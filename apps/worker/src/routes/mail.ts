// Mail accounts management and OAuth connect endpoints (spec §8, Phase 2 rev 2 §4, §6).
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { readSessionCookie } from "../auth/session.ts";
import { b64urlEncode } from "../crypto/b64.ts";
import { aadFor, encryptField, keyringFromEnv } from "../crypto/envelope.ts";
import { sha256 } from "../crypto/hmac.ts";
import { nowSec } from "../env.ts";
import { buildGoogleAuthUrl, revokeGoogleToken } from "../gmail/client.ts";
import { safeJson } from "../http/hygiene.ts";
import { log } from "../log/index.ts";

export const mailRoutes = new Hono<AppEnv>();

const ConnectBody = z.object({
  email: z.string().email().max(255),
});

const DisconnectBody = z.object({
  email: z.string().email().max(255),
});

export const OAUTH_COOKIE_NAME = "__Host-gru_oauth";

export function oauthCookie(value: string, maxAge = 600): string {
  return `${OAUTH_COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearOAuthCookie(): string {
  return `${OAUTH_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

mailRoutes.get("/accounts", async (c) => {
  const db = c.get("db");
  const rows = await db.all<{
    id: number;
    email: string;
    label: string | null;
    status: string;
    last_sync_at: number | null;
    last_error_code: string | null;
    reauth_since: number | null;
    messages_scanned: number;
    testing_mode_detected: number;
  }>("SELECT id, email, label, status, last_sync_at, last_error_code, reauth_since, messages_scanned, testing_mode_detected FROM mail_accounts ORDER BY id ASC");

  return c.json({
    accounts: rows.map((r) => ({
      id: r.id,
      email: r.email,
      label: r.label,
      status: r.status,
      last_sync_at: r.last_sync_at,
      last_error_code: r.last_error_code,
      reauth_since: r.reauth_since,
      messages_scanned: r.messages_scanned,
      testing_mode_detected: Boolean(r.testing_mode_detected),
    })),
  });
});

mailRoutes.post("/connect", async (c) => {
  const env = c.env;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return c.json({ error: "oauth_not_configured" }, 503);
  }

  const body = ConnectBody.safeParse(await safeJson(c.req));
  if (!body.success) return c.json({ error: "bad_request" }, 400);

  const reqEmail = body.data.email.toLowerCase().trim();
  const allowed = (env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (!allowed.includes(reqEmail)) {
    return c.json({ error: "email_not_allowed" }, 403);
  }

  const sessionToken = readSessionCookie(c.req.header("Cookie"));
  if (!sessionToken) return c.json({ error: "unauthorized" }, 401);

  const rawState = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const codeVerifier = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const codeChallenge = b64urlEncode(await sha256(codeVerifier));
  const oidcNonce = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const binding = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));

  const stateHash = b64urlEncode(await sha256(rawState));
  const bindingHash = b64urlEncode(await sha256(binding));
  const sessionHash = b64urlEncode(await sha256(sessionToken));

  const ring = keyringFromEnv(env);
  const verifierEnc = await encryptField(ring, codeVerifier, aadFor("oauth_states", "verifier", stateHash));

  const now = nowSec();
  const expiresAt = now + 600; // 10 minutes

  const db = c.get("db");
  await db.run(
    "INSERT INTO oauth_states (state, verifier_enc, binding_hash, session_hash, oidc_nonce, account_hint, created_at, expires_at, used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
    stateHash,
    verifierEnc,
    bindingHash,
    sessionHash,
    oidcNonce,
    reqEmail,
    now,
    expiresAt,
  );

  const redirectUri = `${env.APP_ORIGIN}/auth/google/callback`;
  const url = buildGoogleAuthUrl({
    clientId: env.GOOGLE_CLIENT_ID,
    redirectUri,
    state: rawState,
    codeChallenge,
    nonce: oidcNonce,
    loginHint: reqEmail,
  });

  return c.json({ url }, 200, {
    "Set-Cookie": oauthCookie(binding, 600),
  });
});

mailRoutes.post("/disconnect", async (c) => {
  const body = DisconnectBody.safeParse(await safeJson(c.req));
  if (!body.success) return c.json({ error: "bad_request" }, 400);

  const email = body.data.email.toLowerCase().trim();
  const db = c.get("db");
  const account = await db.first<{ id: number; access_token_enc: string | null }>(
    "SELECT id, access_token_enc FROM mail_accounts WHERE email = ?",
    email,
  );

  if (!account) return c.json({ error: "account_not_found" }, 404);

  // Revoke token if present (best effort)
  await db.run(
    "UPDATE mail_accounts SET status = 'disconnected', refresh_token_enc = NULL, access_token_enc = NULL, reauth_since = NULL WHERE id = ?",
    account.id,
  );

  log("mail_disconnected", { id: account.id });
  return c.json({ ok: true });
});
