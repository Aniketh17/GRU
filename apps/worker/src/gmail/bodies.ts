// Reads the BODY of job mail (Ani's decision, 2026-11-15, D-058) to understand it by its words.
// Eligible mail = rows GRU already stored as job-related from their headers (job classes, known job-board/ATS/assessment/scheduler
// senders, or replies in a linked thread). Everything else is never fetched. Bodies live in memory only; what is kept are facts:
// the class + rule id, position, vacancies from alerts, deadlines, an interview proposal + encrypted meeting link, a contact.
import { BACKFILL_DAYS } from "./constants.ts";
import { batchGetGmailMessages, GmailApiError, gmailMessageToMeta, hasBodyAccess } from "./client.ts";
import { messageBody, mimeShape } from "./body.ts";
import { countJobLinks, extractVacancies } from "../classify/alerts.ts";
import { extractInterviewTimes, extractMeetingLink, extractRoleFromBody } from "../classify/body.ts";
import { classifyBody, type BodyClass } from "../classify/bodyrules.ts";
import { parseFrom } from "../classify/classify.ts";
import { extractCompanies } from "../classify/company.ts";
import { extractDeadlines } from "../classify/deadlines.ts";
import { decide, type Decision, type LinkResult } from "../classify/decide.ts";
import { resolveLink, type AppRef } from "../classify/link.ts";
import { extractRole, sourceForDomain } from "../classify/role.ts";
import type { Classification, MailClass } from "../classify/types.ts";
import { aadFor, encryptField, keyringFromEnv } from "../crypto/envelope.ts";
import type { Db } from "../db/client.ts";
import type { Status } from "../domain/applications.ts";
import { normalizeName } from "../domain/normalize.ts";
import type { Env } from "../env.ts";
import { classifyWithAi } from "../lib/aiclassify.ts";
import { encJson } from "../lib/enc.ts";
import { log } from "../log/index.ts";
import { getSettings } from "../routes/settings.ts";

/** Each body costs ~0.5-2 ms CPU and Workers Free allows 10 ms per invocation: cap both the count and the characters handled. */
export const BODIES_PER_TICK = 6; // an upper bound: the call budget usually stops it sooner
export const BODY_CHAR_BUDGET = 45_000; // ~3 ms warm; one heavy alert per tick, up to 6 ordinary emails
const INTERVIEW_CLASSES = new Set<string>(["interview_invite", "interview_update"]);
const EVENT_CLASSES = new Set<string>(["application_received", "assessment", "interview_invite", "interview_update", "rejection", "offer", "info_request", "application_update"]);

/** Remaining call budget needed to start a batch, and to start each email (an email costs about 4-11 calls). */
const MIN_BUDGET_TO_START = 16;
const MIN_BUDGET_PER_EMAIL = 12;

interface Row { gmail_id: string; app_id: number | null; class: string | null; internal_date: number; thread_id: string; disposition: string }

export async function processBodies(
  env: Env,
  db: Db,
  account: { id: number; granted_scope: string | null },
  accessToken: string,
  now: number,
  fetchFn: typeof fetch,
  reserve = 0, // call budget to leave untouched for whatever runs after (the notification scheduler)
): Promise<number> {
  if (!hasBodyAccess(account.granted_scope)) return 0;
  if (db.budget.remaining < MIN_BUDGET_TO_START + reserve) return 0;
  const rows = await db.all<Row>(
    `SELECT gmail_id, app_id, class, internal_date, thread_id, disposition FROM emails_seen
     WHERE account_id = ? AND body_checked = 0 AND internal_date >= ?
     ORDER BY (app_id IS NOT NULL) DESC, internal_date DESC LIMIT ${BODIES_PER_TICK}`, // mail tied to an application first: status changes matter most
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
    if (chars > BODY_CHAR_BUDGET || db.budget.remaining < MIN_BUDGET_PER_EMAIL + reserve) break; // finish the rest next tick
    const { text, html } = messageBody(msg);
    chars += text.length + html.length;
    facts += await understand(env, db, account.id, row, gmailMessageToMeta(msg), text, html, apps, settings.auto_status_from_text, now, mimeShape(msg.payload));
    done.add(row.gmail_id);
  }
  await release(ids.filter((id) => !done.has(id) && msgs.some((m) => m.id === id))); // fetched but out of budget
  return facts;
}

type Meta = ReturnType<typeof gmailMessageToMeta>;

async function understand(
  env: Env, db: Db, accountId: number, row: Row, meta: Meta, text: string, html: string, apps: AppRef[], autoStatus: boolean, now: number, shape: string,
): Promise<number> {
  let facts = 0;
  const tail: D1PreparedStatement[] = []; // independent writes, sent as ONE batch (a batch costs one call)
  const flush = () => (tail.length ? db.batch(tail.splice(0)) : Promise.resolve());
  const emailAt = row.internal_date;
  const sender = parseFrom(meta.from);
  const jobLinks = countJobLinks(html);
  let bodyC: BodyClass | null = classifyBody(text, jobLinks);
  const headerCls = (row.class ?? "other") as MailClass;
  // Words win when they are clear; otherwise keep what the headers said.
  // "Thank you for applying" often comes before bad news in different words: when the rules only see a generic acknowledgement
  // (or nothing) in job mail, ask the AI for a second opinion. It must quote the proving sentence, which is verified (lib/aiclassify.ts).
  const generic = !bodyC || bodyC.cls === "application_received" || bodyC.cls === "application_update";
  if (generic && (headerCls === "application_received" || headerCls === "application_update" || headerCls === "other")) {
    const ai = await classifyWithAi(env, db, text, now);
    if (ai && ai.cls !== (bodyC?.cls ?? headerCls)) bodyC = ai;
  }
  const cls: MailClass = bodyC && bodyC.confidence >= 0.8 ? bodyC.cls : headerCls;
  const confidence = bodyC && bodyC.cls === cls ? bodyC.confidence : 0.75;
  // Always record what was read (length only, never the text) so a silent failure to read an email is visible.
  tail.push(db.stmt("UPDATE emails_seen SET class = ?, body_class = ?, body_chars = ?, body_shape = ? WHERE account_id = ? AND gmail_id = ?", cls, bodyC?.rule ?? null, text.length, shape, accountId, row.gmail_id));

  // ---- job alert: pull out the individual vacancies
  if (cls === "alert") {
    for (const v of extractVacancies(html)) {
      tail.push(db.stmt(
        `INSERT INTO jobs (source, source_account_id, source_gmail_id, source_domain, canonical_url, title, company, company_norm, location, status,
           first_seen_at, last_seen_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?, 'new', ?,?,?,?)
         ON CONFLICT DO NOTHING`,
        v.source, accountId, row.gmail_id, sender.domain, v.url, v.title, v.company, v.company ? normalizeName(v.company) : null, v.location, emailAt, emailAt, now, now,
      ));
      facts++;
    }
    tail.push(db.stmt("UPDATE emails_seen SET disposition = 'alert' WHERE account_id = ? AND gmail_id = ?", accountId, row.gmail_id));
    await flush();
    return facts;
  }
  if (cls === "other") {
    await flush();
    return 0;
  }

  // ---- link to an application (headers already tried; try again with the better class). One lookup answers everything we need.
  const info = (id: number) =>
    db.first<{ id: number; status: Status; role: string | null; company: string; same_thread: number; origin: number; undone: number; has_email_event: number }>(
      `SELECT a.id, a.status, a.role, a.company,
         EXISTS(SELECT 1 FROM emails_seen e WHERE e.account_id = ?2 AND e.thread_id = ?3 AND e.app_id = a.id AND e.gmail_id != ?4) AS same_thread,
         EXISTS(SELECT 1 FROM events v WHERE v.app_id = a.id AND v.gmail_id = ?4 AND v.type = 'status_change') AS origin,
         EXISTS(SELECT 1 FROM events v WHERE v.app_id = a.id AND v.gmail_id = ?4 AND v.undone = 1) AS undone,
         EXISTS(SELECT 1 FROM events v WHERE v.app_id = a.id AND v.gmail_id = ?4 AND v.type LIKE 'email:%') AS has_email_event
       FROM applications a WHERE a.id = ?1`,
      id, accountId, row.thread_id, row.gmail_id,
    );
  let appId = row.app_id;
  let appInfo = appId ? await info(appId) : null;
  const guesses = extractCompanies(sender, meta.subject);
  const link: LinkResult = appInfo
    ? { appId: appInfo.id, appStatus: appInfo.status, via: "company", company: { name: appInfo.company, confident: true }, ambiguous: false }
    : resolveLink(guesses, apps, null);
  // The very email that created the application (e.g. "Thank you for applying" whose body then says "we chose another candidate")
  // is as certain a link as a reply in the same thread.
  if (appInfo && (cls === "rejection" || cls === "offer") && (appInfo.same_thread || appInfo.origin)) link.via = "thread";
  // If Ani already undid a change made from this email, never redo it when the email is re-read.
  const undoneByUser = Boolean(appInfo?.undone);
  if (!appInfo && link.appId) {
    appId = link.appId;
    appInfo = await info(appId);
  }
  let appRow: { id: number; status: Status; role: string | null; company: string } | null = appInfo
    ? { id: appInfo.id, status: appInfo.status, role: appInfo.role, company: appInfo.company }
    : null;
  let hasEmailEvent = Boolean(appInfo?.has_email_event);

  // ---- decide what the email means for the application (same rules as the header pass, with better evidence)
  const c: Classification = { cls, confidence, ruleId: `body.${bodyC?.rule ?? "header"}`, tie: false, forwarded: false, sender };
  const decision: Decision = undoneByUser ? { action: "link_only", reason: "Ani undid an earlier change from this email" } : decide(c, link, { autoApplyHighImpact: autoStatus });
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
      tail.push(
        db.stmt("UPDATE emails_seen SET disposition = 'auto_applied', app_id = ? WHERE account_id = ? AND gmail_id = ?", created.id, accountId, row.gmail_id),
        db.stmt("INSERT INTO events (app_id, type, at, account_id, gmail_id, confidence, auto_applied, created_at) VALUES (?, 'status_change', ?, ?, ?, ?, 1, ?)", created.id, emailAt, accountId, row.gmail_id, confidence, now),
      );
      facts++;
    }
  } else if (decision.action === "review") {
    const proposal = JSON.stringify({ class: cls, confidence, suggested: decision.suggested, reason: `${decision.reason} (from the email text)`, company: link.company?.name ?? null });
    const existing = await db.first<{ id: number; resolved_at: number | null }>("SELECT id, resolved_at FROM review_queue WHERE account_id = ? AND gmail_id = ? ORDER BY id DESC LIMIT 1", accountId, row.gmail_id);
    if (existing && existing.resolved_at === null) {
      tail.push(db.stmt("UPDATE review_queue SET kind = ?, proposal_json = ?, app_id = COALESCE(app_id, ?) WHERE id = ?", decision.kind, proposal, appId, existing.id));
    } else if (!existing) {
      const ins = await db.first<{ id: number }>(
        "INSERT INTO review_queue (kind, account_id, gmail_id, app_id, proposal_json, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
        decision.kind, accountId, row.gmail_id, appId, proposal, now,
      );
      if (ins) {
        const ctx = await encryptField(keyringFromEnv(env), JSON.stringify({ subject: meta.subject, from: sender.name || sender.domain, received_at: emailAt }), aadFor("review_queue", "context", ins.id));
        tail.push(
          db.stmt("UPDATE review_queue SET context_enc = ? WHERE id = ?", ctx, ins.id),
          db.stmt("UPDATE emails_seen SET disposition = 'queued' WHERE account_id = ? AND gmail_id = ?", accountId, row.gmail_id),
        );
        facts++;
      }
    }
  } else if (decision.action === "link_only" && appRow) {
    tail.push(
      db.stmt("UPDATE applications SET last_event_at = MAX(COALESCE(last_event_at, 0), ?), updated_at = ? WHERE id = ?", emailAt, now, appRow.id),
      db.stmt("UPDATE emails_seen SET app_id = ?, disposition = CASE WHEN disposition = 'candidate' THEN 'linked' ELSE disposition END WHERE account_id = ? AND gmail_id = ?", appRow.id, accountId, row.gmail_id),
    );
  }
  if (!appRow) {
    await flush();
    return facts;
  }

  // ---- what the email adds to the timeline, the position, deadlines and interviews
  if (EVENT_CLASSES.has(cls) && !hasEmailEvent) {
    tail.push(db.stmt("INSERT INTO events (app_id, type, at, account_id, gmail_id, confidence, auto_applied, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)", appRow.id, `email:${cls}`, emailAt, accountId, row.gmail_id, confidence, now));
    hasEmailEvent = true;
  }
  if (!appRow.role) {
    const role = extractRoleFromBody(text) ?? extractRole(meta.subject);
    if (role) {
      tail.push(db.stmt("UPDATE applications SET role = ?, role_norm = ? WHERE id = ? AND role IS NULL", role, normalizeName(role), appRow.id));
      facts++;
    }
  }
  for (const d of extractDeadlines(text, emailAt, cls)) {
    tail.push(db.stmt("INSERT OR IGNORE INTO deadlines (app_id, kind, due_at, account_id, gmail_id, created_at) VALUES (?, ?, ?, ?, ?, ?)", appRow.id, d.kind, d.at, accountId, row.gmail_id, now));
    facts++;
  }
  await flush();
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
