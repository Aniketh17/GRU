// Ends every GRU session (for example after a password change).
// Usage: node scripts/logout-all.ts [--local]
import { isMain } from "./lib/main.ts";
import { confirm, hasFlag, wrangler } from "./lib/cli.ts";

if (isMain(import.meta.url)) {
  const target = hasFlag("--local") ? "--local" : "--remote";
  if (await confirm(`Delete all sessions in the ${target.slice(2)} D1 database "gru"?`)) {
    process.exit(wrangler(["d1", "execute", "gru", target, "--command", "DELETE FROM sessions"]));
  }
  console.log("Cancelled.");
}
