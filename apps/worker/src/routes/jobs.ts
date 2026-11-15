// Resume profiles + job vacancies + deterministic 100-point matching + Apply Tomorrow queue (spec section 10).
// Vacancies are added by the user (paste or URL). Gmail runs on the metadata scope, so alert bodies are never read.
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import type { Db } from "../db/client.ts";
import { nowSec, type Env } from "../env.ts";
import { safeJson } from "../http/hygiene.ts";
import { decJson, decText, encJson, encText } from "../lib/enc.ts";
import { extractResumeFacts, scoreJob, type MatchResult, type ResumeFacts } from "../jobs/scoring.ts";
import { normalizeName } from "../domain/normalize.ts";
import { log } from "../log/index.ts";
import { getSettings } from "./settings.ts";

export const resumeRoutes = new Hono<AppEnv>();
export const jobRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------- resume profiles
const ResumeBody = z.object({ label: z.string().min(1).max(120), text: z.string().min(50).max(40_000) });

interface ResumeRow { id: number; version: number; label: string; resume_text_enc: string; structured_json_enc: string | null; active: number; created_at: number }

resumeRoutes.get("/", async (c) => {
  const rows = await c.get("db").all<ResumeRow>("SELECT id, version, label, resume_text_enc, structured_json_enc, active, created_at FROM resume_profiles ORDER BY version DESC LIMIT 20");
  const items = await Promise.all(
    rows.map(async (r) => {
      const facts = await decJson<ResumeFacts>(c.env, "resume_profiles", "structured_json_enc", r.id, r.structured_json_enc);
      return { id: r.id, version: r.version, label: r.label, active: r.active === 1, created_at: r.created_at, skills: facts?.skills.map((s) => s.skill) ?? [] };
    }),
  );
  return c.json({ items });
});

resumeRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const r = await c.get("db").first<ResumeRow>("SELECT id, version, label, resume_text_enc, structured_json_enc, active, created_at FROM resume_profiles WHERE id = ?", id);
  if (!r) return c.json({ error: "not_found" }, 404);
  return c.json({ id: r.id, label: r.label, version: r.version, active: r.active === 1, text: await decText(c.env, "resume_profiles", "resume_text_enc", r.id, r.resume_text_enc) });
});

async function saveResume(env: Env, db: Db, id: number, text: string, label: string, now: number) {
  const facts = extractResumeFacts(text);
  await db.run(
    "UPDATE resume_profiles SET label = ?, resume_text_enc = ?, structured_json_enc = ?, updated_at = ? WHERE id = ?",
    label, await encText(env, "resume_profiles", "resume_text_enc", id, text), await encJson(env, "resume_profiles", "structured_json_enc", id, facts), now, id,
  );
}

resumeRoutes.post("/", async (c) => {
  const body = ResumeBody.safeParse(await safeJson(c.req));
  if (!body.success) return c.json({ error: "bad_request" }, 400);
  const db = c.get("db");
  const now = nowSec();
  const ver = await db.first<{ v: number | null }>("SELECT MAX(version) AS v FROM resume_profiles");
  const ins = await db.first<{ id: number }>(
    "INSERT INTO resume_profiles (version, label, resume_text_enc, active, created_at, updated_at) VALUES (?, ?, 'pending', 0, ?, ?) RETURNING id",
    (ver?.v ?? 0) + 1, body.data.label, now, now,
  );
  const id = (ins as { id: number }).id;
  await saveResume(c.env, db, id, body.data.text, body.data.label, now);
  await db.batch([db.stmt("UPDATE resume_profiles SET active = 0"), db.stmt("UPDATE resume_profiles SET active = 1 WHERE id = ?", id)]);
  log("resume_saved", { id });
  return c.json({ id }, 201);
});

resumeRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = ResumeBody.safeParse(await safeJson(c.req));
  if (!body.success || !Number.isInteger(id)) return c.json({ error: "bad_request" }, 400);
  const db = c.get("db");
  if (!(await db.first("SELECT id FROM resume_profiles WHERE id = ?", id))) return c.json({ error: "not_found" }, 404);
  await saveResume(c.env, db, id, body.data.text, body.data.label, nowSec());
  return c.json({ ok: true });
});

resumeRoutes.post("/:id/activate", async (c) => {
  const id = Number(c.req.param("id"));
  const db = c.get("db");
  if (!(await db.first("SELECT id FROM resume_profiles WHERE id = ?", id))) return c.json({ error: "not_found" }, 404);
  await db.batch([db.stmt("UPDATE resume_profiles SET active = 0"), db.stmt("UPDATE resume_profiles SET active = 1 WHERE id = ?", id)]);
  return c.json({ ok: true });
});

resumeRoutes.delete("/:id", async (c) => {
  await c.get("db").run("DELETE FROM resume_profiles WHERE id = ?", Number(c.req.param("id")));
  return c.json({ deleted: true });
});

// ---------------------------------------------------------------- scoring plumbing
interface ActiveResume { id: number; text: string; facts: ResumeFacts }

async function activeResume(env: Env, db: Db): Promise<ActiveResume | null> {
  const r = await db.first<ResumeRow>("SELECT id, version, label, resume_text_enc, structured_json_enc, active, created_at FROM resume_profiles WHERE active = 1 LIMIT 1");
  if (!r) return null;
  const text = await decText(env, "resume_profiles", "resume_text_enc", r.id, r.resume_text_enc);
  if (!text) return null;
  const facts = (await decJson<ResumeFacts>(env, "resume_profiles", "structured_json_enc", r.id, r.structured_json_enc)) ?? extractResumeFacts(text);
  return { id: r.id, text, facts };
}

interface JobRow {
  id: number; source: string; title: string; company: string | null; location: string | null; work_arrangement: string | null;
  employment_type: string | null; canonical_url: string | null; closing_at: number | null; description_enc: string | null;
  status: string; first_seen_at: number; source_account_id: number | null; source_gmail_id: string | null;
}
const JOB_COLS = "id, source, title, company, location, work_arrangement, employment_type, canonical_url, closing_at, description_enc, status, first_seen_at, source_account_id, source_gmail_id";

async function scoreAndSave(env: Env, db: Db, resume: ActiveResume, j: JobRow, now: number): Promise<MatchResult> {
  const description = await decText(env, "jobs", "description_enc", j.id, j.description_enc);
  const m = scoreJob(resume.text, resume.facts, { title: j.title, company: j.company, location: j.location, work_arrangement: j.work_arrangement, employment_type: j.employment_type, description });
  const aadId = `${j.id}:${resume.id}`;
  const c = m.components;
  await db.run(
    `INSERT INTO job_matches (job_id, resume_profile_id, score, band, skills_score, role_score, experience_score, education_score, location_score, work_type_score, domain_score,
       evidence_json_enc, gaps_json_enc, confidence, scored_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(job_id, resume_profile_id) DO UPDATE SET score=excluded.score, band=excluded.band, skills_score=excluded.skills_score, role_score=excluded.role_score,
       experience_score=excluded.experience_score, education_score=excluded.education_score, location_score=excluded.location_score, work_type_score=excluded.work_type_score,
       domain_score=excluded.domain_score, evidence_json_enc=excluded.evidence_json_enc, gaps_json_enc=excluded.gaps_json_enc, confidence=excluded.confidence, scored_at=excluded.scored_at`,
    j.id, resume.id, m.score, m.band, c.skills, c.role, c.experience, c.education, c.location, c.work_type, c.domain,
    await encJson(env, "job_matches", "evidence_json_enc", aadId, { matched: m.matched, explanation: m.explanation, provisional: m.provisional }),
    await encJson(env, "job_matches", "gaps_json_enc", aadId, m.gaps), m.confidence, now,
  );
  return m;
}

/** Scores up to `limit` vacancies that have no match for the active resume yet (CPU-bounded; Workers Free = 10 ms). */
async function scorePending(env: Env, db: Db, resume: ActiveResume, now: number, limit = 12): Promise<number> {
  const rows = await db.all<JobRow>(
    `SELECT ${JOB_COLS} FROM jobs j WHERE status NOT IN ('dismissed','expired','closed') AND NOT EXISTS
       (SELECT 1 FROM job_matches m WHERE m.job_id = j.id AND m.resume_profile_id = ?) LIMIT ?`,
    resume.id, limit,
  );
  for (const r of rows) await scoreAndSave(env, db, resume, r, now);
  return rows.length;
}

interface ListRow extends JobRow { score: number | null; band: string | null; confidence: string | null; decision: string | null }

const present = (r: ListRow) => ({
  id: r.id, title: r.title, company: r.company, location: r.location, work_arrangement: r.work_arrangement, employment_type: r.employment_type,
  source: r.source, url: r.canonical_url, closing_at: r.closing_at, status: r.status, first_seen_at: r.first_seen_at,
  score: r.score, band: r.band, confidence: r.confidence,
  alert: r.source_account_id && r.source_gmail_id ? { account_id: r.source_account_id, gmail_id: r.source_gmail_id } : null,
});

const LIST_SQL = `SELECT ${JOB_COLS.split(", ").map((c) => `j.${c}`).join(", ")}, m.score, m.band, m.confidence, m.decision
  FROM jobs j LEFT JOIN job_matches m ON m.job_id = j.id AND m.resume_profile_id = (SELECT id FROM resume_profiles WHERE active = 1 LIMIT 1)`;

/** Apply Tomorrow: suitable, open, not applied/dismissed, has a URL. Ranked by score, then closing date, then newest. */
export async function applyTomorrow(db: Db, now: number, threshold: number, limit = 20): Promise<ReturnType<typeof present>[]> {
  const rows = await db.all<ListRow>(
    `${LIST_SQL} WHERE j.status IN ('new','shortlisted','saved') AND m.score >= ? AND j.canonical_url IS NOT NULL
       AND (j.closing_at IS NULL OR j.closing_at > ?)
     ORDER BY m.score DESC, COALESCE(j.closing_at, 9999999999) ASC, j.first_seen_at DESC LIMIT ?`,
    threshold, now, limit,
  );
  return rows.map(present);
}

jobRoutes.get("/queue", async (c) => {
  const db = c.get("db");
  const now = nowSec();
  const resume = await activeResume(c.env, db);
  if (resume) await scorePending(c.env, db, resume, now);
  const s = await getSettings(db);
  return c.json({ has_resume: Boolean(resume), threshold: s.shortlist_threshold, items: await applyTomorrow(db, now, s.shortlist_threshold) });
});

jobRoutes.get("/", async (c) => {
  const db = c.get("db");
  const now = nowSec();
  const status = c.req.query("status") ?? "open";
  const band = c.req.query("band");
  const resume = await activeResume(c.env, db);
  if (resume) await scorePending(c.env, db, resume, now);
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (status === "open") where.push("j.status IN ('new','shortlisted','saved')");
  else if (status !== "all") { where.push("j.status = ?"); params.push(status); }
  if (band) { where.push("m.band = ?"); params.push(band); }
  const rows = await db.all<ListRow>(`${LIST_SQL} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY COALESCE(m.score, -1) DESC, j.first_seen_at DESC LIMIT 50`, ...params);
  return c.json({ has_resume: Boolean(resume), items: rows.map(present) });
});

const JobBody = z.object({
  title: z.string().min(1).max(200),
  company: z.string().max(160).optional(),
  location: z.string().max(120).optional(),
  work_arrangement: z.enum(["remote", "hybrid", "onsite"]).optional(),
  employment_type: z.string().max(60).optional(),
  url: z.string().url().max(1000).optional(),
  description: z.string().max(30_000).optional(),
  closing_at: z.number().int().min(0).max(4_102_444_800).optional(),
  source: z.string().max(40).default("manual"),
});

const canonical = (u: string): string => {
  const x = new URL(u);
  x.hash = "";
  for (const k of [...x.searchParams.keys()]) if (/^(utm_|ref|trk|tracking)/i.test(k)) x.searchParams.delete(k);
  return x.toString().replace(/\/$/, "");
};

jobRoutes.post("/", async (c) => {
  const body = JobBody.safeParse(await safeJson(c.req));
  if (!body.success) return c.json({ error: "bad_request" }, 400);
  const v = body.data;
  const db = c.get("db");
  const now = nowSec();
  const url = v.url ? canonical(v.url) : null;
  const norm = v.company ? normalizeName(v.company) : null;
  const dup = url
    ? await db.first<{ id: number }>("SELECT id FROM jobs WHERE canonical_url = ?", url)
    : norm
      ? await db.first<{ id: number }>("SELECT id FROM jobs WHERE company_norm = ? AND LOWER(title) = LOWER(?)", norm, v.title)
      : null;
  if (dup) return c.json({ id: dup.id, duplicate: true }, 200);
  const ins = await db.first<{ id: number }>(
    `INSERT INTO jobs (source, title, company, company_norm, location, work_arrangement, employment_type, canonical_url, closing_at, status, first_seen_at, last_seen_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?, 'new', ?,?,?,?) RETURNING id`,
    v.source, v.title, v.company ?? null, norm, v.location ?? null, v.work_arrangement ?? null, v.employment_type ?? null, url, v.closing_at ?? null, now, now, now, now,
  );
  const id = (ins as { id: number }).id;
  if (v.description) await db.run("UPDATE jobs SET description_enc = ? WHERE id = ?", await encText(c.env, "jobs", "description_enc", id, v.description), id);
  const resume = await activeResume(c.env, db);
  if (resume) {
    const row = await db.first<JobRow>(`SELECT ${JOB_COLS} FROM jobs WHERE id = ?`, id);
    if (row) await scoreAndSave(c.env, db, resume, row, now);
  }
  log("job_created", { id });
  return c.json({ id, duplicate: false }, 201);
});

jobRoutes.post("/rescore", async (c) => {
  const db = c.get("db");
  const resume = await activeResume(c.env, db);
  if (!resume) return c.json({ error: "no_resume" }, 409);
  // Rescoring is incremental: drop stale matches for old resume versions' jobs lazily via scorePending.
  const n = await scorePending(c.env, db, resume, nowSec(), 15);
  return c.json({ scored: n });
});

jobRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = c.get("db");
  const r = await db.first<ListRow>(`${LIST_SQL} WHERE j.id = ?`, id);
  if (!r) return c.json({ error: "not_found" }, 404);
  const resume = await activeResume(c.env, db);
  const m = resume ? await db.first<{ skills_score: number; role_score: number; experience_score: number; education_score: number; location_score: number; work_type_score: number; domain_score: number; evidence_json_enc: string; gaps_json_enc: string }>(
    "SELECT skills_score, role_score, experience_score, education_score, location_score, work_type_score, domain_score, evidence_json_enc, gaps_json_enc FROM job_matches WHERE job_id = ? AND resume_profile_id = ?", id, resume.id) : null;
  const aad = resume ? `${id}:${resume.id}` : "";
  return c.json({
    ...present(r),
    description: await decText(c.env, "jobs", "description_enc", id, r.description_enc),
    match: m
      ? {
          components: { skills: m.skills_score, role: m.role_score, experience: m.experience_score, education: m.education_score, location: m.location_score, work_type: m.work_type_score, domain: m.domain_score },
          evidence: await decJson<{ matched: { skill: string; evidence: string }[]; explanation: string; provisional: boolean }>(c.env, "job_matches", "evidence_json_enc", aad, m.evidence_json_enc),
          gaps: (await decJson<string[]>(c.env, "job_matches", "gaps_json_enc", aad, m.gaps_json_enc)) ?? [],
        }
      : null,
  });
});

const Decision = z.object({ decision: z.enum(["shortlist", "save", "dismiss", "reopen"]) });
const DECISION_STATUS = { shortlist: "shortlisted", save: "saved", dismiss: "dismissed", reopen: "new" } as const;

jobRoutes.post("/:id/decision", async (c) => {
  const id = Number(c.req.param("id"));
  const body = Decision.safeParse(await safeJson(c.req));
  if (!body.success || !Number.isInteger(id)) return c.json({ error: "bad_request" }, 400);
  const r = await c.get("db").run("UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?", DECISION_STATUS[body.data.decision], nowSec(), id);
  return r.meta.changes === 1 ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

const MarkApplied = z.object({ link_application_id: z.number().int().positive().optional(), create_new: z.boolean().optional() });

jobRoutes.post("/:id/mark-applied", async (c) => {
  const id = Number(c.req.param("id"));
  const body = MarkApplied.safeParse((await safeJson(c.req)) ?? {});
  if (!body.success || !Number.isInteger(id)) return c.json({ error: "bad_request" }, 400);
  const db = c.get("db");
  const j = await db.first<JobRow>(`SELECT ${JOB_COLS} FROM jobs WHERE id = ?`, id);
  if (!j) return c.json({ error: "not_found" }, 404);
  const now = nowSec();
  let appId = body.data.link_application_id ?? null;
  if (!appId && j.company && !body.data.create_new) {
    const matches = await db.all<{ id: number; company: string; role: string | null; status: string }>(
      "SELECT id, company, role, status FROM applications WHERE company_norm = ? LIMIT 5", normalizeName(j.company),
    );
    if (matches.length > 0) return c.json({ error: "ambiguous", candidates: matches }, 409);
  }
  if (!appId) {
    const ins = await db.first<{ id: number }>(
      `INSERT INTO applications (company, company_norm, role, role_norm, source, status, applied_at, last_event_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'other', 'applied', ?, ?, ?, ?) RETURNING id`,
      j.company ?? "Unknown company", normalizeName(j.company ?? "unknown company"), j.title, normalizeName(j.title), now, now, now, now,
    );
    appId = (ins as { id: number }).id;
    await db.run("INSERT INTO events (app_id, type, at, created_at) VALUES (?, 'created', ?, ?)", appId, now, now);
  }
  await db.run("UPDATE jobs SET status = 'applied', updated_at = ? WHERE id = ?", now, id);
  return c.json({ ok: true, app_id: appId });
});

jobRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = c.get("db");
  await db.batch([db.stmt("DELETE FROM job_matches WHERE job_id = ?", id), db.stmt("DELETE FROM jobs WHERE id = ?", id)]);
  return c.json({ deleted: true });
});
