import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { call, clearAuthState, login } from "./helpers.ts";

let cookie = "";
beforeEach(async () => { cookie = await login(); });
afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM net_touches"), env.DB.prepare("DELETE FROM net_people"), env.DB.prepare("DELETE FROM net_companies"),
    env.DB.prepare("DELETE FROM applications"), env.DB.prepare("DELETE FROM jobs"), env.DB.prepare("DELETE FROM resume_profiles"), env.DB.prepare("DELETE FROM kv WHERE k = 'net_goals'"),
  ]);
  await clearAuthState();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = async (path: string, init: Record<string, unknown> = {}) => (await call(path, { cookie, ...init })).json() as Promise<Record<string, any>>;

describe("network", () => {
  it("collects target companies, ignoring duplicates, and imports the ones already seen", async () => {
    expect((await j("/api/network/companies/bulk", { json: { names: ["Xero", "xero", "Datacom"] } })).added).toBe(2);
    expect((await call("/api/network/companies", { json: { name: "Xero" }, cookie })).status).toBe(409);
    await env.DB.prepare("INSERT INTO applications (company, company_norm, role, source, status, applied_at, created_at, updated_at) VALUES ('Orion Health','orion health','Analyst','seek','applied',1,1,1)").run();
    expect((await j("/api/network/companies/import-seen", { json: {} })).added).toBe(1);
    const list = (await j("/api/network/companies")).items as { name: string; source: string }[];
    expect(list.map((c) => c.name).sort()).toEqual(["Datacom", "Orion Health", "Xero"]);
  });

  it("stores people encrypted, moves them along the pipeline, schedules follow-ups and advances the company", async () => {
    const co = await j("/api/network/companies", { json: { name: "Xero", why: "Great data team" } });
    const p = await j("/api/network/people", { json: { company_id: co.id, name: "Priya Nair", role: "Data Engineer", url: "https://www.linkedin.com/in/priya" } });
    const raw = await env.DB.prepare("SELECT name_enc, url_enc FROM net_people WHERE id = ?").bind(p.id).first<{ name_enc: string; url_enc: string }>();
    expect(raw?.name_enc).not.toContain("Priya");
    expect(raw?.url_enc).not.toContain("linkedin");

    const sent = await j(`/api/network/people/${p.id}/touch`, { json: { kind: "sent" } });
    expect(sent.stage).toBe("sent");
    expect(sent.next_followup_at).toBeGreaterThan(Date.now() / 1000 + 6 * 86400);
    expect((await env.DB.prepare("SELECT status FROM net_companies WHERE id = ?").bind(co.id).first<{ status: string }>())?.status).toBe("contacted");

    await j(`/api/network/people/${p.id}/touch`, { json: { kind: "call", note: "Said Kafka and dbt matter most. Team is wrestling with late data." } });
    expect((await env.DB.prepare("SELECT status FROM net_companies WHERE id = ?").bind(co.id).first<{ status: string }>())?.status).toBe("conversation");
    await j(`/api/network/people/${p.id}/touch`, { json: { kind: "sent" } }); // a later nudge must not move the company backwards
    expect((await env.DB.prepare("SELECT status FROM net_companies WHERE id = ?").bind(co.id).first<{ status: string }>())?.status).toBe("conversation");
    const detail = await j(`/api/network/people/${p.id}`);
    expect(detail.name).toBe("Priya Nair");
    expect((detail.touches as { note: string | null }[]).some((t) => t.note?.includes("Kafka"))).toBe(true);
    expect((await env.DB.prepare("SELECT note_enc FROM net_touches WHERE note_enc IS NOT NULL").first<{ note_enc: string }>())?.note_enc).not.toContain("Kafka");
  });

  it("counts this week's outreach against the goals and lists follow-ups that are due", async () => {
    const p = await j("/api/network/people", { json: { name: "Sam Lee" } });
    await j("/api/network/goals", { method: "PUT", json: { outreach: 1, conversations: 1 } });
    await j(`/api/network/people/${p.id}/touch`, { json: { kind: "sent", followup_days: 0 } });
    await env.DB.prepare("UPDATE net_people SET next_followup_at = 1 WHERE id = ?").bind(p.id).run();
    const o = await j("/api/network/overview");
    expect(o.week).toMatchObject({ outreach: 1, conversations: 0, goals: { outreach: 1, conversations: 1 }, streak: 1 });
    expect((o.due as { name: string }[]).map((d) => d.name)).toEqual(["Sam Lee"]);
  });

  it("drafts curiosity-first messages from templates and never needs the AI", async () => {
    const p = await j("/api/network/people", { json: { name: "Priya Nair", role: "Data Engineer" } });
    const d = await j(`/api/network/people/${p.id}/draft`, { json: { kind: "connect" } });
    expect(d.source).toBe("template");
    expect(d.text.length).toBeLessThanOrEqual(200);
    const polished = await call(`/api/network/people/${p.id}/draft`, { json: { kind: "connect", polish: true }, cookie }, { AI: { run: async () => ({ response: "Hi Priya, are you hiring? I would love a referral." }) } as never });
    const pj = (await polished.json()) as { source: string; text: string };
    expect(pj.source).toBe("template"); // an AI rewrite that asks for a job is thrown away
    const good = await call(`/api/network/people/${p.id}/draft`, { json: { kind: "connect", polish: true }, cookie }, { AI: { run: async () => ({ response: "Hi Priya, I'm curious about your work as a Data Engineer and would love to connect. No ask, just curiosity." }) } as never });
    expect(((await good.json()) as { source: string }).source).toBe("ai");
  });
});
