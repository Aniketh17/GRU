# GRU: Runbook

Last updated 2026-11-15. Sections marked *(Phase N)* describe behaviour that ships in that phase.

## 1. Routine
There are no weekly chores. Open GRU in the morning; any failure appears on Today and in the brief's health line.

## 2. Pause / resume
- In the app: More → Settings → Pause sync.
- Or: `POST /api/admin/pause` / `POST /api/admin/resume` (logged-in session).

Paused means no Gmail sync and no scheduled notifications. Data and login are unaffected.

## 3. Login problems
- **Forgot the password or want to change it:** run `node scripts/set-password.ts`, then `npx wrangler secret put AUTH_VERIFIER` (paste the new value). Then log out everywhere: `node scripts/logout-all.ts`.
- **"Too many attempts" (429).** Wait for the time shown: per-device locks last 15 min, doubling up to 24 h; the global lock lasts 1 h. If someone else triggered the lock and you need in now:
  `npx wrangler d1 execute gru --remote --command "DELETE FROM login_attempts"`.
  Then consider changing the password, because a lockout means someone was guessing.
- **Logged out unexpectedly:** sessions expire after 7 days idle or 30 days total. Log in again.

## 4. Gmail disconnected ("Reconnect Gmail") *(Phase 2)*
Causes:
- you changed the Google account password (Google revokes Gmail-scoped tokens);
- you revoked GRU at myaccount.google.com/permissions;
- the token went unused for 6 months;
- more than 100 tokens were issued for one account;
- the Google app was still in **Testing** mode (tokens expire after 7 days).

What GRU does: sets that account to `needs_reauth`, stops syncing it (other accounts continue), shows a red Reconnect status on Today and Settings, and sends one generic "Action needed: reconnect Gmail" ping per day.

Fix: More → Settings → Accounts → Reconnect, then sign in to that Google account. Sync resumes from where it stopped.

If it recurs every ~7 days, the Google Cloud app is in Testing. Go to Google Cloud console → Google Auth Platform → Audience → Publish app (SETUP step 5).

## 5. Rotate keys
- `SESSION_SECRET`: `node scripts/gen-keys.ts`, then `npx wrangler secret put SESSION_SECRET`. Existing sessions keep working (they are stored as hashes); fake salts and IP bucket keys change.
- `DATA_KEY_V1` → `V2` *(Phase 7 tooling)*: add `DATA_KEY_V2`, set `ACTIVE_KEY_ID=v2`, run the re-encrypt job, then delete V1.

## 6. Lock / unlock
- `node scripts/lock.ts` deletes `DATA_KEY_V1` and `INDEX_KEY` from the Worker, and GRU shows the Locked page.
- `node scripts/unlock.ts` restores them (paste from your password manager).

## 7. Wipe
- **In-app:** More → Danger zone → type `WIPE EVERYTHING` and hold for 10 s. See PRIVACY §6 for what this does and does not destroy (D1 Time Travel keeps up to 7 days of restorable history).
- **Full teardown:** `node scripts/wipe.ts` (`--dry-run` first). It confirms every step and ends with a manual checklist.
- **Independent backstops:**
  - revoke GRU at myaccount.google.com/permissions for each Gmail account;
  - delete the OAuth client in Google Cloud, which kills every refresh token;
  - delete the Worker in the Cloudflare dashboard.

## 8. Metrics *(Phase 2)*
Dashboard → Workers & Pages → gru → Metrics: CPU time (p50/p99), requests and errors. Record the p99 CPU in DECISIONS.md after each phase that changes the tick. Workers Logs is intentionally off; for live debugging use `npx wrangler tail` (it shows only allowlisted log fields).

## 9. Quarterly check (next: 2027-02-15)
Re-verify free-tier limits and billing terms and update DECISIONS.md Part A:
- Workers, D1, Workers Logs/Observability pricing (changes from 2026-12-01);
- Gmail API quota charges;
- ntfy limits;
- Google OAuth refresh-token rules;
- D1 Time Travel retention.

Then confirm the Cloudflare account still has no payment method and the Google Cloud project still has no billing account.

## 10. Redeploy from scratch
Follow SETUP.md top to bottom, then `npx wrangler d1 migrations apply gru --remote` and `npm run deploy`.
