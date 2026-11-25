// Insights (Revamp 3G): what the job search is telling Ani. Computed from data GRU already has: a few indexed reads and one small
// bounded decrypt (skills), no AI. Also the saved search preferences used to build job-board shortcut links.
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { nowSec } from "../env.ts";
import { safeJson } from "../http/hygiene.ts";
import { decJson } from "../lib/enc.ts";
import { weekStart } from "./network.ts";

export const insightRoutes = new Hono<AppEnv>();
const DAY = 86400;
const WEEKS = 8;

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

insightRoutes.get("/", async (c) => {
  const db = c.get("db");
  const now = nowSec();
  const [apps, reached, firstReply, matches, net] = await Promise.all([
    db.all<{ id: number; source: string; status: string; applied_at: number | null }>("SELECT id, source, status, applied_at FROM applications ORDER BY applied_at DESC LIMIT 600"),
    db.all<{ app_id: number; kind: string }>("SELECT DISTINCT app_id, REPLACE(type, 'status:', '') AS kind FROM events WHERE type IN ('status:assessment','status:interview','status:offer','status:accepted') AND undone = 0 LIMIT 1200"),
    db.all<{ app_id: number; at: number }>("SELECT app_id, MIN(at) AS at FROM events WHERE type LIKE 'status:%' AND prev_status = 'applied' AND undone = 0 GROUP BY app_id LIMIT 600"),
    db.all<{ id: number; job_id: number; resume_profile_id: number; evidence_json_enc: string; gaps_json_enc: string }>(
      "SELECT m.id, m.job_id, m.resume_profile_id, m.evidence_json_enc, m.gaps_json_enc FROM job_matches m JOIN jobs j ON j.id = m.job_id WHERE j.status IN ('new','shortlisted','saved','applied') AND m.score >= 50 ORDER BY m.scored_at DESC LIMIT 30"),
    db.all<{ stage: string; n: number }>("SELECT stage, COUNT(*) AS n FROM net_people GROUP BY stage"),
  ]);

  // Funnel: "reached" counts an application if it is there now or ever was (so a later rejection doesn't erase an interview).
  const ever = new Map<string, Set<number>>();
  for (const r of reached) (ever.get(r.kind) ?? ever.set(r.kind, new Set()).get(r.kind))?.add(r.app_id);
  const has = (kind: string, a: { id: number; status: string }) => a.status === kind || (ever.get(kind)?.has(a.id) ?? false);
  const funnel = {
    applied: apps.length,
    replied: apps.filter((a) => a.status !== "applied").length,
    assessment: apps.filter((a) => has("assessment", a) || has("interview", a) || has("offer", a)).length,
    interview: apps.filter((a) => has("interview", a) || has("offer", a)).length,
    offer: apps.filter((a) => has("offer", a) || a.status === "accepted").length,
  };

  const bySource = new Map<string, { total: number; replied: number }>();
  for (const a of apps) {
    const s = bySource.get(a.source) ?? { total: 0, replied: 0 };
    s.total++;
    if (a.status !== "applied") s.replied++;
    bySource.set(a.source, s);
  }

  const ws = weekStart(now);
  const weekly = Array.from({ length: WEEKS }, (_, i) => ({ week_start: ws - (WEEKS - 1 - i) * 7 * DAY, applied: 0 }));
  for (const a of apps) {
    if (!a.applied_at) continue;
    const idx = weekly.findIndex((w) => a.applied_at! >= w.week_start && a.applied_at! < w.week_start + 7 * DAY);
    if (idx >= 0) (weekly[idx] as { applied: number }).applied++;
  }

  const appliedAt = new Map(apps.map((a) => [a.id, a.applied_at]));
  const days = firstReply.map((r) => ((r.at - (appliedAt.get(r.app_id) ?? r.at)) / DAY)).filter((d) => d >= 0 && d < 120);

  // What the postings you are seeing ask for: skills from the cached (encrypted) match evidence, newest 30 only.
  const demand = new Map<string, { asked: number; have: number }>();
  const bump = (skill: string, have: boolean) => { const d = demand.get(skill) ?? { asked: 0, have: 0 }; d.asked++; if (have) d.have++; demand.set(skill, d); };
  for (const m of matches) {
    const aad = `${m.job_id}:${m.resume_profile_id}`;
    const [ev, gaps] = await Promise.all([
      decJson<{ matched: { skill: string }[] }>(c.env, "job_matches", "evidence_json_enc", aad, m.evidence_json_enc),
      decJson<string[]>(c.env, "job_matches", "gaps_json_enc", aad, m.gaps_json_enc),
    ]);
    for (const s of ev?.matched ?? []) bump(s.skill, true);
    for (const g of gaps ?? []) { const mm = /(?:Required|Preferred) skill not evidenced[^:]*: (.+)$/.exec(g); if (mm?.[1]) bump(mm[1].trim(), false); }
  }

  const stage = Object.fromEntries(net.map((r) => [r.stage, r.n]));
  const reachedStage = (...s: string[]) => net.filter((r) => s.includes(r.stage)).reduce((n, r) => n + r.n, 0);
  return c.json({
    funnel,
    by_source: [...bySource.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.total - a.total),
    weekly,
    median_days_to_reply: median(days),
    demand: [...demand.entries()].map(([skill, v]) => ({ skill, ...v })).sort((a, b) => b.asked - a.asked).slice(0, 12),
    sample: matches.length,
    network: {
      tracked: reachedStage("to_reach", "drafted", "sent", "replied", "call_booked", "call_done", "thanked"),
      contacted: reachedStage("sent", "replied", "call_booked", "call_done", "thanked"),
      replied: reachedStage("replied", "call_booked", "call_done", "thanked"),
      talked: reachedStage("call_done", "thanked"),
      stage,
    },
  });
});

const Prefs = z.object({ roles: z.array(z.string().trim().min(2).max(60)).max(6).default([]), location: z.string().trim().max(60).default("") });

insightRoutes.get("/prefs", async (c) => {
  const row = await c.get("db").first<{ v: string }>("SELECT v FROM kv WHERE k = 'prefs'");
  let raw: unknown = {};
  try { raw = row ? JSON.parse(row.v) : {}; } catch { /* fall back to empty preferences */ }
  const parsed = Prefs.safeParse(raw);
  return c.json(parsed.success ? parsed.data : { roles: [], location: "" });
});

insightRoutes.put("/prefs", async (c) => {
  const b = Prefs.safeParse(await safeJson(c.req));
  if (!b.success) return c.json({ error: "bad_request" }, 400);
  await c.get("db").run("INSERT INTO kv (k, v) VALUES ('prefs', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(b.data));
  return c.json(b.data);
});
