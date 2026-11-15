// Applications API (spec section 12). Company/role/status/dates are plaintext for querying;
// notes are an AES-GCM envelope bound to the row (AAD applications:notes_enc:<id>).
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { aadFor, decryptField, encryptField, keyringFromEnv } from "../crypto/envelope.ts";
import type { Db, SqlParam } from "../db/client.ts";
import {
  ACTIVE_STATUSES, CLOSED_STATUSES, CreateApplication, ListQuery, STALE_AFTER_DAYS, StatusChange, UpdateApplication,
} from "../domain/applications.ts";
import { normalizeName } from "../domain/normalize.ts";
import { nowSec } from "../env.ts";
import { safeJson } from "../http/hygiene.ts";
import { log } from "../log/index.ts";

export const applicationRoutes = new Hono<AppEnv>();

interface AppRow {
  id: number; company: string; role: string | null; source: string; status: string;
  applied_at: number | null; last_event_at: number | null; next_action: string | null;
  next_action_due: number | null; notes_enc: string | null; created_at: number; updated_at: number; stale: number;
}

const STALE_SQL = (now: number) =>
  `(CASE WHEN status IN ('applied','assessment') AND COALESCE(last_event_at, applied_at, created_at) < ${now - STALE_AFTER_DAYS * 86400} THEN 1 ELSE 0 END)`;
const COLUMNS = "id, company, role, source, status, applied_at, last_event_at, next_action, next_action_due, created_at, updated_at";
const ACTIVITY = "COALESCE(last_event_at, created_at)";

function publicApp(r: AppRow) {
  return {
    id: r.id, company: r.company, role: r.role, source: r.source, status: r.status,
    applied_at: r.applied_at, last_event_at: r.last_event_at, next_action: r.next_action,
    next_action_due: r.next_action_due, created_at: r.created_at, updated_at: r.updated_at, stale: r.stale === 1,
  };
}

const idParam = (raw: string): number | null => (/^\d{1,12}$/.test(raw) ? Number(raw) : null);

async function loadApp(db: Db, id: number, now: number): Promise<AppRow | null> {
  return db.first<AppRow>(`SELECT ${COLUMNS}, notes_enc, ${STALE_SQL(now)} AS stale FROM applications WHERE id = ?`, id);
}

applicationRoutes.get("/", async (c) => {
  const q = ListQuery.safeParse(c.req.query());
  if (!q.success) return c.json({ error: "bad_request" }, 400);
  const { status, q: search, stale, limit, cursor } = q.data;
  const now = nowSec();
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (status === "active") {
    where.push(`status IN (${ACTIVE_STATUSES.map(() => "?").join(",")})`);
    params.push(...ACTIVE_STATUSES);
  } else if (status === "closed") {
    where.push(`status IN (${CLOSED_STATUSES.map(() => "?").join(",")})`);
    params.push(...CLOSED_STATUSES);
  } else if (status !== "all") {
    where.push("status = ?");
    params.push(status);
  }
  if (search) {
    const term = normalizeName(search);
    if (term) {
      where.push("(company_norm LIKE ? ESCAPE '\\' OR role_norm LIKE ? ESCAPE '\\')");
      const like = `%${term.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
      params.push(like, like);
    }
  }
  if (stale) where.push(`${STALE_SQL(now)} = 1`);
  if (cursor) {
    const [ts, id] = cursor.split("_").map(Number) as [number, number];
    where.push(`(${ACTIVITY} < ? OR (${ACTIVITY} = ? AND id < ?))`);
    params.push(ts, ts, id);
  }
  const rows = await c.get("db").all<AppRow>(
    `SELECT ${COLUMNS}, ${STALE_SQL(now)} AS stale FROM applications ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY ${ACTIVITY} DESC, id DESC LIMIT ?`,
    ...params,
    limit + 1,
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const next_cursor = rows.length > limit && last ? `${last.last_event_at ?? last.created_at}_${last.id}` : null;
  return c.json({ items: page.map(publicApp), next_cursor });
});

applicationRoutes.get("/summary", async (c) => {
  const now = nowSec();
  const rows = await c.get("db").all<{ status: string; n: number; stale: number }>(
    `SELECT status, COUNT(*) AS n, SUM(${STALE_SQL(now)}) AS stale FROM applications GROUP BY status`,
  );
  const counts: Record<string, number> = {};
  let stale = 0;
  for (const r of rows) {
    counts[r.status] = r.n;
    stale += r.stale ?? 0;
  }
  return c.json({ counts, stale });
});

applicationRoutes.post("/", async (c) => {
  const body = CreateApplication.safeParse(await safeJson(c.req));
  if (!body.success) return c.json({ error: "bad_request" }, 400);
  const v = body.data;
  const db = c.get("db");
  const now = nowSec();
  const applied = v.applied_at ?? now;
  const inserted = await db.first<{ id: number }>(
    `INSERT INTO applications (company, company_norm, role, role_norm, source, status, applied_at, last_event_at,
       next_action, next_action_due, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    v.company, normalizeName(v.company), v.role ?? null, v.role ? normalizeName(v.role) : null, v.source, v.status,
    applied, applied, v.next_action ?? null, v.next_action_due ?? null, now, now,
  );
  if (!inserted) return c.json({ error: "internal" }, 500);
  const stmts = [db.stmt("INSERT INTO events (app_id, type, at, created_at) VALUES (?, 'created', ?, ?)", inserted.id, applied, now)];
  if (v.notes) {
    const enc = await encryptField(keyringFromEnv(c.env), v.notes, aadFor("applications", "notes_enc", inserted.id));
    stmts.push(db.stmt("UPDATE applications SET notes_enc = ? WHERE id = ?", enc, inserted.id));
  }
  await db.batch(stmts);
  log("application_created", { id: inserted.id });
  const row = await loadApp(db, inserted.id, now);
  return c.json(publicApp(row as AppRow), 201);
});

applicationRoutes.get("/:id", async (c) => {
  const id = idParam(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);
  const row = await loadApp(c.get("db"), id, nowSec());
  if (!row) return c.json({ error: "not_found" }, 404);
  const notes = row.notes_enc ? await decryptField(keyringFromEnv(c.env), row.notes_enc, aadFor("applications", "notes_enc", id)) : null;
  return c.json({ ...publicApp(row), notes });
});

applicationRoutes.patch("/:id", async (c) => {
  const id = idParam(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);
  const body = UpdateApplication.safeParse(await safeJson(c.req));
  if (!body.success) return c.json({ error: "bad_request" }, 400);
  const db = c.get("db");
  const now = nowSec();
  if (!(await db.first("SELECT id FROM applications WHERE id = ?", id))) return c.json({ error: "not_found" }, 404);
  const v = body.data;
  const sets: string[] = ["updated_at = ?"];
  const params: SqlParam[] = [now];
  const put = (col: string, val: SqlParam): void => {
    sets.push(`${col} = ?`);
    params.push(val);
  };
  if (v.company !== undefined) {
    put("company", v.company);
    put("company_norm", normalizeName(v.company));
  }
  if (v.role !== undefined) {
    put("role", v.role || null);
    put("role_norm", v.role ? normalizeName(v.role) : null);
  }
  if (v.source !== undefined) put("source", v.source);
  if (v.applied_at !== undefined) put("applied_at", v.applied_at);
  if (v.next_action !== undefined) put("next_action", v.next_action || null);
  if (v.next_action_due !== undefined) put("next_action_due", v.next_action_due);
  if (v.notes !== undefined) {
    put("notes_enc", v.notes ? await encryptField(keyringFromEnv(c.env), v.notes, aadFor("applications", "notes_enc", id)) : null);
  }
  await db.batch([db.stmt(`UPDATE applications SET ${sets.join(", ")} WHERE id = ?`, ...params, id)]);
  const row = await loadApp(db, id, now);
  const notes = row?.notes_enc ? await decryptField(keyringFromEnv(c.env), row.notes_enc, aadFor("applications", "notes_enc", id)) : null;
  return c.json({ ...publicApp(row as AppRow), notes });
});

applicationRoutes.delete("/:id", async (c) => {
  const id = idParam(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);
  const db = c.get("db");
  if (!(await db.first("SELECT id FROM applications WHERE id = ?", id))) return c.json({ error: "not_found" }, 404);
  await db.batch([
    db.stmt("DELETE FROM events WHERE app_id = ?", id),
    db.stmt("DELETE FROM interviews WHERE app_id = ?", id),
    db.stmt("UPDATE emails_seen SET app_id = NULL WHERE app_id = ?", id),
    db.stmt("DELETE FROM applications WHERE id = ?", id),
  ]);
  log("application_deleted", { id });
  return c.json({ deleted: true });
});

/** Manual override: the user may move to any status (spec section 9). Recorded with prev_status for undo. */
applicationRoutes.post("/:id/status", async (c) => {
  const id = idParam(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);
  const body = StatusChange.safeParse(await safeJson(c.req));
  if (!body.success) return c.json({ error: "bad_request" }, 400);
  const db = c.get("db");
  const now = nowSec();
  const current = await db.first<{ status: string }>("SELECT status FROM applications WHERE id = ?", id);
  if (!current) return c.json({ error: "not_found" }, 404);
  if (current.status === body.data.status) return c.json({ error: "unchanged" }, 409);
  const ev = await db.first<{ id: number }>(
    "INSERT INTO events (app_id, type, at, prev_status, auto_applied, created_at) VALUES (?, ?, ?, ?, 0, ?) RETURNING id",
    id, `status:${body.data.status}`, now, current.status, now,
  );
  await db.batch([db.stmt("UPDATE applications SET status = ?, last_event_at = ?, stale = 0, updated_at = ? WHERE id = ?", body.data.status, now, now, id)]);
  const row = await loadApp(db, id, now);
  return c.json({ application: publicApp(row as AppRow), event_id: ev?.id ?? null });
});

applicationRoutes.get("/:id/timeline", async (c) => {
  const id = idParam(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);
  const db = c.get("db");
  if (!(await db.first("SELECT id FROM applications WHERE id = ?", id))) return c.json({ error: "not_found" }, 404);
  const items = await db.all(
    "SELECT id, type, at, prev_status, auto_applied, confidence, undone FROM events WHERE app_id = ? ORDER BY at DESC, id DESC LIMIT 50",
    id,
  );
  return c.json({ items });
});
