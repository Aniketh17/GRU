// Job workspace extras (Revamp 3A/3C): "not the same job" override and the insights block. Mounted under /api/jobs before the generic /:id.
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { normalizeName } from "../domain/normalize.ts";
import { nowSec } from "../env.ts";
import { sameCompany, titleSimilarity } from "../lib/dedupe.ts";
import { decText } from "../lib/enc.ts";

export const jobInsightRoutes = new Hono<AppEnv>();

jobInsightRoutes.post("/:id/not-same", async (c) => {
  const id = Number(c.req.param("id"));
  const r = await c.get("db").run("UPDATE jobs SET dedupe_status = 'not_same', applied_app_id = NULL, dedupe_reason = NULL WHERE id = ?", id);
  return r.meta.changes === 1 ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

// Everything GRU already knows that bears on whether and how to apply: a few indexed reads, no AI.
jobInsightRoutes.get("/:id/insights", async (c) => {
  const id = Number(c.req.param("id"));
  const db = c.get("db");
  const j = await db.first<{ id: number; title: string; company_norm: string | null; closing_at: number | null; first_seen_at: number; dedupe_status: string; dedupe_reason: string | null; applied_app_id: number | null }>(
    "SELECT id, title, company_norm, closing_at, first_seen_at, dedupe_status, dedupe_reason, applied_app_id FROM jobs WHERE id = ?", id);
  if (!j) return c.json({ error: "not_found" }, 404);
  const now = nowSec();
  const cn = j.company_norm;
  const [apps, others, people, netPeople] = await Promise.all([
    cn ? db.all<{ id: number; company_norm: string; role: string | null; status: string; applied_at: number | null; source: string }>(
      "SELECT id, company_norm, role, status, applied_at, source FROM applications ORDER BY applied_at DESC LIMIT 200") : Promise.resolve([]),
    cn ? db.all<{ id: number; title: string; source: string; status: string; canonical_url: string | null }>(
      "SELECT id, title, source, status, canonical_url FROM jobs WHERE company_norm = ? AND id != ? LIMIT 40", cn, id) : Promise.resolve([]),
    cn ? db.all<{ company: string | null }>("SELECT company FROM contacts WHERE company IS NOT NULL ORDER BY last_contact_at DESC LIMIT 100") : Promise.resolve([]),
    // People Ani is building a relationship with at this company (Network): the best route to a referral.
    cn ? db.all<{ id: number; name_enc: string; stage: string; company_id: number }>(
      "SELECT p.id, p.name_enc, p.stage, p.company_id FROM net_people p JOIN net_companies c ON c.id = p.company_id WHERE c.name_norm = ? LIMIT 5", cn) : Promise.resolve([]),
  ]);
  const history = apps.filter((a) => sameCompany(cn, a.company_norm));
  const sameRole = others.filter((o) => titleSimilarity(o.title, j.title) >= 0.75);
  const moved = history.filter((a) => a.status !== "applied").length;
  return c.json({
    applied: j.dedupe_status === "likely_applied" || j.dedupe_status === "confirmed" ? { status: j.dedupe_status, reason: j.dedupe_reason, app_id: j.applied_app_id } : null,
    company_history: history.slice(0, 8).map((a) => ({ id: a.id, role: a.role, status: a.status, applied_at: a.applied_at, source: a.source })),
    company_summary: history.length ? `${history.length} application${history.length === 1 ? "" : "s"} here before; ${moved} moved past "applied".` : null,
    same_role_elsewhere: sameRole.map((o) => ({ id: o.id, source: o.source, status: o.status, url: o.canonical_url })),
    other_roles_here: others.filter((o) => !sameRole.includes(o)).slice(0, 6).map((o) => ({ id: o.id, title: o.title })),
    network: await Promise.all(netPeople.map(async (p) => ({ id: p.id, name: (await decText(c.env, "net_people", "name_enc", p.id, p.name_enc)) ?? "Someone", stage: p.stage }))),
    known_contacts: people.filter((p) => p.company && sameCompany(cn, normalizeName(p.company))).length,
    closing: j.closing_at ? { at: j.closing_at, days_left: Math.ceil((j.closing_at - now) / 86400) } : null,
    first_seen_days: Math.max(0, Math.floor((now - j.first_seen_at) / 86400)),
  });
});
