// Voice conversation history (ROADMAP Voice). Transcripts are encrypted at rest, kept 30 days, never logged.
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { nowSec } from "../env.ts";
import { safeJson } from "../http/hygiene.ts";
import { decText, encText } from "../lib/enc.ts";

export const voiceRoutes = new Hono<AppEnv>();
export const VOICE_RETENTION_SECONDS = 30 * 86400;

// Natural voice: Workers AI Aura-1. 1,363.64 Neurons per 1,000 characters; the Free allowance is 10,000 Neurons/day (~7,300 chars).
// GRU stops itself well below that, so Workers AI never reaches its hard stop and no other feature is starved.
export const TTS_DAILY_CHARS = 5500;
export const TTS_SPEAKERS = ["luna", "asteria", "athena", "stella", "hera", "orion", "arcas"] as const;
const Tts = z.object({ text: z.string().min(1).max(400), speaker: z.enum(TTS_SPEAKERS).default("luna") });

const Entry = z.object({ role: z.enum(["user", "gru"]), text: z.string().min(1).max(1500) });

voiceRoutes.get("/history", async (c) => {
  const rows = await c.get("db").all<{ id: number; role: string; text_enc: string; created_at: number }>(
    "SELECT id, role, text_enc, created_at FROM voice_log ORDER BY id DESC LIMIT 40",
  );
  const items = await Promise.all(rows.map(async (r) => ({ id: r.id, role: r.role, text: await decText(c.env, "voice_log", "text_enc", r.id, r.text_enc), at: r.created_at })));
  return c.json({ items: items.reverse() });
});

voiceRoutes.post("/history", async (c) => {
  const b = Entry.safeParse(await safeJson(c.req));
  if (!b.success) return c.json({ error: "bad_request" }, 400);
  const db = c.get("db");
  const ins = await db.first<{ id: number }>("INSERT INTO voice_log (role, text_enc, created_at) VALUES (?, 'pending', ?) RETURNING id", b.data.role, nowSec());
  const id = (ins as { id: number }).id;
  await db.run("UPDATE voice_log SET text_enc = ? WHERE id = ?", await encText(c.env, "voice_log", "text_enc", id, b.data.text), id);
  return c.json({ id }, 201);
});

voiceRoutes.delete("/history", async (c) => {
  await c.get("db").run("DELETE FROM voice_log");
  return c.json({ deleted: true });
});

voiceRoutes.post("/tts", async (c) => {
  if (!c.env.AI) return c.json({ error: "tts_unavailable" }, 501);
  const b = Tts.safeParse(await safeJson(c.req));
  if (!b.success) return c.json({ error: "bad_request" }, 400);
  const db = c.get("db");
  const day = `tts_chars:${new Date(nowSec() * 1000).toISOString().slice(0, 10)}`; // Workers AI resets at 00:00 UTC
  const len = b.data.text.length;
  // Reserve first (atomic), refuse when it would pass the cap, release if synthesis fails.
  const r = await db.run(
    `INSERT INTO kv (k, v) VALUES (?1, CAST(?2 AS TEXT))
     ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(kv.v AS INTEGER) + ?2 AS TEXT) WHERE CAST(kv.v AS INTEGER) + ?2 <= ?3`,
    day, len, TTS_DAILY_CHARS,
  );
  if (r.meta.changes !== 1) return c.json({ error: "tts_cap" }, 429);
  try {
    const out = (await c.env.AI.run("@cf/deepgram/aura-1", { text: b.data.text, speaker: b.data.speaker, encoding: "mp3" }, { returnRawResponse: true })) as unknown as Response;
    if (!out.ok || !out.body) throw new Error("tts_upstream");
    return new Response(out.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch {
    await db.run("UPDATE kv SET v = CAST(MAX(0, CAST(v AS INTEGER) - ?) AS TEXT) WHERE k = ?", len, day);
    return c.json({ error: "tts_failed" }, 502);
  }
});
