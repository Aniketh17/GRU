// Mutating requests must be JSON, carry X-App: gru, and come from APP_ORIGIN (spec section 7).
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.ts";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const hygiene: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!MUTATING.has(c.req.method)) return next();
  const ct = (c.req.header("Content-Type") ?? "").toLowerCase();
  if (!ct.startsWith("application/json")) return c.json({ error: "unsupported_media_type" }, 415);
  if (c.req.header("X-App") !== "gru") return c.json({ error: "forbidden" }, 403);
  if (c.req.header("Origin") !== c.env.APP_ORIGIN) return c.json({ error: "forbidden" }, 403);
  return next();
};

/** Parse a JSON body without throwing; returns undefined if absent or invalid. */
export async function safeJson(req: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}
