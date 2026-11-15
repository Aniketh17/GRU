// Unauthenticated access is blocked: exercised against the real Hono app on Node 20.
// The path variants are a regression guard inspired by GHSA-h7mg-cq63-vhpq. They do NOT reproduce
// that advisory against GRU's current routes (they also pass on hono 4.13.14); the actual fix is
// pinning hono >= 4.13.16 (D-029). Full D1-backed integration tests run in toolchain/ on Node 22.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { app } from "../../apps/worker/src/app.ts";
import type { Env } from "../../apps/worker/src/env.ts";
import worker from "../../apps/worker/src/index.ts";

/** Minimal D1 stand-in: kill_state=running, no sessions. Enough for the unauthenticated paths. */
function fakeD1(): D1Database {
  const stmt = {
    bind: () => stmt,
    all: async () => ({ results: [{ k: "kill_state", v: "running" }, { k: "paused", v: "0" }] }),
    first: async () => null,
    run: async () => ({ meta: { changes: 0 } }),
  };
  return { prepare: () => stmt, batch: async () => [] } as unknown as D1Database;
}

const env = {
  DB: fakeD1(),
  ASSETS: { fetch: async () => new Response("<!doctype html><title>GRU</title>", { headers: { "Content-Type": "text/html" } }) },
  APP_ORIGIN: "http://localhost:8787",
  DATA_KEY_V1: "x",
  INDEX_KEY: "x",
} as unknown as Env;

const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;

async function req(path: string, method = "GET"): Promise<Response> {
  const headers: Record<string, string> = method === "GET" ? {} : { "Content-Type": "application/json", "X-App": "gru", Origin: env.APP_ORIGIN };
  const r = new Request("http://localhost:8787" + path, { method, headers, ...(method === "GET" ? {} : { body: "{}" }) });
  return worker.fetch(r as Parameters<typeof worker.fetch>[0], env, ctx);
}

const apiRoutes = app.routes.filter((r) => r.path.startsWith("/api/") && r.method !== "ALL" && !r.path.includes("*"));

describe("auth gate (spec section 7)", () => {
  it("discovers the Phase 0 API routes from the router", () => {
    const found = apiRoutes.map((r) => `${r.method} ${r.path}`);
    for (const r of ["GET /api/health", "POST /api/admin/pause", "POST /api/admin/resume", "POST /api/admin/wipe"]) {
      assert.ok(found.includes(r), r);
    }
  });

  for (const r of apiRoutes) {
    it(`${r.method} ${r.path} -> 401, empty body`, async () => {
      const res = await req(r.path, r.method);
      assert.equal(res.status, 401);
      assert.equal(await res.text(), "");
    });
  }

  it("router-bypass path variants never reach a handler", async () => {
    const variants = [
      "/api/health%0A", "/api/health%0D", "/api/health%0D%0A", "/api/%0Ahealth", "/api//health",
      "/api/./health", "/api/health/", "/api/health?x=1", "/api/admin/../health", "/api/health%2F",
    ];
    for (const v of variants) {
      const res = await req(v);
      const body = await res.text();
      assert.ok(!body.includes("kill_state"), `${v} leaked handler output (status ${res.status})`);
      if (res.status === 200) assert.ok(body.startsWith("<!doctype html>"), `${v} returned non-shell 200`);
    }
  });

  it("the static shell and login params are public", async () => {
    assert.equal((await req("/")).status, 200);
    assert.equal((await req("/login")).status, 200);
  });

  it("every response carries the security headers, including 401s", async () => {
    const res = await req("/api/health");
    assert.ok(res.headers.get("Content-Security-Policy")?.startsWith("default-src 'self'"));
    assert.equal(res.headers.get("Cache-Control"), "no-store");
  });
});
