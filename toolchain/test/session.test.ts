import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import {
  ABSOLUTE_TTL, IDLE_TTL, TOUCH_INTERVAL, insertSessionStmt, newToken, readSessionCookie, validateSession,
} from "../../apps/worker/src/auth/session.ts";
import { Db } from "../../apps/worker/src/db/client.ts";
import { clearAuthState } from "./helpers.ts";

afterEach(clearAuthState);

const T0 = 1_800_000_000;
const db = () => new Db(env.DB);

async function make(now: number): Promise<string> {
  const token = newToken();
  await env.DB.batch([await insertSessionStmt(db(), token, now)]);
  return token;
}

const lastSeen = async () =>
  (await env.DB.prepare("SELECT last_seen_at FROM sessions").first<{ last_seen_at: number }>())?.last_seen_at;

describe("sessions", () => {
  it("valid within the idle window", async () => {
    const t = await make(T0);
    expect(await validateSession(db(), t, T0 + 60)).toBe("valid");
  });

  it("missing / garbage tokens are rejected", async () => {
    expect(await validateSession(db(), null, T0)).toBe("missing");
    expect(await validateSession(db(), "not-a-token", T0)).toBe("missing");
    expect(await validateSession(db(), newToken(), T0)).toBe("missing");
  });

  it("expires after 7 days idle and deletes the row", async () => {
    const t = await make(T0);
    expect(await validateSession(db(), t, T0 + IDLE_TTL + 1)).toBe("expired");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first<{ n: number }>()).toEqual({ n: 0 });
  });

  it("expires at the 30-day absolute limit even when active", async () => {
    const t = await make(T0);
    let now = T0;
    while (now + IDLE_TTL / 2 < T0 + ABSOLUTE_TTL) {
      now += IDLE_TTL / 2;
      expect(await validateSession(db(), t, now)).toBe("valid");
    }
    expect(await validateSession(db(), t, T0 + ABSOLUTE_TTL)).toBe("expired");
  });

  it("touches last_seen_at at most every 10 minutes", async () => {
    const t = await make(T0);
    await validateSession(db(), t, T0 + TOUCH_INTERVAL - 1);
    expect(await lastSeen()).toBe(T0);
    await validateSession(db(), t, T0 + TOUCH_INTERVAL);
    expect(await lastSeen()).toBe(T0 + TOUCH_INTERVAL);
  });

  it("stores only a hash of the token", async () => {
    const t = await make(T0);
    const row = await env.DB.prepare("SELECT token_hash FROM sessions").first<{ token_hash: string }>();
    expect(row?.token_hash).not.toBe(t);
  });

  it("reads the cookie among others", () => {
    expect(readSessionCookie("a=1; __Host-gru_s=abc; b=2")).toBe("abc");
    expect(readSessionCookie("a=1")).toBeNull();
  });
});
