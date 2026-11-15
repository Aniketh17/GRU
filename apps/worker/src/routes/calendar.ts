// Calendar: interviews (with meeting links), deadlines found in emails, tasks, and job closing dates in one place,
// plus a private subscription feed for Apple / Google Calendar (the URL contains a secret token).
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { b64urlEncode, utf8 } from "../crypto/b64.ts";
import { timingSafeEqual } from "../crypto/hmac.ts";
import type { Db } from "../db/client.ts";
import { nowSec, type Env } from "../env.ts";
import { safeJson } from "../http/hygiene.ts";
import { buildIcs, type IcsEvent } from "../lib/ics.ts";
import { decJson, decText } from "../lib/enc.ts";
import { aucklandDate } from "../lib/timezone.ts";

export const calendarRoutes = new Hono<AppEnv>();
export const calendarFeedRoutes = new Hono<AppEnv>();

export type ItemKind = "interview" | "deadline" | "task" | "closing";
export interface CalendarItem {
  key: string;
  kind: ItemKind;
  title: string;
  start: number;
  all_day: boolean;
  state: "scheduled" | "proposed" | "open" | "done";
  company: string | null;
  link: { url: string; kind: string } | null;
  app_id: number | null;
  job_id: number | null;
  ref_id: number;
}

const DEADLINE_LABEL: Record<string, string> = { assessment: "Assessment due", offer_reply: "Reply to offer", interview_reply: "Confirm interview", other: "Action needed" };

export async function calendarItems(env: Env, db: Db, from: number, to: number): Promise<CalendarItem[]> {
  const out: CalendarItem[] = [];

  const interviews = await db.all<{ id: number; app_id: number; state: string; start_utc: number; link_enc: string | null; company: string }>(
    `SELECT i.id, i.app_id, i.state, i.start_utc, i.link_enc, a.company FROM interviews i JOIN applications a ON a.id = i.app_id
     WHERE i.state IN ('scheduled','proposed') AND i.start_utc IS NOT NULL AND i.start_utc BETWEEN ? AND ?`,
    from, to,
  );
  for (const i of interviews) {
    const link = await decJson<{ url: string; kind: string }>(env, "interviews", "link_enc", i.id, i.link_enc);
    out.push({
      key: `i${i.id}`, kind: "interview", title: `${i.state === "proposed" ? "Interview? " : "Interview · "}${i.company}`, start: i.start_utc, all_day: false,
      state: i.state === "proposed" ? "proposed" : "scheduled", company: i.company, link: link && /^https:\/\//.test(link.url) ? link : null, app_id: i.app_id, job_id: null, ref_id: i.id,
    });
  }

  const deadlines = await db.all<{ id: number; app_id: number | null; kind: string; due_at: number; done: number; company: string | null }>(
    "SELECT d.id, d.app_id, d.kind, d.due_at, d.done, a.company FROM deadlines d LEFT JOIN applications a ON a.id = d.app_id WHERE d.due_at BETWEEN ? AND ?",
    from, to,
  );
  for (const d of deadlines) {
    out.push({
      key: `d${d.id}`, kind: "deadline", title: `${DEADLINE_LABEL[d.kind] ?? "Deadline"}${d.company ? ` · ${d.company}` : ""}`, start: d.due_at, all_day: false,
      state: d.done ? "done" : "open", company: d.company, link: null, app_id: d.app_id, job_id: null, ref_id: d.id,
    });
  }

  const tasks = await db.all<{ id: number; title_enc: string; due_at: number; done_at: number | null; app_id: number | null }>(
    "SELECT id, title_enc, due_at, done_at, app_id FROM tasks WHERE due_at IS NOT NULL AND due_at BETWEEN ? AND ?",
    from, to,
  );
  for (const t of tasks) {
    // Tasks added by date only are stored at local noon: shown as all-day.
    const noon = new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t.due_at * 1000)) === "12:00";
    out.push({
      key: `t${t.id}`, kind: "task", title: (await decText(env, "tasks", "title_enc", t.id, t.title_enc)) ?? "Task", start: t.due_at, all_day: noon,
      state: t.done_at ? "done" : "open", company: null, link: null, app_id: t.app_id, job_id: null, ref_id: t.id,
    });
  }

  const jobs = await db.all<{ id: number; title: string; company: string | null; closing_at: number }>(
    "SELECT id, title, company, closing_at FROM jobs WHERE closing_at BETWEEN ? AND ? AND status NOT IN ('dismissed','applied','expired','closed')",
    from, to,
  );
  for (const j of jobs) {
    out.push({
      key: `j${j.id}`, kind: "closing", title: `Closes: ${j.title}${j.company ? ` · ${j.company}` : ""}`, start: j.closing_at, all_day: true,
      state: "open", company: j.company, link: null, app_id: null, job_id: j.id, ref_id: j.id,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

const Range = z.object({ from: z.coerce.number().int().min(0), to: z.coerce.number().int().min(0) });

calendarRoutes.get("/", async (c) => {
  const now = nowSec();
  const q = Range.safeParse({ from: c.req.query("from") ?? now - 7 * 86400, to: c.req.query("to") ?? now + 60 * 86400 });
  if (!q.success || q.data.to - q.data.from > 120 * 86400) return c.json({ error: "bad_request" }, 400);
  return c.json({ items: await calendarItems(c.env, c.get("db"), q.data.from, q.data.to) });
});

const Done = z.object({ done: z.boolean() });
calendarRoutes.patch("/deadlines/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = Done.safeParse(await safeJson(c.req));
  if (!b.success || !Number.isInteger(id)) return c.json({ error: "bad_request" }, 400);
  const r = await c.get("db").run("UPDATE deadlines SET done = ? WHERE id = ?", b.data.done ? 1 : 0, id);
  return r.meta.changes === 1 ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

// ---------------------------------------------------------------- private feed
async function feedToken(db: Db, reset = false): Promise<string> {
  const row = reset ? null : await db.first<{ v: string }>("SELECT v FROM kv WHERE k = 'cal_token'");
  if (row?.v) return row.v;
  const token = b64urlEncode(crypto.getRandomValues(new Uint8Array(24)));
  await db.run("INSERT INTO kv (k, v) VALUES ('cal_token', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v", token);
  return token;
}

calendarRoutes.get("/feed", async (c) => c.json({ url: `${c.env.APP_ORIGIN}/cal/${await feedToken(c.get("db"))}.ics` }));
calendarRoutes.post("/feed/reset", async (c) => c.json({ url: `${c.env.APP_ORIGIN}/cal/${await feedToken(c.get("db"), true)}.ics` }));

/** Public (token-protected, read-only) feed: no session, so calendar apps can fetch it. */
calendarFeedRoutes.get("/:file", async (c) => {
  const file = c.req.param("file");
  const token = file.endsWith(".ics") ? file.slice(0, -4) : "";
  const db = c.get("db");
  const stored = await db.first<{ v: string }>("SELECT v FROM kv WHERE k = 'cal_token'");
  if (!token || !stored?.v || !timingSafeEqual(utf8.encode(token), utf8.encode(stored.v))) return c.json({ error: "not_found" }, 404);
  const now = nowSec();
  const items = await calendarItems(c.env, db, now - 30 * 86400, now + 150 * 86400);
  const events: IcsEvent[] = items
    .filter((i) => i.state !== "done")
    .map((i) => ({
      uid: `${i.kind}-${i.ref_id}`,
      summary: i.title,
      start: i.all_day ? aucklandDate(i.start) : i.start,
      end: i.kind === "interview" ? i.start + 3600 : i.start + 1800,
      ...(i.link ? { url: i.link.url, location: i.link.kind, description: `Join ${i.link.kind}: ${i.link.url}` } : {}),
      ...(i.state === "proposed" ? { tentative: true, description: "Time found in an email: please confirm it in GRU." } : {}),
      ...(i.kind === "interview" ? { alarmMinutes: 30 } : {}),
      category: i.kind === "interview" ? "Interview" : i.kind === "deadline" ? "Deadline" : i.kind === "closing" ? "Job closing" : "Task",
    }));
  return new Response(buildIcs(events, now), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=300", "Content-Disposition": 'inline; filename="gru.ics"' },
  });
});
