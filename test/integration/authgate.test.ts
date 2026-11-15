import { describe, expect, it } from "vitest";
import { app } from "../../apps/worker/src/app.ts";
import { call } from "./helpers.ts";

// Every registered /api route, discovered from the router so new routes are covered automatically.
const apiRoutes = app.routes.filter((r) => r.path.startsWith("/api/") && r.method !== "ALL" && !r.path.includes("*"));

describe("unauthenticated access is blocked", () => {
  it("discovers the Phase 0 API routes", () => {
    const paths = apiRoutes.map((r) => `${r.method} ${r.path}`);
    expect(paths).toEqual(expect.arrayContaining([
      "GET /api/health", "POST /api/admin/pause", "POST /api/admin/resume", "POST /api/admin/wipe",
    ]));
  });

  it.each(apiRoutes.map((r) => [r.method, r.path] as const))("%s %s -> 401 with an empty body", async (method, path) => {
    const res = await call(path, method === "GET" ? {} : { method, json: { phrase: "WIPE EVERYTHING" } });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
  });

  it("unknown /api paths are also 401 without a session", async () => {
    expect((await call("/api/applications")).status).toBe(401);
  });

  it("a forged cookie is rejected", async () => {
    expect((await call("/api/health", { cookie: "__Host-gru_s=" + "A".repeat(43) })).status).toBe(401);
  });

  it("only the static shell and the login routes are public", async () => {
    expect((await call("/")).status).toBe(200);
    expect([200, 307, 308]).toContain((await call("/login")).status);
    expect((await call("/auth/params?u=x")).status).toBe(200);
  });
});
