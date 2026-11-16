import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Db } from "../../apps/worker/src/db/client.ts";
import { NOTIFICATION_MESSAGES } from "../../apps/worker/src/notify/ntfy.ts";
import { runDailyLoopScheduler } from "../../apps/worker/src/notify/scheduler.ts";
import { call, clearAuthState, login, testEnv } from "./helpers.ts";

let cookie = "";
beforeEach(async () => {
  cookie = await login();
});
afterEach(async () => {
  await env.DB.batch(
    ["interviews", "events", "applications", "review_queue", "checkins", "notifications_sent", "mail_accounts"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
  await env.DB.prepare("DELETE FROM kv WHERE k = 'settings'").run();
  await clearAuthState();
});

const now = () => Math.floor(Date.now() / 1000);
const DAY = 86400;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;
const json = async (path: string, init: Parameters<typeof call>[1] = {}) => (await call(path, { cookie, ...init })).json() as Promise<J>;

async function seedApp(company: string, status: string, ageDays: number): Promise<number> {
  const t = now() - ageDays * DAY;
  const r = await env.DB.prepare(
    "INSERT INTO applications (company, company_norm, status, applied_at, last_event_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4, ?4, ?4)",
  ).bind(company, company.toLowerCase(), status, t).run();
  return Number(r.meta.last_row_id);
}

describe("GET /api/brief", () => {
  it("requires a session", async () => {
    expect((await call("/api/brief")).status).toBe(401);
  });

  it("summarises follow-ups, interviews, debriefs, review count, pipeline", async () => {
    const stale = await seedApp("Stale Co", "applied", 20);
    await seedApp("Fresh Co", "applied", 2);
    const iv = await seedApp("Soon Ltd", "interview", 5);
    const past = await seedApp("Done Inc", "interview", 9);
    const t = now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO interviews (app_id, state, start_utc, created_at, updated_at) VALUES (?1, 'scheduled', ?2, ?3, ?3)").bind(iv, t + 6 * 3600, t),
      env.DB.prepare("INSERT INTO interviews (app_id, state, start_utc, created_at, updated_at) VALUES (?1, 'done', ?2, ?3, ?3)").bind(past, t - 3 * DAY, t),
      env.DB.prepare("INSERT INTO review_queue (kind, proposal_json, created_at) VALUES ('classify', '{}', ?)").bind(t),
    ]);
    const b = await json("/api/brief");
    expect(b.follow_ups.map((f: J) => f.id)).toEqual([stale]);
    expect(b.interviews_upcoming).toHaveLength(1);
    expect(b.interviews_upcoming[0].company).toBe("Soon Ltd");
    expect(b.missing_debriefs.map((d: J) => d.company)).toEqual(["Done Inc"]);
    expect(b.review_count).toBe(1);
    expect(b.pipeline).toMatchObject({ applied: 2, interview: 2 });
    expect(b.health.summary).toBe("No Gmail accounts connected");
  });

  it("flags interview follow-up after the configured threshold", async () => {
    const past = await seedApp("Quiet Corp", "interview", 12);
    const t = now();
    await env.DB.prepare("INSERT INTO interviews (app_id, state, start_utc, created_at, updated_at) VALUES (?1, 'done', ?2, ?3, ?3)").bind(past, t - 8 * DAY, t).run();
    const b = await json("/api/brief");
    expect(b.follow_ups.some((f: J) => f.company === "Quiet Corp")).toBe(true);
  });
});

describe("settings", () => {
  it("defaults, validates and persists", async () => {
    expect(await json("/api/settings")).toMatchObject({ brief_time: "08:30", stale_days: 14, interview_stale_days: 7, ntfy_configured: false });
    const bad = await call("/api/settings", { method: "PUT", json: { brief_time: "25:99", stale_days: 14, interview_stale_days: 7 }, cookie });
    expect(bad.status).toBe(400);
    const ok = await call("/api/settings", { method: "PUT", json: { brief_time: "07:15", stale_days: 10, interview_stale_days: 5 }, cookie });
    expect(ok.status).toBe(200);
    expect(await json("/api/settings")).toMatchObject({ brief_time: "07:15", stale_days: 10 });
    const stale = await seedApp("Ten Days", "applied", 11);
    expect((await json("/api/brief")).follow_ups.map((f: J) => f.id)).toEqual([stale]);
  });
});

describe("check-in", () => {
  it("is pending, saves encrypted answers, and is idempotent per day", async () => {
    expect((await json("/api/checkin/today")).status).toBe("pending");
    const r1 = await call("/api/checkin/today", { json: { status: "completed", today_focus: "Email the hiring manager", applied_off_email: false }, cookie });
    expect(r1.status).toBe(200);
    const row = await env.DB.prepare("SELECT answers_enc FROM checkins").first<{ answers_enc: string }>();
    expect(row?.answers_enc).toBeTruthy();
    expect(row?.answers_enc).not.toContain("hiring manager");
    const today = await json("/api/checkin/today");
    expect(today.status).toBe("completed");
    expect(today.answers.today_focus).toBe("Email the hiring manager");
    await call("/api/checkin/today", { json: { status: "completed", today_focus: "Updated" }, cookie });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM checkins").first<{ n: number }>())?.n).toBe(1);
  });

  it("rejects invalid input and records skips", async () => {
    expect((await call("/api/checkin/today", { json: { status: "nope" }, cookie })).status).toBe(400);
    await call("/api/checkin/today", { json: { status: "skipped" }, cookie });
    expect((await json("/api/checkin/today")).status).toBe("skipped");
  });
});

describe("notification scheduler", () => {
  const sent: { url: string; body: string; headers: Headers }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: String(init.body), headers: new Headers(init.headers) });
    return new Response("ok");
  }) as unknown as typeof fetch;
  beforeEach(() => {
    sent.length = 0;
  });
  const e = testEnv({ NTFY_TOPIC: "gru-test-topic" });
  // 2026-12-15 08:31 NZDT = 2026-12-14T19:31Z; 18:31 NZDT = 2026-12-15T05:31Z
  const morning = Math.floor(Date.parse("2026-12-14T19:31:00Z") / 1000);
  const evening = Math.floor(Date.parse("2026-12-15T05:31:00Z") / 1000);
  const early = Math.floor(Date.parse("2026-12-14T19:00:00Z") / 1000);

  it("sends nothing before the brief time", async () => {
    await runDailyLoopScheduler(e, new Db(env.DB), early, fakeFetch);
    expect(sent).toHaveLength(0);
  });

  it("sends the morning ping exactly once, with a constant generic body", async () => {
    await seedApp("Secret Employer Ltd", "applied", 30);
    await runDailyLoopScheduler(e, new Db(env.DB), morning, fakeFetch);
    await runDailyLoopScheduler(e, new Db(env.DB), morning + 300, fakeFetch);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://ntfy.sh/gru-test-topic");
    expect(sent[0]!.body).toBe(NOTIFICATION_MESSAGES.brief.message);
    expect(JSON.stringify([...sent[0]!.headers])).not.toContain("Secret");
  });

  it("sends the evening ping only when check-in is not completed", async () => {
    await runDailyLoopScheduler(e, new Db(env.DB), evening, fakeFetch);
    expect(sent.map((s) => s.body)).toContain(NOTIFICATION_MESSAGES.evening.message);
    sent.length = 0;
    await env.DB.prepare("DELETE FROM notifications_sent").run();
    await env.DB.prepare("INSERT INTO checkins (date, status, completed_at) VALUES ('2026-12-15', 'completed', 1)").run();
    await runDailyLoopScheduler(e, new Db(env.DB), evening, fakeFetch);
    expect(sent.map((s) => s.body)).not.toContain(NOTIFICATION_MESSAGES.evening.message);
  });

  it("alerts once a day when a mailbox needs reauth", async () => {
    await env.DB.prepare("INSERT INTO mail_accounts (email, status, created_at) VALUES ('a@example.com', 'needs_reauth', 1)").run();
    await runDailyLoopScheduler(e, new Db(env.DB), morning, fakeFetch);
    await runDailyLoopScheduler(e, new Db(env.DB), morning + 600, fakeFetch);
    expect(sent.filter((s) => s.body === NOTIFICATION_MESSAGES.reauth.message)).toHaveLength(1);
  });

  it("skips quietly without a topic and retries after a failed delivery", async () => {
    await runDailyLoopScheduler(testEnv(), new Db(env.DB), morning, fakeFetch);
    expect(sent).toHaveLength(0);
    const failing = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    await runDailyLoopScheduler(e, new Db(env.DB), morning, failing);
    await runDailyLoopScheduler(e, new Db(env.DB), morning + 300, fakeFetch);
    expect(sent.filter((s) => s.body === NOTIFICATION_MESSAGES.brief.message)).toHaveLength(1);
  });
});

describe("ntfy rate limiting", () => {
  it("backs off for 30 minutes after a 429 instead of retrying on every run, then tries again", async () => {
    let calls = 0;
    const limited = (async () => { calls++; return new Response("slow down", { status: 429 }); }) as unknown as typeof fetch;
    const e = testEnv({ NTFY_TOPIC: "gru-test-topic" });
    const t0 = Math.floor(Date.parse("2026-12-14T19:31:00Z") / 1000); // 08:31 NZDT
    await runDailyLoopScheduler(e, new Db(env.DB), t0, limited);
    expect(calls).toBe(1);
    await runDailyLoopScheduler(e, new Db(env.DB), t0 + 300, limited);
    await runDailyLoopScheduler(e, new Db(env.DB), t0 + 900, limited);
    expect(calls).toBe(1); // still backing off
    await runDailyLoopScheduler(e, new Db(env.DB), t0 + 1900, limited);
    expect(calls).toBe(2); // the back-off has passed
  });
});
