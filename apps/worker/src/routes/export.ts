// GET /api/export?table=<name>&after=<id>: decrypted JSON export, paginated by table (spec section 12).
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { decText } from "../lib/enc.ts";
import { log } from "../log/index.ts";

export const exportRoutes = new Hono<AppEnv>();

// table -> encrypted columns (AAD rowid is the row's primary key; job_matches/checkins handled separately).
const TABLES: Record<string, { key: string; enc: string[]; cols: string }> = {
  applications: { key: "id", enc: ["notes_enc"], cols: "id, company, role, source, status, applied_at, last_event_at, next_action, notes_enc" },
  interviews: { key: "id", enc: ["prep_enc", "debrief_enc"], cols: "id, app_id, state, start_utc, tz, format, rating, followup_sent, prep_enc, debrief_enc" },
  notes: { key: "id", enc: ["body_enc"], cols: "id, tags, created_at, body_enc" },
  tasks: { key: "id", enc: ["title_enc"], cols: "id, due_at, priority, kind, done_at, app_id, title_enc" },
  jobs: { key: "id", enc: ["description_enc"], cols: "id, source, title, company, location, canonical_url, status, closing_at, first_seen_at, description_enc" },
  resume_profiles: { key: "id", enc: ["resume_text_enc"], cols: "id, version, label, active, created_at, resume_text_enc" },
  checkins: { key: "date", enc: ["answers_enc"], cols: "date, status, completed_at, answers_enc" },
};

exportRoutes.get("/", async (c) => {
  const table = c.req.query("table") ?? "";
  const spec = TABLES[table];
  if (!spec) return c.json({ error: "bad_table", tables: Object.keys(TABLES) }, 400);
  const after = c.req.query("after") ?? (spec.key === "date" ? "" : "0");
  const db = c.get("db");
  const rows = await db.all<Record<string, string | number | null>>(
    `SELECT ${spec.cols} FROM ${table} WHERE ${spec.key} > ? ORDER BY ${spec.key} ASC LIMIT 50`,
    spec.key === "date" ? after : Number(after),
  );
  const items = [];
  for (const r of rows) {
    const out: Record<string, unknown> = { ...r };
    for (const col of spec.enc) {
      out[col.replace(/_enc$/, "")] = await decText(c.env, table, col, r[spec.key] as string | number, r[col] as string | null);
      delete out[col];
    }
    items.push(out);
  }
  log("export_page", { count: items.length });
  const last = rows[rows.length - 1];
  return c.json({ table, items, next: rows.length === 50 && last ? String(last[spec.key]) : null });
});
