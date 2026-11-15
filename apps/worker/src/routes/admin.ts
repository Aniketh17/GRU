import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { clearSessionCookie } from "../auth/session.ts";
import { setKv } from "../db/kv.ts";
import { safeJson } from "../http/hygiene.ts";
import { WIPE_PHRASE, wipeAll } from "../kill/wipe.ts";
import { log } from "../log/index.ts";

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.post("/pause", async (c) => {
  await setKv(c.get("db"), "paused", "1");
  log("admin_pause");
  return c.json({ paused: true });
});

adminRoutes.post("/resume", async (c) => {
  await setKv(c.get("db"), "paused", "0");
  log("admin_resume");
  return c.json({ paused: false });
});

const WipeBody = z.object({ phrase: z.string().max(64) });

adminRoutes.post("/wipe", async (c) => {
  const body = WipeBody.safeParse(await safeJson(c.req));
  if (!body.success) return c.json({ error: "bad_request" }, 400);
  if (body.data.phrase !== WIPE_PHRASE) return c.json({ error: "wrong_phrase" }, 400);
  const result = await wipeAll(c.env, c.get("db"));
  return c.json(result, 200, { "Set-Cookie": clearSessionCookie() });
});
