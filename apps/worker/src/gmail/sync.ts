// Gmail sync engine (spec §8, Phase 2 rev 2 §5, §6).
// 15-minute cron sync: 5-day backfill then incremental history, batch GETs,
// max 12 new processed emails per account per tick, forward-only auto-transitions,
// and isolated account failure handling.

import { BACKFILL_DAYS } from "./constants.ts";
import { classify } from "../classify/classify.ts";
import { extractCompanies } from "../classify/company.ts";
import { decide } from "../classify/decide.ts";
import { processBodies } from "./bodies.ts";
import { extractRole, sourceForDomain } from "../classify/role.ts";
import { resolveLink, type AppRef } from "../classify/link.ts";
import { aadFor, decryptField, encryptField, keyringFromEnv } from "../crypto/envelope.ts";
import type { Db } from "../db/client.ts";
import type { Status } from "../domain/applications.ts";
import { normalizeName } from "../domain/normalize.ts";
import type { Env } from "../env.ts";
import { log } from "../log/index.ts";
import {
  batchGetGmailMessages,
  getGmailProfile,
  gmailMessageToMeta,
  listGmailHistory,
  listGmailMessages,
  refreshAccessToken,
} from "./client.ts";

export const MAX_NEW_EMAILS_PER_TICK = 12;

interface MailAccountRow {
  id: number;
  email: string;
  status: string;
  refresh_token_enc: string | null;
  access_token_enc: string | null;
  access_expires_at: number | null;
  history_id: string | null;
  backfill_page_token: string | null;
  backfill_floor: number | null;
  backfill_done: number;
  messages_scanned: number;
  granted_scope: string | null;
}

export async function syncMailAccounts(
  env: Env,
  db: Db,
  now: number,
  fetchFn: typeof fetch = fetch,
): Promise<{ processed: number; accountsSynced: number }> {
  const ring = keyringFromEnv(env);
  const accounts = await db.all<MailAccountRow>(
    "SELECT id, email, status, refresh_token_enc, access_token_enc, access_expires_at, history_id, backfill_page_token, backfill_floor, backfill_done, messages_scanned, granted_scope FROM mail_accounts WHERE status = 'active'",
  );

  let totalProcessed = 0;
  let accountsSynced = 0;

  for (const account of accounts) {
    if (db.budget.remaining < 5) {
      log("sync_budget_exhausted", { id: account.id });
      break;
    }

    try {
      const res = await syncSingleAccount(env, db, ring, account, now, fetchFn);
      totalProcessed += res.processed;
      accountsSynced++;
    } catch (err) {
      const message = (err as Error).message || "";
      const isAuthError =
        message.includes("invalid_grant") ||
        message.includes("token_refresh_failed") ||
        message.includes("401");

      if (isAuthError) {
        log("mail_reauth_needed", { id: account.id });
        await db.run(
          "UPDATE mail_accounts SET status = 'needs_reauth', reauth_since = ?, last_error_code = 'invalid_grant' WHERE id = ?",
          now,
          account.id,
        );
      } else {
        log("sync_account_error", { id: account.id });
        await db.run(
          "UPDATE mail_accounts SET last_error_code = 'sync_error' WHERE id = ?",
          account.id,
        );
      }
    }
  }

  return { processed: totalProcessed, accountsSynced };
}

async function getOrRefreshAccessToken(
  env: Env,
  db: Db,
  ring: ReturnType<typeof keyringFromEnv>,
  account: MailAccountRow,
  now: number,
  fetchFn: typeof fetch,
): Promise<string> {
  if (
    account.access_token_enc &&
    account.access_expires_at &&
    account.access_expires_at > now + 120
  ) {
    return await decryptField(
      ring,
      account.access_token_enc,
      aadFor("mail_accounts", "access_token", account.email),
    );
  }

  if (!account.refresh_token_enc || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("missing_refresh_token_or_config");
  }

  const refreshToken = await decryptField(
    ring,
    account.refresh_token_enc,
    aadFor("mail_accounts", "refresh_token", account.email),
  );

  const refreshed = await refreshAccessToken({
    refreshToken,
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    fetchFn,
  });

  const newAccessEnc = await encryptField(
    ring,
    refreshed.accessToken,
    aadFor("mail_accounts", "access_token", account.email),
  );
  const newExpiresAt = now + refreshed.expiresIn;

  await db.run(
    "UPDATE mail_accounts SET access_token_enc = ?, access_expires_at = ? WHERE id = ?",
    newAccessEnc,
    newExpiresAt,
    account.id,
  );

  return refreshed.accessToken;
}

async function syncSingleAccount(
  env: Env,
  db: Db,
  ring: ReturnType<typeof keyringFromEnv>,
  account: MailAccountRow,
  now: number,
  fetchFn: typeof fetch,
): Promise<{ processed: number }> {
  const accessToken = await getOrRefreshAccessToken(env, db, ring, account, now, fetchFn);
  await enrichSeen(db, accessToken, account.id, fetchFn);
  await processBodies(env, db, account, accessToken, now, fetchFn);

  // Load active applications for linking
  const appRows = await db.all<{ id: number; company_norm: string; status: Status }>(
    "SELECT id, company_norm, status FROM applications",
  );
  const apps: AppRef[] = appRows.map((a) => ({
    id: a.id,
    company_norm: a.company_norm,
    status: a.status,
  }));

  // Fetch thread linking cache
  const linkedThreads = await db.all<{ thread_id: string; app_id: number }>(
    "SELECT thread_id, app_id FROM emails_seen WHERE account_id = ? AND app_id IS NOT NULL",
    account.id,
  );
  const threadMap = new Map<string, number>();
  for (const t of linkedThreads) {
    threadMap.set(t.thread_id, t.app_id);
  }

  let candidateIds: string[] = [];
  const isBackfill = account.backfill_done === 0;
  let nextBackfillToken: string | null = account.backfill_page_token;
  let nextHistoryId: string | null = account.history_id;
  let backfillFinished = false;

  if (isBackfill) {
    const listRes = await listGmailMessages(
      accessToken,
      { pageToken: account.backfill_page_token ?? undefined, maxResults: 50 },
      fetchFn,
    );
    const msgs = listRes.messages ?? [];
    candidateIds = msgs.map((m) => m.id);
    nextBackfillToken = listRes.nextPageToken ?? null;
    if (!listRes.nextPageToken || msgs.length === 0) {
      backfillFinished = true;
    }
  } else {
    // Incremental sync using history
    if (!account.history_id) {
      const profile = await getGmailProfile(accessToken, fetchFn);
      nextHistoryId = profile.historyId;
      await db.run("UPDATE mail_accounts SET history_id = ? WHERE id = ?", nextHistoryId, account.id);
      return { processed: 0 };
    }

    try {
      const historyRes = await listGmailHistory(
        accessToken,
        account.history_id,
        { maxResults: 100 },
        fetchFn,
      );
      nextHistoryId = historyRes.historyId ?? account.history_id;
      const addedIds = new Set<string>();
      for (const record of historyRes.history ?? []) {
        for (const added of record.messagesAdded ?? []) {
          addedIds.add(added.message.id);
        }
        for (const msg of record.messages ?? []) {
          addedIds.add(msg.id);
        }
      }
      candidateIds = [...addedIds];
    } catch (err) {
      if ((err as Error).message.includes("404")) {
        // History expired: recover from current profile
        const profile = await getGmailProfile(accessToken, fetchFn);
        nextHistoryId = profile.historyId;
        await db.run("UPDATE mail_accounts SET history_id = ? WHERE id = ?", nextHistoryId, account.id);
        return { processed: 0 };
      }
      throw err;
    }
  }

  if (candidateIds.length === 0) {
    await db.run(
      "UPDATE mail_accounts SET last_sync_at = ?, backfill_done = ?, backfill_page_token = ?, history_id = ? WHERE id = ?",
      now,
      backfillFinished ? 1 : account.backfill_done,
      nextBackfillToken,
      nextHistoryId,
      account.id,
    );
    return { processed: 0 };
  }

  // Filter out already seen messages
  const seenRows = await db.all<{ gmail_id: string }>(
    `SELECT gmail_id FROM emails_seen WHERE account_id = ? AND gmail_id IN (${candidateIds.map(() => "?").join(",")})`,
    account.id,
    ...candidateIds,
  );
  const seenSet = new Set(seenRows.map((s) => s.gmail_id));
  const unseenIds = candidateIds.filter((id) => !seenSet.has(id)).slice(0, 50);

  if (unseenIds.length === 0) {
    await db.run(
      "UPDATE mail_accounts SET last_sync_at = ?, backfill_done = ?, backfill_page_token = ?, history_id = ? WHERE id = ?",
      now,
      backfillFinished ? 1 : account.backfill_done,
      nextBackfillToken,
      nextHistoryId,
      account.id,
    );
    return { processed: 0 };
  }

  // Batch GET metadata for unseen messages (1 HTTP subrequest for up to 50 messages!)
  const rawMessages = await batchGetGmailMessages(accessToken, unseenIds, fetchFn);
  let processedCount = 0;
  const floor = Math.max(account.backfill_floor ?? 0, now - BACKFILL_DAYS * 86400);

  for (const rawMsg of rawMessages) {
    const meta = gmailMessageToMeta(rawMsg);
    if (isBackfill && meta.internalDate > 0 && meta.internalDate < floor) {
      backfillFinished = true;
      continue;
    }

    const emailAt = meta.internalDate || now; // dates come from the email, not from when GRU saw it
    const c = classify(meta, [account.email]);
    if (c.cls === "other") {
      // Per spec: other non-job mail is classified in memory and not stored in emails_seen
      continue;
    }

    const threadAppId = threadMap.get(meta.threadId) ?? null;
    const guesses = extractCompanies(c.sender, meta.subject);
    const link = resolveLink(guesses, apps, threadAppId);
    const decision = decide(c, link);
    const role = extractRole(meta.subject);
    if (link.appId && role) {
      // Fill the position from the email subject when the application has none yet (never overwrites Ani's edits).
      await db.run("UPDATE applications SET role = ?, role_norm = ? WHERE id = ? AND role IS NULL", role, normalizeName(role), link.appId);
    }

    if (processedCount >= MAX_NEW_EMAILS_PER_TICK) {
      break;
    }

    // Apply decision
    if (decision.action === "auto_status") {
      const appId = link.appId as number;
      const app = apps.find((a) => a.id === appId);
      const prevStatus = app ? app.status : "applied";

      await db.batch([
        db.stmt(
          "UPDATE applications SET status = ?, last_event_at = MAX(COALESCE(last_event_at, 0), ?), updated_at = ? WHERE id = ?",
          decision.to,
          emailAt,
          now,
          appId,
        ),
        db.stmt(
          "INSERT INTO events (app_id, type, at, account_id, gmail_id, confidence, auto_applied, prev_status, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
          appId,
          `status:${decision.to}`,
          emailAt,
          account.id,
          meta.id,
          c.confidence,
          prevStatus,
          now,
        ),
        db.stmt(
          "INSERT INTO emails_seen (account_id, gmail_id, thread_id, internal_date, from_domain, class, confidence, rule_id, app_id, disposition) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto_applied')",
          account.id,
          meta.id,
          meta.threadId,
          meta.internalDate,
          c.sender.domain,
          c.cls,
          c.confidence,
          c.ruleId,
          appId,
        ),
      ]);
      if (app) app.status = decision.to;
      threadMap.set(meta.threadId, appId);
      processedCount++;
    } else if (decision.action === "create_application") {
      const company = decision.company;
      const companyNorm = normalizeName(company);

      const createRes = await db.run(
        "INSERT INTO applications (company, company_norm, role, role_norm, status, source, applied_at, last_event_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'applied', ?, ?, ?, ?, ?)",
        company,
        companyNorm,
        role,
        role ? normalizeName(role) : null,
        sourceForDomain(c.sender.domain),
        emailAt,
        emailAt,
        now,
        now,
      );
      const newAppId = createRes.meta.last_row_id as number;
      apps.push({ id: newAppId, company_norm: companyNorm, status: "applied" });
      threadMap.set(meta.threadId, newAppId);

      await db.batch([
        db.stmt(
          "INSERT INTO events (app_id, type, at, account_id, gmail_id, confidence, auto_applied, created_at) VALUES (?, 'status_change', ?, ?, ?, ?, 1, ?)",
          newAppId,
          emailAt,
          account.id,
          meta.id,
          c.confidence,
          now,
        ),
        db.stmt(
          "INSERT INTO emails_seen (account_id, gmail_id, thread_id, internal_date, from_domain, class, confidence, rule_id, app_id, disposition) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto_applied')",
          account.id,
          meta.id,
          meta.threadId,
          meta.internalDate,
          c.sender.domain,
          c.cls,
          c.confidence,
          c.ruleId,
          newAppId,
        ),
      ]);
      processedCount++;
    } else if (decision.action === "link_only") {
      const appId = link.appId;
      await db.batch([
        ...(appId
          ? [db.stmt("UPDATE applications SET last_event_at = MAX(COALESCE(last_event_at, 0), ?), updated_at = ? WHERE id = ?", emailAt, now, appId)]
          : []),
        db.stmt(
          "INSERT INTO emails_seen (account_id, gmail_id, thread_id, internal_date, from_domain, class, confidence, rule_id, app_id, disposition) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'linked')",
          account.id,
          meta.id,
          meta.threadId,
          meta.internalDate,
          c.sender.domain,
          c.cls,
          c.confidence,
          c.ruleId,
          appId,
        ),
      ]);
      if (appId) threadMap.set(meta.threadId, appId);
      processedCount++;
    } else if (decision.action === "alert") {
      await db.run(
        "INSERT INTO emails_seen (account_id, gmail_id, thread_id, internal_date, from_domain, class, confidence, rule_id, app_id, disposition) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'alert')",
        account.id,
        meta.id,
        meta.threadId,
        meta.internalDate,
        c.sender.domain,
        c.cls,
        c.confidence,
        c.ruleId,
      );
      processedCount++;
    } else if (decision.action === "review") {
      // Store encrypted context for review (deleted upon resolution)
      const reviewContext = JSON.stringify({
        subject: meta.subject,
        from: c.sender.name || c.sender.domain,
        received_at: emailAt,
      });
      // Pre-insert to obtain review_queue id for AAD
      const insRes = await db.run(
        "INSERT INTO review_queue (kind, account_id, gmail_id, app_id, proposal_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        decision.kind,
        account.id,
        meta.id,
        link.appId,
        JSON.stringify({
          class: c.cls,
          confidence: c.confidence,
          suggested: decision.suggested,
          reason: decision.reason,
          company: link.company?.name ?? null,
        }),
        now,
      );
      const reviewId = insRes.meta.last_row_id as number;
      const contextEnc = await encryptField(
        ring,
        reviewContext,
        aadFor("review_queue", "context", reviewId),
      );

      await db.batch([
        db.stmt("UPDATE review_queue SET context_enc = ? WHERE id = ?", contextEnc, reviewId),
        db.stmt(
          "INSERT INTO emails_seen (account_id, gmail_id, thread_id, internal_date, from_domain, class, confidence, rule_id, app_id, disposition) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')",
          account.id,
          meta.id,
          meta.threadId,
          meta.internalDate,
          c.sender.domain,
          c.cls,
          c.confidence,
          c.ruleId,
          link.appId,
        ),
      ]);
      processedCount++;
    }
  }

  if (unseenIds.length > 0) {
    await db.run(
      `UPDATE emails_seen SET enriched = 1 WHERE account_id = ? AND gmail_id IN (${unseenIds.map(() => "?").join(",")})`,
      account.id,
      ...unseenIds,
    );
  }

  await db.run(
    "UPDATE mail_accounts SET last_sync_at = ?, backfill_done = ?, backfill_page_token = ?, history_id = ?, messages_scanned = messages_scanned + ?, last_success_at = ? WHERE id = ?",
    now,
    backfillFinished ? 1 : account.backfill_done,
    nextBackfillToken,
    nextHistoryId,
    unseenIds.length,
    now,
    account.id,
  );

  return { processed: processedCount };
}

/**
 * One-time (and self-healing) pass over emails imported before role/source extraction existed:
 * re-reads only their headers (batch GET, 1 subrequest per 50), fills in a missing position, and
 * corrects the source for applications GRU created automatically. Never touches fields Ani has set.
 */
async function enrichSeen(db: Db, accessToken: string, accountId: number, fetchFn: typeof fetch): Promise<void> {
  const rows = await db.all<{ gmail_id: string; app_id: number }>(
    "SELECT gmail_id, app_id FROM emails_seen WHERE account_id = ? AND enriched = 0 AND app_id IS NOT NULL ORDER BY internal_date DESC LIMIT 50",
    accountId,
  );
  if (rows.length === 0) return;
  const appByMsg = new Map(rows.map((r) => [r.gmail_id, r.app_id]));
  const raw = await batchGetGmailMessages(accessToken, rows.map((r) => r.gmail_id), fetchFn);
  const stmts: D1PreparedStatement[] = [];
  for (const msg of raw) {
    const meta = gmailMessageToMeta(msg);
    const appId = appByMsg.get(meta.id);
    if (!appId) continue;
    const role = extractRole(meta.subject);
    if (role) stmts.push(db.stmt("UPDATE applications SET role = ?, role_norm = ? WHERE id = ? AND role IS NULL", role, normalizeName(role), appId));
    const source = sourceForDomain(classify(meta, []).sender.domain);
    if (source !== "email") stmts.push(db.stmt("UPDATE applications SET source = ? WHERE id = ? AND source = 'email'", source, appId));
  }
  stmts.push(db.stmt(`UPDATE emails_seen SET enriched = 1 WHERE account_id = ? AND gmail_id IN (${rows.map(() => "?").join(",")})`, accountId, ...rows.map((r) => r.gmail_id)));
  await db.batch(stmts);
}
