# GRU: Setup checklist

Do these steps in order. Steps 1–4 are needed to deploy Phase 0/1. Steps 5–7 are needed before Gmail (Phase 2), and step 8 before notifications (Phase 3). Step 9 should be done now.
Console menu names were current as of 2026-11-15; if Google or Cloudflare renamed something, tell Claude and this file gets updated.

> **$0 rule:** never add a payment method to Cloudflare, never attach a billing account to the Google Cloud project, and never start the Google Cloud free trial. GRU never needs any of them.

## 1. Local machine
- [ ] Node 20.16+ (already installed) is enough for the Node 20 lane: `cd C:devGRU`, then `npm ci`, then `npm run check`.
- [ ] **For steps 3–8 (Wrangler):** add Node 22 **side by side** with fnm, without replacing the system Node that Antigravity uses. See docs/DEVELOPMENT.md. Then, in that terminal: `cd C:devGRU	oolchain`, `npm ci`, `npm run check`.
- [ ] Wrangler commands below are run from `toolchain/` with `--config ../wrangler.jsonc`, or use the npm scripts there (`npm run dev`, `npm run db:migrate:remote`, `npm run deploy`).

## 2. Cloudflare account (free, no card)
- [ ] Sign up at https://dash.cloudflare.com/sign-up. If it asks for a card, stop and tell Claude.
- [ ] Turn on 2FA (step 9).
- [ ] Check that no payment method is on file: dashboard → **Manage Account → Billing → Payment info** should show none.
- [ ] Check the plan: **Workers & Pages → Plans** should show **Free**.
- [ ] Choose your workers.dev subdomain: **Workers & Pages → Overview**, right sidebar **Subdomain**. Your app URL will be `https://gru.<subdomain>.workers.dev`.

## 3. Wrangler and the database
- [ ] `npx wrangler login` (a browser opens; approve).
- [ ] `npx wrangler d1 create gru`, then copy the printed `database_id` into `wrangler.jsonc` → `d1_databases[0].database_id`.
- [ ] Set `vars.APP_ORIGIN` in `wrangler.jsonc` to `https://gru.<subdomain>.workers.dev`.
- [ ] `npx wrangler d1 migrations apply gru --remote`

## 4. Keys, login and secrets
- [ ] `node build/unit/scripts/gen-keys.js` (Node 20, after `npm run build:unit`) or `node scripts/gen-keys.ts` (Node ≥ 22.18) prints `DATA_KEY_V1`, `INDEX_KEY`, `SESSION_SECRET` and `NTFY_TOPIC`. **Save all four in your password manager first.** If `DATA_KEY_V1` is lost, your data is unrecoverable by design.
- [ ] `node build/unit/scripts/set-password.js` (or `node scripts/set-password.ts` on Node ≥ 22.18) asks for a username and a password (16+ characters; a 5-word passphrase is ideal), then prints `AUTH_USERNAME` and `AUTH_VERIFIER`. Save the password in your password manager. The verifier is not secret-critical but is stored as a secret anyway.
- [ ] For each value, run `npx wrangler secret put <NAME>` and paste it: `DATA_KEY_V1`, `INDEX_KEY`, `SESSION_SECRET`, `AUTH_USERNAME`, `AUTH_VERIFIER`.
- [ ] `cd toolchain && npm run deploy`, then open `https://gru.<subdomain>.workers.dev/login` on your phone and sign in.
- [ ] **Local dev only:** copy `.dev.vars.example` to `.dev.vars` (git-ignored) and fill it with **separate** throwaway values made with the same scripts. Never put production keys in `.dev.vars`.

## 5. Google Cloud project (before Phase 2)
- [ ] Go to https://console.cloud.google.com and sign in with either Gmail account. If prompted to "Start free trial", **dismiss it**.
- [ ] Create a project: project picker → **New project** → name `gru` → Create.
- [ ] Confirm there is no billing: **☰ → Billing** should say "This project has no billing account". Do not link one.
- [ ] Enable the Gmail API: **☰ → APIs & Services → Library**, search "Gmail API", then **Enable**.
- [ ] **☰ → Google Auth Platform** (formerly "OAuth consent screen") → **Get started**:
  - App name `GRU`, support email = your address; Audience **External**; contact email; agree; **Create**.
  - **Data Access → Add or remove scopes:** `.../auth/gmail.readonly`, `openid`, `.../auth/userinfo.email`. Save.
  - **Audience → Publish app** (status becomes **In production**). Google shows warnings about verification. GRU qualifies for the personal-use exception (you are the only user), so do not submit for verification.
- [ ] **Clients → Create client** → Application type **Web application** → name `gru-web`:
  - Authorized redirect URIs: `https://gru.<subdomain>.workers.dev/api/mail/callback` and `http://localhost:8787/api/mail/callback`
  - **Create**, then copy the Client ID and Client secret into your password manager.
- [ ] `npx wrangler secret put GOOGLE_CLIENT_ID`, then `npx wrangler secret put GOOGLE_CLIENT_SECRET`
- [ ] `npx wrangler secret put ALLOWED_EMAILS` → both Gmail addresses, comma-separated, no spaces.

## 6. Connect Gmail (Phase 2)
- [ ] In GRU: More → Settings → Accounts → Connect, once for each address.
- [ ] On Google's "Google hasn't verified this app" screen, click **Advanced → Go to GRU (unsafe)**. It's your own app.
- [ ] If GRU shows a red "Testing mode" banner, go back to step 5 and publish the app.

## 7. Remember
Changing a Google account password disconnects that mailbox from GRU. Reconnect afterwards (RUNBOOK §4).

## 8. ntfy (before Phase 3)
- [ ] Install **ntfy** from the App Store or Play Store.
- [ ] **+** → Subscribe to topic → paste `NTFY_TOPIC` from step 4 (leave the server as ntfy.sh).
- [ ] `npx wrangler secret put NTFY_TOPIC`

## 9. Account security (do now)
- [ ] Cloudflare: **My Profile → Authentication** → add a security key/passkey or an authenticator app.
- [ ] Both Google accounts: https://myaccount.google.com/security → Passkeys and 2-Step Verification.
- [ ] Your password manager itself uses a strong master password and 2FA.
