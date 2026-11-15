// Recruiter / hiring contacts (built from job emails). Names, addresses and notes are encrypted at rest.
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { safeJson } from "../http/hygiene.ts";
import { decJson, encJson } from "../lib/enc.ts";

export const contactRoutes = new Hono<AppEnv>();

interface Row {
  id: number; name_enc: string | null; email_enc: string | null; notes_enc: string | null; company: string | null;
  app_id: number | null; app_company: string | null; first_seen_at: number; last_contact_at: number; msg_count: number;
}

contactRoutes.get("/", async (c) => {
  const rows = await c.get("db").all<Row>(
    `SELECT c.id, c.name_enc, c.email_enc, c.notes_enc, c.company, c.app_id, a.company AS app_company, c.first_seen_at, c.last_contact_at, c.msg_count
     FROM contacts c LEFT JOIN applications a ON a.id = c.app_id ORDER BY c.last_contact_at DESC LIMIT 100`,
  );
  const items = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      name: await decJson<string>(c.env, "contacts", "name_enc", r.id, r.name_enc),
      email: await decJson<string>(c.env, "contacts", "email_enc", r.id, r.email_enc),
      notes: await decJson<string>(c.env, "contacts", "notes_enc", r.id, r.notes_enc),
      company: r.app_company ?? r.company,
      app_id: r.app_id,
      first_seen_at: r.first_seen_at,
      last_contact_at: r.last_contact_at,
      msg_count: r.msg_count,
    })),
  );
  return c.json({ items });
});

const Patch = z.object({ notes: z.string().max(2000) });

contactRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = Patch.safeParse(await safeJson(c.req));
  if (!b.success || !Number.isInteger(id)) return c.json({ error: "bad_request" }, 400);
  const enc = b.data.notes.trim() ? await encJson(c.env, "contacts", "notes_enc", id, b.data.notes.trim()) : null;
  const r = await c.get("db").run("UPDATE contacts SET notes_enc = ? WHERE id = ?", enc, id);
  return r.meta.changes === 1 ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

contactRoutes.delete("/:id", async (c) => {
  await c.get("db").run("DELETE FROM contacts WHERE id = ?", Number(c.req.param("id")));
  return c.json({ deleted: true });
});
