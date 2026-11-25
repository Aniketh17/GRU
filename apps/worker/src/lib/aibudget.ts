// One daily Neuron budget for every Workers AI use (voice, transcription, chat), so the Free allowance can never be exceeded.
// Workers AI Free = 10,000 Neurons/day (resets 00:00 UTC) and FAILS beyond it (never bills). GRU stops itself well below that.
import type { Db } from "../db/client.ts";

export const AI_DAILY_NEURONS = 8000;
/** Per-feature ceilings (sum 8,000). Each feature degrades gracefully when its share is used up (Revamp plan, section 5). */
export const AI_CAPS = { tts: 3800, stt: 400, llm: 1200, tailor: 1800, write: 800 } as const;
export type AiKind = keyof typeof AI_CAPS;

/** Neuron prices verified in Cloudflare's pricing page, 2026-11-15 (see DECISIONS D-055/D-059). */
export const NEURONS_PER_TTS_CHAR = 1.36364; // aura-1: 1,363.64 per 1,000 characters
export const NEURONS_PER_STT_MINUTE = 46.63; // whisper-large-v3-turbo

export const utcDay = (now: number): string => new Date(now * 1000).toISOString().slice(0, 10);
const keyFor = (kind: AiKind, now: number) => `ai:${kind}:${utcDay(now)}`;

/** Atomically reserves `neurons` for `kind`; false if the feature's share or the daily total would be exceeded. */
export async function reserveNeurons(db: Db, kind: AiKind, neurons: number, now: number): Promise<boolean> {
  const n = Math.max(1, Math.ceil(neurons));
  if (n > AI_CAPS[kind]) return false;
  const total = await db.first<{ n: number }>("SELECT COALESCE(SUM(CAST(v AS INTEGER)), 0) AS n FROM kv WHERE k LIKE ?", `ai:%:${utcDay(now)}`);
  if ((total?.n ?? 0) + n > AI_DAILY_NEURONS) return false;
  const r = await db.run(
    `INSERT INTO kv (k, v) VALUES (?1, CAST(?2 AS TEXT))
     ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(kv.v AS INTEGER) + ?2 AS TEXT) WHERE CAST(kv.v AS INTEGER) + ?2 <= ?3`,
    keyFor(kind, now), n, AI_CAPS[kind],
  );
  return r.meta.changes === 1;
}

/** Gives back a reservation when the AI call failed. */
export async function releaseNeurons(db: Db, kind: AiKind, neurons: number, now: number): Promise<void> {
  await db.run("UPDATE kv SET v = CAST(MAX(0, CAST(v AS INTEGER) - ?) AS TEXT) WHERE k = ?", Math.ceil(neurons), keyFor(kind, now));
}

export async function aiUsage(db: Db, now: number): Promise<Record<AiKind | "total", number>> {
  const rows = await db.all<{ k: string; v: string }>("SELECT k, v FROM kv WHERE k LIKE ?", `ai:%:${utcDay(now)}`);
  const out = { tts: 0, stt: 0, llm: 0, tailor: 0, write: 0, total: 0 };
  for (const r of rows) {
    const kind = r.k.split(":")[1] as AiKind;
    const v = Number(r.v) || 0;
    if (kind in out) out[kind] += v;
    out.total += v;
  }
  return out;
}

/** Workers AI language-model prices (Neurons per million tokens), verified 2026-11-15. */
export const LLM_RATES: Record<string, { in: number; out: number }> = {
  "@cf/meta/llama-3.2-3b-instruct": { in: 4625, out: 30475 },
  "@cf/google/gemma-4-26b-a4b-it": { in: 9091, out: 27273 },
  "@cf/qwen/qwen3-30b-a3b-fp8": { in: 4625, out: 30475 },
};
export const llmNeurons = (model: string, inputTokens: number, outputTokens: number): number => {
  const r = LLM_RATES[model] ?? { in: 31818, out: 68182 }; // unknown model: assume the dearest, so the cap stays safe
  return (inputTokens * r.in + outputTokens * r.out) / 1_000_000;
};
