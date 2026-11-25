import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AI_CAPS, utcDay } from "../../apps/worker/src/lib/aibudget.ts";
import { call, clearAuthState, login } from "./helpers.ts";

let cookie = "";
beforeEach(async () => { cookie = await login(); });
afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM job_kits"), env.DB.prepare("DELETE FROM job_matches"), env.DB.prepare("DELETE FROM jobs"),
    env.DB.prepare("DELETE FROM resume_profiles"), env.DB.prepare("DELETE FROM kv WHERE k LIKE 'ai:%'"),
  ]);
  await clearAuthState();
});

const BULLET = "Built GRU, a job-search assistant on Cloudflare Workers with TypeScript and D1, handling emails every day";
const RESUME = `Aniketh, BSc Computer Science\nProjects\n- ${BULLET}\n- Trained a PyTorch image classifier reaching 92% accuracy on a public dataset\nSkills: Python, TypeScript, SQL`;

async function seed() {
  await call("/api/resume-profiles", { json: { label: "Main", text: RESUME }, cookie });
  const j = (await (await call("/api/jobs", { json: { title: "Graduate Data Engineer", company: "Acme", description: "Requirements: Python, SQL, Kafka and Airflow. Graduate role in Auckland, experience with data pipelines." }, cookie })).json()) as { id: number };
  return j.id;
}
const ai = (text: string, usage = { prompt_tokens: 300, completion_tokens: 120 }) => ({ run: async () => ({ choices: [{ message: { content: text } }], usage }) });
const post = (id: number, body: unknown, a: unknown) => call(`/api/jobs/${id}/tailor`, { json: body, cookie }, { AI: a as never });

describe("tailor kit", () => {
  it("rewrites bullets, holds back anything not in the resume, caches the result and charges the tailoring share", async () => {
    const id = await seed();
    const reply = JSON.stringify({ rewrites: [{ i: 0, text: "Built GRU with Kafka, serving 10,000 users" }, { i: 1, text: "Trained a PyTorch image classifier reaching 92% accuracy" }], summary: "Graduate with TypeScript and PyTorch projects." });
    const r = await post(id, { keywords: ["kafka", "airflow"], bullets: [BULLET, "Trained a PyTorch image classifier reaching 92% accuracy on a public dataset"] }, ai(reply));
    expect(r.status).toBe(200);
    const { kit } = (await r.json()) as { kit: { rewrites: { grounded: boolean; flagged: string[] }[]; summary_flagged: string[] } };
    expect(kit.rewrites[0]?.grounded).toBe(false);
    expect(kit.rewrites[0]?.flagged).toEqual(expect.arrayContaining(["kafka", "10000"]));
    expect(kit.rewrites[1]?.grounded).toBe(true);
    expect(kit.summary_flagged).toEqual([]);

    const raw = await env.DB.prepare("SELECT kit_enc FROM job_kits").first<{ kit_enc: string }>();
    expect(raw?.kit_enc).not.toContain("PyTorch"); // encrypted at rest

    const cached = (await (await call(`/api/jobs/${id}/tailor`, { cookie })).json()) as { kit: unknown; stale: boolean; resume: { text: string } | null; description: string | null };
    expect(cached.kit).not.toBeNull();
    expect(cached.stale).toBe(false);
    expect(cached.description).toContain("Kafka");
    const used = await env.DB.prepare("SELECT v FROM kv WHERE k = ?").bind(`ai:tailor:${utcDay(Math.floor(Date.now() / 1000))}`).first<{ v: string }>();
    expect(Number(used?.v)).toBeGreaterThan(0);
    expect(Number(used?.v)).toBeLessThan(60);
    const llm = await env.DB.prepare("SELECT v FROM kv WHERE k = ?").bind(`ai:llm:${utcDay(Math.floor(Date.now() / 1000))}`).first();
    expect(llm).toBeNull(); // chat's share is untouched
  });

  it("refuses bullets that are not in the resume, and needs a posting and a resume", async () => {
    const id = await seed();
    expect((await post(id, { bullets: ["Led a team of fifty engineers at Google for ten years"] }, ai("{}"))).status).toBe(400);
    const none = (await (await call("/api/jobs", { json: { title: "No text", company: "Z" }, cookie })).json()) as { id: number };
    expect((await post(none.id, { bullets: [BULLET] }, ai("{}"))).status).toBe(409);
    expect((await call(`/api/jobs/${id}/tailor`, { json: { bullets: [BULLET] }, cookie })).status).toBe(501); // no AI binding
  });

  it("stops at its own daily share and hands the reservation back when the model fails", async () => {
    const id = await seed();
    const failing = { run: async () => { throw new Error("boom"); } };
    expect((await post(id, { bullets: [BULLET] }, failing)).status).toBe(502);
    const k = `ai:tailor:${utcDay(Math.floor(Date.now() / 1000))}`;
    expect(Number((await env.DB.prepare("SELECT v FROM kv WHERE k = ?").bind(k).first<{ v: string }>())?.v)).toBe(0);
    await env.DB.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(k, String(AI_CAPS.tailor)).run();
    expect((await post(id, { bullets: [BULLET] }, ai("{}"))).status).toBe(429);
    const al = (await (await call("/api/ai/allowance", { cookie })).json()) as { tailor: { used: number; cap: number } };
    expect(al.tailor).toEqual({ used: AI_CAPS.tailor, cap: AI_CAPS.tailor });
  });
});
