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
    ["interviews", "events", "applications", "job_matches", "jobs", "resume_profiles", "notes", "note_tokens", "tasks", "notifications_sent"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
  await clearAuthState();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;
const now = () => Math.floor(Date.now() / 1000);
const post = async (path: string, json: unknown, method = "POST") => call(path, { method, json, cookie });
const get = async (path: string) => (await call(path, { cookie })).json() as Promise<J>;

async function newApp(company = "Kōwhai Labs", status = "applied"): Promise<number> {
  const r = await post("/api/applications", { company, role: "Graduate Engineer", status });
  return ((await r.json()) as J).id;
}

describe("interviews", () => {
  it("creates, moves the application to interview, stores encrypted prep and debrief", async () => {
    const appId = await newApp();
    const start = now() + 5 * 3600;
    const r = await post("/api/interviews", { app_id: appId, start_utc: start, format: "video" });
    expect(r.status).toBe(201);
    const id = ((await r.json()) as J).id;
    expect((await get(`/api/applications/${appId}`)).status).toBe("interview");

    await post(`/api/interviews/${id}`, { prep: "Ask about the secret roadmap" }, "PATCH");
    const raw = await env.DB.prepare("SELECT prep_enc FROM interviews WHERE id = ?").bind(id).first<{ prep_enc: string }>();
    expect(raw?.prep_enc).not.toContain("roadmap");

    const bad = await post(`/api/interviews/${id}/debrief`, { rating: 9 });
    expect(bad.status).toBe(400);
    const ok = await post(`/api/interviews/${id}/debrief`, { rating: 4, questions: "System design", went_well: "Calm", improve: "Pace", followup_sent: true, next_step: "Technical round", next_date: "2026-12-20" });
    expect(ok.status).toBe(200);
    const list = await get(`/api/interviews?app_id=${appId}`);
    expect(list.items[0]).toMatchObject({ state: "done", rating: 4, followup_sent: true, prep: "Ask about the secret roadmap" });
    expect(list.items[0].debrief.questions).toBe("System design");
  });

  it("sends 24h and 2h reminders once each with a generic message", async () => {
    const appId = await newApp("Secret Corp");
    const t = now();
    await post("/api/interviews", { app_id: appId, start_utc: t + 20 * 3600 });
    const sent: string[] = [];
    const f = (async (_u: string, init: RequestInit) => { sent.push(String(init.body)); return new Response("ok"); }) as unknown as typeof fetch;
    const e = testEnv({ NTFY_TOPIC: "gru-t" });
    await runDailyLoopScheduler(e, new Db(env.DB), t, f);
    await runDailyLoopScheduler(e, new Db(env.DB), t + 60, f);
    expect(sent.filter((s) => s === NOTIFICATION_MESSAGES.interview.message)).toHaveLength(1);
    await runDailyLoopScheduler(e, new Db(env.DB), t + 19 * 3600, f);
    expect(sent.filter((s) => s === NOTIFICATION_MESSAGES.interview.message)).toHaveLength(2);
    expect(sent.join("|")).not.toContain("Secret");
  });
});

const RESUME = "Graduate software engineer in Auckland, New Zealand. BSc Computer Science. Built a REST API with Python, FastAPI and PostgreSQL, deployed with Docker on AWS. Used Git and pytest.";
const DESC = "Graduate backend role in Auckland. You will build APIs in Python and PostgreSQL, ship with Docker. Requirements: Python, PostgreSQL, Docker, REST. Degree in computer science. Nice to have: Kubernetes.";

describe("resume + jobs", () => {
  it("shows not-scored without a resume, then scores with evidence once one exists", async () => {
    const r = await post("/api/jobs", { title: "Graduate Backend Engineer", company: "Acme NZ", location: "Auckland", url: "https://example.com/jobs/1?utm_source=x", description: DESC });
    expect(r.status).toBe(201);
    const id = ((await r.json()) as J).id;
    expect((await get("/api/jobs")).has_resume).toBe(false);
    expect((await get(`/api/jobs/${id}`)).match).toBeNull();

    expect((await post("/api/resume-profiles", { label: "AI/Software", text: RESUME })).status).toBe(201);
    const detail = await get(`/api/jobs/${id}`);
    expect(detail.score).toBeNull(); // scored lazily on list
    const list = await get("/api/jobs");
    expect(list.has_resume).toBe(true);
    expect(list.items[0].score).toBeGreaterThanOrEqual(65);
    const after = await get(`/api/jobs/${id}`);
    expect(after.match.evidence.matched.length).toBeGreaterThan(2);
    expect(after.match.gaps.join()).toContain("kubernetes");
    const enc = await env.DB.prepare("SELECT resume_text_enc FROM resume_profiles").first<{ resume_text_enc: string }>();
    expect(enc?.resume_text_enc).not.toContain("Auckland");
  });

  it("dedupes by canonical URL and builds the ranked Apply Tomorrow queue", async () => {
    await post("/api/resume-profiles", { label: "r", text: RESUME });
    const a = await post("/api/jobs", { title: "Graduate Backend Engineer", company: "Acme", url: "https://example.com/j/1", description: DESC, location: "Auckland" });
    const dup = await post("/api/jobs", { title: "Graduate Backend Engineer", company: "Acme", url: "https://example.com/j/1?utm_campaign=z" });
    expect(((await dup.json()) as J).duplicate).toBe(true);
    await post("/api/jobs", { title: "Senior Java Architect", company: "Big", url: "https://example.com/j/2", location: "London", description: "Requirements: Java, Spring Boot, Kafka, 8+ years experience. ".repeat(5) });
    await post("/api/jobs", { title: "Graduate Dev", company: "NoUrl", description: DESC });
    const q = await get("/api/jobs/queue");
    expect(q.items.map((j: J) => j.title)).toEqual(["Graduate Backend Engineer"]);
    const id = ((await a.json()) as J).id;
    await post(`/api/jobs/${id}/decision`, { decision: "dismiss" });
    expect((await get("/api/jobs/queue")).items).toHaveLength(0);
  });

  it("mark-applied asks before linking an ambiguous application, then creates/links", async () => {
    await newApp("Acme");
    const j = await post("/api/jobs", { title: "Graduate Dev", company: "Acme", url: "https://example.com/j/9" });
    const id = ((await j.json()) as J).id;
    const amb = await post(`/api/jobs/${id}/mark-applied`, {});
    expect(amb.status).toBe(409);
    expect(((await amb.json()) as J).candidates).toHaveLength(1);
    const ok = await post(`/api/jobs/${id}/mark-applied`, { create_new: true });
    expect(ok.status).toBe(200);
    expect((await get("/api/jobs?status=applied")).items).toHaveLength(1);
  });
});

describe("notes, tasks, agenda, export", () => {
  it("finds notes by exact word via blind index; plaintext is never stored", async () => {
    await post("/api/notes", { body: "Recruiter Priya mentioned the Wellington team is hiring", tags: ["recruiter"] });
    await post("/api/notes", { body: "Unrelated grocery list" });
    const hit = await get("/api/notes/search?q=wellington");
    expect(hit.items).toHaveLength(1);
    expect(hit.items[0].tags).toEqual(["recruiter"]);
    expect((await get("/api/notes/search?q=wellington%20priya")).items).toHaveLength(1);
    expect((await get("/api/notes/search?q=melbourne")).items).toHaveLength(0);
    expect((await call("/api/notes/search?q=a", { cookie })).status).toBe(400);
    const raw = await env.DB.prepare("SELECT group_concat(token_hmac) AS t FROM note_tokens").first<{ t: string }>();
    expect(raw?.t.toLowerCase()).not.toContain("wellington");
  });

  it("buckets tasks into overdue/today/upcoming and completes them", async () => {
    const t = now();
    await post("/api/tasks", { title: "Overdue thing", due_at: t - 3 * 86400 });
    await post("/api/tasks", { title: "Today thing", due_at: t + 60 });
    await post("/api/tasks", { title: "Later thing", due_at: t + 3 * 86400, priority: 1 });
    await post("/api/tasks", { title: "Someday" });
    const a = await get("/api/agenda");
    expect(a.overdue.map((x: J) => x.title)).toEqual(["Overdue thing"]);
    expect(a.upcoming.map((x: J) => x.title)).toEqual(["Later thing"]);
    expect(a.someday.map((x: J) => x.title)).toEqual(["Someday"]);
    const id = a.overdue[0].id;
    await post(`/api/tasks/${id}`, { done: true }, "PATCH");
    expect((await get("/api/agenda")).overdue).toHaveLength(0);
    expect((await get("/api/tasks?status=done")).items).toHaveLength(1);
    expect((await get("/api/agenda/weekly")).tasks_done).toBe(1);
  });

  it("exports decrypted rows, paginated, for known tables only", async () => {
    await post("/api/notes", { body: "export me please" });
    const ex = await get("/api/export?table=notes");
    expect(ex.items[0].body).toBe("export me please");
    expect(ex.next).toBeNull();
    expect((await call("/api/export?table=sessions", { cookie })).status).toBe(400);
    expect((await call("/api/export?table=notes")).status).toBe(401);
  });
});
