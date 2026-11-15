// Unlock: restores DATA_KEY_V1 and INDEX_KEY from values you paste (hidden input).
// Usage: node scripts/unlock.ts
import { isMain } from "./lib/main.ts";
import { askHidden, wrangler } from "./lib/cli.ts";
import { LOCK_SECRETS } from "./lock.ts";

const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

if (isMain(import.meta.url)) {
  for (const name of LOCK_SECRETS) {
    const value = (await askHidden(`Paste ${name}: `)).trim();
    if (!KEY_RE.test(value)) {
      console.error(`${name} doesn't look like a GRU key (43 base64url characters).`);
      process.exit(1);
    }
    const code = wrangler(["secret", "put", name], value + "\n");
    if (code !== 0) process.exit(code);
  }
  console.log("Unlocked.");
}
