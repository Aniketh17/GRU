// Interviews (spec sections 11, 12): records, prep notes, debriefs. Free text is encrypted at rest.
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { nowSec } from "../env.ts";
import { safeJson } from "../http/hygiene.ts";
import { decJson, encJson } from "../lib/enc.ts";
import { log } from "../log/index.ts";

export const interviewRoutes = new Hono<AppEnv>();

const FORMATS = ["video", "phone", "onsite", "assessment"] as const;
const epoch = z.number().int().min(0).max(4_102_444_800);

const Create = z.object({
  app_id: z.number().int().positive(),
  start_utc: epoch,
  tz: z.string().max(64).default("Pacific/Auckland"),
  format: z.enum(FORMATS).default("video"),
  review_id: z.number().int().positive().optional(),
});
const Patch = z.object({
  start_utc: epoch.optional(),
  tz: z.string().max(64).optional(),
  format: z.enum(FORMATS).optional(),
  state: z.enum(["scheduled", "done", "cancelled"]).optional(),
  prep: z.string().max(5000).nullable().optional(),
});
const Debrief = z.object({
  rating: z.number().int().min(1).max(5),
  questions: z.string().max(3000).default(""),
  went_well: z.string().max(3000).default(""),
  improve: z.string().max(3000).default(""),
  followup_sent: z.boolean().default(false),
  next_step: z.string().max(500).default(""),
  next_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
});

interface Row {
  id: number;
  app_id: number;
  state: string;
  start_utc: number | null;
  tz: string | null;
  format: string | null;
  prep_enc: string | null;
  debrief_enc: string | null;
  rating: number | null;
  followup_sent: number;
  company: string;
  role: string | null;
}
const SELECT = `SELECT i.id, i.app_id, i.state, i.start_utc, i.tz, i.format, i.prep_enc, i.debrief_enc, i.rating, i.followup_sent, a.company, a.role
  FROM interviews i JOIN applications a ON a.id = i.app_id`;

async function present(env: AppEnv["Bindings"], r: Row) {
  const prep = await decJson<{ text: string }>(env, "interviews", "prep_enc", r.id, r.prep_enc);
  const debrief = await decJson<Record<string, unknown>>(env, "interviews", "debrief_enc", r.id, r.debrief_enc);
  return {
    id: r.id, app_id: r.app_id, company: r.company, role: r.role, state: r.state, start_utc: r.start_utc, tz: r.tz,
    format: r.format, rating: r.rating, followup_sent: r.followup_sent === 1,
    prep: prep?.text ?? null, debrief,
  };
}

interviewRoutes.get("/", async (c) => {
  const db = c.get("db");
  const appId = Number(c.req.query("app_id") ?? 0);
  const rows = appId
    ? await db.all<Row>(`${SELECT} WHERE i.app_id = ? ORDER BY i.start_utc DESC LIMIT 50`, appId)
    : await db.all<Row>(`${SELECT} WHERE i.state != 'cancelled' ORDER BY i.start_utc DESC LIMIT 50`);
  return c.json({ items: await Promise.all(rows.map((r) => present(c.env, r))) });
});

interviewRoutes.post("/", async (c) => {
  const body = Create.safeParse(await safeJson(c.req));
  if (!body.success) return c.json({ error: "bad_request" }, 400);
  const v = body.data;
  const db = c.get("db");
  const now = nowSec();
  const app = await db.first<{ id: number; status: string }>("SELECT id, status FROM applications WHERE id = ?", v.app_id);
  if (!app) return c.json({ error: "not_found" }, 404);
  const ins = await db.first<{ id: number }>(
    "INSERT INTO interviews (app_id, state, start_utc, tz, format, created_at, updated_at) VALUES (?, 'scheduled', ?, ?, ?, ?, ?) RETURNING id",
    v.app_id, v.start_utc, v.tz, v.format, now, now,
  );
  const stmts = [db.stmt("INSERT INTO events (app_id, type, at, created_at) VALUES (?, 'interview_scheduled', ?, ?)", v.app_id, now, now)];
  if (app.status === "applied" || app.status === "assessment") {
    stmts.push(
      db.stmt("UPDATE applications SET status = 'interview', last_event_at = ?, updated_at = ? WHERE id = ?", now, now, v.app_id),
      db.stmt("INSERT INTO events (app_id, type, at, prev_status, created_at) VALUES (?, 'status:interview', ?, ?, ?)", v.app_id, now, app.status, now),
    );
  }
  if (v.review_id) stmts.push(db.stmt("UPDATE review_queue SET resolved_at = ?, resolution = 'interview_added', context_enc = NULL WHERE id = ? AND resolved_at IS NULL", now, v.review_id));
  await db.batch(stmts);
  log("interview_created", { id: ins?.id ?? 0 });
  return c.json({ id: ins?.id }, 201);
});

interviewRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = Patch.safeParse(await safeJson(c.req));
  if (!Number.isInteger(id) || !body.success) return c.json({ error: "bad_request" }, 400);
  const db = c.get("db");
  const now = nowSec();
  const v = body.data;
  const sets: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [now];
  if (v.start_utc !== undefined) { sets.push("start_utc = ?"); params.push(v.start_utc); }
  if (v.tz !== undefined) { sets.push("tz = ?"); params.push(v.tz); }
  if (v.format !== undefined) { sets.push("format = ?"); params.push(v.format); }
  if (v.state !== undefined) { sets.push("state = ?"); params.push(v.state); }
  if (v.prep !== undefined) { sets.push("prep_enc = ?"); params.push(v.prep ? await encJson(c.env, "interviews", "prep_enc", id, { text: v.prep }) : null); }
  const r = await db.run(`UPDATE interviews SET ${sets.join(", ")} WHERE id = ?`, ...params, id);
  if (r.meta.changes !== 1) return c.json({ error: "not_found" }, 404);
  const row = await db.first<Row>(`${SELECT} WHERE i.id = ?`, id);
  return c.json(await present(c.env, row as Row));
});

interviewRoutes.post("/:id/debrief", async (c) => {
  const id = Number(c.req.param("id"));
  const body = Debrief.safeParse(await safeJson(c.req));
  if (!Number.isInteger(id) || !body.success) return c.json({ error: "bad_request" }, 400);
  const db = c.get("db");
  const now = nowSec();
  const v = body.data;
  const row = await db.first<{ app_id: number }>("SELECT app_id FROM interviews WHERE id = ?", id);
  if (!row) return c.json({ error: "not_found" }, 404);
  const enc = await encJson(c.env, "interviews", "debrief_enc", id, {
    questions: v.questions, went_well: v.went_well, improve: v.improve, next_step: v.next_step, next_date: v.next_date,
  });
  await db.batch([
    db.stmt("UPDATE interviews SET debrief_enc = ?, rating = ?, followup_sent = ?, state = 'done', updated_at = ? WHERE id = ?", enc, v.rating, v.followup_sent ? 1 : 0, now, id),
    db.stmt("UPDATE applications SET last_event_at = ?, updated_at = ?, next_action = ? WHERE id = ?", now, now, v.next_step ? v.next_step.slice(0, 200) : null, row.app_id),
    db.stmt("INSERT INTO events (app_id, type, at, created_at) VALUES (?, 'interview_debrief', ?, ?)", row.app_id, now, now),
  ]);
  return c.json({ ok: true });
});

interviewRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "bad_request" }, 400);
  await c.get("db").run("DELETE FROM interviews WHERE id = ?", id);
  return c.json({ deleted: true });
});
