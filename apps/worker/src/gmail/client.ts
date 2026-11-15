// Google OAuth client and Gmail API wrapper (spec §8, Phase 2 rev 2 §2, §4, §6).
// Only GET endpoints for profile, messages.list (no q!), messages.get (metadata only, no snippet)
// and history.list are ever called. All requests use subrequest budgeting and safe error handling.

import { b64urlDecode, fromUtf8 } from "../crypto/b64.ts";
import type { MailMeta } from "../classify/types.ts";
import {
  FORBIDDEN_GMAIL_SCOPES,
  GMAIL_API_BASE,
  GMAIL_BATCH_ENDPOINT,
  GMAIL_FULL_FIELDS,
  GMAIL_LEGACY_METADATA_SCOPE,
  GMAIL_METADATA_FIELDS,
  GMAIL_READONLY_SCOPE,
  GMAIL_SCOPES,
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_REVOKE_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
} from "./constants.ts";
import type {
  GmailHistoryResponse,
  GmailListResponse,
  GmailMessage,
  GmailProfileResponse,
  GoogleTokenResponse,
  IdTokenClaims,
} from "./types.ts";

export class OAuthError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "OAuthError";
  }
}

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeError";
  }
}

export class GmailApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = "GmailApiError";
  }
}

export function buildGoogleAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  nonce: string;
  loginHint: string;
}): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("login_hint", params.loginHint);
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/**
 * Validates granted scopes strictly:
 * - Must contain gmail.readonly (current) or gmail.metadata (older connections, header-only)
 * - Must NOT contain any scope that can modify, send, label or delete mail
 */
export function validateGrantedScopes(grantedScopeString: string): void {
  const granted = new Set(grantedScopeString.split(/\s+/).filter(Boolean));
  if (!granted.has(GMAIL_READONLY_SCOPE) && !granted.has(GMAIL_LEGACY_METADATA_SCOPE)) {
    throw new ScopeError("missing_gmail_read_scope");
  }
  for (const forbidden of FORBIDDEN_GMAIL_SCOPES) {
    if (granted.has(forbidden)) {
      throw new ScopeError(`forbidden_scope_detected:${forbidden}`);
    }
  }
}

/** True when this connection was granted read access to message bodies. */
export const hasBodyAccess = (grantedScope: string | null | undefined): boolean =>
  Boolean(grantedScope?.split(/\s+/).includes(GMAIL_READONLY_SCOPE));

/**
 * Decodes and validates Google id_token claims received directly over TLS from Google token endpoint.
 */
export function parseAndValidateIdToken(
  idToken: string,
  options: {
    clientId: string;
    nonce?: string;
    allowedEmails: readonly string[];
    now: number;
  },
): IdTokenClaims {
  const parts = idToken.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new OAuthError("malformed_id_token", "invalid_id_token");
  }

  let claims: IdTokenClaims;
  try {
    const jsonStr = fromUtf8.decode(b64urlDecode(parts[1]));
    claims = JSON.parse(jsonStr) as IdTokenClaims;
  } catch {
    throw new OAuthError("failed_to_parse_id_token_claims", "invalid_id_token");
  }

  if (claims.iss !== "accounts.google.com" && claims.iss !== "https://accounts.google.com") {
    throw new OAuthError(`invalid_issuer:${claims.iss}`, "invalid_id_token");
  }
  if (claims.aud !== options.clientId) {
    throw new OAuthError(`invalid_audience:${claims.aud}`, "invalid_id_token");
  }
  if (claims.exp <= options.now) {
    throw new OAuthError("expired_id_token", "expired_id_token");
  }
  if (options.nonce && claims.nonce !== options.nonce) {
    throw new OAuthError("nonce_mismatch", "invalid_id_token");
  }
  if (!claims.email || !claims.email_verified) {
    throw new OAuthError("email_unverified", "email_unverified");
  }
  const normalizedEmail = claims.email.toLowerCase().trim();
  const allowed = options.allowedEmails.map((e) => e.toLowerCase().trim());
  if (!allowed.includes(normalizedEmail)) {
    throw new OAuthError("email_not_allowed", "email_not_allowed");
  }

  return claims;
}

export async function exchangeCodeForTokens(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  codeVerifier: string;
  fetchFn?: typeof fetch;
}): Promise<GoogleTokenResponse> {
  const f = params.fetchFn ?? fetch;
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
    code_verifier: params.codeVerifier,
  });

  const res = await f(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new OAuthError(`token_exchange_failed:${res.status}:${errText}`, "token_exchange_failed");
  }

  return (await res.json()) as GoogleTokenResponse;
}

export async function refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchFn?: typeof fetch;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const f = params.fetchFn ?? fetch;
  const body = new URLSearchParams({
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: "refresh_token",
  });

  const res = await f(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    const isInvalidGrant = errText.includes("invalid_grant");
    throw new OAuthError(
      `token_refresh_failed:${res.status}:${errText}`,
      isInvalidGrant ? "invalid_grant" : "token_refresh_failed",
    );
  }

  const data = (await res.json()) as GoogleTokenResponse;
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

export async function revokeGoogleToken(token: string, fetchFn: typeof fetch = fetch): Promise<void> {
  try {
    await fetchFn(`${GOOGLE_REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch {
    // Best-effort token revocation
  }
}

export async function getGmailProfile(
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<GmailProfileResponse> {
  const res = await fetchFn(`${GMAIL_API_BASE}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new GmailApiError(`get_profile_failed:${res.status}`, res.status);
  }
  return (await res.json()) as GmailProfileResponse;
}

export async function listGmailMessages(
  accessToken: string,
  options: { pageToken?: string | undefined; maxResults?: number } = {},
  fetchFn: typeof fetch = fetch,
): Promise<GmailListResponse> {
  const max = Math.min(options.maxResults ?? 50, 50);
  const url = new URL(`${GMAIL_API_BASE}/messages`);
  url.searchParams.set("maxResults", String(max));
  if (options.pageToken) {
    url.searchParams.set("pageToken", options.pageToken);
  }
  // Strictly no 'q' parameter per gmail.metadata scope limitation!

  const res = await fetchFn(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new GmailApiError(`list_messages_failed:${res.status}`, res.status);
  }
  return (await res.json()) as GmailListResponse;
}

export async function listGmailHistory(
  accessToken: string,
  startHistoryId: string,
  options: { pageToken?: string | undefined; maxResults?: number } = {},
  fetchFn: typeof fetch = fetch,
): Promise<GmailHistoryResponse> {
  const max = Math.min(options.maxResults ?? 100, 100);
  const url = new URL(`${GMAIL_API_BASE}/history`);
  url.searchParams.set("startHistoryId", startHistoryId);
  url.searchParams.set("maxResults", String(max));
  if (options.pageToken) {
    url.searchParams.set("pageToken", options.pageToken);
  }

  const res = await fetchFn(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new GmailApiError(`list_history_failed:${res.status}`, res.status);
  }
  return (await res.json()) as GmailHistoryResponse;
}

export function buildBatchGetRequestBody(messageIds: string[], boundary: string, format: "metadata" | "full" = "metadata"): string {
  const query = format === "full" ? `format=full&fields=${GMAIL_FULL_FIELDS}` : `format=metadata&fields=${GMAIL_METADATA_FIELDS}`;
  const parts: string[] = [];
  for (const id of messageIds) {
    parts.push(
      `--${boundary}\r\n` +
      `Content-Type: application/http\r\n` +
      `Content-ID: <item-${id}>\r\n\r\n` +
      `GET /gmail/v1/users/me/messages/${id}?${query}\r\n`,
    );
  }
  parts.push(`--${boundary}--\r\n`);
  return parts.join("\r\n");
}

export function parseBatchGetResponseBody(responseText: string, boundary: string): GmailMessage[] {
  const cleanBoundary = boundary.replace(/^--/, "");
  const parts = responseText.split(`--${cleanBoundary}`);
  const messages: GmailMessage[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === "--") continue;

    // A batch HTTP response part contains MIME headers, then an HTTP response status line, headers, and JSON body
    const httpStatusMatch = /HTTP\/[0-9.]+\s+([0-9]{3})/i.exec(trimmed);
    if (!httpStatusMatch || httpStatusMatch[1] !== "200") {
      continue;
    }

    // Find JSON body after double newline
    const jsonStart = trimmed.indexOf("{");
    const jsonEnd = trimmed.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      try {
        const jsonStr = trimmed.slice(jsonStart, jsonEnd + 1);
        const parsed = JSON.parse(jsonStr) as GmailMessage;
        if (parsed.id && parsed.threadId) {
          messages.push(parsed);
        }
      } catch {
        // Skip unparseable part
      }
    }
  }

  return messages;
}

export async function batchGetGmailMessages(
  accessToken: string,
  messageIds: string[],
  fetchFn: typeof fetch = fetch,
  format: "metadata" | "full" = "metadata",
): Promise<GmailMessage[]> {
  if (messageIds.length === 0) return [];
  const boundary = `gru_batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const body = buildBatchGetRequestBody(messageIds, boundary, format);

  const res = await fetchFn(GMAIL_BATCH_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/mixed; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    throw new GmailApiError(`batch_get_failed:${res.status}`, res.status);
  }

  const responseContentType = res.headers.get("Content-Type") || "";
  const boundaryMatch = /boundary=([^\s;]+)/i.exec(responseContentType);
  const respBoundary = boundaryMatch ? (boundaryMatch[1] ?? boundary).replace(/^["']|["']$/g, "") : boundary;

  const text = await res.text();
  return parseBatchGetResponseBody(text, respBoundary);
}

/**
 * Extracts header metadata from a GmailMessage to a classification MailMeta object.
 * Note: bodies and snippets are NEVER extracted or stored.
 */
export function gmailMessageToMeta(msg: GmailMessage): MailMeta {
  const headers = msg.payload?.headers ?? [];
  const getHeader = (name: string): string => {
    const h = headers.find((item) => item.name.toLowerCase() === name.toLowerCase());
    return h ? h.value : "";
  };

  const internalDateSec = msg.internalDate ? Math.floor(Number(msg.internalDate) / 1000) : 0;

  return {
    id: msg.id,
    threadId: msg.threadId,
    internalDate: internalDateSec,
    labelIds: msg.labelIds ?? [],
    from: getHeader("from"),
    subject: getHeader("subject"),
    listUnsubscribe: Boolean(getHeader("list-unsubscribe")),
    contentType: getHeader("content-type") || "text/plain",
    autoSubmitted: getHeader("auto-submitted"),
  };
}
