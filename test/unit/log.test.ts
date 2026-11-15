import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { errorCode, log, sanitize } from "../../apps/worker/src/log/index.ts";

describe("log allowlist (spec section 7)", () => {
  it("rejects sensitive keys: subject, snippet, body, from, email, and more", () => {
    const out = sanitize({
      subject: "Interview at Acme", snippet: "Hi there", body: "full text", from: "hr@acme.example",
      to: "me@example.com", email: "me@example.com", resume: "skills", description: "job text",
      password: "x", token: "y", ip: "203.0.113.5", title: "Engineer", company: "Acme",
    });
    assert.deepEqual(out, {});
  });

  it("keeps allowlisted keys with safe values", () => {
    const fields = { id: 3, account_id: 1, fetched_count: 12, duration_ms: 4.2, status: "active", error_code: "invalid_grant" };
    assert.deepEqual(sanitize(fields), fields);
  });

  it("drops unsafe values even under allowed keys", () => {
    assert.deepEqual(sanitize({ code: "someone@example.com", status: "has spaces in it", id: { nested: 1 }, count: [1, 2], ms: Infinity }), {});
  });

  it("writes exactly one JSON line with only safe fields", () => {
    const spy = mock.method(console, "log", () => {});
    try {
      log("tick_done", { count: 2, subject: "secret" });
      log("Bad Event Name!", { count: 1 });
      assert.equal(spy.mock.callCount(), 2);
      assert.deepEqual(JSON.parse(spy.mock.calls[0]?.arguments[0] as string), { ev: "tick_done", count: 2 });
      assert.deepEqual(JSON.parse(spy.mock.calls[1]?.arguments[0] as string), { ev: "invalid_event", count: 1 });
    } finally {
      spy.mock.restore();
    }
  });

  it("errorCode exposes only safe error names, never messages", () => {
    assert.equal(errorCode(new TypeError("contains user@example.com")), "TypeError");
    assert.equal(errorCode("a string"), "unknown");
  });
});
