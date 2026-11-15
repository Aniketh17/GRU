# GRU: Architecture

Last updated 2026-11-15 (Phase 0, after Ani's decisions D-001, D-016, D-018–D-022).
GRU is a single-user, phone-first PWA that addresses its user as **Ani**. One Cloudflare Worker serves both the API and the static web app, D1 is the only datastore, a single cron drives everything scheduled, and ntfy delivers content-free pings.

```
 Phone / laptop browser (PWA)                      Cloudflare (Workers Free, no payment method)
 ┌──────────────────────────┐   HTTPS        ┌──────────────────────────────────────────────┐
 │ login.html               │──────────────▶ │ Worker "gru"  (workers.dev, no custom domain) │
 │  └ Argon2id (WASM) ──P──▶│  /auth/*       │  headers → kill guard → auth → hygiene → route│
 │ SPA (Phase 1+)           │  /api/*        │  scheduled(): */15 tick (lock, sync, scheduler)│
 └──────────────────────────┘                │        │ D1 binding "DB"        │ assets      │
        ▲ ntfy app                           │        ▼                         ▼            │
        │ (content-free ping)                │   D1 (SQLite, 500 MB/DB)   apps/web/dist      │
 ┌──────┴─────┐                              └──────┬───────────────────────────┬──────────┘
 │  ntfy.sh   │◀──── fixed-string POST ─────────────┘                           │
 └────────────┘                                     Gmail API (read-only, Phase 2) ◀┘
                                                    oauth2.googleapis.com (token, revoke)
```

## 1. Components
| Component | Tech | Plan / cost |
|---|---|---|
| API + scheduler | Cloudflare Worker, TypeScript strict, Hono, Zod | Workers Free |
| Web app | Static HTML in Phase 0; Vite + React + Tailwind + TanStack Query + React Router from Phase 1 | Static assets: free, unlimited |
| Database | D1, numbered SQL migrations, no ORM | D1 Free |
| Scheduling | 1 Cron Trigger `*/15 * * * *` | Free (1 of 5) |
| Notifications | ntfy.sh behind a `Notifier` interface (fixed enum → constant strings) | Free, no account |
| Mail source | Gmail API, `gmail.readonly`, OAuth web client (Phase 2) | Google Cloud project with **no billing account** |
| Local tooling | Node 20 lane (root): TypeScript, `node:test`. Node 22 lane (`toolchain/`): Wrangler, Vitest + workerd, Vite, ESLint (D-028, DEVELOPMENT.md) | Free |

## 2. Authentication (D-001, D-006, D-018, D-019)
There is one account, provisioned from the terminal. No registration route exists anywhere.

**Provisioning** (`scripts/set-password.ts`, run locally): prompts for a username and password (hidden input; minimum 16 characters, with a strength check). It derives `P = Argon2id(password, salt, m=64 MiB, t=3, p=1, 32 B)` and outputs:
- `AUTH_USERNAME`
- `AUTH_VERIFIER = gru1$argon2id$v=19$m=65536,t=3,p=1$<salt b64url>$<SHA-256(P) b64url>`

Both are stored as Worker secrets, never in D1 or git.

**Login flow:**
1. `GET /auth/params?u=<username>` returns the algorithm, parameters and salt. An unknown username gets the same parameters and a deterministic fake salt (`HMAC(SESSION_SECRET, "salt:"+u)`), so the response doesn't reveal which usernames exist.
2. The browser computes `P` in WebAssembly (`hash-wasm`; about 0.2 s on a laptop, 0.5–1 s on a phone).
3. `POST /auth/login {u, p}`:
   - check rate-limit buckets first, so a locked bucket costs about 1 D1 read;
   - compare the username digest and `SHA-256(P)` against the verifier in constant time, always evaluating both;
   - on success, clear the client bucket, create a session and set the cookie;
   - on failure, increment the buckets and return a generic 401.

**Sessions:**
- 32 random bytes, sent as cookie `__Host-gru_s` (HttpOnly; Secure; SameSite=Strict; Path=/).
- D1 `sessions(token_hash PK, created_at, last_seen_at, expires_at)`.
- Idle expiry 7 days, absolute expiry 30 days; `last_seen_at` is written at most every 10 min.
- `POST /auth/logout` deletes the row. `scripts/logout-all.ts` and wipe delete every row.

**Rate limits** (`login_attempts`):
- Per client (HMAC of the IP, raw IP never stored): 5 failures / 15 min → 15 min lock, doubling per repeat up to 24 h.
- Global: 20 failures / hour → 1 h lock.
- Locked responses are `429` + `Retry-After`.

**Why the browser does the hashing:** server-side Argon2id at OWASP strength takes about 45–210 ms of CPU against a 10 ms limit (DECISIONS A9). Server relief keeps full Argon2id cost for any offline attacker while the Worker does one SHA-256.

**Gmail OAuth is separate.** It never logs anyone into GRU. `/api/mail/connect` requires an existing GRU session and only adds a mailbox, and its callback enforces the `ALLOWED_EMAILS` allowlist.

## 3. Request pipeline (every request)
1. **Security headers**, applied to all responses:
   - CSP `default-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`; the login page also gets `script-src 'self' 'wasm-unsafe-eval'` (D-021);
   - HSTS, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`;
   - `Cache-Control: no-store` on `/api` and `/auth`.
2. **Kill guard:**
   - `kill_state=wiping` → 423 for everything except static assets;
   - `wiped` → 423 with a "GRU has been wiped" state;
   - a missing data key → 423 `{locked:true}`, and the SPA shows the Locked page.
3. **Public paths:** static assets, `/login`, `/auth/params`, `/auth/login`.
4. **Auth:** a valid session is required for `/api/*` and `/auth/logout`. Anything else gets 401 with an empty body.
5. **Hygiene**, for mutating methods: `Content-Type: application/json`, `X-App: gru`, and `Origin` equal to `APP_ORIGIN`. Failures return 415 or 403.
6. **Route**, with Zod validation; list pages are capped at 50.

## 4. Data
- Migration `0001_init.sql` is the spec §6 schema verbatim, plus seed rows `kv.kill_state=running` and `kv.paused=0`.
- Migration `0002_auth.sql` adds `sessions` and `login_attempts` (D-024).
- Phase 6 adds `tasks`, `task_links` and `reminders` (§7).
- Encrypted columns use AES-256-GCM envelopes (`v1.<kid>.<iv>.<ct>`, AAD `table:column:rowid`) under the secret `DATA_KEY_V1`.
- Notes and tasks are searched through an HMAC blind index under `INDEX_KEY`.

## 5. Secrets (Cloudflare secrets in production; git-ignored `.dev.vars` locally)
| Name | Purpose |
|---|---|
| `DATA_KEY_V1` | AES-256-GCM field key (lose it and the data is unrecoverable by design) |
| `INDEX_KEY` | HMAC key for the blind index |
| `SESSION_SECRET` | HMAC key for fake salts and IP bucket keys |
| `AUTH_USERNAME`, `AUTH_VERIFIER` | Single-user login (D-018) |
| `ALLOWED_EMAILS` | Gmail accounts that may be connected (Phase 2) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Gmail OAuth (Phase 2) |
| `NTFY_TOPIC` | 40-character random topic (Phase 3) |
| `APP_ORIGIN` (var, not secret) | Exact origin for Origin checks and ntfy Click |

## 6. Failure handling and degradation
- **Daily caps** (Workers requests, D1 reads/writes): fail quietly, record the failure when possible, report it in the next brief, never retry in a loop (D-011).
- **Subrequest budget:** 40 per invocation. When it runs out, save the cursor and stop.
- **Gmail authorisation lost** (D-022): `invalid_grant` or a revoked token sets that account to `needs_reauth` and stops its sync, while other accounts continue. GRU shows a red Reconnect status (Today, Settings, brief health line) and sends ntfy `action_needed` at most once per day. Reconnecting resumes from the stored cursor. Changing a Google password revokes Gmail tokens (RUNBOOK §4).
- **ntfy** rate-limited or down: log `ntfy_failed` (code only) without retrying; the in-app brief is the source of truth.

## 7. Phase 6 scope: Notes + Tasks + Agenda (D-016, option B)
- **Tasks:**
  - fields: title (encrypted), optional notes (encrypted), due date and optional time (UTC + IANA tz), priority (`high|normal|low`), status (`open|done|cancelled`), `kind` (`task|call|interview_prep|followup`);
  - links to applications, interviews and notes through `task_links`.
- **Reminders:** at a chosen offset before the due time (default 1 h for calls, plus the existing 24 h / 2 h for interviews). They go out through the scheduler as a generic ntfy `task_due`, with no title in the ping.
- **Agenda view:** today and the next 7 days, merging tasks, phone calls, scheduled interviews and follow-ups due; overdue items are pinned at the top.
- **Morning brief:** adds "Today's agenda" (count + top 3 by priority/time) and "Overdue".
- **Not included:** Google Calendar (a possible future read-only phase, which would need a new scope review), recurring tasks (unless asked for), and sharing.
- **Spec change:** the Notifier enum gains `task_due` ("Task reminder") in Phase 6. It is still a fixed string.

## 8. Notifications (unchanged rule)
`Notifier.send(kind)` accepts only the fixed enum: `brief_ready`, `interview_soon`, `review_needed`, `action_needed`, `followup_due`, `jobs_ready`, and from Phase 6 `task_due`. Each maps to a constant string. A type-level test makes free text impossible. Pings never contain job, email, interview, task or personal details.

## 9. Cost posture (verified 2026-11-15, DECISIONS A8)
GRU uses **no paid service and no payment method**, and has **no billing path**.

| Guard | Enforced how |
|---|---|
| Workers / D1 Free limits fail rather than bill | Platform behaviour; GRU degrades (§6) |
| No payment method on the Cloudflare account | SETUP checkbox |
| No billing account on the Google Cloud project; never start the GCP free trial | SETUP checkbox |
| `observability.enabled = false`; no Workers Caching, R2, AI, Queues, Durable Objects or custom domains | `test/unit/config.test.ts` parses `wrangler.jsonc` and fails on any of these |
| ntfy without an account | n/a |
| All dependencies are open-source libraries, pinned exact | `package.json`, lockfile review in Phase 7 |
