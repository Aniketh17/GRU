import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.ts";
import { nowSec } from "../env.ts";
import type { AuthProvider, Identity } from "./provider.ts";
import { readSessionCookie, validateSession } from "./session.ts";

export const sessionProvider: AuthProvider = {
  async authenticate(c): Promise<Identity | null> {
    const db = c.get("db");
    const result = await validateSession(db, readSessionCookie(c.req.header("Cookie")), nowSec());
    return result === "valid" ? { kind: "owner" } : null;
  },
};

/** Unauthenticated requests get 401 and an empty body (spec section 7). */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const identity = await sessionProvider.authenticate(c);
  if (!identity) return c.body(null, 401);
  await next();
};
