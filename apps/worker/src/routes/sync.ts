// POST /api/sync: the app's "Refresh". Checks Gmail now and reads waiting job mail (shares the cron's lock).
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { nowSec } from "../env.ts";
import { runManualSync } from "../tick.ts";

export const syncRoutes = new Hono<AppEnv>();

syncRoutes.post("/", async (c) => {
  const db = c.get("db");
  const now = nowSec();
  // Gentle on Gmail and the free allowance: at most one manual sync every 10 seconds.
  const last = await db.first<{ v: string }>("SELECT v FROM kv WHERE k = 'last_manual_sync'");
  if (last && now - Number(last.v) < 10) return c.json({ ran: false, reason: "too_soon", pending: 0 });
  await db.run("INSERT INTO kv (k, v) VALUES ('last_manual_sync', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v", String(now));
  return c.json(await runManualSync(c.env, now));
});
