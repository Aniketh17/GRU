import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { Db } from "../../apps/worker/src/db/client.ts";
import { acquireTickLock, runTick } from "../../apps/worker/src/tick.ts";
import { clearAuthState, resetKillState, testEnv } from "./helpers.ts";

const T0 = 1_800_000_000;

afterEach(async () => {
  await resetKillState();
  await clearAuthState();
  await env.DB.prepare("DELETE FROM kv WHERE k = 'tick_lock'").run();
});

describe("cron tick", () => {
  it("exits immediately when paused", async () => {
    await env.DB.prepare("UPDATE kv SET v = '1' WHERE k = 'paused'").run();
    expect(await runTick(testEnv(), T0)).toEqual({ ran: false, reason: "paused" });
  });

  it("exits immediately when not running (wiping/wiped)", async () => {
    await env.DB.prepare("UPDATE kv SET v = 'wiped' WHERE k = 'kill_state'").run();
    expect(await runTick(testEnv(), T0)).toEqual({ ran: false, reason: "wiped" });
  });

  it("runs, and releases its lock afterwards", async () => {
    expect(await runTick(testEnv(), T0)).toEqual({ ran: true });
    expect(await env.DB.prepare("SELECT v FROM kv WHERE k = 'tick_lock'").first()).toBeNull();
  });

  it("does not overlap with a tick holding a live lock", async () => {
    expect(await acquireTickLock(new Db(env.DB), T0)).not.toBeNull();
    expect(await runTick(testEnv(), T0 + 60)).toEqual({ ran: false, reason: "locked" });
  });

  it("takes over an expired lock", async () => {
    expect(await acquireTickLock(new Db(env.DB), T0)).not.toBeNull();
    expect(await runTick(testEnv(), T0 + 301)).toEqual({ ran: true });
  });

  it("housekeeping removes expired sessions and stale login attempts", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sessions VALUES ('old', ?, ?, ?)").bind(T0 - 40 * 86400, T0 - 10 * 86400, T0 - 10 * 86400),
      env.DB.prepare("INSERT INTO sessions VALUES ('live', ?, ?, ?)").bind(T0 - 60, T0 - 60, T0 + 86400),
      env.DB.prepare("INSERT INTO login_attempts VALUES ('c:stale', 1, ?, 0, 0)").bind(T0 - 2 * 86400),
    ]);
    await runTick(testEnv(), T0);
    const sessions = await env.DB.prepare("SELECT token_hash FROM sessions").all<{ token_hash: string }>();
    expect(sessions.results.map((r) => r.token_hash)).toEqual(["live"]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts").first()).toEqual({ n: 0 });
  });
});
