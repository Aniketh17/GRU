import { env } from "cloudflare:test";
import { afterAll, describe, expect, it } from "vitest";
import { call, clearAuthState } from "./helpers.ts";

afterAll(clearAuthState);

describe("global login lock (distributed guessing)", () => {
  it("20 failures across many clients lock all logins with 429", async () => {
    const WRONG = "B".repeat(43);
    for (let c = 0; c < 5; c++) {
      for (let i = 0; i < 4; i++) {
        const res = await call("/auth/login", { json: { u: "testuser", p: WRONG }, headers: { "CF-Connecting-IP": `192.0.2.${c}` } });
        expect(res.status).toBe(401);
      }
    }
    const res = await call("/auth/login", { json: { u: "testuser", p: env.TEST_PROOF }, headers: { "CF-Connecting-IP": "192.0.2.200" } });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(3500);
  });
});
