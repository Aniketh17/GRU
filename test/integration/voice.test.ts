import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AI_CAPS, NEURONS_PER_TTS_CHAR, utcDay } from "../../apps/worker/src/lib/aibudget.ts";
import { call, clearAuthState, login } from "./helpers.ts";

let cookie = "";
beforeEach(async () => {
  cookie = await login();
});
afterEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM voice_log"), env.DB.prepare("DELETE FROM kv WHERE k LIKE 'ai:%'")]);
  await clearAuthState();
});

const okAi = { run: async () => new Response(new Uint8Array([73, 68, 51]), { headers: { "Content-Type": "audio/mpeg" } }) };
const tts = (text: string, ai: unknown = okAi) => call("/api/voice/tts", { json: { text, speaker: "luna" }, cookie }, { AI: ai as never });

describe("natural voice (Workers AI, capped)", () => {
  it("needs a session and is unavailable without the AI binding", async () => {
    expect((await call("/api/voice/tts", { json: { text: "hi" } })).status).toBe(401);
    expect((await call("/api/voice/tts", { json: { text: "hi" }, cookie })).status).toBe(501);
  });

  it("returns audio and validates input", async () => {
    const r = await tts("Good morning, Ani.");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("audio/mpeg");
    expect((await r.arrayBuffer()).byteLength).toBe(3);
    expect((await call("/api/voice/tts", { json: { text: "x".repeat(401) }, cookie }, { AI: okAi as never })).status).toBe(400);
    expect((await call("/api/voice/tts", { json: { text: "hi", speaker: "robot" }, cookie }, { AI: okAi as never })).status).toBe(400);
  });

  it("stops itself at the daily character cap, long before the Free allowance", async () => {
    const chunk = "a".repeat(400);
    const calls = Math.floor(AI_CAPS.tts / Math.ceil(400 * NEURONS_PER_TTS_CHAR));
    for (let i = 0; i < calls; i++) expect((await tts(chunk)).status).toBe(200);
    expect((await tts(chunk)).status).toBe(429);
    expect((await tts("short")).status).toBe(200); // small remainder still fits
  });

  it("releases the reservation when synthesis fails", async () => {
    const failing = { run: async () => { throw new Error("boom"); } };
    expect((await tts("hello there", failing)).status).toBe(502);
    const used = await env.DB.prepare("SELECT v FROM kv WHERE k LIKE 'ai:tts:%'").first<{ v: string }>();
    expect(Number(used?.v)).toBe(0);
  });
});

describe("voice history", () => {
  it("stores encrypted transcripts, returns them in order, and can be cleared", async () => {
    await call("/api/voice/history", { json: { role: "user", text: "read my brief" }, cookie });
    await call("/api/voice/history", { json: { role: "gru", text: "Good morning, Ani." }, cookie });
    const raw = await env.DB.prepare("SELECT text_enc FROM voice_log").first<{ text_enc: string }>();
    expect(raw?.text_enc).not.toContain("brief");
    const h = (await (await call("/api/voice/history", { cookie })).json()) as { items: { role: string; text: string }[] };
    expect(h.items.map((i) => i.text)).toEqual(["read my brief", "Good morning, Ani."]);
    await call("/api/voice/history", { method: "DELETE", json: {}, cookie });
    expect(((await (await call("/api/voice/history", { cookie })).json()) as { items: unknown[] }).items).toHaveLength(0);
  });
});

const wav = (seconds: number) => {
  const bytes = new Uint8Array(44 + Math.round(seconds * 32000));
  bytes.set([82, 73, 70, 70]); // RIFF
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
};
const stt = (audio: string, ai: unknown = { run: async () => ({ text: "  add a task to call the recruiter  " }) }) =>
  call("/api/voice/stt", { json: { audio }, cookie }, { AI: ai as never });

describe("speech to text (Whisper, capped)", () => {
  it("needs a session and the AI binding", async () => {
    expect((await call("/api/voice/stt", { json: { audio: wav(1) } })).status).toBe(401);
    expect((await call("/api/voice/stt", { json: { audio: wav(1) }, cookie })).status).toBe(501);
  });

  it("transcribes a WAV and returns trimmed text; rejects non-WAV and over-long audio", async () => {
    const r = await stt(wav(2));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ text: "add a task to call the recruiter" });
    expect((await stt("A".repeat(400))).status).toBe(400);
    expect((await stt(wav(36))).status).toBe(413);
  });

  it("stops at its daily share and releases on failure", async () => {
    await env.DB.prepare("INSERT INTO kv (k, v) VALUES (?, '399')").bind(`ai:stt:${utcDay(Math.floor(Date.now() / 1000))}`).run();
    expect((await stt(wav(5))).status).toBe(429);
    await env.DB.prepare("DELETE FROM kv WHERE k LIKE 'ai:%'").run();
    const failing = { run: async () => { throw new Error("boom"); } };
    expect((await stt(wav(5), failing)).status).toBe(502);
    const used = await env.DB.prepare("SELECT v FROM kv WHERE k LIKE 'ai:stt:%'").first<{ v: string }>();
    expect(Number(used?.v)).toBe(0);
  });
});
