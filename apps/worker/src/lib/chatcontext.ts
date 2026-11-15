// A compact, read-only snapshot of what GRU knows, handed to the chat model as DATA (never as instructions).
// Everything here is already visible to Ani in the app. Strings are trimmed; the whole snapshot is kept small to save Neurons.
import { aadFor, decryptField, keyringFromEnv } from "../crypto/envelope.ts";
import type { Db } from "../db/client.ts";
import type { Env } from "../env.ts";
import { decJson, decText } from "./enc.ts";

const trim = (s: string | null | undefined, n = 90): string => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const when = (epoch: number) =>
  new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(epoch * 1000));
const dayOnly = (epoch: number) => new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", weekday: "short", day: "numeric", month: "short" }).format(new Date(epoch * 1000));
const ago = (epoch: number, now: number) => {
  const d = Math.floor((now - epoch) / 86400);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};

export interface ChatIds {
  jobs: Set<number>;
  applications: Set<number>;
  reviews: Set<number>;
}

export async function buildChatContext(env: Env, db: Db, now: number): Promise<{ data: Record<string, unknown>; ids: ChatIds }> {
  const ids: ChatIds = { jobs: new Set(), applications: new Set(), reviews: new Set() };
  const ring = keyringFromEnv(env);

  const reviewRows = await db.all<{ id: number; kind: string; app_id: number | null; proposal_json: string | null; context_enc: string | null; created_at: number; company: string | null; received_at: number | null }>(
    `SELECT r.id, r.kind, r.app_id, r.proposal_json, r.context_enc, r.created_at, a.company, e.internal_date AS received_at
     FROM review_queue r LEFT JOIN applications a ON a.id = r.app_id
     LEFT JOIN emails_seen e ON e.account_id = r.account_id AND e.gmail_id = r.gmail_id
     WHERE r.resolved_at IS NULL ORDER BY r.created_at DESC LIMIT 8`,
  );
  const review_emails = [];
  for (const r of reviewRows) {
    ids.reviews.add(r.id);
    let ctx: { subject?: string; from?: string } = {};
    if (r.context_enc) {
      try { ctx = JSON.parse(await decryptField(ring, r.context_enc, aadFor("review_queue", "context", r.id))); } catch { /* unreadable: omit */ }
    }
    let p: { class?: string; suggested?: string | null; company?: string | null } = {};
    try { p = JSON.parse(r.proposal_json ?? "{}"); } catch { /* ignore */ }
    review_emails.push({
      id: r.id, subject: trim(ctx.subject), from: trim(ctx.from, 50), received: dayOnly(r.received_at ?? r.created_at),
      looks_like: p.class ?? r.kind, suggested_status: p.suggested ?? null, company: trim(r.company ?? p.company ?? "", 50),
    });
  }
  const reviewCount = (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM review_queue WHERE resolved_at IS NULL"))?.n ?? 0;

  const apps = await db.all<{ id: number; company: string; role: string | null; status: string; source: string; last: number | null; applied: number | null }>(
    `SELECT id, company, role, status, source, COALESCE(last_event_at, applied_at, created_at) AS last, applied_at AS applied
     FROM applications ORDER BY (status IN ('applied','assessment','interview','offer')) DESC, COALESCE(last_event_at, applied_at, created_at) DESC LIMIT 25`,
  );
  for (const a of apps) ids.applications.add(a.id);
  const applications = apps.map((a) => ({ id: a.id, company: trim(a.company, 50), role: trim(a.role, 60) || null, status: a.status, via: a.source, last_update: a.last ? ago(a.last, now) : null }));

  const interviews = (await db.all<{ company: string; start_utc: number; state: string; has_link: number }>(
    `SELECT a.company, i.start_utc, i.state, (i.link_enc IS NOT NULL) AS has_link FROM interviews i JOIN applications a ON a.id = i.app_id
     WHERE i.state IN ('scheduled','proposed') AND i.start_utc BETWEEN ? AND ? ORDER BY i.start_utc LIMIT 6`, now - 3600, now + 14 * 86400,
  )).map((i) => ({ company: trim(i.company, 50), when: when(i.start_utc), confirmed: i.state === "scheduled", has_meeting_link: Boolean(i.has_link) }));

  const deadlines = (await db.all<{ company: string | null; kind: string; due_at: number }>(
    `SELECT a.company, d.kind, d.due_at FROM deadlines d LEFT JOIN applications a ON a.id = d.app_id WHERE d.done = 0 AND d.due_at BETWEEN ? AND ? ORDER BY d.due_at LIMIT 5`, now - 3600, now + 14 * 86400,
  )).map((d) => ({ company: trim(d.company ?? "", 50), what: d.kind.replace("_", " "), due: when(d.due_at) }));

  const taskRows = await db.all<{ id: number; title_enc: string; due_at: number | null }>("SELECT id, title_enc, due_at FROM tasks WHERE done_at IS NULL ORDER BY COALESCE(due_at, 9999999999) LIMIT 8");
  const tasks = [];
  for (const t of taskRows) tasks.push({ title: trim(await decText(env, "tasks", "title_enc", t.id, t.title_enc), 80), due: t.due_at ? dayOnly(t.due_at) : null });

  const jobRows = await db.all<{ id: number; title: string; company: string | null; location: string | null; source: string; source_gmail_id: string | null; first_seen_at: number; score: number | null; confidence: string | null; status: string }>(
    `SELECT j.id, j.title, j.company, j.location, j.source, j.source_gmail_id, j.first_seen_at, m.score, m.confidence, j.status
     FROM jobs j LEFT JOIN job_matches m ON m.job_id = j.id AND m.resume_profile_id = (SELECT id FROM resume_profiles WHERE active = 1 LIMIT 1)
     WHERE j.status IN ('new','shortlisted','saved') ORDER BY COALESCE(m.score, -1) DESC, j.first_seen_at DESC LIMIT 10`,
  );
  for (const j of jobRows) ids.jobs.add(j.id);
  const jobs = jobRows.map((j) => ({
    id: j.id, title: trim(j.title, 80), company: trim(j.company ?? "", 50) || null, location: trim(j.location ?? "", 40) || null, score: j.score,
    provisional: j.confidence === "low" || undefined, status: j.status,
    came_from: j.source_gmail_id ? `${j.source} job alert, ${dayOnly(j.first_seen_at)}` : "added by you",
  }));

  const events = (await db.all<{ company: string; type: string; at: number; auto_applied: number; prev_status: string | null }>(
    `SELECT a.company, e.type, e.at, e.auto_applied, e.prev_status FROM events e JOIN applications a ON a.id = e.app_id
     WHERE e.created_at >= ? AND (e.type LIKE 'email:%' OR e.type LIKE 'status:%') AND e.undone = 0 ORDER BY e.at DESC LIMIT 10`, now - 4 * 86400,
  )).map((e) => ({
    company: trim(e.company, 50), what: e.type.startsWith("status:") ? `status changed to ${e.type.slice(7)}${e.auto_applied ? " automatically (undo available)" : ""}` : `${e.type.slice(6).replace("_", " ")} email`, when: ago(e.at, now),
  }));

  const contacts: unknown[] = [];
  const crows = await db.all<{ id: number; name_enc: string | null; company: string | null; last_contact_at: number }>("SELECT id, name_enc, company, last_contact_at FROM contacts ORDER BY last_contact_at DESC LIMIT 5");
  for (const c of crows) {
    const name = await decJson<string>(env, "contacts", "name_enc", c.id, c.name_enc);
    if (name) contacts.push({ name: trim(name, 40), company: trim(c.company ?? "", 40), last_wrote: ago(c.last_contact_at, now) });
  }

  return {
    ids,
    data: { now: `${when(now)} (Auckland time)`, review_email_count: reviewCount, review_emails, applications, interviews, deadlines, tasks, jobs, recent_email_events: events, contacts },
  };
}
