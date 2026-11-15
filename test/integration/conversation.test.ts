import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Db } from "../../apps/worker/src/db/client.ts";
import { NOTIFICATION_MESSAGES } from "../../apps/worker/src/notify/ntfy.ts";
import { runDailyLoopScheduler } from "../../apps/worker/src/notify/scheduler.ts";
import { call, clearAuthState, login, testEnv } from "./helpers.ts";

let cookie = "";
let now = 0;
beforeEach(async () => {
  cookie = await login();
  now = Math.floor(Date.now() / 1000);
});
afterEach(async () => {
  await env.DB.batch(["events", "applications", "jobs", "job_matches", "interviews", "notifications_sent", "resume_profiles"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await clearAuthState();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;
const get = async (path: string) => (await call(path, { cookie })).json() as Promise<J>;

async function app(id: number, company: string, status = "applied", ageDays = 1) {
  const t = now - ageDays * 86400;
  await env.DB.prepare("INSERT INTO applications (id, company, company_norm, status, source, applied_at, last_event_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'email', ?5, ?5, ?5, ?5)").bind(id, company, company.toLowerCase(), status, t).run();
}

describe("brief: what GRU found in the mail", () => {
  it("lists vacancies that arrived on job alerts (best first) and what recent emails said, noting automatic moves", async () => {
    await app(1, "Fonterra", "rejected");
    await app(2, "Chubb", "interview");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO events (app_id, type, at, account_id, gmail_id, confidence, auto_applied, prev_status, created_at) VALUES (1, 'status:rejected', ?1, 1, 'm1', 0.95, 1, 'applied', ?1)").bind(now - 3600),
      env.DB.prepare("INSERT INTO events (app_id, type, at, account_id, gmail_id, auto_applied, created_at) VALUES (1, 'email:rejection', ?1, 1, 'm1', 0, ?1)").bind(now - 3600),
      env.DB.prepare("INSERT INTO events (app_id, type, at, account_id, gmail_id, auto_applied, created_at) VALUES (2, 'email:interview_invite', ?1, 1, 'm2', 0, ?1)").bind(now - 7200),
      env.DB.prepare("INSERT INTO jobs (source, source_account_id, source_gmail_id, title, company, location, status, first_seen_at, last_seen_at, created_at, updated_at) VALUES ('seek', 1, 'alert1', 'Graduate Data Analyst', 'Acme Robotics', 'Auckland', 'new', ?1, ?1, ?1, ?1)").bind(now - 3600),
      env.DB.prepare("INSERT INTO jobs (source, source_account_id, source_gmail_id, title, company, status, first_seen_at, last_seen_at, created_at, updated_at) VALUES ('linkedin', 1, 'alert2', 'Cook', 'Diner', 'new', ?1, ?1, ?1, ?1)").bind(now - 7200),
      env.DB.prepare("INSERT INTO jobs (source, title, company, status, first_seen_at, last_seen_at, created_at, updated_at) VALUES ('manual', 'Added by hand', 'X', 'new', ?1, ?1, ?1, ?1)").bind(now - 3600),
    ]);
    await call("/api/resume-profiles", { json: { label: "r", text: "Graduate engineer in Auckland. BSc Computer Science. Python, SQL, data analysis projects with PostgreSQL." }, cookie });
    const b = await get("/api/brief");
    expect(b.found.alert_job_count).toBe(2); // only vacancies that came from an alert
    expect(b.found.alert_jobs[0]).toMatchObject({ title: "Graduate Data Analyst", company: "Acme Robotics", source: "seek" });
    expect(b.found.alert_jobs[0].score).toBeGreaterThan(b.found.alert_jobs[1].score ?? -1); // scored on the way, best first
    expect(b.found.email_events).toEqual(expect.arrayContaining([
      expect.objectContaining({ company: "Fonterra", what: "rejection", moved_automatically: true }),
      expect.objectContaining({ company: "Chubb", what: "interview_invite", moved_automatically: false }),
    ]));
  });

  it("is empty and calm when nothing arrived", async () => {
    const b = await get("/api/brief");
    expect(b.found).toEqual({ alert_jobs: [], alert_job_count: 0, email_events: [] });
  });
});

describe("weekly summary", () => {
  it("reports response rate, outcomes, alert jobs and a concrete focus", async () => {
    await app(1, "Replied Co", "interview", 5);
    await app(2, "Quiet Co", "applied", 20);
    await app(3, "Another", "applied", 3);
    await env.DB.prepare("INSERT INTO events (app_id, type, at, auto_applied, created_at) VALUES (1, 'status:rejected', ?1, 0, ?1)").bind(now - 3600).run();
    await env.DB.prepare("INSERT INTO jobs (source, source_gmail_id, title, status, first_seen_at, last_seen_at, created_at, updated_at) VALUES ('seek', 'a', 'J', 'new', ?1, ?1, ?1, ?1)").bind(now - 3600).run();
    const w = await get("/api/agenda/weekly");
    expect(w).toMatchObject({ recent_applications: 3, response_rate: 33, rejections: 1, jobs_from_alerts: 1 });
    expect(w.focus).toMatch(/Quiet Co/); // the longest-quiet application is the thing to chase
  });
});

describe("weekly ping", () => {
  const sent: string[] = [];
  const f = (async (_u: string, init: RequestInit) => { sent.push(String(init.body)); return new Response("ok"); }) as unknown as typeof fetch;
  const e = testEnv({ NTFY_TOPIC: "gru-t" });
  beforeEach(() => { sent.length = 0; });
  const sunday = Math.floor(Date.parse("2026-12-19T19:31:00Z") / 1000); // Sun 20 Dec 08:31 NZDT
  const monday = Math.floor(Date.parse("2026-12-20T19:31:00Z") / 1000); // Mon 21 Dec 08:31 NZDT

  it("is sent once on Sunday morning, with a generic message, and not on other days", async () => {
    await runDailyLoopScheduler(e, new Db(env.DB), sunday, f);
    await runDailyLoopScheduler(e, new Db(env.DB), sunday + 600, f);
    expect(sent.filter((s) => s === NOTIFICATION_MESSAGES.weekly.message)).toHaveLength(1);
    sent.length = 0;
    await runDailyLoopScheduler(e, new Db(env.DB), monday, f);
    expect(sent).not.toContain(NOTIFICATION_MESSAGES.weekly.message);
  });
});
