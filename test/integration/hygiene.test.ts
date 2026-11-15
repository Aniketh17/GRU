import { afterAll, describe, expect, it } from "vitest";
import { call, clearAuthState, login } from "./helpers.ts";

afterAll(clearAuthState);

describe("request hygiene on mutating routes", () => {
  it("rejects a non-JSON content type with 415", async () => {
    const cookie = await login();
    const res = await call("/api/admin/pause", { method: "POST", body: "x", cookie, headers: { "Content-Type": "text/plain" } });
    expect(res.status).toBe(415);
  });

  it("rejects a missing X-App header with 403", async () => {
    const cookie = await login();
    const res = await call("/api/admin/pause", { json: {}, cookie, headers: { "X-App": "" } });
    expect(res.status).toBe(403);
  });

  it("rejects a foreign Origin with 403 (CSRF)", async () => {
    const cookie = await login();
    const res = await call("/api/admin/pause", { json: {}, cookie, headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  it("accepts a well-formed request", async () => {
    const cookie = await login();
    expect((await call("/api/admin/pause", { json: {}, cookie })).status).toBe(200);
    expect((await call("/api/admin/resume", { json: {}, cookie })).status).toBe(200);
  });
});
