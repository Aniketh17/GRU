// Pure pieces of the request pipeline that don't need workerd or D1.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ABSOLUTE_TTL, clearSessionCookie, readSessionCookie, sessionCookie } from "../../apps/worker/src/auth/session.ts";
import { BudgetExhausted, SubrequestBudget } from "../../apps/worker/src/db/budget.ts";
import { BASE_CSP, LOGIN_CSP, applySecurityHeaders, isNoStorePath } from "../../apps/worker/src/http/headers.ts";
import { isWipeableTable } from "../../apps/worker/src/kill/wipe.ts";

describe("security headers", () => {
  it("applies the full set to any response, including immutable ones", () => {
    const res = applySecurityHeaders(Response.redirect("http://localhost/x", 302), "/api/health");
    assert.equal(res.headers.get("Content-Security-Policy"), BASE_CSP);
    assert.equal(res.headers.get("Strict-Transport-Security"), "max-age=31536000; includeSubDomains");
    assert.equal(res.headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.equal(res.status, 302);
  });

  it("matches the spec's CSP exactly", () => {
    assert.equal(BASE_CSP, "default-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  });

  it("only the login page gets 'wasm-unsafe-eval' (D-021)", () => {
    assert.equal(applySecurityHeaders(new Response("x"), "/login").headers.get("Content-Security-Policy"), LOGIN_CSP);
    assert.equal(applySecurityHeaders(new Response("x"), "/").headers.get("Content-Security-Policy"), BASE_CSP);
    assert.ok(!BASE_CSP.includes("unsafe"));
    assert.ok(!LOGIN_CSP.includes("'unsafe-eval'"));
  });

  it("no-store on /api and /auth only", () => {
    assert.equal(isNoStorePath("/api/health"), true);
    assert.equal(isNoStorePath("/auth/login"), true);
    assert.equal(isNoStorePath("/assets/app.js"), false);
    assert.equal(applySecurityHeaders(new Response("x"), "/").headers.get("Cache-Control"), null);
  });
});

describe("session cookie", () => {
  it("is __Host-, HttpOnly, Secure, SameSite=Strict, Path=/, no Domain, 30-day Max-Age", () => {
    const c = sessionCookie("A".repeat(43));
    assert.match(c, /^__Host-gru_s=A{43};/);
    for (const attr of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/", `Max-Age=${ABSOLUTE_TTL}`]) assert.ok(c.includes(attr), attr);
    assert.ok(!/Domain=/i.test(c));
    assert.ok(clearSessionCookie().includes("Max-Age=0"));
  });

  it("reads the session cookie among others", () => {
    assert.equal(readSessionCookie("a=1; __Host-gru_s=abc; b=2"), "abc");
    assert.equal(readSessionCookie("a=1"), null);
    assert.equal(readSessionCookie(undefined), null);
  });
});

describe("SubrequestBudget (spec section 5, D-003)", () => {
  it("allows 40 calls and rejects the 41st", () => {
    const b = new SubrequestBudget();
    for (let i = 0; i < 40; i++) b.take();
    assert.equal(b.remaining, 0);
    assert.throws(() => b.take(), BudgetExhausted);
  });

  it("charges fetches before they are sent", async () => {
    const b = new SubrequestBudget(0);
    await assert.rejects(async () => b.fetch("http://192.0.2.1/never"), BudgetExhausted);
  });
});

describe("wipe table selection", () => {
  it("never touches D1 internals", () => {
    assert.equal(isWipeableTable("d1_migrations"), false);
    assert.equal(isWipeableTable("_cf_KV"), false);
    assert.equal(isWipeableTable("sqlite_sequence"), false);
    assert.equal(isWipeableTable("Robert'); DROP TABLE x;--"), false);
    assert.equal(isWipeableTable("notes"), true);
  });
});
