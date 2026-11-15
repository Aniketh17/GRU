// Public auth routes: /auth/params, /auth/login, and /auth/logout. There is no registration route (D-001).
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { nowSec } from "../env.ts";
import { kdfParamsFor, verifyLogin } from "../auth/password.ts";
import { clientBucketKey, failureStmts, loadBuckets, lockRemaining, successStmt } from "../auth/ratelimit.ts";
import { clearSessionCookie, insertSessionStmt, newToken, readSessionCookie, revokeSession, sessionCookie } from "../auth/session.ts";
import { safeJson } from "../http/hygiene.ts";
import { log } from "../log/index.ts";

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
