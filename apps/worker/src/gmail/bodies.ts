// Reads the BODY of job mail (Ani's decision, 2026-11-15, D-058) to understand it by its words.
// Eligible mail = rows GRU already stored as job-related from their headers (job classes, known job-board/ATS/assessment/scheduler
// senders, or replies in a linked thread). Everything else is never fetched. Bodies live in memory only; what is kept are facts:
// the class + rule id, position, vacancies from alerts, deadlines, an interview proposal + encrypted meeting link, a contact.
import { BACKFILL_DAYS } from "./constants.ts";
import { batchGetGmailMessages, GmailApiError, gmailMessageToMeta, hasBodyAccess } from "./client.ts";
import { messageBody } from "./body.ts";
import { countJobLinks, extractVacancies } from "../classify/alerts.ts";
import { extractInterviewTimes, extractMeetingLink, extractRoleFromBody } from "../classify/body.ts";
import { classifyBody } from "../classify/bodyrules.ts";
import { parseFrom } from "../classify/classify.ts";
import { extractCompanies } from "../classify/company.ts";
import { extractDeadlines } from "../classify/deadlines.ts";
import { decide, type LinkResult } from "../classify/decide.ts";
import { resolveLink, type AppRef } from "../classify/link.ts";
import { extractRole, sourceForDomain } from "../classify/role.ts";
import type { Classification, MailClass } from "../classify/types.ts";
import { aadFor, encryptField, keyringFromEnv } from "../crypto/envelope.ts";
import type { Db } from "../db/client.ts";
import type { Status } from "../domain/applications.ts";
import { normalizeName } from "../domain/normalize.ts";
import type { Env } from "../env.ts";
import { encJson } from "../lib/enc.ts";
import { log } from "../log/index.ts";
import { getSettings } from "../routes/settings.ts";

/** Each body costs ~0.5-2 ms CPU and Workers Free allows 10 ms per invocation: cap both the count and the characters handled. */
export const BODIES_PER_TICK = 6;
export const BODY_CHAR_BUDGET = 45_000; // ~3 ms warm; one heavy alert per tick, up to 6 ordinary emails
const INTERVIEW_CLASSES = new Set<string>(["interview_invite", "interview_update"]);
const EVENT_CLASSES = new Set<string>(["application_received", "assessment", "interview_invite", "interview_update", "rejection", "offer", "info_request", "application_update"]);

interface Row { gmail_id: string; app_id: number | null; class: string | null; internal_date: number; thread_id: string; disposition: string }

export async function processBodies(
  env: Env,
  db: Db,
  account: { id: number; granted_scope: string | null },
  accessToken: string,
  now: number,
  fetchFn: typeof fetch,
): Promise<number> {
  if (!hasBodyAccess(account.granted_scope)) return 0;
  const rows = await db.all<Row>(
    `SELECT gmail_id, app_id, class, internal_date, thread_id, disposition FROM emails_seen
     WHERE account_id = ? AND body_checked = 0 AND internal_date >= ?
     ORDER BY internal_date DESC LIMIT ${BODIES_PER_TICK}`,
    account.id,
    now - BACKFILL_DAYS * 86400,
  );
  if (rows.length === 0) return 0;

  // Mark first, process after: if processing ever failed hard (e.g. hit the CPU limit) the email is skipped next time
  // instead of being retried forever. Whatever we did not get to is released again below.
  const ids = rows.map((r) => r.gmail_id);
  const placeholders = ids.map(() => "?").join(",");
  await db.run(`UPDATE emails_seen SET body_checked = 1 WHERE account_id = ? AND gmail_id IN (${placeholders})`, account.id, ...ids);
  const release = (list: string[]) =>
    list.length ? db.run(`UPDATE emails_seen SET body_checked = 0 WHERE account_id = ? AND gmail_id IN (${list.map(() => "?").join(",")})`, account.id, ...list) : Promise.resolve();

  let msgs;
  try {
    msgs = await batchGetGmailMessages(accessToken, ids, fetchFn, "full");
  } catch (e) {
    if (e instanceof GmailApiError && (e.status === 403 || e.status === 401)) {
      // Connection doesn't actually have body access: fall back to header-only and let Settings prompt a reconnect.
      await db.run("UPDATE mail_accounts SET granted_scope = NULL WHERE id = ?", account.id);
      log("body_access_denied", { id: account.id });
    }
    await release(ids); // transient errors: try again next tick
    return 0;
  }

  const settings = await getSettings(db);
  const apps = await db.all<AppRef>("SELECT id, company_norm, status FROM applications");
  const byId = new Map(rows.map((r) => [r.gmail_id, r]));
  let facts = 0;
  let chars = 0;
  const done = new Set<string>();
  for (const msg of msgs) {
    const row = byId.get(msg.id);
    if (!row) continue;
    if (chars > BODY_CHAR_BUDGET) break; // finish the rest next tick
    const { text, html } = messageBody(msg);
    chars += text.length + html.length;
    facts += await understand(env, db, account.id, row, gmailMessageToMeta(msg), text, html, apps, settings.auto_status_from_text, now);
    done.add(row.gmail_id);
  }
  await release(ids.filter((id) => !done.has(id) && msgs.some((m) => m.id === id))); // fetched but out of budget
  return facts;
}

type Meta = ReturnType<typeof gmailMessageToMeta>;

async function understand(
  env: Env, db: Db, accountId: number, row: Row, meta: Meta, text: string, html: string, apps: AppRef[], autoStatus: boolean, now: number,
): Promise<number> {
  let facts = 0;
  const emailAt = row.internal_date;
  const sender = parseFrom(meta.from);
  const jobLinks = countJobLinks(html);
  const bodyC = classifyBody(text, jobLinks);
  const headerCls = (row.class ?? "other") as MailClass;
  // Words win when they are clear; otherwise keep what the headers said.
  const cls: MailClass = bodyC && bodyC.confidence >= 0.8 ? bodyC.cls : headerCls;
  const confidence = bodyC && bodyC.cls === cls ? bodyC.confidence : 0.75;
  if (cls !== headerCls || bodyC) {
    await db.run("UPDATE emails_seen SET class = ?, body_class = ? WHERE account_id = ? AND gmail_id = ?", cls, bodyC?.rule ?? null, accountId, row.gmail_id);
  }

  // ---- job alert: pull out the individual vacancies
  if (cls === "alert") {
    for (const v of extractVacancies(html)) {
      const ins = await db.run(
        `INSERT INTO jobs (source, source_account_id, source_gmail_id, source_domain, canonical_url, title, company, company_norm, location, status,
           first_seen_at, last_seen_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?, 'new', ?,?,?,?)
         ON CONFLICT DO NOTHING`,
        v.source, accountId, row.gmail_id, sender.domain, v.url, v.title, v.company, v.company ? normalizeName(v.company) : null, v.location, emailAt, emailAt, now, now,
      );
      if (ins.meta.changes === 1) facts++;
    }
    await db.run("UPDATE emails_seen SET disposition = 'alert' WHERE account_id = ? AND gmail_id = ?", accountId, row.gmail_id);
    return facts;
  }
  if (cls === "other") return 0;

  // ---- link to an application (headers already tried; try again with the better class)
  let appId = row.app_id;
  let appRow = appId ? await db.first<{ id: number; status: Status; role: string | null; company: string }>("SELECT id, status, role, company FROM applications WHERE id = ?", appId) : null;
  const guesses = extractCompanies(sender, meta.subject);
  const link: LinkResult = appRow
    ? { appId: appRow.id, appStatus: appRow.status, via: "company", company: { name: appRow.company, confident: true }, ambiguous: false }
    : resolveLink(guesses, apps, null);
  if (appRow && (cls === "rejection" || cls === "offer")) {
    const sameThread = await db.first("SELECT 1 AS x FROM emails_seen WHERE account_id = ? AND thread_id = ? AND app_id = ? AND gmail_id != ?", accountId, row.thread_id, appRow.id, row.gmail_id);
    if (sameThread) link.via = "thread";
  }
  if (!appRow && link.appId) {
    appId = link.appId;
    appRow = await db.first("SELECT id, status, role, company FROM applications WHERE id = ?", appId);
  }

  // ---- decide what the email means for the application (same rules as the header pass, with better evidence)
  const c: Classification = { cls, confidence, ruleId: `body.${bodyC?.rule ?? "header"}`, tie: false, forwarded: false, sender };
  const decision = decide(c, link, { autoApplyHighImpact: autoStatus });
  if (decision.action === "auto_status" && appRow) {
    await db.batch([
      db.stmt("UPDATE applications SET status = ?, last_event_at = MAX(COALESCE(last_event_at, 0), ?), updated_at = ? WHERE id = ?", decision.to, emailAt, now, appRow.id),
      db.stmt(
        "INSERT INTO events (app_id, type, at, account_id, gmail_id, confidence, auto_applied, prev_status, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
        appRow.id, `status:${decision.to}`, emailAt, accountId, row.gmail_id, confidence, appRow.status, now,
      ),
      db.stmt("UPDATE emails_seen SET disposition = 'auto_applied', app_id = ? WHERE account_id = ? AND gmail_id = ?", appRow.id, accountId, row.gmail_id),
      db.stmt("UPDATE review_queue SET resolved_at = ?, resolution = 'auto_from_text', context_enc = NULL WHERE account_id = ? AND gmail_id = ? AND resolved_at IS NULL", now, accountId, row.gmail_id),
    ]);
    appRow.status = decision.to;
    facts++;
  } else if (decision.action === "create_application" && !appRow) {
    const role = extractRole(meta.subject) ?? extractRoleFromBody(text);
    const created = await db.first<{ id: number }>(
      `INSERT INTO applications (company, company_norm, role, role_norm, status, source, applied_at, last_event_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'applied', ?, ?, ?, ?, ?) RETURNING id`,
      decision.company, normalizeName(decision.company), role, role ? normalizeName(role) : null, sourceForDomain(sender.domain), emailAt, emailAt, now, now,
    );
    if (created) {
      appId = created.id;
      appRow = { id: created.id, status: "applied", role, company: decision.company };
      apps.push({ id: created.id, company_norm: normalizeName(decision.company), status: "applied" });
      await db.run("UPDATE emails_seen SET disposition = 'auto_applied', app_id = ? WHERE account_id = ? AND gmail_id = ?", created.id, accountId, row.gmail_id);
      await db.run("INSERT INTO events (app_id, type, at, account_id, gmail_id, confidence, auto_applied, created_at) VALUES (?, 'status_change', ?, ?, ?, ?, 1, ?)", created.id, emailAt, accountId, row.gmail_id, confidence, now);
      facts++;
    }
  } else if (decision.action === "review") {
    const proposal = JSON.stringify({ class: cls, confidence, suggested: decision.suggested, reason: `${decision.reason} (from the email text)`, company: link.company?.name ?? null });
    const open = await db.first<{ id: number }>("SELECT id FROM review_queue WHERE account_id = ? AND gmail_id = ? AND resolved_at IS NULL", accountId, row.gmail_id);
    if (open) {
      await db.run("UPDATE review_queue SET kind = ?, proposal_json = ?, app_id = COALESCE(app_id, ?) WHERE id = ?", decision.kind, proposal, appId, open.id);
    } else if (!(await db.first("SELECT 1 AS x FROM review_queue WHERE account_id = ? AND gmail_id = ?", accountId, row.gmail_id))) {
      const ins = await db.first<{ id: number }>(
        "INSERT INTO review_queue (kind, account_id, gmail_id, app_id, proposal_json, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
        decision.kind, accountId, row.gmail_id, appId, proposal, now,
      );
      if (ins) {
        const ctx = await encryptField(keyringFromEnv(env), JSON.stringify({ subject: meta.subject, from: sender.name || sender.domain, received_at: emailAt }), aadFor("review_queue", "context", ins.id));
        await db.run("UPDATE review_queue SET context_enc = ? WHERE id = ?", ctx, ins.id);
        await db.run("UPDATE emails_seen SET disposition = 'queued' WHERE account_id = ? AND gmail_id = ?", accountId, row.gmail_id);
        facts++;
      }
    }
  } else if (decision.action === "link_only" && appRow) {
    await db.run("UPDATE applications SET last_event_at = MAX(COALESCE(last_event_at, 0), ?), updated_at = ? WHERE id = ?", emailAt, now, appRow.id);
    await db.run("UPDATE emails_seen SET app_id = ?, disposition = CASE WHEN disposition = 'candidate' THEN 'linked' ELSE disposition END WHERE account_id = ? AND gmail_id = ?", appRow.id, accountId, row.gmail_id);
  }
  if (!appRow) return facts;

  // ---- what the email adds to the timeline, the position, deadlines and interviews
  if (EVENT_CLASSES.has(cls) && !(await db.first("SELECT 1 AS x FROM events WHERE app_id = ? AND gmail_id = ? AND type LIKE 'email:%'", appRow.id, row.gmail_id))) {
    await db.run("INSERT INTO events (app_id, type, at, account_id, gmail_id, confidence, auto_applied, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)", appRow.id, `email:${cls}`, emailAt, accountId, row.gmail_id, confidence, now);
  }
  if (!appRow.role) {
    const role = extractRoleFromBody(text) ?? extractRole(meta.subject);
    if (role) {
      await db.run("UPDATE applications SET role = ?, role_norm = ? WHERE id = ? AND role IS NULL", role, normalizeName(role), appRow.id);
      facts++;
    }
  }
  for (const d of extractDeadlines(text, emailAt, cls)) {
    const r = await db.run("INSERT OR IGNORE INTO deadlines (app_id, kind, due_at, account_id, gmail_id, created_at) VALUES (?, ?, ?, ?, ?, ?)", appRow.id, d.kind, d.at, accountId, row.gmail_id, now);
    if (r.meta.changes === 1) facts++;
  }
  if (INTERVIEW_CLASSES.has(cls)) facts += await proposeInterview(env, db, appRow.id, row, text, html, now);
  return facts;
}

async function proposeInterview(env: Env, db: Db, appId: number, row: Row, text: string, html: string, now: number): Promise<number> {
  let facts = 0;
  const link = extractMeetingLink(text, html);
  const { times } = extractInterviewTimes(text, row.internal_date);
  const when = times.length === 1 ? (times[0] as number) : null; // several candidate slots: Ani picks the time
  if (!link && !when) return 0;
  const open = await db.all<{ id: number; state: string; start_utc: number | null }>(
    "SELECT id, state, start_utc FROM interviews WHERE app_id = ? AND state IN ('proposed','scheduled') ORDER BY id DESC LIMIT 5",
    appId,
  );
  let target = when ? open.find((i) => i.start_utc !== null && Math.abs(i.start_utc - when) <= 3600) : open.find((i) => i.state === "proposed" && i.start_utc === null);
  if (!target && when) target = open.find((i) => i.state === "proposed" && i.start_utc === null);
  let id = target?.id;
  if (target && when && target.start_utc === null) await db.run("UPDATE interviews SET start_utc = ?, updated_at = ? WHERE id = ?", when, now, target.id);
  if (!target) {
    const ins = await db.first<{ id: number }>(
      "INSERT INTO interviews (app_id, state, start_utc, tz, format, created_at, updated_at) VALUES (?, 'proposed', ?, 'Pacific/Auckland', ?, ?, ?) RETURNING id",
      appId, when, link ? "video" : null, now, now,
    );
    id = ins?.id;
    await db.run("INSERT INTO events (app_id, type, at, created_at) VALUES (?, 'interview_proposed', ?, ?)", appId, row.internal_date, now);
    facts++;
  }
  if (id && link) {
    await db.run("UPDATE interviews SET link_enc = ? WHERE id = ?", await encJson(env, "interviews", "link_enc", id, link), id);
    facts++;
  }
  return facts;
}
