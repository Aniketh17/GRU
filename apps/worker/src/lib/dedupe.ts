// Already-applied detection (Revamp 3C): a vacancy that matches something Ani applied to elsewhere must not sit in "Apply today".
// Pure functions + one bounded refresh. Never deletes anything: matches are hidden behind a section Ani can override.
import type { Db } from "../db/client.ts";
import { normalizeName } from "../domain/normalize.ts";

const STOP = new Set(["the", "a", "an", "and", "of", "for", "to", "in", "at", "with", "-", "&", "role", "position", "job", "new", "nz", "au"]);

export function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // "(Remote)", "(Fixed term)"
    .replace(/[^a-z0-9+#.\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t && !STOP.has(t));
}

export const titleNorm = (title: string): string => titleTokens(title).sort().join(" ");

/** Jaccard similarity of title words, 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const A = new Set(titleTokens(a));
  const B = new Set(titleTokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Same company when the normalised names are equal, or one contains the other (and is long enough to mean something). */
export function sameCompany(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 4 && l.includes(s);
}

export const LIKELY_MIN = 0.75;

export interface AppLite { id: number; company: string; company_norm: string; role: string | null; status: string; applied_at: number | null; source: string }
export interface JobLite { id: number; title: string; company_norm: string | null; dedupe_status: string; applied_app_id: number | null; dedupe_reason: string | null }
export interface DedupeVerdict { status: "none" | "likely_applied"; app_id: number | null; reason: string | null }

const SOURCE_LABEL: Record<string, string> = { seek: "Seek", linkedin: "LinkedIn", email: "email", referral: "a referral", manual: "your own entry", other: "elsewhere" };
const fmt = (t: number | null): string => (t ? new Date(t * 1000).toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: "Pacific/Auckland" }) : "");

/** The best match among the applications, or none. Needs the same company AND a similar role. */
export function judge(job: { title: string; company_norm: string | null }, apps: AppLite[]): DedupeVerdict {
  let best: { app: AppLite; sim: number } | null = null;
  for (const a of apps) {
    if (!a.role || !sameCompany(job.company_norm, a.company_norm)) continue;
    const sim = titleSimilarity(job.title, a.role);
    if (sim >= LIKELY_MIN && (!best || sim > best.sim)) best = { app: a, sim };
  }
  if (!best) return { status: "none", app_id: null, reason: null };
  const a = best.app;
  const when = fmt(a.applied_at);
  return {
    status: "likely_applied",
    app_id: a.id,
    reason: `You applied to ${a.company}${a.role ? ` as ${a.role}` : ""}${when ? ` on ${when}` : ""} via ${SOURCE_LABEL[a.source] ?? "elsewhere"}${a.status !== "applied" ? ` (now ${a.status})` : ""}.`,
  };
}

/**
 * Re-checks every open vacancy against the applications (a handful of rows: two reads and at most one batched write).
 * Vacancies Ani said are "not the same job" keep that answer; vacancies marked applied are left alone.
 */
export async function refreshDedupe(db: Db): Promise<void> {
  const [apps, jobs] = await Promise.all([
    db.all<AppLite>("SELECT id, company, company_norm, role, status, applied_at, source FROM applications"),
    db.all<JobLite>("SELECT id, title, company_norm, dedupe_status, applied_app_id, dedupe_reason FROM jobs WHERE status IN ('new','shortlisted','saved') AND dedupe_status != 'not_same'"),
  ]);
  const stmts = [];
  for (const j of jobs) {
    const v = judge(j, apps);
    if (v.status !== j.dedupe_status || v.app_id !== j.applied_app_id || v.reason !== j.dedupe_reason) {
      stmts.push(db.stmt("UPDATE jobs SET dedupe_status = ?, applied_app_id = ?, dedupe_reason = ? WHERE id = ?", v.status, v.app_id, v.reason, j.id));
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
}

export { normalizeName };
