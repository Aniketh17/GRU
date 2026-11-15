// Browser speech, privacy-first (DECISIONS D-042):
//  - Recognition only when it can run ON THE DEVICE (processLocally). Never the browser's server recognition.
//  - Speech output only with voices installed on the device (localService === true).
// If either is missing, GRU falls back to text; everything still works typed.

const LANG = "en-NZ";

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface SpeechRecognitionCtor {
  new (): SpeechRecognitionLike;
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
}

const Ctor = (): SpeechRecognitionCtor | undefined => {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export type SttStatus = "unknown" | "ready" | "downloadable" | "unsupported";

/** Cheap capability hint (no speech service is touched): the API surface for on-device recognition exists. */
export const sttMaybe = (): boolean => typeof Ctor()?.available === "function";

/** "ready" only if the browser confirms on-device recognition is available for our language. */
export async function sttStatus(): Promise<SttStatus> {
  const C = Ctor();
  if (!C || typeof C.available !== "function") return "unsupported";
  try {
    const r = await C.available({ langs: [LANG], processLocally: true });
    if (r === "available") return "ready";
    if (r === "downloadable" || r === "downloading") return "downloadable";
  } catch {
    /* fall through */
  }
  return "unsupported";
}

export async function installStt(): Promise<boolean> {
  const C = Ctor();
  try {
    return Boolean(C?.install && (await C.install({ langs: [LANG], processLocally: true })));
  } catch {
    return false;
  }
}

export interface Listener { stop: () => void; result: Promise<string> }

/** Starts on-device listening after an explicit tap. Resolves with the final transcript ("" if nothing heard). */
export function listen(onInterim: (text: string) => void): Listener {
  const C = Ctor();
  if (!C) return { stop: () => undefined, result: Promise.resolve("") };
  const rec = new C();
  rec.lang = LANG;
  rec.processLocally = true;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = "";
  const result = new Promise<string>((resolve, reject) => {
    rec.onresult = (e) => {
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r?.[0]) continue;
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      onInterim((finalText + interim).trim());
    };
    rec.onerror = (e) => (e.error === "no-speech" || e.error === "aborted" ? resolve("") : reject(new Error(e.error)));
    rec.onend = () => resolve(finalText.trim());
  });
  rec.start();
  return { stop: () => rec.stop(), result };
}

// ---------------------------------------------------------------- speaking
const synth = (): SpeechSynthesis | null => (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null);

/** Warm, natural-sounding on-device voices first; NZ/AU/UK English preferred. Never non-local voices. */
export function rankVoice(v: { name: string; lang: string; localService: boolean }): number {
  if (!v.localService) return -1000;
  const lang = v.lang.replace("_", "-");
  let s = 0;
  if (/^en-NZ/i.test(lang)) s += 30;
  else if (/^en-AU/i.test(lang)) s += 26;
  else if (/^en-GB/i.test(lang)) s += 22;
  else if (/^en-(US|IE|ZA|CA)/i.test(lang)) s += 14;
  else if (/^en/i.test(lang)) s += 8;
  else return -1000;
  if (/natural|neural|premium|enhanced|siri|online/i.test(v.name)) s += 40;
  if (/aria|jenny|libby|sonia|molly|catherine|karen|moira|serena|samantha|tessa|zira|hazel|susan|female/i.test(v.name)) s += 10;
  if (/espeak|compact|robot|novelty|bad news|whisper|zarvox|trinoids|cellos|bubbles|boing|organ|bells/i.test(v.name)) s -= 60;
  return s;
}

export function localVoices(): SpeechSynthesisVoice[] {
  const s = synth();
  if (!s) return [];
  return s.getVoices().filter((v) => rankVoice(v) > -1000).sort((a, b) => rankVoice(b) - rankVoice(a));
}

export function voicesReady(): Promise<SpeechSynthesisVoice[]> {
  const s = synth();
  if (!s) return Promise.resolve([]);
  const have = localVoices();
  if (have.length) return Promise.resolve(have);
  return new Promise((resolve) => {
    const done = () => { s.removeEventListener("voiceschanged", done); resolve(localVoices()); };
    s.addEventListener("voiceschanged", done);
    setTimeout(done, 1500);
  });
}

const KEY_VOICE = "gru.voice.uri";
const KEY_SPEAK = "gru.voice.speak";
const KEY_ENGINE = "gru.voice.engine";
const KEY_SPEAKER = "gru.voice.speaker";

export const NATURAL_SPEAKERS = [
  { id: "luna", label: "Luna · warm" },
  { id: "asteria", label: "Asteria · clear" },
  { id: "athena", label: "Athena · calm" },
  { id: "stella", label: "Stella · bright" },
  { id: "hera", label: "Hera · smooth" },
  { id: "orion", label: "Orion · steady (male)" },
  { id: "arcas", label: "Arcas · deep (male)" },
] as const;

export type Engine = "natural" | "device";
export interface VoicePrefs { uri: string | null; speak: boolean; engine: Engine; speaker: string }

export const getPrefs = (): VoicePrefs => {
  try {
    return {
      uri: localStorage.getItem(KEY_VOICE),
      speak: localStorage.getItem(KEY_SPEAK) !== "0",
      engine: localStorage.getItem(KEY_ENGINE) === "device" ? "device" : "natural",
      speaker: localStorage.getItem(KEY_SPEAKER) ?? "luna",
    };
  } catch {
    return { uri: null, speak: true, engine: "natural", speaker: "luna" };
  }
};
export const setPrefs = (p: Partial<VoicePrefs>) => {
  try {
    if (p.uri !== undefined) {
      if (p.uri) localStorage.setItem(KEY_VOICE, p.uri);
      else localStorage.removeItem(KEY_VOICE);
    }
    if (p.speak !== undefined) localStorage.setItem(KEY_SPEAK, p.speak ? "1" : "0");
    if (p.engine !== undefined) localStorage.setItem(KEY_ENGINE, p.engine);
    if (p.speaker !== undefined) localStorage.setItem(KEY_SPEAKER, p.speaker);
  } catch {
    /* private mode: preferences just don't persist */
  }
};

let queueToken = 0;
let currentSource: AudioBufferSourceNode | null = null;
let audioCtx: AudioContext | null = null;

export const isSpeaking = () => Boolean(synth()?.speaking) || currentSource !== null;

/** Call synchronously inside a tap handler so mobile browsers allow audio later. Never produces sound by itself. */
export function unlockAudio(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    audioCtx ??= new AC();
    if (audioCtx.state === "suspended") void audioCtx.resume();
  } catch {
    /* no audio available */
  }
}

/** Immediately silences GRU (interrupt). */
export function stopSpeaking(): void {
  queueToken++;
  synth()?.cancel();
  try { currentSource?.stop(); } catch { /* already stopped */ }
  currentSource = null;
}

export type SpeakResult = "natural" | "device" | "none" | "cap";

async function fetchNatural(text: string, speaker: string): Promise<AudioBuffer> {
  const res = await fetch("/api/voice/tts", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-App": "gru" },
    body: JSON.stringify({ text, speaker }),
  });
  if (res.status === 429) throw new Error("cap");
  if (!res.ok) throw new Error("tts");
  if (!audioCtx) throw new Error("no_audio");
  return audioCtx.decodeAudioData(await res.arrayBuffer());
}

function playBuffer(buf: AudioBuffer): Promise<void> {
  return new Promise((resolve) => {
    if (!audioCtx) return resolve();
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.destination);
    currentSource = src;
    src.onended = () => { if (currentSource === src) currentSource = null; resolve(); };
    src.start();
  });
}

async function speakDevice(sentences: string[], from: number, my: number, onSentence?: (i: number) => void): Promise<boolean> {
  const s = synth();
  if (!s) return false;
  const voices = await voicesReady();
  const prefs = getPrefs();
  const voice = voices.find((v) => v.voiceURI === prefs.uri) ?? voices[0];
  if (!voice) return false;
  for (let i = from; i < sentences.length; i++) {
    if (my !== queueToken) return true;
    const text = sentences[i];
    if (!text) continue;
    onSentence?.(i);
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = 0.96;
      u.pitch = 1;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      s.speak(u);
    });
  }
  return true;
}

/**
 * Speaks sentence by sentence. Prefers the natural neural voice (the next sentence is fetched while the current one plays);
 * falls back to an on-device voice if the natural voice is off, unavailable, or its daily allowance is used up.
 */
export async function speak(sentences: string[], onSentence?: (i: number) => void): Promise<SpeakResult> {
  stopSpeaking();
  const my = ++queueToken;
  const prefs = getPrefs();
  const parts = sentences.map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return "none";
  let failedAt = 0;
  let reason = "";
  if (prefs.engine === "natural" && audioCtx) {
    try {
      let next: Promise<AudioBuffer> = fetchNatural(parts[0] as string, prefs.speaker);
      for (let i = 0; i < parts.length; i++) {
        failedAt = i;
        const buf = await next;
        if (my !== queueToken) return "natural";
        next = i + 1 < parts.length ? fetchNatural(parts[i + 1] as string, prefs.speaker) : Promise.resolve(buf);
        next.catch(() => undefined);
        onSentence?.(i);
        await playBuffer(buf);
        if (my !== queueToken) return "natural";
      }
      return "natural";
    } catch (e) {
      reason = e instanceof Error ? e.message : "";
      synth()?.cancel();
    }
  }
  const ok = await speakDevice(parts, failedAt, my, onSentence);
  return ok ? "device" : reason === "cap" ? "cap" : "none";
}

/** Sentences are short and clean for the voice: no stray symbols, arrows or emoji. */
export const speakable = (s: string): string => s.replace(/[→↗·•]/g, ",").replace(/\s+/g, " ").trim();
