import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { call, clearAuthState, login } from "./helpers.ts";

let cookie = "";
beforeEach(async () => {
  cookie = await login();
});
afterEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM kv WHERE k IN ('last_manual_sync', 'tick_lock')"), env.DB.prepare("UPDATE kv SET v = '0' WHERE k = 'paused'")]);
  await clearAuthState();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sync = async (): Promise<Record<string, any>> => (await call("/api/sync", { json: {}, cookie })).json();

describe("POST /api/sync (Refresh)", () => {
  it("needs a session", async () => {
    expect((await call("/api/sync", { json: {} })).status).toBe(401);
  });

  it("runs, reports what is still waiting, and is rate limited to once per 10 seconds", async () => {
    expect(await sync()).toMatchObject({ ran: true, pending: 0 });
    expect(await sync()).toMatchObject({ ran: false, reason: "too_soon" });
  });

  it("does nothing while GRU is paused, and never overlaps a run that holds the lock", async () => {
    await env.DB.prepare("UPDATE kv SET v = '1' WHERE k = 'paused'").run();
    expect(await sync()).toMatchObject({ ran: false, reason: "paused" });
    await env.DB.prepare("UPDATE kv SET v = '0' WHERE k = 'paused'").run();
    await env.DB.prepare("DELETE FROM kv WHERE k = 'last_manual_sync'").run();
    await env.DB.prepare("INSERT INTO kv (k, v) VALUES ('tick_lock', ?)").bind(`${Math.floor(Date.now() / 1000) + 200}:other-run`).run();
    expect(await sync()).toMatchObject({ ran: false, reason: "busy" });
  });
});
