// Reads the BODY of job-application emails, and only those: emails whose headers were already classified as job mail
// AND linked to one of Ani's applications (Ani's decision, 2026-11-15, DECISIONS D-058). All other mail stays header-only.
// Bodies live in memory for the duration of this function. Only extracted facts are saved (position, interview time,
// meeting link), and the link is encrypted. Nothing is written to Gmail.
import { BACKFILL_DAYS } from "./constants.ts";
import { batchGetGmailMessages, GmailApiError, hasBodyAccess } from "./client.ts";
import { messageBody } from "./body.ts";
import { extractInterviewTimes, extractMeetingLink, extractRoleFromBody } from "../classify/body.ts";
import type { Db } from "../db/client.ts";
import { normalizeName } from "../domain/normalize.ts";
import type { Env } from "../env.ts";
import { encJson } from "../lib/enc.ts";
import { log } from "../log/index.ts";

/** The only email classes whose bodies may be opened. Job alerts, recruiter outreach and "other" are never opened. */
export const BODY_CLASSES = ["application_received", "application_update", "assessment", "interview_invite", "interview_update", "rejection", "offer", "info_request"] as const;
const INTERVIEW_CLASSES = new Set<string>(["interview_invite", "interview_update"]);
// Kept small: each body costs ~0.5-2 ms of CPU and Workers Free allows 10 ms per invocation. 3 per 15-minute tick = 288 emails/day.
export const BODIES_PER_TICK = 3;

interface Row { gmail_id: string; app_id: number; class: string; internal_date: number }

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
    `SELECT gmail_id, app_id, class, internal_date FROM emails_seen
     WHERE account_id = ? AND body_checked = 0 AND app_id IS NOT NULL AND class IN (${BODY_CLASSES.map(() => "?").join(",")}) AND internal_date >= ?
     ORDER BY internal_date DESC LIMIT ${BODIES_PER_TICK}`,
    account.id,
    ...BODY_CLASSES,
    now - BACKFILL_DAYS * 86400,
  );
  if (rows.length === 0) return 0;

  let msgs;
  try {
    msgs = await batchGetGmailMessages(accessToken, rows.map((r) => r.gmail_id), fetchFn, "full");
  } catch (e) {
    if (e instanceof GmailApiError && (e.status === 403 || e.status === 401)) {
      // Connection doesn't actually have body access: fall back to header-only and let Settings prompt a reconnect.
      await db.run("UPDATE mail_accounts SET granted_scope = NULL WHERE id = ?", account.id);
      log("body_access_denied", { id: account.id });
    }
    return 0; // transient errors: try again next tick
  }

  const byId = new Map(rows.map((r) => [r.gmail_id, r]));
  let facts = 0;
  for (const msg of msgs) {
    const row = byId.get(msg.id);
    if (!row) continue;
    const { text, html } = messageBody(msg);
    facts += await applyFacts(env, db, row, text, html, now);
  }
  await db.run(
    `UPDATE emails_seen SET body_checked = 1 WHERE account_id = ? AND gmail_id IN (${rows.map(() => "?").join(",")})`,
    account.id,
    ...rows.map((r) => r.gmail_id),
  );
  return facts;
}

async function applyFacts(env: Env, db: Db, row: Row, text: string, html: string, now: number): Promise<number> {
  let facts = 0;
  const app = await db.first<{ id: number; role: string | null }>("SELECT id, role FROM applications WHERE id = ?", row.app_id);
  if (!app) return 0;

  if (!app.role) {
    const role = extractRoleFromBody(text);
    if (role) {
      await db.run("UPDATE applications SET role = ?, role_norm = ? WHERE id = ? AND role IS NULL", role, normalizeName(role), app.id);
      facts++;
    }
  }

  if (INTERVIEW_CLASSES.has(row.class)) {
    const link = extractMeetingLink(text, html);
    const { times } = extractInterviewTimes(text, row.internal_date);
    const when = times.length === 1 ? (times[0] as number) : null; // several candidate slots: Ani picks the time
    if (link || when) {
      const open = await db.all<{ id: number; state: string; start_utc: number | null }>(
        "SELECT id, state, start_utc FROM interviews WHERE app_id = ? AND state IN ('proposed','scheduled') ORDER BY id DESC LIMIT 5",
        app.id,
      );
      let target = when ? open.find((i) => i.start_utc !== null && Math.abs(i.start_utc - when) <= 3600) : open.find((i) => i.state === "proposed" && i.start_utc === null);
      if (!target && when) target = open.find((i) => i.state === "proposed" && i.start_utc === null);
      let id = target?.id;
      if (target && when && target.start_utc === null) await db.run("UPDATE interviews SET start_utc = ?, updated_at = ? WHERE id = ?", when, now, target.id);
      if (!target) {
        const ins = await db.first<{ id: number }>(
          "INSERT INTO interviews (app_id, state, start_utc, tz, format, created_at, updated_at) VALUES (?, 'proposed', ?, 'Pacific/Auckland', ?, ?, ?) RETURNING id",
          app.id, when, link ? "video" : null, now, now,
        );
        id = ins?.id;
        await db.run("INSERT INTO events (app_id, type, at, created_at) VALUES (?, 'interview_proposed', ?, ?)", app.id, row.internal_date, now);
        facts++;
      }
      if (id && link) {
        await db.run("UPDATE interviews SET link_enc = ? WHERE id = ?", await encJson(env, "interviews", "link_enc", id, link), id);
        facts++;
      }
    }
  }
  return facts;
}
