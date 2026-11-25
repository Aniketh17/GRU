// Inbox triage (Revamp 3D): mail GRU could not classify. Ani decides what it is, links it, or says it is not job related.
// Nothing here talks to Gmail: only what was already stored (encrypted subject and sender, kept 30 days).
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { normalizeName } from "../domain/normalize.ts";
import { nowSec } from "../env.ts";
import { safeJson } from "../http/hygiene.ts";
import { decText } from "../lib/enc.ts";
import { log } from "../log/index.ts";

export const inboxRoutes = new Hono<AppEnv>();
export const INBOX_RETENTION_SECONDS = 30 * 86400;

const CLASSES = ["rejection", "offer", "interview", "assessment", "application_received", "update", "recruiter", "alert"] as const;
/** What each choice means for an application's status (null = does not change the status). */
const STATUS_FOR: Record<(typeof CLASSES)[number], string | null> = {
  rejection: "rejected", offer: "offer", interview: "interview", assessment: "assessment",
  application_received: "applied", update: null, recruiter: null, alert: null,
};
const MAIL_CLASS: Record<(typeof CLASSES)[number], string> = {
  rejection: "rejection", offer: "offer", interview: "interview_invite", assessment: "assessment",
  application_received: "application_received", update: "application_update", recruiter: "recruiter_outreach", alert: "alert",
};

interface Row { account_id: number; gmail_id: string; internal_date: number; from_domain: string | null; class: string | null; body_chars: number | null; app_id: number | null; subject_enc: string | null; from_enc: string | null }

inboxRoutes.get("/", async (c) => {
  const db = c.get("db");
  const now = nowSec();
  const rows = await db.all<Row>(
    `SELECT account_id, gmail_id, internal_date, from_domain, class, body_chars, app_id, subject_enc, from_enc FROM emails_seen
     WHERE disposition = 'candidate' AND ignored = 0 AND user_class IS NULL AND body_checked = 1 AND internal_date >= ?
     ORDER BY internal_date DESC LIMIT 60`, now - INBOX_RETENTION_SECONDS);
  const [rules, apps] = await Promise.all([
    db.all<{ domain: string; created_at: number }>("SELECT domain, created_at FROM sender_rules ORDER BY created_at DESC LIMIT 100"),
    db.all<{ id: number; company: string; role: string | null; status: string }>("SELECT id, company, role, status FROM applications ORDER BY COALESCE(last_event_at, applied_at) DESC LIMIT 60"),
  ]);
  const items = await Promise.all(rows.map(async (r) => ({
    account_id: r.account_id, gmail_id: r.gmail_id, at: r.internal_date, domain: r.from_domain,
    subject: await decText(c.env, "emails_seen", "subject_enc", `${r.account_id}:${r.gmail_id}`, r.subject_enc),
    from: await decText(c.env, "emails_seen", "from_enc", `${r.account_id}:${r.gmail_id}`, r.from_enc),
    app_id: r.app_id,
    unreadable: (r.body_chars ?? 0) === 0,
  })));
  return c.json({ items, blocked: rules.map((r) => r.domain), applications: apps, classes: CLASSES });
});

const Classify = z.object({
  account_id: z.number().int().positive(),
  gmail_id: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/),
  class: z.enum(CLASSES),
  app_id: z.number().int().positive().optional(),
  create: z.object({ company: z.string().trim().min(1).max(160), role: z.string().trim().max(200).optional() }).optional(),
});

inboxRoutes.post("/classify", async (c) => {
  const b = Classify.safeParse(await safeJson(c.req));
  if (!b.success) return c.json({ error: "bad_request" }, 400);
  const { account_id, gmail_id, create } = b.data;
  const db = c.get("db");
  const row = await db.first<{ internal_date: number }>("SELECT internal_date FROM emails_seen WHERE account_id = ? AND gmail_id = ?", account_id, gmail_id);
  if (!row) return c.json({ error: "not_found" }, 404);
  const now = nowSec();
  const at = row.internal_date || now;
  const status = STATUS_FOR[b.data.class];
  let appId = b.data.app_id ?? null;
  if (appId && !(await db.first("SELECT id FROM applications WHERE id = ?", appId))) return c.json({ error: "application_not_found" }, 404);
  const stmts = [];
  if (!appId && create) {
    const ins = await db.first<{ id: number }>(
      `INSERT INTO applications (company, company_norm, role, role_norm, source, status, applied_at, last_event_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'email', ?, ?, ?, ?, ?) RETURNING id`,
      create.company, normalizeName(create.company), create.role ?? null, create.role ? normalizeName(create.role) : null, status ?? "applied", at, at, now, now);
    appId = (ins as { id: number }).id;
    stmts.push(db.stmt("INSERT INTO events (app_id, type, at, account_id, gmail_id, auto_applied, created_at) VALUES (?, 'created', ?, ?, ?, 0, ?)", appId, at, account_id, gmail_id, now));
  } else if (appId && status) {
    const app = await db.first<{ status: string }>("SELECT status FROM applications WHERE id = ?", appId);
    if (app && app.status !== status) {
      stmts.push(
        db.stmt("UPDATE applications SET status = ?, last_event_at = MAX(COALESCE(last_event_at, 0), ?), updated_at = ? WHERE id = ?", status, at, now, appId),
        db.stmt("INSERT INTO events (app_id, type, at, account_id, gmail_id, auto_applied, prev_status, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)", appId, `status:${status}`, at, account_id, gmail_id, app.status, now),
      );
    }
  }
  stmts.push(db.stmt(
    "UPDATE emails_seen SET user_class = ?, class = ?, app_id = ?, disposition = ?, subject_enc = NULL, from_enc = NULL WHERE account_id = ? AND gmail_id = ?",
    b.data.class, MAIL_CLASS[b.data.class], appId, appId ? "linked" : "ignored", account_id, gmail_id));
  await db.batch(stmts);
  log("inbox_classified", { class: b.data.class, linked: Boolean(appId) });
  return c.json({ ok: true, app_id: appId });
});

const Ignore = z.object({ account_id: z.number().int().positive(), gmail_id: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/), block_sender: z.boolean().optional() });

// "Not job related": forgotten at once (subject and sender deleted) and optionally never read again from that sender's domain.
inboxRoutes.post("/ignore", async (c) => {
  const b = Ignore.safeParse(await safeJson(c.req));
  if (!b.success) return c.json({ error: "bad_request" }, 400);
  const db = c.get("db");
  const row = await db.first<{ from_domain: string | null }>("SELECT from_domain FROM emails_seen WHERE account_id = ? AND gmail_id = ?", b.data.account_id, b.data.gmail_id);
  if (!row) return c.json({ error: "not_found" }, 404);
  const stmts = [db.stmt("UPDATE emails_seen SET ignored = 1, user_class = 'not_job', disposition = 'ignored', subject_enc = NULL, from_enc = NULL WHERE account_id = ? AND gmail_id = ?", b.data.account_id, b.data.gmail_id)];
  if (b.data.block_sender && row.from_domain) {
    stmts.push(
      db.stmt("INSERT INTO sender_rules (domain, action, created_at) VALUES (?, 'ignore', ?) ON CONFLICT(domain) DO NOTHING", row.from_domain, nowSec()),
      db.stmt("UPDATE emails_seen SET ignored = 1, disposition = 'ignored', subject_enc = NULL, from_enc = NULL WHERE from_domain = ? AND disposition = 'candidate' AND app_id IS NULL", row.from_domain),
    );
  }
  await db.batch(stmts);
  return c.json({ ok: true, blocked: b.data.block_sender === true ? row.from_domain : null });
});

inboxRoutes.delete("/rules/:domain", async (c) => {
  await c.get("db").run("DELETE FROM sender_rules WHERE domain = ?", c.req.param("domain").toLowerCase());
  return c.json({ deleted: true });
});

inboxRoutes.get("/count", async (c) => {
  const r = await c.get("db").first<{ n: number }>(
    "SELECT COUNT(*) AS n FROM emails_seen WHERE disposition = 'candidate' AND ignored = 0 AND user_class IS NULL AND body_checked = 1 AND internal_date >= ?", nowSec() - INBOX_RETENTION_SECONDS);
  return c.json({ count: r?.n ?? 0 });
});
