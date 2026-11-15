// Records the microphone after an explicit tap and returns a 16 kHz mono WAV (base64), ready for Whisper.
// Works on iPhone Safari / home-screen apps, where on-device speech recognition isn't available.
// The audio stays in memory; only the transcript text comes back and nothing is stored.

export interface Recording {
  /** Stops recording (the result then resolves). */
  stop: () => void;
  /** Base64 WAV, or "" if nothing usable was recorded. */
  result: Promise<string>;
}

export class MicError extends Error {
  constructor(readonly reason: "unsupported" | "denied" | "failed") {
    super(reason);
  }
}

export const micSupported = (): boolean => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";

const SAMPLE_RATE = 16_000;

export function encodeWav(samples: Float32Array, rate = SAMPLE_RATE): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] as number));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function toWavBase64(blob: Blob): Promise<string> {
  if (blob.size < 1500) return "";
  const Ctx = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctx) throw new MicError("unsupported");
  // Decoding on a 16 kHz context resamples for us.
  const decoded = await new Ctx(1, SAMPLE_RATE, SAMPLE_RATE).decodeAudioData(await blob.arrayBuffer());
  const mono = new Float32Array(decoded.length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const ch = decoded.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] as number) + (ch[i] as number) / decoded.numberOfChannels;
  }
  if (mono.length < SAMPLE_RATE * 0.3) return "";
  return toBase64(encodeWav(mono));
}

export async function startRecording(maxSeconds = 25): Promise<Recording> {
  if (!micSupported()) throw new MicError("unsupported");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    throw new MicError(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "failed");
  }
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const timer = window.setTimeout(() => stop(), maxSeconds * 1000);
  const release = () => { window.clearTimeout(timer); stream.getTracks().forEach((t) => t.stop()); };
  const result = new Promise<string>((resolve, reject) => {
    rec.onstop = () => {
      release();
      toWavBase64(new Blob(chunks, { type: rec.mimeType || "audio/mp4" })).then(resolve, () => reject(new MicError("failed")));
    };
    rec.onerror = () => { release(); reject(new MicError("failed")); };
  });
  function stop() {
    if (rec.state !== "inactive") rec.stop();
  }
  rec.start();
  return { stop, result };
}
