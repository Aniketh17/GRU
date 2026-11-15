import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encJson } from "../../apps/worker/src/lib/enc.ts";
import { call, clearAuthState, login, testEnv } from "./helpers.ts";

let cookie = "";
let now = 0;
beforeEach(async () => {
  cookie = await login();
  now = Math.floor(Date.now() / 1000);
});
afterEach(async () => {
  await env.DB.batch(["interviews", "applications", "deadlines", "tasks", "jobs"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await env.DB.prepare("DELETE FROM kv WHERE k = 'cal_token'").run();
  await clearAuthState();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;
const get = async (path: string) => (await call(path, { cookie })).json() as Promise<J>;

async function seed() {
  await env.DB.prepare("INSERT INTO applications (id, company, company_norm, status, source, applied_at, last_event_at, created_at, updated_at) VALUES (1, 'Acme Robotics', 'acme robotics', 'interview', 'email', ?1, ?1, ?1, ?1)").bind(now).run();
  const link = await encJson(testEnv(), "interviews", "link_enc", 1, { url: "https://acme.zoom.us/j/555", kind: "Zoom" });
  await env.DB.batch([
    env.DB.prepare("INSERT INTO interviews (id, app_id, state, start_utc, tz, link_enc, created_at, updated_at) VALUES (1, 1, 'scheduled', ?1, 'Pacific/Auckland', ?2, ?3, ?3)").bind(now + 2 * 86400, link, now),
    env.DB.prepare("INSERT INTO interviews (id, app_id, state, start_utc, tz, created_at, updated_at) VALUES (2, 1, 'proposed', ?1, 'Pacific/Auckland', ?2, ?2)").bind(now + 5 * 86400, now),
    env.DB.prepare("INSERT INTO interviews (id, app_id, state, start_utc, created_at, updated_at) VALUES (3, 1, 'cancelled', ?1, ?2, ?2)").bind(now + 3 * 86400, now),
    env.DB.prepare("INSERT INTO deadlines (app_id, kind, due_at, created_at) VALUES (1, 'assessment', ?1, ?2)").bind(now + 3 * 86400, now),
    env.DB.prepare("INSERT INTO jobs (source, title, company, status, closing_at, first_seen_at, last_seen_at, created_at, updated_at) VALUES ('seek', 'Data Analyst', 'Beta Ltd', 'new', ?1, ?2, ?2, ?2, ?2)").bind(now + 4 * 86400, now),
  ]);
  await call("/api/tasks", { json: { title: "Call the recruiter", due_at: now + 86400 }, cookie });
}

describe("calendar items", () => {
  it("needs a session", async () => {
    expect((await call("/api/calendar")).status).toBe(401);
  });

  it("combines interviews (with link), deadlines, tasks and closing dates; skips cancelled interviews; honours the range", async () => {
    await seed();
    const { items } = (await get("/api/calendar")) as { items: J[] };
    expect(items.map((i) => i.kind)).toEqual(["task", "interview", "deadline", "closing", "interview"]);
    const iv = items.find((i) => i.key === "i1")!;
    expect(iv).toMatchObject({ title: "Interview · Acme Robotics", state: "scheduled", link: { url: "https://acme.zoom.us/j/555", kind: "Zoom" } });
    expect(items.find((i) => i.key === "i2")).toMatchObject({ state: "proposed", link: null });
    expect(items.find((i) => i.kind === "deadline")).toMatchObject({ title: "Assessment due · Acme Robotics", state: "open" });
    expect(items.find((i) => i.kind === "closing")?.title).toBe("Closes: Data Analyst · Beta Ltd");
    expect(((await get(`/api/calendar?from=${now}&to=${now + 3600}`)) as { items: J[] }).items).toHaveLength(0);
    expect((await call(`/api/calendar?from=0&to=${now + 999 * 86400}`, { cookie })).status).toBe(400);
  });

  it("deadlines can be marked done and then show as done", async () => {
    await seed();
    const id = ((await env.DB.prepare("SELECT id FROM deadlines").first<{ id: number }>()) as { id: number }).id;
    expect((await call(`/api/calendar/deadlines/${id}`, { method: "PATCH", json: { done: true }, cookie })).status).toBe(200);
    const { items } = (await get("/api/calendar")) as { items: J[] };
    expect(items.find((i) => i.kind === "deadline")?.state).toBe("done");
  });
});

describe("private calendar feed", () => {
  it("creates a stable secret URL, serves a calendar to anyone with the token, and rejects everything else", async () => {
    await seed();
    const feed = (await get("/api/calendar/feed")) as { url: string };
    expect(feed.url).toMatch(/\/cal\/[A-Za-z0-9_-]{30,}\.ics$/);
    expect(((await get("/api/calendar/feed")) as { url: string }).url).toBe(feed.url); // stable
    const path = new URL(feed.url).pathname;

    const res = await call(path); // no session: calendar apps can't log in
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/calendar");
    const ics = await res.text();
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("SUMMARY:Interview · Acme Robotics");
    expect(ics).toContain("URL:https://acme.zoom.us/j/555");
    expect(ics).toContain("STATUS:TENTATIVE"); // the proposed interview
    expect(ics).toContain("SUMMARY:Assessment due · Acme Robotics");
    expect(ics).toContain("SUMMARY:Call the recruiter");
    expect(ics).not.toContain("cancel");

    expect((await call("/cal/not-the-token.ics")).status).toBe(404);
    expect((await call(path.replace(".ics", ""))).status).toBe(404);
    expect((await call("/cal/.ics")).status).toBe(404);
  });

  it("resetting the link makes the old one stop working", async () => {
    const old = new URL(((await get("/api/calendar/feed")) as { url: string }).url).pathname;
    const fresh = (await (await call("/api/calendar/feed/reset", { json: {}, cookie })).json()) as { url: string };
    expect(new URL(fresh.url).pathname).not.toBe(old);
    expect((await call(old)).status).toBe(404);
    expect((await call(new URL(fresh.url).pathname)).status).toBe(200);
  });

  it("serves nothing when no feed link has been created", async () => {
    expect((await call("/cal/anything.ics")).status).toBe(404);
  });
});
