// Client-side Argon2id for login (D-018). Shared by the browser login page,
// scripts/set-password.ts and the test config, so all three derive identically.
import { argon2id } from "hash-wasm";

export interface KdfParams {
  m: number; // memory in KiB
  t: number; // iterations
  p: number; // parallelism
  salt: string; // base64url
}

function fromB64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Returns base64url(Argon2id(NFC(password), salt, m, t, p, 32 bytes)). */
export async function deriveProof(password: string, params: KdfParams): Promise<string> {
  const out = await argon2id({
    password: password.normalize("NFC"),
    salt: fromB64url(params.salt),
    parallelism: params.p,
    iterations: params.t,
    memorySize: params.m,
    hashLength: 32,
    outputType: "binary",
  });
  return toB64url(out);
}
