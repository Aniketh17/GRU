// Voice conversation history (ROADMAP Voice). Transcripts are encrypted at rest, kept 30 days, never logged.
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { nowSec } from "../env.ts";
import { safeJson } from "../http/hygiene.ts";
import { AI_CAPS, NEURONS_PER_STT_MINUTE, NEURONS_PER_TTS_CHAR, releaseNeurons, reserveNeurons } from "../lib/aibudget.ts";
import { decText, encText } from "../lib/enc.ts";
import { getSettings } from "./settings.ts";

export const voiceRoutes = new Hono<AppEnv>();
export const VOICE_RETENTION_SECONDS = 30 * 86400;

// Natural voice: Workers AI Aura-1 (D-055). Billing is the shared Neuron ledger (lib/aibudget.ts).
export const TTS_DAILY_CHARS = Math.floor(AI_CAPS.tts / NEURONS_PER_TTS_CHAR);
export const TTS_SPEAKERS = ["luna", "asteria", "athena", "stella", "hera", "orion", "arcas"] as const;
const Tts = z.object({ text: z.string().min(1).max(400), speaker: z.enum(TTS_SPEAKERS).default("luna") });
const Stt = z.object({ audio: z.string().min(200).max(1_700_000) });
const MAX_STT_SECONDS = 35;
const Entry = z.object({ role: z.enum(["user", "gru"]), text: z.string().min(1).max(1500) });

voiceRoutes.get("/history", async (c) => {
  // Conversations are deleted when the chat closes unless Ani turned "remember" on (Revamp 3F).
  if (!(await getSettings(c.get("db"))).remember_chat) return c.json({ items: [] });
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
  if (!(await getSettings(db)).remember_chat) return c.json({ id: null, stored: false }, 200);
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
  const now = nowSec();
  const cost = Math.ceil(b.data.text.length * NEURONS_PER_TTS_CHAR);
  if (!(await reserveNeurons(db, "tts", cost, now))) return c.json({ error: "tts_cap" }, 429);
  try {
    const out = (await c.env.AI.run("@cf/deepgram/aura-1", { text: b.data.text, speaker: b.data.speaker, encoding: "mp3" }, { returnRawResponse: true })) as unknown as Response;
    if (!out.ok || !out.body) throw new Error("tts_upstream");
    return new Response(out.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch {
    await releaseNeurons(db, "tts", cost, now);
    return c.json({ error: "tts_failed" }, 502);
  }
});

// Speech to text for devices without on-device recognition (iPhone). The recording is sent as a 16 kHz mono WAV (base64),
// transcribed by Whisper, and discarded: never stored, never logged (Ani, 2026-11-15, D-042/D-059).
voiceRoutes.post("/stt", async (c) => {
  if (!c.env.AI) return c.json({ error: "stt_unavailable" }, 501);
  const b = Stt.safeParse(await safeJson(c.req));
  if (!b.success || !b.data.audio.startsWith("UklGR")) return c.json({ error: "bad_request" }, 400); // "RIFF"
  const bytes = Math.floor((b.data.audio.length * 3) / 4);
  const seconds = Math.max(1, (bytes - 44) / 32000);
  if (seconds > MAX_STT_SECONDS) return c.json({ error: "too_long" }, 413);
  const db = c.get("db");
  const now = nowSec();
  const cost = Math.ceil((seconds / 60) * NEURONS_PER_STT_MINUTE) + 1;
  if (!(await reserveNeurons(db, "stt", cost, now))) return c.json({ error: "stt_cap" }, 429);
  try {
    const out = (await c.env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: b.data.audio, language: "en", vad_filter: true })) as { text?: string };
    return c.json({ text: String(out.text ?? "").trim().slice(0, 500) });
  } catch {
    await releaseNeurons(db, "stt", cost, now);
    return c.json({ error: "stt_failed" }, 502);
  }
});
