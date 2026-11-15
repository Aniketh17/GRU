// AES-256-GCM field encryption (spec section 7, D-005).
// Envelope: v1.<keyid>.<iv b64url>.<ciphertext+tag b64url>, AAD = "table:column:rowid".
import type { Env } from "../env.ts";
import { b64urlDecode, b64urlEncode, fromUtf8, utf8 } from "./b64.ts";

/** Thrown when a needed data key is absent: the app is Locked (spec section 15). */
export class LockedError extends Error {
  constructor() {
    super("locked");
    this.name = "LockedError";
  }
}

/** Thrown for malformed, tampered, wrong-key or wrong-AAD envelopes. Never includes data. */
export class DecryptError extends Error {
  constructor(code: "format" | "unknown_key" | "auth") {
    super(code);
    this.name = "DecryptError";
  }
}

export interface Keyring {
  active: string;
  keys: Record<string, string | undefined>;
}

export function keyringFromEnv(env: Pick<Env, "DATA_KEY_V1">): Keyring {
  return { active: "k1", keys: { k1: env.DATA_KEY_V1 } };
}

export const aadFor = (table: string, column: string, rowid: number | string): string => `${table}:${column}:${rowid}`;

const KEY_ID = /^k[0-9]{1,3}$/;
const aesKeys = new Map<string, Promise<CryptoKey>>();

function aesKey(raw: string): Promise<CryptoKey> {
  let key = aesKeys.get(raw);
  if (!key) {
    const bytes = b64urlDecode(raw);
    if (bytes.length !== 32) throw new Error("data_key_must_be_32_bytes");
    key = crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    aesKeys.set(raw, key);
  }
  return key;
}

export async function encryptField(ring: Keyring, plaintext: string, aad: string): Promise<string> {
  const raw = ring.keys[ring.active];
  if (!raw) throw new LockedError();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: utf8.encode(aad) },
    await aesKey(raw),
    utf8.encode(plaintext),
  );
  return `v1.${ring.active}.${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(ct))}`;
}

export async function decryptField(ring: Keyring, envelope: string, aad: string): Promise<string> {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new DecryptError("format");
  const [, kid, ivB64, ctB64] = parts as [string, string, string, string];
  if (!KEY_ID.test(kid) || !(kid in ring.keys)) throw new DecryptError("unknown_key");
  const raw = ring.keys[kid];
  if (!raw) throw new LockedError();
  let iv: Uint8Array, ct: Uint8Array;
  try {
    iv = b64urlDecode(ivB64);
    ct = b64urlDecode(ctB64);
  } catch {
    throw new DecryptError("format");
  }
  if (iv.length !== 12 || ct.length < 16) throw new DecryptError("format");
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: utf8.encode(aad) },
      await aesKey(raw),
      ct,
    );
    return fromUtf8.decode(pt);
  } catch {
    throw new DecryptError("auth");
  }
}
