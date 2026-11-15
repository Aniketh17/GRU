// Prints fresh keys to stdout. Never writes them to disk.
// Usage: node scripts/gen-keys.ts
import { isMain } from "./lib/main.ts";
import { webcrypto } from "node:crypto";

const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");

export function randomKey(): string {
  return b64url(webcrypto.getRandomValues(new Uint8Array(32)));
}

/** "gru-" + 36 chars of [a-z0-9] = 40 chars (spec: 32+). Rejection sampling avoids bias. */
export function randomTopic(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "gru-";
  while (out.length < 40) {
    const [byte] = webcrypto.getRandomValues(new Uint8Array(1));
    if (byte !== undefined && byte < 252) out += alphabet[byte % 36];
  }
  return out;
}

export function generateAll(): Record<string, string> {
  return {
    DATA_KEY_V1: randomKey(),
    INDEX_KEY: randomKey(),
    SESSION_SECRET: randomKey(),
    NTFY_TOPIC: randomTopic(),
  };
}

if (isMain(import.meta.url)) {
  console.log("Save ALL of these in your password manager BEFORE storing them anywhere else.");
  console.log("Losing DATA_KEY_V1 makes GRU's encrypted data unrecoverable (by design).\n");
  for (const [k, v] of Object.entries(generateAll())) console.log(`${k}=${v}`);
  console.log("\nThen: npx wrangler secret put <NAME>   (paste each value)");
}
