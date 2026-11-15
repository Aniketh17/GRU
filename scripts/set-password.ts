// Provisions GRU's single login (D-001, D-018). Prints AUTH_USERNAME and AUTH_VERIFIER.
// Usage: node scripts/set-password.ts [--m 65536] [--t 3]
import { isMain } from "./lib/main.ts";
import { createHash, webcrypto } from "node:crypto";
import { deriveProof } from "../apps/web/src/derive.ts";
import { ask, askHidden, flagValue } from "./lib/cli.ts";

export const DEFAULT_M = 65536; // 64 MiB
export const DEFAULT_T = 3;

const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");

export function passwordProblems(password: string, username: string): string[] {
  const problems: string[] = [];
  if (password.length < 16) problems.push("must be at least 16 characters (a 5-word passphrase is ideal)");
  if (new Set(password).size < 8) problems.push("uses too few distinct characters");
  if (username && password.toLowerCase().includes(username.toLowerCase())) problems.push("must not contain the username");
  if (/^(.)\1+$/.test(password) || /(password|qwerty|123456|letmein)/i.test(password)) problems.push("is too predictable");
  return problems;
}

export async function buildVerifier(password: string, m: number, t: number, saltBytes?: Uint8Array): Promise<string> {
  const salt = b64url(saltBytes ?? webcrypto.getRandomValues(new Uint8Array(16)));
  const proof = await deriveProof(password, { m, t, p: 1, salt });
  const digest = createHash("sha256").update(Buffer.from(proof, "base64url")).digest();
  return `gru1$argon2id$v=19$m=${m},t=${t},p=1$${salt}$${b64url(digest)}`;
}

async function main(): Promise<void> {
  const m = Number(flagValue("--m") ?? DEFAULT_M);
  const t = Number(flagValue("--t") ?? DEFAULT_T);
  if (!Number.isInteger(m) || m < 7168 || !Number.isInteger(t) || t < 1) throw new Error("invalid --m/--t");

  const username = (await ask("Username (3–32 chars, a-z 0-9 . _ -): ")).normalize("NFKC").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error("invalid username");

  const password = await askHidden("Password: ");
  const problems = passwordProblems(password, username);
  if (problems.length) throw new Error("Password " + problems.join("; "));
  if ((await askHidden("Repeat password: ")) !== password) throw new Error("passwords did not match");

  process.stdout.write(`Deriving Argon2id (m=${m} KiB, t=${t})…\n`);
  const verifier = await buildVerifier(password, m, t);
  console.log("\nStore these as Worker secrets (npx wrangler secret put <NAME>):\n");
  console.log(`AUTH_USERNAME=${username}`);
  console.log(`AUTH_VERIFIER=${verifier}`);
  console.log("\nKeep the password itself in your password manager. GRU never sees it.");
}

if (isMain(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(`Error: ${e instanceof Error ? e.message : "failed"}`);
    process.exit(1);
  });
}
