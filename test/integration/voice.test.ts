import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TTS_DAILY_CHARS } from "../../apps/worker/src/routes/voice.ts";
import { call, clearAuthState, login } from "./helpers.ts";

let cookie = "";
beforeEach(async () => {
  cookie = await login();
});
afterEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM voice_log"), env.DB.prepare("DELETE FROM kv WHERE k LIKE 'tts_chars:%'")]);
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
    const calls = Math.floor(TTS_DAILY_CHARS / 400);
    for (let i = 0; i < calls; i++) expect((await tts(chunk)).status).toBe(200);
    expect((await tts(chunk)).status).toBe(429);
    expect((await tts("short")).status).toBe(200); // small remainder still fits
  });

  it("releases the reservation when synthesis fails", async () => {
    const failing = { run: async () => { throw new Error("boom"); } };
    expect((await tts("hello there", failing)).status).toBe(502);
    const used = await env.DB.prepare("SELECT v FROM kv WHERE k LIKE 'tts_chars:%'").first<{ v: string }>();
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
