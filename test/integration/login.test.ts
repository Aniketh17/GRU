import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { call, clearAuthState, login } from "./helpers.ts";

afterEach(clearAuthState);

const attempt = (u: string, p: string, ip: string) =>
  call("/auth/login", { json: { u, p }, headers: { "CF-Connecting-IP": ip } });
const WRONG = "A".repeat(43);

describe("login", () => {
  it("sets a __Host- session cookie with HttpOnly, Secure, SameSite=Strict, Path=/ and no Domain", async () => {
    const res = await attempt("testuser", env.TEST_PROOF, "198.51.100.1");
    expect(res.status).toBe(200);
    const c = res.headers.get("Set-Cookie") ?? "";
    expect(c).toMatch(/^__Host-gru_s=[A-Za-z0-9_-]{43};/);
    for (const attr of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) expect(c).toContain(attr);
    expect(c).not.toMatch(/Domain=/i);
  });

  it("gives an identical generic 401 for a wrong password and a wrong username", async () => {
    const a = await attempt("testuser", WRONG, "198.51.100.2");
    const b = await attempt("nobody", env.TEST_PROOF, "198.51.100.3");
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.text()).toBe(await b.text());
  });

  it("locks a client after 5 failures with 429 + Retry-After, even for correct credentials", async () => {
    const ip = "198.51.100.4";
    for (let i = 0; i < 5; i++) expect((await attempt("testuser", WRONG, ip)).status).toBe(401);
    const locked = await attempt("testuser", env.TEST_PROOF, ip);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("Retry-After"))).toBeGreaterThan(800);
    // A different client is unaffected.
    expect((await attempt("testuser", env.TEST_PROOF, "198.51.100.5")).status).toBe(200);
  });

  it("resets the client's failure count after a successful login", async () => {
    const ip = "198.51.100.6";
    for (let i = 0; i < 4; i++) await attempt("testuser", WRONG, ip);
    expect((await attempt("testuser", env.TEST_PROOF, ip)).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await attempt("testuser", WRONG, ip)).status).toBe(401);
  });

  it("never stores the raw IP", async () => {
    await attempt("testuser", WRONG, "203.0.113.77");
    const rows = await env.DB.prepare("SELECT bucket FROM login_attempts").all<{ bucket: string }>();
    expect(rows.results.length).toBeGreaterThan(0);
    for (const r of rows.results) expect(r.bucket).not.toContain("203.0.113.77");
  });

  it("validates the body and requires hygiene headers", async () => {
    expect((await call("/auth/login", { json: { u: "testuser" } })).status).toBe(400);
    expect((await call("/auth/login", { json: { u: "testuser", p: env.TEST_PROOF }, headers: { "X-App": "other" } })).status).toBe(403);
  });

  it("has no registration route", async () => {
    for (const p of ["/auth/register", "/auth/signup", "/api/register", "/api/users"]) {
      const res = await call(p, { json: { u: "x", p: WRONG } });
      expect([401, 404]).toContain(res.status);
    }
  });

  it("logout revokes the session server-side and clears the cookie", async () => {
    const cookie = await login();
    expect((await call("/api/health", { cookie })).status).toBe(200);
    const out = await call("/auth/logout", { json: {}, cookie });
    expect(out.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await call("/api/health", { cookie })).status).toBe(401);
  });
});

describe("/auth/params", () => {
  it("returns argon2id params without revealing whether the user exists", async () => {
    const real = (await (await call("/auth/params?u=testuser")).json()) as Record<string, unknown>;
    const fake = (await (await call("/auth/params?u=intruder")).json()) as Record<string, unknown>;
    expect(real).toMatchObject({ alg: "argon2id", v: 19, m: 19456, t: 2, p: 1 });
    expect(Object.keys(fake).sort()).toEqual(Object.keys(real).sort());
  });
});
