import { env } from "cloudflare:test";
import { afterAll, describe, expect, it } from "vitest";
import { BASE_CSP, LOGIN_CSP } from "../../apps/worker/src/http/headers.ts";
import { call, clearAuthState, login, resetKillState } from "./helpers.ts";

afterAll(async () => {
  await resetKillState();
  await clearAuthState();
});

function expectSecurityHeaders(res: Response, csp = BASE_CSP): void {
  expect(res.headers.get("Content-Security-Policy")).toBe(csp);
  expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
  expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
}

describe("security headers on every response class", () => {
  it("static shell (200)", async () => {
    const res = await call("/");
    expect(res.status).toBe(200);
    expectSecurityHeaders(res);
    expect(res.headers.get("Cache-Control")).not.toBe("no-store");
  });

  it("login page gets 'wasm-unsafe-eval' and nothing else does", async () => {
    const res = await call("/login");
    expectSecurityHeaders(res, LOGIN_CSP);
    expect(LOGIN_CSP).toContain("'wasm-unsafe-eval'");
    expect(BASE_CSP).not.toContain("unsafe");
  });

  it("401 from /api with no-store", async () => {
    const res = await call("/api/health");
    expect(res.status).toBe(401);
    expectSecurityHeaders(res);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("authenticated 200 from /api with no-store", async () => {
    const res = await call("/api/health", { cookie: await login() });
    expect(res.status).toBe(200);
    expectSecurityHeaders(res);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("415 from hygiene", async () => {
    const res = await call("/auth/login", { method: "POST", body: "u=x", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    expect(res.status).toBe(415);
    expectSecurityHeaders(res);
  });

  it("429 from the login lock", async () => {
    let res!: Response;
    for (let i = 0; i < 6; i++) {
      res = await call("/auth/login", { json: { u: "testuser", p: "C".repeat(43) }, headers: { "CF-Connecting-IP": "198.51.100.99" } });
    }
    expect(res.status).toBe(429);
    expectSecurityHeaders(res);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("423 when wiped", async () => {
    await env.DB.prepare("UPDATE kv SET v = 'wiped' WHERE k = 'kill_state'").run();
    const res = await call("/api/health");
    expect(res.status).toBe(423);
    expectSecurityHeaders(res);
    await resetKillState();
  });
});
