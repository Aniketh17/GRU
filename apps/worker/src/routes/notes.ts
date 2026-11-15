// Notes (blind-index search), tasks, agenda and weekly review (spec sections 11, 12, 21).
// Note bodies and task titles are encrypted. Search uses HMAC(INDEX_KEY, word) tokens, never plaintext.
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { b64urlEncode } from "../crypto/b64.ts";
import { hmacSha256 } from "../crypto/hmac.ts";
import type { Db } from "../db/client.ts";
import { nowSec, type Env } from "../env.ts";
import { safeJson } from "../http/hygiene.ts";
import { decText, encText } from "../lib/enc.ts";
import { aucklandDate } from "../lib/timezone.ts";

export const noteRoutes = new Hono<AppEnv>();
export const taskRoutes = new Hono<AppEnv>();
export const agendaRoutes = new Hono<AppEnv>();

export function tokenize(text: string): string[] {
  return [...new Set(text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]{3,}/g) ?? [])].slice(0, 200);
}
const tokenHash = async (env: Env, t: string) => b64urlEncode(await hmacSha256(env.INDEX_KEY ?? "", t));

const NoteBody = z.object({ body: z.string().min(1).max(10_000), tags: z.array(z.string().regex(/^[a-z0-9-]{1,24}$/)).max(8).default([]) });

interface NoteRow { id: number; body_enc: string; tags: string | null; created_at: number; updated_at: number }

async function presentNote(env: Env, r: NoteRow) {
  return { id: r.id, body: await decText(env, "notes", "body_enc", r.id, r.body_enc), tags: r.tags ? r.tags.split(",").filter(Boolean) : [], created_at: r.created_at, updated_at: r.updated_at };
}

async function reindex(env: Env, db: Db, id: number, body: string): Promise<D1PreparedStatement[]> {
  const hashes = await Promise.all(tokenize(body).map((t) => tokenHash(env, t)));
  return [db.stmt("DELETE FROM note_tokens WHERE note_id = ?", id), ...hashes.map((h) => db.stmt("INSERT INTO note_tokens (note_id, token_hmac) VALUES (?, ?)", id, h))];
}

noteRoutes.get("/", async (c) => {
  const rows = await c.get("db").all<NoteRow>("SELECT id, body_enc, tags, created_at, updated_at FROM notes ORDER BY updated_at DESC LIMIT 50");
  return c.json({ items: await Promise.all(rows.map((r) => presentNote(c.env, r))) });
});

noteRoutes.get("/search", async (c) => {
  const tokens = tokenize(c.req.query("q") ?? "").slice(0, 6);
  if (tokens.length === 0) return c.json({ error: "query_too_short" }, 400);
  const hashes = await Promise.all(tokens.map((t) => tokenHash(c.env, t)));
  const db = c.get("db");
  const ids = await db.all<{ note_id: number }>(
    `SELECT note_id FROM note_tokens WHERE token_hmac IN (${hashes.map(() => "?").join(",")}) GROUP BY note_id HAVING COUNT(DISTINCT token_hmac) = ? LIMIT 50`,
    ...hashes, hashes.length,
  );
  if (ids.length === 0) return c.json({ items: [] });
  const rows = await db.all<NoteRow>(`SELECT id, body_enc, tags, created_at, updated_at FROM notes WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY updated_at DESC`, ...ids.map((i) => i.note_id));
  return c.json({ items: await Promise.all(rows.map((r) => presentNote(c.env, r))) });
});

noteRoutes.post("/", async (c) => {
  const b = NoteBody.safeParse(await safeJson(c.req));
  if (!b.success) return c.json({ error: "bad_request" }, 400);
  const db = c.get("db");
  const now = nowSec();
  const ins = await db.first<{ id: number }>("INSERT INTO notes (body_enc, tags, created_at, updated_at) VALUES ('pending', ?, ?, ?) RETURNING id", b.data.tags.join(","), now, now);
  const id = (ins as { id: number }).id;
  await db.batch([db.stmt("UPDATE notes SET body_enc = ? WHERE id = ?", await encText(c.env, "notes", "body_enc", id, b.data.body), id), ...(await reindex(c.env, db, id, b.data.body))]);
  return c.json({ id }, 201);
});

noteRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = NoteBody.safeParse(await safeJson(c.req));
  if (!b.success || !Number.isInteger(id)) return c.json({ error: "bad_request" }, 400);
  const db = c.get("db");
  if (!(await db.first("SELECT id FROM notes WHERE id = ?", id))) return c.json({ error: "not_found" }, 404);
  await db.batch([
    db.stmt("UPDATE notes SET body_enc = ?, tags = ?, updated_at = ? WHERE id = ?", await encText(c.env, "notes", "body_enc", id, b.data.body), b.data.tags.join(","), nowSec(), id),
    ...(await reindex(c.env, db, id, b.data.body)),
  ]);
  return c.json({ ok: true });
});

noteRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = c.get("db");
  await db.batch([db.stmt("DELETE FROM note_tokens WHERE note_id = ?", id), db.stmt("DELETE FROM notes WHERE id = ?", id)]);
  return c.json({ deleted: true });
});

// ---------------------------------------------------------------- tasks
const TaskBody = z.object({
  title: z.string().min(1).max(300),
  due_at: z.number().int().min(0).max(4_102_444_800).nullable().optional(),
  priority: z.number().int().min(1).max(3).default(2),
  kind: z.enum(["task", "call", "interview_prep"]).default("task"),
  app_id: z.number().int().positive().nullable().optional(),
  note_id: z.number().int().positive().nullable().optional(),
});
const TaskPatch = z.object({
  title: z.string().min(1).max(300).optional(),
  due_at: z.number().int().min(0).max(4_102_444_800).nullable().optional(),
  priority: z.number().int().min(1).max(3).optional(),
  done: z.boolean().optional(),
});

interface TaskRow { id: number; title_enc: string; due_at: number | null; priority: number; kind: string; done_at: number | null; app_id: number | null; note_id: number | null; created_at: number }
const TASK_COLS = "id, title_enc, due_at, priority, kind, done_at, app_id, note_id, created_at";

async function presentTask(env: Env, r: TaskRow) {
  return { id: r.id, title: await decText(env, "tasks", "title_enc", r.id, r.title_enc), due_at: r.due_at, priority: r.priority, kind: r.kind, done_at: r.done_at, app_id: r.app_id, note_id: r.note_id };
}

taskRoutes.get("/", async (c) => {
  const done = c.req.query("status") === "done";
  const rows = await c.get("db").all<TaskRow>(
    `SELECT ${TASK_COLS} FROM tasks WHERE done_at IS ${done ? "NOT " : ""}NULL ORDER BY ${done ? "done_at DESC" : "COALESCE(due_at, 9999999999) ASC, priority ASC"} LIMIT 50`,
  );
  return c.json({ items: await Promise.all(rows.map((r) => presentTask(c.env, r))) });
});

taskRoutes.post("/", async (c) => {
  const b = TaskBody.safeParse(await safeJson(c.req));
  if (!b.success) return c.json({ error: "bad_request" }, 400);
  const db = c.get("db");
  const now = nowSec();
  const v = b.data;
  const ins = await db.first<{ id: number }>(
    "INSERT INTO tasks (title_enc, due_at, priority, kind, app_id, note_id, created_at, updated_at) VALUES ('pending', ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    v.due_at ?? null, v.priority, v.kind, v.app_id ?? null, v.note_id ?? null, now, now,
  );
  const id = (ins as { id: number }).id;
  await db.run("UPDATE tasks SET title_enc = ? WHERE id = ?", await encText(c.env, "tasks", "title_enc", id, v.title), id);
  return c.json({ id }, 201);
});

taskRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = TaskPatch.safeParse(await safeJson(c.req));
  if (!b.success || !Number.isInteger(id)) return c.json({ error: "bad_request" }, 400);
  const v = b.data;
  const now = nowSec();
  const sets = ["updated_at = ?"];
  const p: (string | number | null)[] = [now];
  if (v.title !== undefined) { sets.push("title_enc = ?"); p.push(await encText(c.env, "tasks", "title_enc", id, v.title)); }
  if (v.due_at !== undefined) { sets.push("due_at = ?"); p.push(v.due_at); }
  if (v.priority !== undefined) { sets.push("priority = ?"); p.push(v.priority); }
  if (v.done !== undefined) { sets.push("done_at = ?"); p.push(v.done ? now : null); }
  const r = await c.get("db").run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, ...p, id);
  return r.meta.changes === 1 ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

taskRoutes.delete("/:id", async (c) => {
  await c.get("db").run("DELETE FROM tasks WHERE id = ?", Number(c.req.param("id")));
  return c.json({ deleted: true });
});

// ---------------------------------------------------------------- agenda + weekly review
agendaRoutes.get("/", async (c) => {
  const db = c.get("db");
  const now = nowSec();
  const today = aucklandDate(now);
  const rows = await db.all<TaskRow>(`SELECT ${TASK_COLS} FROM tasks WHERE done_at IS NULL ORDER BY COALESCE(due_at, 9999999999) ASC, priority ASC LIMIT 100`);
  const tasks = await Promise.all(rows.map((r) => presentTask(c.env, r)));
  const weekEnd = aucklandDate(now + 7 * 86400);
  const bucket = { overdue: [] as typeof tasks, today: [] as typeof tasks, upcoming: [] as typeof tasks, someday: [] as typeof tasks };
  for (const t of tasks) {
    if (t.due_at === null) bucket.someday.push(t);
    else {
      const d = aucklandDate(t.due_at);
      if (d < today) bucket.overdue.push(t);
      else if (d === today) bucket.today.push(t);
      else if (d <= weekEnd) bucket.upcoming.push(t);
    }
  }
  const interviews = await db.all<{ id: number; app_id: number; company: string; start_utc: number; format: string | null }>(
    `SELECT i.id, i.app_id, a.company, i.start_utc, i.format FROM interviews i JOIN applications a ON a.id = i.app_id
     WHERE i.state = 'scheduled' AND i.start_utc >= ? AND i.start_utc <= ? ORDER BY i.start_utc ASC`,
    now, now + 7 * 86400,
  );
  return c.json({ date: today, ...bucket, interviews });
});

agendaRoutes.get("/weekly", async (c) => {
  const db = c.get("db");
  const now = nowSec();
  const since = now - 7 * 86400;
  const n = async (sql: string, ...p: number[]) => (await db.first<{ n: number }>(sql, ...p))?.n ?? 0;
  return c.json({
    date: aucklandDate(now),
    is_sunday: new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", weekday: "short" }).format(new Date(now * 1000)) === "Sun",
    applications_added: await n("SELECT COUNT(*) AS n FROM applications WHERE created_at >= ?", since),
    status_changes: await n("SELECT COUNT(*) AS n FROM events WHERE type LIKE 'status:%' AND undone = 0 AND at >= ?", since),
    interviews_done: await n("SELECT COUNT(*) AS n FROM interviews WHERE state = 'done' AND updated_at >= ?", since),
    tasks_done: await n("SELECT COUNT(*) AS n FROM tasks WHERE done_at >= ?", since),
    tasks_open: await n("SELECT COUNT(*) AS n FROM tasks WHERE done_at IS NULL"),
    notes_added: await n("SELECT COUNT(*) AS n FROM notes WHERE created_at >= ?", since),
    checkins_done: await n("SELECT COUNT(*) AS n FROM checkins WHERE status = 'completed' AND completed_at >= ?", since),
    jobs_found: await n("SELECT COUNT(*) AS n FROM jobs WHERE first_seen_at >= ?", since),
  });
});
