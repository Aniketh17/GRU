// POST /api/events/:id/undo: revert a status change within 24 hours (spec section 9).
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { UNDO_WINDOW_SECONDS } from "../domain/applications.ts";
import { nowSec } from "../env.ts";
import { log } from "../log/index.ts";

export const eventRoutes = new Hono<AppEnv>();

eventRoutes.get("/recent", async (c) => {
  const db = c.get("db");
  const since = nowSec() - 86400 * 2; // last 48 hours
  const rows = await db.all<{
    id: number;
    app_id: number;
    type: string;
    at: number;
    prev_status: string | null;
    auto_applied: number;
    undone: number;
    company: string;
    current_status: string;
  }>(
    `SELECT e.id, e.app_id, e.type, e.at, e.prev_status, e.auto_applied, e.undone,
            a.company, a.status as current_status
     FROM events e
     JOIN applications a ON e.app_id = a.id
     WHERE e.at >= ? AND e.type LIKE 'status:%'
     ORDER BY e.at DESC
     LIMIT 20`,
    since,
  );
  return c.json({ items: rows });
});

eventRoutes.post("/:id/undo", async (c) => {
  const raw = c.req.param("id");
  if (!/^\d{1,12}$/.test(raw)) return c.json({ error: "not_found" }, 404);
  const id = Number(raw);
  const db = c.get("db");
  const now = nowSec();
  const ev = await db.first<{ app_id: number; prev_status: string | null; undone: number; created_at: number; type: string }>(
    "SELECT app_id, prev_status, undone, created_at, type FROM events WHERE id = ?",
    id,
  );
  if (!ev) return c.json({ error: "not_found" }, 404);
  if (!ev.type.startsWith("status:") || !ev.prev_status) return c.json({ error: "not_undoable" }, 409);
  if (ev.undone) return c.json({ error: "already_undone" }, 409);
  if (now - ev.created_at > UNDO_WINDOW_SECONDS) return c.json({ error: "undo_expired" }, 409);
  await db.batch([
    db.stmt("UPDATE events SET undone = 1 WHERE id = ?", id),
    db.stmt("UPDATE applications SET status = ?, last_event_at = ?, updated_at = ? WHERE id = ?", ev.prev_status, now, now, ev.app_id),
    db.stmt("INSERT INTO events (app_id, type, at, prev_status, created_at) VALUES (?, 'undo', ?, ?, ?)", ev.app_id, now, ev.type.slice(7), now),
  ]);
  log("event_undone", { id, app_id: ev.app_id });
  return c.json({ undone: true, status: ev.prev_status });
});
