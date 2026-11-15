// Integration tests for Phase 2: Gmail OAuth, security flow, sync, review queue and undo (spec §8, §9, Phase 2 rev 2 §10).
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { b64urlEncode, utf8 } from "../../apps/worker/src/crypto/b64.ts";
import { sha256 } from "../../apps/worker/src/crypto/hmac.ts";
import { aadFor, decryptField, keyringFromEnv } from "../../apps/worker/src/crypto/envelope.ts";
import { runTick } from "../../apps/worker/src/tick.ts";
import { call, clearAuthState, login, testEnv } from "./helpers.ts";

let cookie = "";
const TEST_EMAIL = "ani.primary@gmail.com";
const TEST_CLIENT_ID = "mock-client-id";
const TEST_CLIENT_SECRET = "mock-client-secret";

const mockEnv = {
  GOOGLE_CLIENT_ID: TEST_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: TEST_CLIENT_SECRET,
  ALLOWED_EMAILS: "ani.primary@gmail.com,ani.secondary@gmail.com",
};

beforeEach(async () => {
  cookie = await login();
});

afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM events"),
    env.DB.prepare("DELETE FROM applications"),
    env.DB.prepare("DELETE FROM review_queue"),
    env.DB.prepare("DELETE FROM emails_seen"),
    env.DB.prepare("DELETE FROM mail_accounts"),
    env.DB.prepare("DELETE FROM oauth_states"),
  ]);
  await clearAuthState();
});

function makeMockIdToken(email: string, nonce: string) {
  const header = b64urlEncode(utf8.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = b64urlEncode(
    utf8.encode(
      JSON.stringify({
        iss: "https://accounts.google.com",
        aud: TEST_CLIENT_ID,
        exp: Math.floor(Date.now() / 1000) + 3600,
        nonce,
        email,
        email_verified: true,
      }),
    ),
  );
  return `${header}.${payload}.mock-sig`;
}

describe("Gmail OAuth connect flow (/api/mail/connect)", () => {
  it("rejects unauthorized request with 401", async () => {
    const res = await call("/api/mail/connect", { json: { email: TEST_EMAIL } }, mockEnv);
    expect(res.status).toBe(401);
  });

  it("rejects email not in allowlist with 403", async () => {
    const res = await call("/api/mail/connect", { json: { email: "intruder@gmail.com" }, cookie }, mockEnv);
    expect(res.status).toBe(403);
  });

  it("generates Google URL, sets __Host-gru_oauth cookie and stores state hash", async () => {
    const res = await call("/api/mail/connect", { json: { email: TEST_EMAIL }, cookie }, mockEnv);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { url: string };
    expect(data.url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(data.url).toContain(`client_id=${TEST_CLIENT_ID}`);

    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain("__Host-gru_oauth=");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("HttpOnly");

    // Check oauth_states table has hashed state, not plaintext
    const url = new URL(data.url);
    const rawState = url.searchParams.get("state")!;
    const stateHash = b64urlEncode(await sha256(rawState));

    const stateRow = await env.DB.prepare("SELECT * FROM oauth_states WHERE state = ?").bind(stateHash).first();
    expect(stateRow).toBeTruthy();
    expect(stateRow?.used).toBe(0);
  });
});

describe("OAuth callback security flow (/auth/google/callback)", () => {
  it("rejects callback if binding cookie is missing", async () => {
    // Start connect
    const connRes = await call("/api/mail/connect", { json: { email: TEST_EMAIL }, cookie }, mockEnv);
    const data = (await connRes.json()) as { url: string };
    const rawState = new URL(data.url).searchParams.get("state")!;

    // Call callback without __Host-gru_oauth cookie
    const cbRes = await call(`/auth/google/callback?code=mock_code&state=${rawState}`, {}, mockEnv);
    expect(cbRes.status).toBe(302);
    expect(cbRes.headers.get("Location")).toContain("error=missing_binding_cookie");
  });

  it("rejects callback if binding cookie does not match stored hash", async () => {
    const connRes = await call("/api/mail/connect", { json: { email: TEST_EMAIL }, cookie }, mockEnv);
    const data = (await connRes.json()) as { url: string };
    const rawState = new URL(data.url).searchParams.get("state")!;

    // Call callback with forged binding cookie
    const cbRes = await call(
      `/auth/google/callback?code=mock_code&state=${rawState}`,
      { headers: { Cookie: "__Host-gru_oauth=forged_binding_token" } },
      mockEnv,
    );
    expect(cbRes.status).toBe(302);
    expect(cbRes.headers.get("Location")).toContain("error=binding_cookie_mismatch");
  });

  it("completes happy path connection, encrypts tokens, and clears binding cookie", async () => {
    const connRes = await call("/api/mail/connect", { json: { email: TEST_EMAIL }, cookie }, mockEnv);
    const data = (await connRes.json()) as { url: string };
    const rawState = new URL(data.url).searchParams.get("state")!;
    const url = new URL(data.url);
    const nonce = url.searchParams.get("nonce")!;
    const bindingCookie = connRes.headers.get("Set-Cookie")!.split(";")[0]!;

    // Mock global fetch for Google token and profile endpoints
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === "string" ? input : input.toString();
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "mock_access_token_123",
            refresh_token: "mock_refresh_token_456",
            expires_in: 3600,
            scope: "openid email https://www.googleapis.com/auth/gmail.metadata",
            token_type: "Bearer",
            id_token: makeMockIdToken(TEST_EMAIL, nonce),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (urlStr.includes("gmail/v1/users/me/profile")) {
        return new Response(
          JSON.stringify({
            emailAddress: TEST_EMAIL,
            messagesTotal: 100,
            threadsTotal: 50,
            historyId: "hist_12345",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return originalFetch(input, init);
    };

    try {
      const cbRes = await call(
        `/auth/google/callback?code=mock_code_xyz&state=${rawState}`,
        { headers: { Cookie: `${cookie}; ${bindingCookie}` } },
        mockEnv,
      );

      expect(cbRes.status).toBe(302);
      expect(cbRes.headers.get("Location")).toContain("/settings?connected=1");
      expect(cbRes.headers.get("Set-Cookie")).toContain("__Host-gru_oauth=;");

      // Verify account in mail_accounts table
      const account = await env.DB.prepare("SELECT * FROM mail_accounts WHERE email = ?").bind(TEST_EMAIL).first();
      expect(account).toBeTruthy();
      expect(account?.status).toBe("active");
      expect(account?.history_id).toBe("hist_12345");
      expect(account?.access_token_enc).toMatch(/^v1\.k1\./);
      expect(account?.refresh_token_enc).toMatch(/^v1\.k1\./);

      // Verify state cannot be replayed
      const replayRes = await call(
        `/auth/google/callback?code=mock_code_xyz&state=${rawState}`,
        { headers: { Cookie: `${cookie}; ${bindingCookie}` } },
        mockEnv,
      );
      expect(replayRes.status).toBe(302);
      expect(replayRes.headers.get("Location")).toContain("error=");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("revokes token and refuses connection if unexpected scopes are returned", async () => {
    const connRes = await call("/api/mail/connect", { json: { email: TEST_EMAIL }, cookie }, mockEnv);
    const data = (await connRes.json()) as { url: string };
    const rawState = new URL(data.url).searchParams.get("state")!;
    const bindingCookie = connRes.headers.get("Set-Cookie")!.split(";")[0]!;

    let revokeCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === "string" ? input : input.toString();
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "mock_access_token_bad_scope",
            refresh_token: "mock_refresh_token_bad_scope",
            expires_in: 3600,
            // Forbidden scope gmail.readonly included!
            scope: "openid email https://www.googleapis.com/auth/gmail.metadata https://www.googleapis.com/auth/gmail.readonly",
            token_type: "Bearer",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (urlStr.includes("oauth2.googleapis.com/revoke")) {
        revokeCalled = true;
        return new Response("ok", { status: 200 });
      }
      return originalFetch(input, init);
    };

    try {
      const cbRes = await call(
        `/auth/google/callback?code=mock_code&state=${rawState}`,
        { headers: { Cookie: `${cookie}; ${bindingCookie}` } },
        mockEnv,
      );

      expect(cbRes.status).toBe(302);
      expect(cbRes.headers.get("Location")).toContain("error=unexpected_scopes_granted");
      expect(revokeCalled).toBe(true);

      const account = await env.DB.prepare("SELECT * FROM mail_accounts WHERE email = ?").bind(TEST_EMAIL).first();
      expect(account).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Review queue and Undo integration", () => {
  it("resolves review queue item and immediately purges encrypted context", async () => {
    // Create an application
    const appRes = await call("/api/applications", { json: { company: "Harbourline", status: "applied" }, cookie });
    const app = (await appRes.json()) as { id: number };

    // Insert an item in review_queue with encrypted context
    const ring = keyringFromEnv(testEnv());
    const contextJson = JSON.stringify({ subject: "Offer of employment – Harbourline", from: "Sam Patel" });
    const ins = await env.DB.prepare(
      "INSERT INTO review_queue (kind, app_id, proposal_json, created_at) VALUES ('classify', ?, ?, ?)",
    ).bind(app.id, JSON.stringify({ class: "offer", suggested: "offer" }), 1700000000).run();
    const reviewId = ins.meta.last_row_id as number;

    const contextEnc = await decryptField ? await (async () => {
      const { encryptField } = await import("../../apps/worker/src/crypto/envelope.ts");
      return encryptField(ring, contextJson, aadFor("review_queue", "context", reviewId));
    })() : "";

    await env.DB.prepare("UPDATE review_queue SET context_enc = ? WHERE id = ?").bind(contextEnc, reviewId).run();

    // Verify GET /api/review returns item with decrypted context
    const listRes = await call("/api/review", { cookie });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { items: { id: number; context: { subject: string } }[] };
    expect(list.items.length).toBe(1);
    expect(list.items[0]?.context.subject).toBe("Offer of employment – Harbourline");

    // Resolve review queue item (confirm offer)
    const resolveRes = await call(
      `/api/review/${reviewId}/resolve`,
      { method: "POST", json: { action: "confirm", appId: app.id, status: "offer" }, cookie },
    );
    expect(resolveRes.status).toBe(200);

    // Verify application updated to offer
    const appUpdated = await env.DB.prepare("SELECT status FROM applications WHERE id = ?").bind(app.id).first();
    expect(appUpdated?.status).toBe("offer");

    // Verify context_enc is purged (NULL) in DB
    const reviewRow = await env.DB.prepare("SELECT context_enc, resolved_at FROM review_queue WHERE id = ?").bind(reviewId).first();
    expect(reviewRow?.resolved_at).toBeTruthy();
    expect(reviewRow?.context_enc).toBeNull();
  });

  it("sync tick processes mail, updates application, preserves privacy (no snippets), and allows undo", async () => {
    const ring = keyringFromEnv(testEnv());
    const now = Math.floor(Date.now() / 1000);

    // Create an application for Harbourline
    const appRes = await call("/api/applications", { json: { company: "Harbourline", status: "applied" }, cookie });
    const app = (await appRes.json()) as { id: number };

    // Setup an active account in mail_accounts
    const accessEnc = await (await import("../../apps/worker/src/crypto/envelope.ts")).encryptField(
      ring,
      "valid_mock_access_token",
      aadFor("mail_accounts", "access_token", TEST_EMAIL),
    );
    await env.DB.prepare(
      "INSERT INTO mail_accounts (email, label, access_token_enc, access_expires_at, status, backfill_done, history_id, created_at) VALUES (?, ?, ?, ?, 'active', 1, 'hist_001', ?)",
    ).bind(TEST_EMAIL, TEST_EMAIL, accessEnc, now + 3600, now).run();

    const account = await env.DB.prepare("SELECT id FROM mail_accounts WHERE email = ?").bind(TEST_EMAIL).first<{ id: number }>();
    expect(account).toBeTruthy();

    // Mock fetch for Gmail API during tick
    const mockFetch = async (input: RequestInfo | URL) => {
      const urlStr = typeof input === "string" ? input : input.toString();

      if (urlStr.includes("/messages?maxResults=")) {
        return new Response(JSON.stringify({ messages: [{ id: "msg_assess_1", threadId: "t_assess_1" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (urlStr.includes("/batch/gmail/v1")) {
        const boundary = "mock_batch_boundary";
        const respBody = [
          `--${boundary}`,
          "Content-Type: application/http",
          "Content-ID: <response-1>",
          "",
          "HTTP/1.1 200 OK",
          "Content-Type: application/json; charset=UTF-8",
          "",
          JSON.stringify({
            id: "msg_assess_1",
            threadId: "t_assess_1",
            labelIds: ["INBOX"],
            internalDate: String(now * 1000),
            payload: {
              headers: [
                { name: "From", value: "Harbourline Careers <careers@hackerrank.com>" },
                { name: "Subject", value: "Harbourline has invited you to complete a coding challenge" },
              ],
            },
          }),
          `--${boundary}--`,
        ].join("\r\n");

        return new Response(respBody, {
          status: 200,
          headers: { "Content-Type": `multipart/mixed; boundary=${boundary}` },
        });
      }

      if (urlStr.includes("/history?")) {
        return new Response(
          JSON.stringify({
            historyId: "hist_999",
            history: [
              {
                id: "h1",
                messagesAdded: [
                  { message: { id: "msg_assess_1", threadId: "t_assess_1" } },
                ],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("not found", { status: 404 });
    };

    // Run tick with mockFetch
    const tickResult = await runTick(testEnv(mockEnv), now, mockFetch as unknown as typeof fetch);
    expect(tickResult.ran).toBe(true);

    // Verify application moved automatically from applied -> assessment
    const appUpdated = await env.DB.prepare("SELECT status FROM applications WHERE id = ?").bind(app.id).first();
    expect(appUpdated?.status).toBe("assessment");

    // Verify event recorded with auto_applied = 1
    const event = await env.DB.prepare(
      "SELECT id, type, prev_status, auto_applied, undone FROM events WHERE app_id = ? ORDER BY id DESC LIMIT 1",
    ).bind(app.id).first<{ id: number; type: string; prev_status: string; auto_applied: number; undone: number }>();
    expect(event).toBeTruthy();
    expect(event?.prev_status).toBe("applied");
    expect(event?.auto_applied).toBe(1);
    expect(event?.undone).toBe(0);

    // Verify emails_seen row: snippet_enc MUST be NULL per privacy rule
    const seen = await env.DB.prepare("SELECT * FROM emails_seen WHERE gmail_id = 'msg_assess_1'").first();
    expect(seen).toBeTruthy();
    expect(seen?.snippet_enc).toBeNull();
    expect(seen?.disposition).toBe("auto_applied");

    // Test Undo on automatic event
    const undoRes = await call(`/api/events/${event!.id}/undo`, { method: "POST", json: {}, cookie });
    expect(undoRes.status).toBe(200);

    // Application status should be reverted back to applied
    const appReverted = await env.DB.prepare("SELECT status FROM applications WHERE id = ?").bind(app.id).first();
    expect(appReverted?.status).toBe("applied");
  });
});
