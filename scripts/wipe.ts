// Full teardown (spec section 15). Needs a human at the terminal; confirms every step.
// Usage: node scripts/wipe.ts --dry-run   (always run this first)
//        node scripts/wipe.ts
import { isMain } from "./lib/main.ts";
import { confirm, hasFlag, wrangler, type Exec } from "./lib/cli.ts";

export const ALL_SECRETS = [
  "DATA_KEY_V1", "INDEX_KEY", "SESSION_SECRET", "AUTH_USERNAME", "AUTH_VERIFIER",
  "ALLOWED_EMAILS", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "NTFY_TOPIC",
];

export interface Step {
  label: string;
  args: string[];
}

export function plan(): Step[] {
  return [
    ...ALL_SECRETS.map((s) => ({ label: `Delete Worker secret ${s}`, args: ["secret", "delete", s] })),
    { label: 'Delete the D1 database "gru" (all tables)', args: ["d1", "delete", "gru"] },
    { label: 'Delete the Worker "gru" and its static assets', args: ["delete", "--name", "gru"] },
  ];
}

export const MANUAL_CHECKLIST = [
  "Google Cloud console: delete the OAuth client (or the whole project). This kills every refresh token.",
  "myaccount.google.com/permissions: remove GRU from BOTH Gmail accounts (belt and braces).",
  "ntfy app: unsubscribe from the GRU topic.",
  "Phone: delete the GRU home-screen app.",
  "Cloudflare: D1 Time Travel keeps up to 7 days of restorable history on the Free plan (verified 2026-11-15).",
  "  Deleting the database ends GRU's access; Cloudflare's own retention still applies. See PRIVACY.md section 6.",
  "Password manager: delete the GRU keys only once you're sure you never need to restore.",
];

export async function run(exec: Exec, dryRun: boolean, ok: (q: string) => Promise<boolean> = confirm): Promise<number> {
  console.log(dryRun ? "GRU full teardown: DRY RUN (nothing will be changed)\n" : "GRU full teardown\n");
  for (const step of plan()) {
    if (dryRun) {
      console.log(`[dry-run] ${step.label}: wrangler ${step.args.join(" ")}`);
      continue;
    }
    if (!(await ok(step.label + "?"))) {
      console.log("  skipped");
      continue;
    }
    const code = exec(step.args);
    console.log(code === 0 ? "  done" : `  FAILED (exit ${code}). Continue manually.`);
  }
  console.log("\nManual checklist:");
  for (const line of MANUAL_CHECKLIST) console.log(`  - ${line}`);
  return 0;
}

if (isMain(import.meta.url)) process.exit(await run(wrangler, hasFlag("--dry-run")));
