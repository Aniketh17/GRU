import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { call, clearAuthState, login } from "./helpers.ts";

let cookie = "";
beforeEach(async () => {
  cookie = await login();
});
afterEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM events"), env.DB.prepare("DELETE FROM applications")]);
  await clearAuthState();
});

type App = { id: number; company: string; role: string | null; status: string; stale: boolean; notes?: string | null };
const create = async (body: Record<string, unknown>) => {
  const res = await call("/api/applications", { json: body, cookie });
  expect(res.status).toBe(201);
  return (await res.json()) as App;
};
const get = async (path: string) => (await call(path, { cookie })).json() as Promise<Record<string, unknown>>;
const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

describe("applications CRUD", () => {
  it("creates with defaults and records a 'created' event", async () => {
    const a = await create({ company: "Kōwhai Labs Ltd", role: "Graduate ML Engineer" });
    expect(a).toMatchObject({ company: "Kōwhai Labs Ltd", role: "Graduate ML Engineer", status: "applied", stale: false });
    const row = await env.DB.prepare("SELECT company_norm, role_norm FROM applications WHERE id = ?").bind(a.id).first();
    expect(row).toEqual({ company_norm: "kowhai labs", role_norm: "graduate ml engineer" });
    const tl = (await get(`/api/applications/${a.id}/timeline`)) as { items: { type: string }[] };
    expect(tl.items.map((e) => e.type)).toEqual(["created"]);
  });

  it("encrypts notes at rest and returns them decrypted", async () => {
    const a = await create({ company: "Harbourline", notes: "Recruiter: Sam" });
    const raw = await env.DB.prepare("SELECT notes_enc FROM applications WHERE id = ?").bind(a.id).first<{ notes_enc: string }>();
    expect(raw?.notes_enc).toMatch(/^v1\.k1\./);
    expect(raw?.notes_enc).not.toContain("Sam");
    expect((await get(`/api/applications/${a.id}`)).notes).toBe("Recruiter: Sam");
  });

  it("validates input", async () => {
    expect((await call("/api/applications", { json: { company: "" }, cookie })).status).toBe(400);
    expect((await call("/api/applications", { json: { company: "X", status: "hired" }, cookie })).status).toBe(400);
    expect((await call("/api/applications", { json: { company: "X".repeat(121) }, cookie })).status).toBe(400);
  });

  it("patches fields, re-normalises, and clears notes", async () => {
    const a = await create({ company: "Old Name", notes: "secret" });
    const res = await call(`/api/applications/${a.id}`, { method: "PATCH", json: { company: "New Name Limited", next_action: "Follow up", notes: null }, cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ company: "New Name Limited", next_action: "Follow up", notes: null });
    const row = await env.DB.prepare("SELECT company_norm, notes_enc FROM applications WHERE id = ?").bind(a.id).first();
    expect(row).toEqual({ company_norm: "new name", notes_enc: null });
    expect((await call(`/api/applications/${a.id}`, { method: "PATCH", json: {}, cookie })).status).toBe(400);
  });

  it("deletes the application and its events", async () => {
    const a = await create({ company: "Gone Co" });
    expect((await call(`/api/applications/${a.id}`, { method: "DELETE", json: {}, cookie })).status).toBe(200);
    expect((await call(`/api/applications/${a.id}`, { cookie })).status).toBe(404);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE app_id = ?").bind(a.id).first()).toEqual({ n: 0 });
  });

  it("404s on unknown or malformed ids", async () => {
    expect((await call("/api/applications/999999", { cookie })).status).toBe(404);
    expect((await call("/api/applications/abc", { cookie })).status).toBe(404);
  });
});

describe("list, filters, search, pagination", () => {
  it("filters active vs closed vs a single status", async () => {
    await create({ company: "A1" });
    await create({ company: "A2", status: "interview" });
    await create({ company: "C1", status: "rejected" });
    const ids = async (q: string) => ((await get(`/api/applications?${q}`)).items as App[]).map((x) => x.company).sort();
    expect(await ids("status=active")).toEqual(["A1", "A2"]);
    expect(await ids("status=closed")).toEqual(["C1"]);
    expect(await ids("status=interview")).toEqual(["A2"]);
    expect(await ids("status=all")).toEqual(["A1", "A2", "C1"]);
  });

  it("searches company and role, macron-insensitive, with LIKE wildcards escaped", async () => {
    await create({ company: "Kōwhai Labs", role: "ML Engineer" });
    await create({ company: "Harbourline", role: "Backend Developer" });
    await create({ company: "100% Pure_Data" });
    const names = async (q: string) => ((await get(`/api/applications?status=all&q=${encodeURIComponent(q)}`)).items as App[]).map((x) => x.company);
    expect(await names("kowhai")).toEqual(["Kōwhai Labs"]);
    expect(await names("backend")).toEqual(["Harbourline"]);
    // "%" normalises to an empty term, so no LIKE filter is applied at all (it cannot act as a wildcard).
    expect((await names("%")).sort()).toEqual(["100% Pure_Data", "Harbourline", "Kōwhai Labs"]);
    expect(await names("pure data")).toEqual(["100% Pure_Data"]);
    expect(await names("_")).toHaveLength(3);
    expect(await names("zzz")).toEqual([]);
  });

  it("flags stale applications (14 days without activity) and filters them", async () => {
    const old = await create({ company: "Quiet Co", applied_at: now() - 20 * DAY });
    await create({ company: "Fresh Co" });
    const stale = (await get("/api/applications?stale=1")).items as App[];
    expect(stale.map((x) => x.id)).toEqual([old.id]);
    expect(stale[0]?.stale).toBe(true);
    expect((await get("/api/applications/summary")).stale).toBe(1);
  });

  it("caps pages at 50 and paginates with a cursor without duplicates", async () => {
    const stmts = [];
    const t = now();
    for (let i = 0; i < 55; i++) {
      stmts.push(env.DB.prepare("INSERT INTO applications (company, company_norm, status, last_event_at, created_at, updated_at) VALUES (?, ?, 'applied', ?, ?, ?)").bind(`Co ${i}`, `co ${i}`, t - i, t, t));
    }
    await env.DB.batch(stmts);
    expect((await call("/api/applications?limit=51", { cookie })).status).toBe(400);
    const p1 = await get("/api/applications");
    expect((p1.items as App[]).length).toBe(50);
    const p2 = await get(`/api/applications?cursor=${p1.next_cursor as string}`);
    expect((p2.items as App[]).length).toBe(5);
    expect(p2.next_cursor).toBeNull();
    const all = [...(p1.items as App[]), ...(p2.items as App[])].map((x) => x.id);
    expect(new Set(all).size).toBe(55);
  });

  it("summary counts by status", async () => {
    await create({ company: "A" });
    await create({ company: "B" });
    await create({ company: "C", status: "offer" });
    expect((await get("/api/applications/summary")).counts).toEqual({ applied: 2, offer: 1 });
  });
});

describe("manual status override, timeline and undo", () => {
  it("allows any manual move, records prev_status, and undo reverts it", async () => {
    const a = await create({ company: "Harbourline" });
    const res = await call(`/api/applications/${a.id}/status`, { json: { status: "interview" }, cookie });
    expect(res.status).toBe(200);
    const { application, event_id } = (await res.json()) as { application: App; event_id: number };
    expect(application.status).toBe("interview");

    // Manual override may go "backwards" (only automatic changes are forbidden from downgrading).
    const tl = (await get(`/api/applications/${a.id}/timeline`)) as { items: { type: string; prev_status: string | null }[] };
    expect(tl.items[0]).toMatchObject({ type: "status:interview", prev_status: "applied" });

    const undo = await call(`/api/events/${event_id}/undo`, { json: {}, cookie });
    expect(await undo.json()).toEqual({ undone: true, status: "applied" });
    expect(((await get(`/api/applications/${a.id}`)) as App).status).toBe("applied");
    expect((await call(`/api/events/${event_id}/undo`, { json: {}, cookie })).status).toBe(409);
  });

  it("rejects a no-op change and refuses undo after 24 hours", async () => {
    const a = await create({ company: "Late Co" });
    expect((await call(`/api/applications/${a.id}/status`, { json: { status: "applied" }, cookie })).status).toBe(409);
    const res = await call(`/api/applications/${a.id}/status`, { json: { status: "rejected" }, cookie });
    const { event_id } = (await res.json()) as { event_id: number };
    await env.DB.prepare("UPDATE events SET created_at = created_at - 90000 WHERE id = ?").bind(event_id).run();
    const undo = await call(`/api/events/${event_id}/undo`, { json: {}, cookie });
    expect(undo.status).toBe(409);
    expect(await undo.json()).toEqual({ error: "undo_expired" });
  });

  it("cannot undo a 'created' event", async () => {
    const a = await create({ company: "X" });
    const tl = (await get(`/api/applications/${a.id}/timeline`)) as { items: { id: number }[] };
    expect((await call(`/api/events/${tl.items[0]?.id}/undo`, { json: {}, cookie })).status).toBe(409);
  });
});
