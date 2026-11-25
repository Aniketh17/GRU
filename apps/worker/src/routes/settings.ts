// Settings API (spec sections 11 and 12).
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import type { Db } from "../db/client.ts";

export interface UserSettings {
  brief_time: string; // HH:mm (default "08:30")
  stale_days: number; // days before application is marked stale (default 14)
  interview_stale_days: number; // days after interview before follow-up prompt (default 7)
  shortlist_threshold: number; // minimum job match score for Apply Tomorrow (default 65)
  remember_chat: boolean; // keep Talk-to-GRU conversations for 30 days (default off: history is deleted when the chat is closed)
  auto_status_from_text: boolean; // update application status automatically when the email text is clear (undo for 24 h)
}

export const DEFAULT_SETTINGS: UserSettings = {
  brief_time: "08:30",
  stale_days: 14,
  interview_stale_days: 7,
  shortlist_threshold: 65,
  auto_status_from_text: true,
  remember_chat: false,
};

const settingsSchema = z.strictObject({
  brief_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  stale_days: z.number().int().min(1).max(90),
  interview_stale_days: z.number().int().min(1).max(90),
  shortlist_threshold: z.number().int().min(30).max(95).default(65),
  auto_status_from_text: z.boolean().default(true),
  remember_chat: z.boolean().default(false),
});

export async function getSettings(db: Db): Promise<UserSettings> {
  const row = await db.first<{ v: string }>("SELECT v FROM kv WHERE k = 'settings'");
  if (!row) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(row.v);
    const validated = settingsSchema.safeParse(parsed);
    return validated.success ? validated.data : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const settingsRoutes = new Hono<AppEnv>();

settingsRoutes.get("/", async (c) => {
  const db = c.get("db");
  const settings = await getSettings(db);
  return c.json({ ...settings, ntfy_configured: Boolean(c.env.NTFY_TOPIC?.trim()) });
});

settingsRoutes.put("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_input", details: parsed.error.issues }, 400);
  }

  const db = c.get("db");
  await db.run(
    "INSERT INTO kv (k, v) VALUES ('settings', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
    JSON.stringify(parsed.data),
  );

  return c.json(parsed.data);
});
