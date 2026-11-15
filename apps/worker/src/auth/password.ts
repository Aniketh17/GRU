// Server side of client-side Argon2id ("server relief", D-018).
// The browser sends P = Argon2id(password, salt, params). We store only SHA-256(P)
// in the AUTH_VERIFIER secret and compare in constant time (<1 ms CPU).
import type { Env } from "../env.ts";
import { b64urlDecode, b64urlEncode } from "../crypto/b64.ts";
import { hmacSha256, sha256, timingSafeEqual } from "../crypto/hmac.ts";

export interface Verifier {
  m: number;
  t: number;
  p: number;
  salt: string; // base64url
  digest: Uint8Array; // SHA-256(P), 32 bytes
}

export interface KdfParams {
  alg: "argon2id";
  v: 19;
  m: number;
  t: number;
  p: number;
  salt: string;
}

const VERIFIER_RE =
  /^gru1\$argon2id\$v=19\$m=([0-9]{4,7}),t=([0-9]{1,2}),p=([0-9]{1,2})\$([A-Za-z0-9_-]{22,64})\$([A-Za-z0-9_-]{43})$/;

export function parseVerifier(s: string | undefined): Verifier {
  const m = s ? VERIFIER_RE.exec(s) : null;
  if (!m) throw new Error("bad_verifier");
  const [mem, t, p] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Floor: OWASP's lowest-memory Argon2id option (7 MiB with t=5) -> require m >= 7168.
  if (mem < 7168 || t < 1 || p < 1 || p > 4) throw new Error("weak_verifier_params");
  const digest = b64urlDecode(m[5] as string);
  if (digest.length !== 32) throw new Error("bad_verifier");
  return { m: mem, t, p, salt: m[4] as string, digest };
}

export const normalizeUsername = (u: string): string => u.normalize("NFKC").trim().toLowerCase();

async function usernameMatches(env: Env, username: string): Promise<boolean> {
  const a = await sha256(normalizeUsername(username));
  const b = await sha256(normalizeUsername(env.AUTH_USERNAME ?? ""));
  return timingSafeEqual(a, b) && (env.AUTH_USERNAME ?? "") !== "";
}

/**
 * KDF parameters for a login attempt. Unknown usernames get the same params and a
 * deterministic fake salt of the same length, so the response does not reveal
 * whether the username exists.
 */
export async function kdfParamsFor(env: Env, username: string): Promise<KdfParams> {
  const ver = parseVerifier(env.AUTH_VERIFIER);
  let salt = ver.salt;
  if (!(await usernameMatches(env, username))) {
    const saltLen = b64urlDecode(ver.salt).length;
    const fake = await hmacSha256(env.SESSION_SECRET ?? "", "salt:" + normalizeUsername(username));
    salt = b64urlEncode(fake.slice(0, Math.min(saltLen, fake.length)));
  }
  return { alg: "argon2id", v: 19, m: ver.m, t: ver.t, p: ver.p, salt };
}

/** Both checks always run, so timing doesn't reveal which one failed. */
export async function verifyLogin(env: Env, username: string, proofB64: string): Promise<boolean> {
  const ver = parseVerifier(env.AUTH_VERIFIER);
  let proof: Uint8Array;
  try {
    proof = b64urlDecode(proofB64);
  } catch {
    proof = new Uint8Array(32);
  }
  const digest = await sha256(proof);
  const passOk = proof.length === 32 && timingSafeEqual(digest, ver.digest);
  const userOk = await usernameMatches(env, username);
  return passOk && userOk;
}
