import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { call, clearAuthState, login } from "./helpers.ts";

let cookie = "";
beforeEach(async () => { cookie = await login(); });
afterEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM events"), env.DB.prepare("DELETE FROM applications"), env.DB.prepare("DELETE FROM net_people"), env.DB.prepare("DELETE FROM kv WHERE k = 'prefs'")]);
  await clearAuthState();
});

const now = () => Math.floor(Date.now() / 1000);
const addApp = async (company: string, source: string, status: string, appliedAgo: number) => {
  const r = await env.DB.prepare("INSERT INTO applications (company, company_norm, role, source, status, applied_at, created_at, updated_at) VALUES (?, ?, 'Analyst', ?, ?, ?, 1, 1) RETURNING id")
    .bind(company, company.toLowerCase(), source, status, now() - appliedAgo).first<{ id: number }>();
  return r?.id as number;
};

describe("insights", () => {
  it("builds the funnel, reply rate by source and time to first reply from the applications and their history", async () => {
    const a = await addApp("A", "seek", "rejected", 10 * 86400); // replied, and had reached an interview before being rejected
    await env.DB.prepare("INSERT INTO events (app_id, type, at, prev_status, auto_applied, created_at) VALUES (?, 'status:interview', ?, 'applied', 0, 1)").bind(a, now() - 6 * 86400).run();
    await env.DB.prepare("INSERT INTO events (app_id, type, at, prev_status, auto_applied, created_at) VALUES (?, 'status:rejected', ?, 'interview', 0, 1)").bind(a, now() - 2 * 86400).run();
    await addApp("B", "seek", "applied", 3 * 86400);
    await addApp("C", "linkedin", "offer", 20 * 86400);
    const d = (await (await call("/api/insights", { cookie })).json()) as {
      funnel: Record<string, number>; by_source: { source: string; total: number; replied: number }[]; weekly: { applied: number }[]; median_days_to_reply: number | null;
    };
    expect(d.funnel).toEqual({ applied: 3, replied: 2, assessment: 2, interview: 2, offer: 1 });
    expect(d.by_source.find((s) => s.source === "seek")).toMatchObject({ total: 2, replied: 1 });
    expect(d.weekly).toHaveLength(8);
    expect(d.weekly.reduce((n, w) => n + w.applied, 0)).toBe(3);
    expect(Math.round(d.median_days_to_reply ?? -1)).toBe(4); // applied 10 days ago, first change 6 days ago
  });

  it("is empty and safe with no data, and stores search shortcuts", async () => {
    const d = (await (await call("/api/insights", { cookie })).json()) as { funnel: { applied: number }; demand: unknown[] };
    expect(d.funnel.applied).toBe(0);
    expect(d.demand).toEqual([]);
    const saved = await call("/api/insights/prefs", { method: "PUT", json: { roles: ["graduate data analyst", " "], location: "Auckland" }, cookie });
    expect(saved.status).toBe(400); // a blank role is rejected
    await call("/api/insights/prefs", { method: "PUT", json: { roles: ["graduate data analyst"], location: "Auckland" }, cookie });
    expect(await (await call("/api/insights/prefs", { cookie })).json()).toEqual({ roles: ["graduate data analyst"], location: "Auckland" });
  });
});
