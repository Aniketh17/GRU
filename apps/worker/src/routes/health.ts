import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { getSystemState } from "../db/kv.ts";
import { isLocked } from "../kill/guard.ts";

export const healthRoutes = new Hono<AppEnv>();

healthRoutes.get("/health", async (c) => {
  const s = await getSystemState(c.get("db"));
  return c.json({ ok: true, kill_state: s.kill, paused: s.paused, locked: isLocked(c.env) });
});
