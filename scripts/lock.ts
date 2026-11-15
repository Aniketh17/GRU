// Lock (spec section 15): deletes the data keys from the deployed Worker.
// Encrypted data becomes unreadable until scripts/unlock.ts restores the keys.
// Usage: node scripts/lock.ts [--dry-run]
import { isMain } from "./lib/main.ts";
import { confirm, hasFlag, wrangler, type Exec } from "./lib/cli.ts";

export const LOCK_SECRETS = ["DATA_KEY_V1", "INDEX_KEY"];

export async function lock(exec: Exec, dryRun: boolean, ok: (q: string) => Promise<boolean> = confirm): Promise<number> {
  console.log("Make sure DATA_KEY_V1 and INDEX_KEY are saved in your password manager. Without them, unlock is impossible.");
  for (const name of LOCK_SECRETS) {
    if (dryRun) {
      console.log(`[dry-run] would run: wrangler secret delete ${name}`);
      continue;
    }
    if (!(await ok(`Delete secret ${name} from the Worker?`))) return 1;
    const code = exec(["secret", "delete", name]);
    if (code !== 0) return code;
  }
  console.log("Locked. GRU will show the Locked page.");
  return 0;
}

if (isMain(import.meta.url)) process.exit(await lock(wrangler, hasFlag("--dry-run")));
