// Unit tests for Gmail API client, OAuth helpers, scope enforcement and batch parsing (spec §8, Phase 2 rev 2 §2, §10).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FORBIDDEN_GMAIL_SCOPES,
  GMAIL_METADATA_FIELDS,
  GMAIL_SCOPES,
} from "../../apps/worker/src/gmail/constants.ts";
import {
  buildBatchGetRequestBody,
  buildGoogleAuthUrl,
  gmailMessageToMeta,
  parseAndValidateIdToken,
  parseBatchGetResponseBody,
  ScopeError,
  validateGrantedScopes,
} from "../../apps/worker/src/gmail/client.ts";
import { b64urlEncode, utf8 } from "../../apps/worker/src/crypto/b64.ts";

describe("Gmail scope enforcement (Phase 2 rev 2 §2)", () => {
  it("requests strictly openid, email, and gmail.metadata", () => {
    assert.deepEqual([...GMAIL_SCOPES], [
      "openid",
      "email",
      "https://www.googleapis.com/auth/gmail.metadata",
    ]);
  });

  it("ensures no code requests any forbidden scopes", () => {
    assert.equal(GMAIL_SCOPES.length, 3);
    for (const scope of GMAIL_SCOPES) {
      assert.ok(!FORBIDDEN_GMAIL_SCOPES.includes(scope as any));
    }
  });

  it("validateGrantedScopes accepts valid metadata scope", () => {
    assert.doesNotThrow(() => {
      validateGrantedScopes("openid email https://www.googleapis.com/auth/gmail.metadata");
    });
  });

  it("validateGrantedScopes rejects missing gmail.metadata scope", () => {
    assert.throws(
      () => validateGrantedScopes("openid email"),
      (err) => err instanceof ScopeError && err.message === "missing_gmail_metadata_scope",
    );
  });

  it("validateGrantedScopes rejects any forbidden scope", () => {
    for (const forbidden of FORBIDDEN_GMAIL_SCOPES) {
      assert.throws(
        () => validateGrantedScopes(`openid email https://www.googleapis.com/auth/gmail.metadata ${forbidden}`),
        (err) => err instanceof ScopeError && err.message.startsWith("forbidden_scope_detected:"),
      );
    }
  });
});

describe("Google OAuth URL builder", () => {
  it("builds URL with all required Phase 2 security parameters", () => {
    const urlStr = buildGoogleAuthUrl({
      clientId: "test-client-id",
      redirectUri: "http://localhost:8787/auth/google/callback",
      state: "state-token-123",
      codeChallenge: "challenge-456",
      nonce: "nonce-789",
      loginHint: "candidate@gmail.com",
    });

    const url = new URL(urlStr);
    assert.equal(url.origin, "https://accounts.google.com");
    assert.equal(url.pathname, "/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("client_id"), "test-client-id");
    assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:8787/auth/google/callback");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
    assert.equal(url.searchParams.get("include_granted_scopes"), "false");
    assert.equal(url.searchParams.get("state"), "state-token-123");
    assert.equal(url.searchParams.get("code_challenge"), "challenge-456");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("nonce"), "nonce-789");
    assert.equal(url.searchParams.get("login_hint"), "candidate@gmail.com");
  });
});

describe("Google id_token validation", () => {
  const makeToken = (payload: Record<string, unknown>) => {
    const header = b64urlEncode(utf8.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
    const body = b64urlEncode(utf8.encode(JSON.stringify(payload)));
    return `${header}.${body}.mock-signature`;
  };

  const validPayload = {
    iss: "https://accounts.google.com",
    aud: "my-client-id",
    exp: 2000000000,
    nonce: "correct-nonce",
    email: "ani@gmail.com",
    email_verified: true,
  };

  it("accepts valid token for allowed email and matching nonce", () => {
    const token = makeToken(validPayload);
    const claims = parseAndValidateIdToken(token, {
      clientId: "my-client-id",
      nonce: "correct-nonce",
      allowedEmails: ["ani@gmail.com", "other@gmail.com"],
      now: 1700000000,
    });
    assert.equal(claims.email, "ani@gmail.com");
  });

  it("rejects token with wrong issuer", () => {
    const token = makeToken({ ...validPayload, iss: "https://fake.issuer.com" });
    assert.throws(() => {
      parseAndValidateIdToken(token, {
        clientId: "my-client-id",
        allowedEmails: ["ani@gmail.com"],
        now: 1700000000,
      });
    });
  });

  it("rejects token with wrong audience", () => {
    const token = makeToken({ ...validPayload, aud: "wrong-client-id" });
    assert.throws(() => {
      parseAndValidateIdToken(token, {
        clientId: "my-client-id",
        allowedEmails: ["ani@gmail.com"],
        now: 1700000000,
      });
    });
  });

  it("rejects expired token", () => {
    const token = makeToken({ ...validPayload, exp: 1600000000 });
    assert.throws(() => {
      parseAndValidateIdToken(token, {
        clientId: "my-client-id",
        allowedEmails: ["ani@gmail.com"],
        now: 1700000000,
      });
    });
  });

  it("rejects unverified email", () => {
    const token = makeToken({ ...validPayload, email_verified: false });
    assert.throws(() => {
      parseAndValidateIdToken(token, {
        clientId: "my-client-id",
        allowedEmails: ["ani@gmail.com"],
        now: 1700000000,
      });
    });
  });

  it("rejects email not in allowlist", () => {
    const token = makeToken({ ...validPayload, email: "intruder@gmail.com" });
    assert.throws(() => {
      parseAndValidateIdToken(token, {
        clientId: "my-client-id",
        allowedEmails: ["ani@gmail.com"],
        now: 1700000000,
      });
    });
  });
});

describe("Gmail batch request builder & multipart parser", () => {
  it("builds valid multipart batch body requesting format=metadata without snippets", () => {
    const ids = ["189a1b2c", "189a1b2d"];
    const boundary = "test_boundary";
    const body = buildBatchGetRequestBody(ids, boundary);

    assert.ok(body.includes(`--${boundary}\r\n`));
    assert.ok(body.includes(`GET /gmail/v1/users/me/messages/189a1b2c?format=metadata&fields=${GMAIL_METADATA_FIELDS}`));
    assert.ok(body.includes(`GET /gmail/v1/users/me/messages/189a1b2d?format=metadata&fields=${GMAIL_METADATA_FIELDS}`));
    assert.ok(!body.includes("snippet"));
    assert.ok(!body.includes("format=full"));
    assert.ok(!body.includes("format=raw"));
  });

  it("parses multipart batch response into GmailMessage objects", () => {
    const boundary = "batch_resp_bound";
    const resp = [
      `--${boundary}`,
      "Content-Type: application/http",
      "Content-ID: <response-1>",
      "",
      "HTTP/1.1 200 OK",
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify({
        id: "msg1",
        threadId: "t1",
        labelIds: ["INBOX"],
        internalDate: "1720000000000",
        payload: {
          headers: [
            { name: "From", value: "Careers <careers@company.com>" },
            { name: "Subject", value: "Interview invitation" },
          ],
        },
      }),
      `--${boundary}`,
      "Content-Type: application/http",
      "Content-ID: <response-2>",
      "",
      "HTTP/1.1 200 OK",
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify({
        id: "msg2",
        threadId: "t2",
        labelIds: ["INBOX"],
        internalDate: "1720000100000",
        payload: {
          headers: [
            { name: "From", value: "Indeed <donotreply@match.indeed.com>" },
            { name: "Subject", value: "5 new jobs in Auckland" },
          ],
        },
      }),
      `--${boundary}--`,
    ].join("\r\n");

    const messages = parseBatchGetResponseBody(resp, boundary);
    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.id, "msg1");
    assert.equal(messages[1]?.id, "msg2");
  });

  it("gmailMessageToMeta extracts metadata without snippet or body", () => {
    const msg = {
      id: "msg123",
      threadId: "th456",
      labelIds: ["INBOX"],
      internalDate: "1700000000000",
      payload: {
        headers: [
          { name: "From", value: "Acme Talent <talent@acme.com>" },
          { name: "Subject", value: "Application received" },
          { name: "List-Unsubscribe", value: "<mailto:unsub@acme.com>" },
          { name: "Content-Type", value: "text/plain" },
        ],
      },
    };
    const meta = gmailMessageToMeta(msg);
    assert.equal(meta.id, "msg123");
    assert.equal(meta.threadId, "th456");
    assert.equal(meta.internalDate, 1700000000);
    assert.equal(meta.from, "Acme Talent <talent@acme.com>");
    assert.equal(meta.subject, "Application received");
    assert.equal(meta.listUnsubscribe, true);
    assert.equal((meta as unknown as Record<string, unknown>).snippet, undefined);
    assert.equal((meta as unknown as Record<string, unknown>).body, undefined);
  });
});
