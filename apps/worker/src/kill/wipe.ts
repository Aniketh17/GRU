// In-app wipe (spec section 15, D-013, D-025).
// Order: kill_state=wiping -> revoke Gmail refresh tokens -> empty every table -> kill_state=wiped.
// Wipe makes data inaccessible through GRU immediately. It does NOT claim to destroy
// historical copies: D1 Time Travel keeps up to 7 days of restorable history (PRIVACY.md).
import type { Env } from "../env.ts";
import { aadFor, decryptField, keyringFromEnv } from "../crypto/envelope.ts";
import type { Db } from "../db/client.ts";
import { setKv } from "../db/kv.ts";
import { errorCode, log } from "../log/index.ts";

export const WIPE_PHRASE = "WIPE EVERYTHING";
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export interface WipeResult {
  wiped: true;
  tables: number;
  revoked: number;
  revoke_failed: number;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;
export function isWipeableTable(name: string): boolean {
  return TABLE_NAME.test(name) && !name.startsWith("sqlite_") && !name.startsWith("_cf_") && name !== "d1_migrations";
}

export async function wipeAll(env: Env, db: Db, fetcher?: Fetcher): Promise<WipeResult> {
  const doFetch: Fetcher = fetcher ?? ((url, init) => db.budget.fetch(url, init));
  await setKv(db, "kill_state", "wiping");
  log("wipe_started");

  // 1. Revoke every stored Gmail refresh token (revoking also invalidates access tokens).
  let revoked = 0;
  let failed = 0;
  const accounts = await db.all<{ id: number; refresh_token_enc: string }>(
    "SELECT id, refresh_token_enc FROM mail_accounts WHERE refresh_token_enc IS NOT NULL",
  );
  for (const a of accounts) {
    try {
      const token = await decryptField(keyringFromEnv(env), a.refresh_token_enc, aadFor("mail_accounts", "refresh_token_enc", a.id));
      const res = await doFetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (res.ok) revoked++;
      else failed++;
    } catch (err) {
      // Locked (no key), budget exhausted or network error: report, keep wiping.
      // RUNBOOK backstop: revoke at myaccount.google.com/permissions.
      log("wipe_revoke_failed", { account_id: a.id, code: errorCode(err) });
      failed++;
    }
  }

  // 2. Empty every application table in ONE batch (atomic, one subrequest).
  //    Tables are discovered dynamically so future migrations are covered automatically.
  const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'"))
    .map((r) => r.name)
    .filter(isWipeableTable);
  const stmts = tables.map((t) => db.stmt(`DELETE FROM "${t}"`));
  stmts.push(db.stmt("INSERT INTO kv (k, v) VALUES ('kill_state', 'wiped'), ('paused', '1')"));
  await db.batch(stmts);

  log("wipe_done", { tables_count: tables.length, revoked_count: revoked, failed_count: failed });
  return { wiped: true, tables: tables.length, revoked, revoke_failed: failed };
}
