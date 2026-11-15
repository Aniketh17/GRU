import { env } from "cloudflare:test";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { call, clearAuthState, login, resetKillState } from "./helpers.ts";

afterEach(resetKillState);
afterAll(clearAuthState);

const kv = async (k: string) => (await env.DB.prepare("SELECT v FROM kv WHERE k = ?").bind(k).first<{ v: string }>())?.v;

describe("pause / resume", () => {
  it("flips the paused flag and health reports it", async () => {
    const cookie = await login();
    await call("/api/admin/pause", { json: {}, cookie });
    expect(await kv("paused")).toBe("1");
    expect(await (await call("/api/health", { cookie })).json()).toMatchObject({ paused: true, kill_state: "running" });
    await call("/api/admin/resume", { json: {}, cookie });
    expect(await kv("paused")).toBe("0");
  });
});

describe("kill states", () => {
  it("wiping -> 423 on /api and /auth, static shell still served", async () => {
    await env.DB.prepare("UPDATE kv SET v = 'wiping' WHERE k = 'kill_state'").run();
    expect((await call("/api/health")).status).toBe(423);
    expect((await call("/auth/params?u=x")).status).toBe(423);
    expect((await call("/")).status).toBe(200);
  });

  it("wiped -> 423 with the state, so the app can show the Wiped page", async () => {
    await env.DB.prepare("UPDATE kv SET v = 'wiped' WHERE k = 'kill_state'").run();
    const res = await call("/api/health");
    expect(res.status).toBe(423);
    expect(await res.json()).toEqual({ state: "wiped" });
  });

  it("an unknown kill_state value fails closed", async () => {
    await env.DB.prepare("UPDATE kv SET v = 'banana' WHERE k = 'kill_state'").run();
    expect((await call("/api/health")).status).toBe(423);
  });
});

describe("locked (data keys absent)", () => {
  it("data routes return 423 {locked:true}; health and admin still work", async () => {
    const cookie = await login();
    const lockedEnv = { DATA_KEY_V1: undefined, INDEX_KEY: undefined };
    const data = await call("/api/applications", { cookie }, lockedEnv);
    expect(data.status).toBe(423);
    expect(await data.json()).toEqual({ locked: true });
    const health = await call("/api/health", { cookie }, lockedEnv);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ locked: true });
    expect((await call("/api/admin/pause", { json: {}, cookie }, lockedEnv)).status).toBe(200);
  });
});
