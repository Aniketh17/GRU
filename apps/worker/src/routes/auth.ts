// Public auth routes: /auth/params, /auth/login, /auth/logout, and /auth/google/callback (D-001, D-045).
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { nowSec } from "../env.ts";
import { kdfParamsFor, verifyLogin } from "../auth/password.ts";
import { clientBucketKey, failureStmts, loadBuckets, lockRemaining, successStmt } from "../auth/ratelimit.ts";
import { clearSessionCookie, insertSessionStmt, newToken, readSessionCookie, revokeSession, sessionCookie } from "../auth/session.ts";
import { b64urlEncode } from "../crypto/b64.ts";
import { aadFor, decryptField, encryptField, keyringFromEnv } from "../crypto/envelope.ts";
import { sha256 } from "../crypto/hmac.ts";
import {
  exchangeCodeForTokens,
  getGmailProfile,
  parseAndValidateIdToken,
  revokeGoogleToken,
  validateGrantedScopes,
} from "../gmail/client.ts";
import { safeJson } from "../http/hygiene.ts";
import { log } from "../log/index.ts";
import { clearOAuthCookie, OAUTH_COOKIE_NAME, readCookie } from "./mail.ts";

export const authRoutes = new Hono<AppEnv>();

const configured = (env: AppEnv["Bindings"]) => Boolean(env.AUTH_USERNAME && env.AUTH_VERIFIER && env.SESSION_SECRET);

const ParamsQuery = z.object({ u: z.string().min(1).max(128) });
const LoginBody = z.object({
  u: z.string().min(1).max(128),
  p: z.string().regex(/^[A-Za-z0-9_-]{43}$/), // base64url of the 32-byte Argon2id output
});

authRoutes.get("/params", async (c) => {
  if (!configured(c.env)) return c.json({ error: "not_configured" }, 503);
  const q = ParamsQuery.safeParse({ u: c.req.query("u") });
  if (!q.success) return c.json({ error: "bad_request" }, 400);
  return c.json(await kdfParamsFor(c.env, q.data.u));
});

authRoutes.post("/login", async (c) => {
  if (!configured(c.env)) return c.json({ error: "not_configured" }, 503);
  const body = LoginBody.safeParse(await safeJson(c.req));
  if (!body.success) return c.json({ error: "bad_request" }, 400);

  const db = c.get("db");
  const now = nowSec();
  const clientKey = await clientBucketKey(c.env.SESSION_SECRET as string, c.req.header("CF-Connecting-IP") ?? "unknown");
  const buckets = await loadBuckets(db, clientKey);

  // Locked buckets are rejected before any verification work.
  const retry = lockRemaining(buckets, now);
  if (retry > 0) {
    log("login_locked", { ms: retry * 1000 });
    return c.json({ error: "locked", retry_after: retry }, 429, { "Retry-After": String(retry) });
  }

  if (!(await verifyLogin(c.env, body.data.u, body.data.p))) {
    await db.batch(failureStmts(db, buckets, now));
    log("login_failed");
    return c.json({ error: "invalid_credentials" }, 401);
  }

  const token = newToken();
  await db.batch([successStmt(db, clientKey), await insertSessionStmt(db, token, now)]);
  log("login_ok");
  return c.json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token) });
});

authRoutes.post("/logout", async (c) => {
  const token = readSessionCookie(c.req.header("Cookie"));
  if (token) await revokeSession(c.get("db"), token);
  return c.json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
});

authRoutes.get("/google/callback", async (c) => {
  const env = c.env;
  const db = c.get("db");
  const fail = (code: string) => {
    log("oauth_callback_failed", { code });
    return c.redirect(`${env.APP_ORIGIN}/settings?error=${encodeURIComponent(code)}`, 302);
  };

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return fail("oauth_not_configured");
  }

  const errParam = c.req.query("error");
  if (errParam) {
    log("oauth_denied", { code: errParam });
    return c.redirect(
      `${env.APP_ORIGIN}/settings?error=oauth_denied`,
      302,
    );
  }

  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) {
    return fail("missing_params");
  }

  const stateHash = b64urlEncode(await sha256(state));
  const now = nowSec();

  const stateRow = await db.first<{
    state: string;
    verifier_enc: string;
    binding_hash: string;
    session_hash: string;
    oidc_nonce: string;
    account_hint: string;
    expires_at: number;
    used: number;
  }>(
    "SELECT state, verifier_enc, binding_hash, session_hash, oidc_nonce, account_hint, expires_at, used FROM oauth_states WHERE state = ?",
    stateHash,
  );

  if (!stateRow || stateRow.used !== 0 || stateRow.expires_at <= now) {
    return fail("invalid_or_expired_state");
  }

  // Atomically mark used to prevent replay and race conditions
  const updateRes = await db.run("UPDATE oauth_states SET used = 1 WHERE state = ? AND used = 0", stateHash);
  if (updateRes.meta.changes !== 1) {
    return fail("state_already_used");
  }

  // Check browser binding cookie (__Host-gru_oauth)
  const cookieVal = readCookie(c.req.header("Cookie"), OAUTH_COOKIE_NAME);
  if (!cookieVal) {
    return fail("missing_binding_cookie");
  }
  const cookieHash = b64urlEncode(await sha256(cookieVal));
  if (cookieHash !== stateRow.binding_hash) {
    return fail("binding_cookie_mismatch");
  }

  // Check initiating session is still active
  const sessionRow = await db.first<{ token_hash: string }>(
    "SELECT token_hash FROM sessions WHERE token_hash = ? AND expires_at > ?",
    stateRow.session_hash,
    now,
  );
  if (!sessionRow) {
    return fail("initiating_session_expired");
  }

  const ring = keyringFromEnv(env);
  let codeVerifier: string;
  try {
    codeVerifier = await decryptField(ring, stateRow.verifier_enc, aadFor("oauth_states", "verifier", stateHash));
  } catch {
    return fail("failed_to_decrypt_verifier");
  }

  const redirectUri = `${env.APP_ORIGIN}/auth/google/callback`;
  let tokens;
  try {
    tokens = await exchangeCodeForTokens({
      code,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri,
      codeVerifier,
    });
  } catch (e) {
    log("oauth_exchange_error", { code: (e as Error).message });
    return fail("token_exchange_failed");
  }

  // Granted scopes check: must have gmail.metadata and no other Gmail scope!
  try {
    validateGrantedScopes(tokens.scope);
  } catch (e) {
    // Revoke unexpected access immediately!
    await revokeGoogleToken(tokens.access_token);
    log("oauth_scope_rejected");
    return fail("unexpected_scopes_granted");
  }

  if (!tokens.id_token) {
    await revokeGoogleToken(tokens.access_token);
    return fail("missing_id_token");
  }

  const allowed = (env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  let claims;
  try {
    claims = parseAndValidateIdToken(tokens.id_token, {
      clientId: env.GOOGLE_CLIENT_ID,
      nonce: stateRow.oidc_nonce,
      allowedEmails: allowed,
      now,
    });
  } catch (e) {
    await revokeGoogleToken(tokens.access_token);
    return fail((e as Error).message || "invalid_id_token");
  }

  if (claims.email.toLowerCase() !== stateRow.account_hint.toLowerCase()) {
    await revokeGoogleToken(tokens.access_token);
    return fail("email_mismatch_with_hint");
  }

  // Initial profile to get historyId
  let profile;
  try {
    profile = await getGmailProfile(tokens.access_token);
  } catch (e) {
    log("gmail_profile_failed");
    return fail("gmail_profile_failed");
  }

  const isTestingMode = Boolean(
    tokens.refresh_token_expires_in && tokens.refresh_token_expires_in <= 7 * 86400,
  );

  const email = claims.email.toLowerCase();
  const accessTokenEnc = await encryptField(ring, tokens.access_token, aadFor("mail_accounts", "access_token", email));
  const refreshTokenEnc = tokens.refresh_token
    ? await encryptField(ring, tokens.refresh_token, aadFor("mail_accounts", "refresh_token", email))
    : null;
  const accessExpiresAt = now + (tokens.expires_in || 3600);

  const existingAccount = await db.first<{ id: number; refresh_token_enc: string | null }>(
    "SELECT id, refresh_token_enc FROM mail_accounts WHERE email = ?",
    email,
  );

  if (existingAccount) {
    const finalRefreshTokenEnc = refreshTokenEnc || existingAccount.refresh_token_enc;
    await db.run(
      "UPDATE mail_accounts SET refresh_token_enc = ?, access_token_enc = ?, access_expires_at = ?, status = 'active', history_id = ?, last_success_at = ?, reauth_since = NULL, last_error_code = NULL, testing_mode_detected = ? WHERE id = ?",
      finalRefreshTokenEnc,
      accessTokenEnc,
      accessExpiresAt,
      profile.historyId,
      now,
      isTestingMode ? 1 : 0,
      existingAccount.id,
    );
  } else {
    const backfillFloor = now - 90 * 86400; // 90 days ago
    await db.run(
      "INSERT INTO mail_accounts (email, label, refresh_token_enc, access_token_enc, access_expires_at, status, history_id, backfill_floor, backfill_done, testing_mode_detected, created_at, last_success_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 0, ?, ?, ?)",
      email,
      email,
      refreshTokenEnc,
      accessTokenEnc,
      accessExpiresAt,
      profile.historyId,
      backfillFloor,
      isTestingMode ? 1 : 0,
      now,
      now,
    );
  }

  log("mail_connected");
  c.header("Set-Cookie", clearOAuthCookie());
  return c.redirect(`${env.APP_ORIGIN}/settings?connected=1`, 302);
});
