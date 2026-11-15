// Kill-switch guards (spec section 15).
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.ts";
import { getSystemState } from "../db/kv.ts";
import { errorCode, log } from "../log/index.ts";

const isServerPath = (p: string) => p.startsWith("/api/") || p.startsWith("/auth/");

/**
 * wiping -> 423 on /api and /auth (except a retry of the wipe itself);
 * wiped  -> 423 on /api and /auth. Static assets stay up so the Wiped page can render.
 * If the state can't be read (e.g. D1 daily cap), fail closed with 503.
 */
export const killGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isServerPath(c.req.path)) return next();
  let state;
  try {
    state = await getSystemState(c.get("db"));
  } catch (err) {
    log("kill_state_unreadable", { code: errorCode(err) });
    return c.json({ error: "unavailable" }, 503);
  }
  if (state.kill === "running") return next();
  const wipeRetry = state.kill === "wiping" && c.req.method === "POST" && c.req.path === "/api/admin/wipe";
  if (wipeRetry) return next();
  return c.json({ state: state.kill }, 423);
};

export function isLocked(env: AppEnv["Bindings"]): boolean {
  return !env.DATA_KEY_V1 || !env.INDEX_KEY;
}

/** Data routes need the keys. Health and admin (pause/wipe) keep working while Locked. */
export const lockedGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const p = c.req.path;
  if (p === "/api/health" || p.startsWith("/api/admin/")) return next();
  if (isLocked(c.env)) return c.json({ locked: true }, 423);
  return next();
};
