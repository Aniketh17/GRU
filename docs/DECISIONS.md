# GRU: Decisions and verified findings

Findings were read from official documentation on **2026-11-15** unless stated otherwise. Every number in SPEC.md is a hypothesis; this file records what was actually verified. Re-verify quarterly (RUNBOOK.md §9).

Status legend:
- ✅ confirms the spec
- ⚠️ differs from the spec or is ambiguous, with handling noted
- ⛔ blocked or awaiting Ani

---

## Part A: Verified platform facts

### A1. Cloudflare Workers, Free plan
Source: https://developers.cloudflare.com/workers/platform/limits/ (page "Last updated Nov 13, 2026")

| Item | Spec hypothesis | Verified | Status |
|---|---|---|---|
| Requests/day | 100,000 | 100,000, reset at 00:00 UTC. Over the limit: Error 1027 (fail open or fail closed, configured per route) | ✅ |
| CPU per invocation | 10 ms | 10 ms per HTTP request **and per Cron Trigger**. Network wait (fetch, D1, KV) does not count. Over the limit: Error 1102 | ✅ |
| Cron wall time | n/a | 15 min per Cron Trigger | ✅ (not a constraint) |
| Memory | 128 MB | 128 MB per isolate | ✅ |
| Subrequests | 50, including D1 | 50 per invocation, defined as "Fetch API or ... Cloudflare services like R2, KV, or D1". A separate row lists "Subrequests to internal services: 1,000" on Free | ⚠️ see D-003 |
| Simultaneous open connections | n/a | 6 per invocation | ⚠️ cap fetch concurrency at 6 |
| Cron Triggers per account | n/a | 5 | ✅ GRU uses 1 |
| Worker size | n/a | 64 MiB uncompressed | ✅ |
| Env vars + secrets | n/a | 64 per Worker, 5 KB each | ✅ GRU uses about 10 |
| Startup time | n/a | 1 s | ✅ keep top-level init trivial |

### A2. Cloudflare D1, Free plan
Sources: https://developers.cloudflare.com/d1/platform/limits/ (Oct 30, 2026), https://developers.cloudflare.com/d1/platform/pricing/ (Oct 30, 2026), https://developers.cloudflare.com/d1/worker-api/d1-database/ (Jun 22, 2026), https://developers.cloudflare.com/d1/reference/time-travel/ (Nov 6, 2026)

| Item | Spec hypothesis | Verified | Status |
|---|---|---|---|
| Storage | 5 GB total | 5 GB per account, but **500 MB per database** | ⚠️ GRU's data is tiny, so 500 MB is ample. Recorded so it is not mistaken for 5 GB |
| Databases | n/a | 10 per account | ✅ |
| Rows read/day | 5M | 5,000,000 | ✅ |
| Rows written/day | 100k | 100,000 | ✅ |
| Reset | n/a | "Free daily usage limits reset at 00:00 UTC", which is 12:00 or 13:00 Auckland time | ✅ |
| Over limit | requests fail | "you will not be able to run queries against D1. D1 API will return errors" | ✅ see D-011 |
| Queries per invocation | n/a | 50 on Free. "a `db.batch()` call counts as a single query against it, not one query per statement" | ✅ see D-003 |
| Batch semantics | n/a | "Batched statements are SQL transactions ... it aborts or rolls back the entire sequence". The same section also mentions auto-commit | ⚠️ treated as atomic; an integration test asserts rollback (D-004) |
| Bound params per query | n/a | 100 | ⚠️ the emails_seen diff (`IN (...)` with up to 25 ids) fits; chunk anything larger |
| Statement length | n/a | 100 KB | ✅ |
| Time Travel (PITR) | "check and record" | **7 days on Free** (30 on Paid). The intro text says 30 days without naming a plan; the Notes section and the limits page both say 7 for Free | ⚠️ after a wipe, D1 history stays restorable by the account owner for up to 7 days. This goes in PRIVACY.md and the wipe checklist (D-013) |

### A3. Cloudflare Access / Zero Trust
Sources: https://developers.cloudflare.com/cloudflare-one/setup/, https://www.cloudflare.com/plans/zero-trust-services/, https://developers.cloudflare.com/workers/configuration/routing/workers-dev/, https://developers.cloudflare.com/workers/configuration/cloudflare-access/, https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

- ⚠️ **Payment method** (now moot, see D-001). The setup docs say: *"Complete your onboarding by selecting a subscription plan and entering your payment details. If you chose the Zero Trust Free plan, this step is still needed but you will not be charged."* Entering payment details violates spec rule 4. Per spec §7 we stop and ask. See D-001.
- ✅ Access can protect a `workers.dev` URL with no custom domain (Worker → Access tab → "Protect this Worker behind Access").
- JWT: JWKS at `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`; RS256; select the key by `kid` from `public_certs`; validate `aud` (the application AUD tag) and `iss` (the team domain). Keys rotate every 6 weeks, and old keys stay valid for 7 days.
- ⚠️ `ctx.access` is not passed to the user Worker by Static Assets routers, so if Access is ever used, GRU verifies the header JWT itself.
- ⚠️ The "50 users" Free-plan figure was not found on any page read. It is irrelevant for a single user.

### A4. Cloudflare Workers AI (Phase 8 only)
Sources: https://developers.cloudflare.com/workers-ai/platform/pricing/ (Nov 12, 2026), https://developers.cloudflare.com/workers-ai/platform/data-usage/ (Oct 16, 2026)

- ✅ Free allocation: 10,000 Neurons/day, reset at 00:00 UTC. On Workers Free, going over means "further operations will fail with an error"; overage pricing is only available on Workers Paid.
- ✅ Data: *"Cloudflare does not use Customer Content processed by Workers AI to train AI models."* Zero data retention for standard inference. Exceptions are R2/KV/DO/Vectorize storage, AI Gateway logging/caching, and stateful/batch features. GRU will use none of them.
- ⚠️ Some catalog models need a paid billing method (examples given: kimi-k2.6, glm-5.3). Any Phase 8 model must be confirmed free-eligible before use.
- **Terms change vs spec:** none adverse found. Re-verify at the Phase 8 gate.

### A5. Google OAuth and Gmail API
Sources: https://developers.google.com/identity/protocols/oauth2, https://developers.google.com/identity/protocols/oauth2/web-server, https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification, https://support.google.com/cloud/answer/7454865, https://developers.google.com/gmail/api/auth/scopes, https://developers.google.com/gmail/api/reference/quota, https://developers.google.com/gmail/api/guides/batch

- ✅ Testing-mode refresh tokens: "issued a refresh token expiring in 7 days" unless only name/email/profile scopes are requested. This confirms the spec's reason to move the app to In production.
- ⚠️ **Canary reliability.** `refresh_token_expires_in` is documented, but as *"only set when the user grants time-based access"*. Nothing says Testing-mode tokens carry it. The spec's canary may never fire. See D-007.
- ✅ `gmail.readonly` is listed under **Restricted scopes** ("require restricted scope OAuth App Verification"; storing restricted-scope data on servers triggers a security assessment).
- ✅ **Personal-use exception:** *"if you are the only user of your app or if your app is used by only a few users, all of whom are known personally to you"*, so no verification submission is needed. An unverified app in production shows the unverified-app screen and is capped at 100 new users. GRU has 2 accounts, both Ani's. My reading is that the exception also covers the security assessment, though the page does not name CASA explicitly.
- ⚠️ **Extra revocation causes** not in the spec: a refresh token is revoked if unused for 6 months, or **when the user changes their password and the token has Gmail scopes**. A limit of 100 refresh tokens per account per client applies (the oldest is silently invalidated). Handling: these surface as `invalid_grant` → `needs_reauth`, and RUNBOOK will note "after changing a Gmail password, reconnect in GRU".
- ✅ Revoke: `POST https://oauth2.googleapis.com/revoke?token=...`; 200 means success. Revoking an access token also revokes its refresh token. (The docs only show the query-string form, so GRU uses that.)
- ✅ Gmail quota (projects created on or after 2026-05-01): 6,000 units per user per minute; messages.list = 5; messages.get = 20 (60 for format=full/raw). One tick at most is about 1 list + 12 metadata gets + a few full gets for alerts, well under 6,000.
- ⚠️ Gmail quota page notes a per-day billing threshold (80M units) with "charges ... planned later in 2026". GRU uses about 0.01% of that. Re-check quarterly.
- Batch HTTP: still supported, at most 100 calls per batch (50 recommended); quota counts each call. See D-009.

### A6. ntfy (public ntfy.sh)
Sources: https://docs.ntfy.sh/publish/, https://ntfy.sh/#pricing

- ✅ Verbatim: *"the topic is essentially a password, so pick something that's not easily guessable"*. GRU uses a 32+ char random topic, as the spec requires.
- ✅ `Click` header (alias of `X-Click`) opens a URL. Message size limit is 4,096 bytes.
- ⚠️ Read only through the fetch tool's summary, because the page is too long for verbatim retrieval: messages cached **12 h**; "all topics on ntfy.sh are public"; rate limit burst of 60 requests per visitor, refilling at 1 per 5 s; **250 messages/day** on ntfy.sh free. GRU sends about 1–6/day, so there is a large margin. Handling: Ani should spot-check the "Limitations" section of the publish docs; a 429 from ntfy is logged as `ntfy_rate_limited` and never retried in a loop.
- Privacy consequence: anyone who learns the topic can read GRU's (content-free) pings and send fake ones. That is acceptable only because messages carry no data. Spoofed pings can at worst open the app.

### A7. Tooling
- ⚠️ `wrangler@4.162.0` (latest on 2026-11-15) requires **Node >= 22.12.0**. This machine has Node 20.16.0. See D-015.

---

### A8. Cost and payment-method verification (deployment-cost check)
Sources: https://developers.cloudflare.com/workers/platform/pricing/ (Nov 13, 2026), https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ (Nov 12, 2026), https://developers.cloudflare.com/workers/observability/logs/workers-logs/ (Nov 12, 2026), https://developers.google.com/workspace/guides/create-project, https://developers.google.com/gmail/api/reference/quota, https://docs.ntfy.sh/, https://ntfy.sh/

| Component | Payment method needed? | Can it bill? | Guard in GRU |
|---|---|---|---|
| Workers Free | Not mentioned; "By default, users have access to the Workers Free plan" | Over the limit it fails (Error 1027), and no Free overage is listed | Never upgrade; SETUP step confirms there is no payment method on the Cloudflare account |
| D1 Free | No ("available on both the Workers Free and Workers Paid plans") | Over the limit, queries error | Degrade per D-011 |
| Static assets | No | "Requests to static assets are free and unlimited". ⚠️ Pricing footnote: with **Workers Caching** enabled, cache-served requests (including assets) are billed | Workers Caching is never enabled; `check:config` test |
| Cron Triggers | No | No | 1 of 5 |
| **Workers Logs** | No | Free today (200k events/day, 3-day retention). ⚠️ "Beginning **December 1, 2026**, Workers Logs will use Cloudflare Observability pricing" (not yet published). **New Workers have observability enabled by default** | **`observability.enabled = false`** set explicitly; `check:config` test. Debug with `wrangler tail`; CPU/subrequest metrics come from the dashboard's Workers metrics, not Logs (D-020) |
| workers.dev hostname | No | No | No custom domain (domains cost money) |
| R2, Workers AI paid models, Durable Objects, Queues, Access | n/a | R2 and paid models need billing | Not used; `check:config` rejects these bindings. Workers AI is Phase 8 only, after re-verification |
| Google Cloud project + Gmail API + OAuth client | ⚠️ Not stated explicitly. The guide says "Depending on the … APIs … you might also need to enable billing" | Gmail: "Usage under this threshold [80,000,000 units/day/project] doesn't incur extra charges". ⚠️ "planned to incur charges … later in 2026" with ≥90 days' notice | **Never attach a billing account and never start the GCP free trial.** With no billing account linked, there is nothing to charge. SETUP includes a check ("Billing → this project has no billing account"). GRU uses about 0.01% of the threshold |
| ntfy.sh | No ("Try ntfy for free without sign-up") | Paid tiers are optional | Content-free pings only |
| npm dependencies | No | No (open-source libraries, no SaaS) | Pinned exact |

**Conclusion (2026-11-15):** the architecture needs **no paid service, no payment method, and has no billing path**, provided the guards above hold. Two dated risks to re-check: the Workers Logs pricing change on 2026-12-01 (already neutralised by disabling it), and Gmail API threshold charges, which need a billing account we will never attach.

### A9. Argon2id CPU benchmark (local measurement, 2026-11-15)
Measured with `hash-wasm@4.12.0` (WebAssembly, the same engine family as workerd's V8) on Ani's laptop, Node 20, median of 5 wall-clock runs:

| Params | Wall time | Fits the 10 ms Workers Free CPU limit? |
|---|---|---|
| m=19 MiB, t=2, p=1 (OWASP minimum) | ~44 ms | ❌ about 4.5× over |
| m=12 MiB, t=3, p=1 (OWASP alt) | ~59 ms | ❌ |
| m=64 MiB, t=3, p=1 (RFC 9106 second recommendation) | ~209 ms | ❌ |
| m=4 MiB, t=1 | ~5 ms | ✅ but far below guidance |

The limits page says isolates have "some built-in flexibility … where your Worker infrequently runs over", without quantifying it. Consistent overruns get Error 1102. **Server-side Argon2id at a meaningful strength is not viable on Workers Free.** Ani chose client-side Argon2id (D-018).

### A10. CSP and WebAssembly
Source: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src
- ✅ "WebAssembly is blocked from loading and executing on the page" unless `script-src` includes `'wasm-unsafe-eval'` (or `'unsafe-eval'`, which GRU will never use).
- ⚠️ Browser-compatibility data did not render in the fetch. iOS Safari support for `'wasm-unsafe-eval'` must be checked on a real device during the Phase 0 walkthrough. If it fails, the fallback is a login-page-only CSP with a WASM hash/nonce approach, decided then.

### A11. Tooling and environment (2026-11-15)
- `wrangler@4.156.0` needs Node ≥ 22.0; latest `wrangler@4.162.0` needs ≥ 22.12.0. Vite 8 needs ≥ 20.19 or ≥ 22.12. Vitest 4 needs ^22.12 / ^24 / ≥26.
- Machine has **Node 20.16.0**. `winget install OpenJS.NodeJS.LTS` (resolves to **26.13.1**) failed with MSI 1603 because `node.exe` is held open by Antigravity's Stitch MCP bridge processes. Per Ani: do not kill them. Retry when Ani closes Antigravity, before any Wrangler step (D-015).

---

## Part B: Decisions

| ID | Decision | Status |
|---|---|---|
| D-001 | **App auth = single-user username + password** (Ani, 2026-11-15). Replaces both Cloudflare Access (which requires payment details at onboarding) and Google sign-in. No registration route exists. Gmail OAuth is completely separate: it only connects mailboxes, and only for an already-logged-in session. | ✅ decided |
| D-002 | No `jose`. Any JWT/HMAC work uses WebCrypto. | ✅ |
| D-003 | `SubrequestBudget(40)` counts **every** fetch and **every** D1 call (a `batch()` counts once). This is the stricter reading of the two Workers rows. | ✅ |
| D-004 | Multi-statement writes use `db.batch()`, assumed atomic. An integration test forces a mid-batch failure and asserts rollback; if that fails, writes become idempotent instead. | ✅ |
| D-005 | Field encryption: AES-256-GCM, envelope `v1.<keyid>.<iv>.<ct>`, AAD `table:column:rowid`. Rows needing an id before encryption pre-allocate it. | ✅ |
| D-006 | **Sessions are server-side** (needed for real expiry, logout and revocation). Token = 32 random bytes; cookie `__Host-gru_s`, HttpOnly, Secure, SameSite=Strict, Path=/. D1 `sessions` stores only SHA-256(token). Idle expiry 7 days, absolute expiry 30 days. `last_seen_at` is refreshed at most every 10 min to save writes. Logout deletes the row; `scripts/logout-all` and wipe delete all rows. | ✅ |
| D-007 | Token canary: keep the spec's `refresh_token_expires_in` check, plus a heuristic: `invalid_grant` 6–8 days after connect → "Google app may still be in Testing mode". SETUP makes "In production" a checkbox. | ✅ |
| D-008 | One cron, `*/15 * * * *`; `kv.tick_lock` with a 5-min expiry. | ✅ |
| D-009 | Gmail batch HTTP could cut about 12 subrequests to 1 per account per tick. Evaluate with a CPU benchmark in Phase 2; adopt only with Ani's approval. | deferred to Phase 2 |
| D-010 | Static assets binding with SPA fallback and **`run_worker_first: true`**: every request (assets included) passes through the Worker so security headers are guaranteed and tested in one place. Cost: each asset request counts toward the 100k/day Worker requests, which is negligible for one user. If the daily limit is hit, the Worker returns 429 instead of serving assets. | ✅ |
| D-011 | Daily-cap fallback: a D1 error ends the tick quietly; the next successful brief reports it; never retry in a loop. | ✅ |
| D-012 | `log(event, fields)` with an allowlist; ESLint `no-console` outside `log/`. | ✅ |
| D-013 | Wipe wording: GRU makes data **immediately inaccessible through GRU** and deletes all live rows and keys. It does **not** claim historical copies are destroyed: D1 Time Travel can keep restorable history for **up to 7 days** on Free. See PRIVACY.md. | ✅ |
| D-014 | Real Gmail addresses, the username, the password verifier and keys are never in the repo. | ✅ |
| D-015 | Node: system Node 20.16 is kept untouched (Antigravity/Stitch MCP use it). GRU uses **Node 24.22.3 LTS via fnm 1.39.0** (D-030). Stitch MCP did **not** need stopping: fnm installs under the user profile and never touches `C:Program Files
odejs
ode.exe`. | ✅ done 2026-11-15 |
| D-016 | **Calendar/tasks = option B** (Ani, 2026-11-15). GRU's own tasks and agenda ship with Notes in Phase 6: due date/time, priority, completion, interview and phone-call reminders, daily agenda, upcoming list, morning-brief integration, links to notes and applications. **No Google Calendar** in the initial build; a read-only Google Calendar phase stays a possible future option. | ✅ decided |
| D-017 | Persona: app named GRU and addresses the user as "Ani" in UI copy. Notifications remain fixed constant strings with no name and no content. | ✅ |
| D-018 | **Client-side Argon2id ("server relief")** (Ani, 2026-11-15). The login page derives `P = Argon2id(password, salt, m=64 MiB, t=3, p=1, 32 B)` in WebAssembly and posts it. The Worker stores only `V = SHA-256(P)` (in the secret `AUTH_VERIFIER`, not D1) and compares in constant time, in under 1 ms of CPU. An offline attacker holding `V` must pay a full Argon2id per guess, the same as server-side hashing. `P` is password-equivalent in transit, protected by TLS like a password. `/auth/params` returns the salt; for unknown usernames it returns a deterministic fake salt (HMAC of the username) so it doesn't reveal which usernames exist. | ✅ decided |
| D-019 | **Login rate limiting** in D1 table `login_attempts`, checked *before* any verification work. Per-client bucket (keyed by HMAC of `CF-Connecting-IP`, never the raw IP): 5 failures / 15 min → locked 15 min, doubling per repeat up to 24 h. Global bucket: 20 failures / hour → all logins locked 1 h (stops distributed guessing). Trade-off: an attacker can lock Ani out for up to an hour; recovery is documented in RUNBOOK §3. Locked responses are `429` + `Retry-After`; wrong credentials are a generic `401`. | ✅ |
| D-020 | `observability.enabled = false` in wrangler config (Workers Logs pricing changes 2026-12-01, and new Workers default to enabled). | ✅ |
| D-021 | Login page only: CSP adds `script-src 'self' 'wasm-unsafe-eval'`. All other responses keep the spec's CSP unchanged. | ✅ |
| D-022 | **Gmail authorisation loss** (Ani, item 6): on `invalid_grant` or a revoked or expired token, set the account to `needs_reauth` and stop syncing that account (other accounts continue). Show a red "Reconnect Gmail" status on Today + Settings and in the brief health line; send ntfy `action_needed` at most once per day. Reconnect re-runs OAuth and resumes from the stored cursor. RUNBOOK documents that changing a Google password revokes Gmail tokens. Built in Phase 2; documented now. | ✅ |
| D-023 | Repo moved to `C:\dev\GRU` (outside OneDrive). The OneDrive copy is removed only after the copy is verified with `npm test` green (waits on D-015). | in progress |
| D-024 | Schema additions for auth go in a new migration `0002_auth.sql` (`sessions`, `login_attempts`), so `0001_init.sql` stays the spec's schema verbatim. | ✅ |
| D-025 | In-app wipe empties tables with `DELETE FROM` every table (discovered from `sqlite_master`; D1 internals excluded) in **one atomic batch**, instead of DROP + CREATE. Same acceptance result (all tables exist and are empty) without duplicating the schema in Worker code, and future migrations are covered automatically. Neither approach securely erases SQLite free pages; PRIVACY §6 makes no such claim. | ✅ |
| D-026 | `@cloudflare/vitest-pool-workers` is **deprecated** (renamed). GRU uses `@cloudflare/vitest-plugin@1.4.11` (bundles wrangler 4.156.0, the same as our pin). | ✅ |
| D-027 | Single root `package.json` (no npm workspaces). The `apps/worker`, `apps/web` and `scripts` folders keep the spec layout; one lockfile is simpler to audit. | ✅ |
| D-028 | **Two tool lanes** (Ani: no silent downgrades). Root = Node 20 lane: hono, zod, hash-wasm, TypeScript 6, types; unit tests on built-in `node:test` (compiled by `tsc`, so no extra dependency); a dependency-free console-ban check stands in for ESLint `no-console`. `toolchain/` = Node 22 lane with its own package.json and lockfile: Wrangler, @cloudflare/vitest-plugin, Vitest, Vite, ESLint + typescript-eslint. It is not installed until Node 22 is available. Reason: typescript-eslint 8.72.1 declares Node ^20.9 but pulls `eslint-visitor-keys@5` (^20.19), Vite 8 needs ^20.19, and Wrangler/Miniflare need ≥ 22. All relative imports use explicit `.ts` extensions so one source tree serves both lanes. | ✅ |
| D-029 | **Security pin: hono 4.13.14 → 4.13.16** (2026-11-15). `npm audit` flagged 5 moderate advisories in hono ≤ 4.13.15, including GHSA-h7mg-cq63-vhpq (RegExpRouter can skip wildcard middleware; GRU's auth gate is wildcard middleware). 4.13.16 (published 2026-11-01) is the first fixed release and meets the ≥ 2-weeks-old rule. `npm audit` now reports 0 vulnerabilities. A Node 20 auth-gate test was added as a regression guard. It does **not** reproduce the advisory against GRU's routes (it also passes on 4.13.14), so the version pin is the actual fix. | ✅ |
| D-030 | **Node 24.22.3 LTS ("Krypton") via fnm**, pinned in `.node-version` (root and `toolchain/`). Chosen over 26.x, which had only 2 LTS releases on 2026-11-15; 24 is supported until 2028-04 and meets every toolchain floor (Wrangler ≥ 22, Vite ≥ 22.12, Vitest ≥ 24). fnm only activates in shells that run `fnm env`, so the system PATH (and Antigravity) still resolve Node 20. The root lane is verified on both 20.16 and 24.22.3. | ✅ |
| D-031 | npm 11 blocks dependency install scripts by default. Approved exactly two in `toolchain/package.json` → `allowScripts`: `esbuild@0.28.2` and `workerd@1.20261023.1`. Both are the official packages; their postinstall only selects or verifies the platform binary already fetched as an optional dependency. Any other script stays blocked. | ✅ |
| D-032 | `compatibility_date` 2026-11-01 → **2026-10-23**. The pinned workerd binary (from wrangler 4.156.0) supports dates only up to 2026-10-30, and workerd refused to start. Production accepts any past date; no flags differ in that window for GRU. | ✅ |
| D-033 | ESLint runs from the repo root (`cd .. && eslint --config toolchain/eslint.config.js --max-warnings 0 .`). Run from `toolchain/`, ESLint 9 silently linted only the 16 files in that folder. Now 64 files (apps, scripts, both test suites) are linted. Plain `.mjs` helpers declare their Node globals explicitly (no `globals` dependency). | ✅ |
| D-034 | Dev-only `minimatch` < 11.0.1 advisory (GHSA-g3hv-75wg-m249) via typescript-eslint: **accepted and documented** (Ani took the recommended default, 2026-11-15). It never ships in the Worker or web bundles and only reads our own globs. Re-check with `npm run upgrade-check`; no `overrides` hack. | ✅ |
| D-035 | **One package again.** With Node 24 via fnm, the two lanes (D-028) were merged: root `package.json` (engines ≥ 22.12), configs at the root, tests in `test/unit`, `test/integration`, `test/e2e`. React/Vite/Tailwind/Vitest resolve from one `node_modules`. `toolchain/` removed. | ✅ |
| D-036 | Frontend runtime deps (bundled into the static app, never the Worker): `react`/`react-dom` 19.1.10, `react-router` 7.18.5, `@tanstack/react-query` 5.105.0 (spec §4 stack), `@fontsource-variable/inter` 5.3.0 (OFL, self-hosted, no CDN; only the Latin subset, 48 KB, downloads for English pages). Build-only: `vite`, `@vitejs/plugin-react` 6.1.2, `tailwindcss` + `@tailwindcss/vite` 4.3.3, `@playwright/test` 1.64.1. All published ≥ 2 weeks before use. | ✅ |
| D-037 | Typeface **Inter**, self-hosted (Ani's default from the design review; spec said system fonts). Fallback stack: system-ui. | ✅ |
| D-038 | Lighthouse 12 removed its PWA category, so the gate “Lighthouse PWA installable” is verified with Chrome's own installability check (`Page.getInstallabilityErrors` via CDP = no errors) in Playwright, plus manifest and icon fetches. | ✅ |
| D-039 | wrangler 4.156 env files go through dotenv-expand 13, which expands `$name` even inside quotes. `AUTH_VERIFIER` (`gru1$argon2id$…`) must have every `# GRU: Decisions and verified findings

Findings were read from official documentation on **2026-11-15** unless stated otherwise. Every number in SPEC.md is a hypothesis; this file records what was actually verified. Re-verify quarterly (RUNBOOK.md §9).

Status legend:
- ✅ confirms the spec
- ⚠️ differs from the spec or is ambiguous, with handling noted
- ⛔ blocked or awaiting Ani

---

## Part A: Verified platform facts

### A1. Cloudflare Workers, Free plan
Source: https://developers.cloudflare.com/workers/platform/limits/ (page "Last updated Nov 13, 2026")

| Item | Spec hypothesis | Verified | Status |
|---|---|---|---|
| Requests/day | 100,000 | 100,000, reset at 00:00 UTC. Over the limit: Error 1027 (fail open or fail closed, configured per route) | ✅ |
| CPU per invocation | 10 ms | 10 ms per HTTP request **and per Cron Trigger**. Network wait (fetch, D1, KV) does not count. Over the limit: Error 1102 | ✅ |
| Cron wall time | n/a | 15 min per Cron Trigger | ✅ (not a constraint) |
| Memory | 128 MB | 128 MB per isolate | ✅ |
| Subrequests | 50, including D1 | 50 per invocation, defined as "Fetch API or ... Cloudflare services like R2, KV, or D1". A separate row lists "Subrequests to internal services: 1,000" on Free | ⚠️ see D-003 |
| Simultaneous open connections | n/a | 6 per invocation | ⚠️ cap fetch concurrency at 6 |
| Cron Triggers per account | n/a | 5 | ✅ GRU uses 1 |
| Worker size | n/a | 64 MiB uncompressed | ✅ |
| Env vars + secrets | n/a | 64 per Worker, 5 KB each | ✅ GRU uses about 10 |
| Startup time | n/a | 1 s | ✅ keep top-level init trivial |

### A2. Cloudflare D1, Free plan
Sources: https://developers.cloudflare.com/d1/platform/limits/ (Oct 30, 2026), https://developers.cloudflare.com/d1/platform/pricing/ (Oct 30, 2026), https://developers.cloudflare.com/d1/worker-api/d1-database/ (Jun 22, 2026), https://developers.cloudflare.com/d1/reference/time-travel/ (Nov 6, 2026)

| Item | Spec hypothesis | Verified | Status |
|---|---|---|---|
| Storage | 5 GB total | 5 GB per account, but **500 MB per database** | ⚠️ GRU's data is tiny, so 500 MB is ample. Recorded so it is not mistaken for 5 GB |
| Databases | n/a | 10 per account | ✅ |
| Rows read/day | 5M | 5,000,000 | ✅ |
| Rows written/day | 100k | 100,000 | ✅ |
| Reset | n/a | "Free daily usage limits reset at 00:00 UTC", which is 12:00 or 13:00 Auckland time | ✅ |
| Over limit | requests fail | "you will not be able to run queries against D1. D1 API will return errors" | ✅ see D-011 |
| Queries per invocation | n/a | 50 on Free. "a `db.batch()` call counts as a single query against it, not one query per statement" | ✅ see D-003 |
| Batch semantics | n/a | "Batched statements are SQL transactions ... it aborts or rolls back the entire sequence". The same section also mentions auto-commit | ⚠️ treated as atomic; an integration test asserts rollback (D-004) |
| Bound params per query | n/a | 100 | ⚠️ the emails_seen diff (`IN (...)` with up to 25 ids) fits; chunk anything larger |
| Statement length | n/a | 100 KB | ✅ |
| Time Travel (PITR) | "check and record" | **7 days on Free** (30 on Paid). The intro text says 30 days without naming a plan; the Notes section and the limits page both say 7 for Free | ⚠️ after a wipe, D1 history stays restorable by the account owner for up to 7 days. This goes in PRIVACY.md and the wipe checklist (D-013) |

### A3. Cloudflare Access / Zero Trust
Sources: https://developers.cloudflare.com/cloudflare-one/setup/, https://www.cloudflare.com/plans/zero-trust-services/, https://developers.cloudflare.com/workers/configuration/routing/workers-dev/, https://developers.cloudflare.com/workers/configuration/cloudflare-access/, https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

- ⚠️ **Payment method** (now moot, see D-001). The setup docs say: *"Complete your onboarding by selecting a subscription plan and entering your payment details. If you chose the Zero Trust Free plan, this step is still needed but you will not be charged."* Entering payment details violates spec rule 4. Per spec §7 we stop and ask. See D-001.
- ✅ Access can protect a `workers.dev` URL with no custom domain (Worker → Access tab → "Protect this Worker behind Access").
- JWT: JWKS at `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`; RS256; select the key by `kid` from `public_certs`; validate `aud` (the application AUD tag) and `iss` (the team domain). Keys rotate every 6 weeks, and old keys stay valid for 7 days.
- ⚠️ `ctx.access` is not passed to the user Worker by Static Assets routers, so if Access is ever used, GRU verifies the header JWT itself.
- ⚠️ The "50 users" Free-plan figure was not found on any page read. It is irrelevant for a single user.

### A4. Cloudflare Workers AI (Phase 8 only)
Sources: https://developers.cloudflare.com/workers-ai/platform/pricing/ (Nov 12, 2026), https://developers.cloudflare.com/workers-ai/platform/data-usage/ (Oct 16, 2026)

- ✅ Free allocation: 10,000 Neurons/day, reset at 00:00 UTC. On Workers Free, going over means "further operations will fail with an error"; overage pricing is only available on Workers Paid.
- ✅ Data: *"Cloudflare does not use Customer Content processed by Workers AI to train AI models."* Zero data retention for standard inference. Exceptions are R2/KV/DO/Vectorize storage, AI Gateway logging/caching, and stateful/batch features. GRU will use none of them.
- ⚠️ Some catalog models need a paid billing method (examples given: kimi-k2.6, glm-5.3). Any Phase 8 model must be confirmed free-eligible before use.
- **Terms change vs spec:** none adverse found. Re-verify at the Phase 8 gate.

### A5. Google OAuth and Gmail API
Sources: https://developers.google.com/identity/protocols/oauth2, https://developers.google.com/identity/protocols/oauth2/web-server, https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification, https://support.google.com/cloud/answer/7454865, https://developers.google.com/gmail/api/auth/scopes, https://developers.google.com/gmail/api/reference/quota, https://developers.google.com/gmail/api/guides/batch

- ✅ Testing-mode refresh tokens: "issued a refresh token expiring in 7 days" unless only name/email/profile scopes are requested. This confirms the spec's reason to move the app to In production.
- ⚠️ **Canary reliability.** `refresh_token_expires_in` is documented, but as *"only set when the user grants time-based access"*. Nothing says Testing-mode tokens carry it. The spec's canary may never fire. See D-007.
- ✅ `gmail.readonly` is listed under **Restricted scopes** ("require restricted scope OAuth App Verification"; storing restricted-scope data on servers triggers a security assessment).
- ✅ **Personal-use exception:** *"if you are the only user of your app or if your app is used by only a few users, all of whom are known personally to you"*, so no verification submission is needed. An unverified app in production shows the unverified-app screen and is capped at 100 new users. GRU has 2 accounts, both Ani's. My reading is that the exception also covers the security assessment, though the page does not name CASA explicitly.
- ⚠️ **Extra revocation causes** not in the spec: a refresh token is revoked if unused for 6 months, or **when the user changes their password and the token has Gmail scopes**. A limit of 100 refresh tokens per account per client applies (the oldest is silently invalidated). Handling: these surface as `invalid_grant` → `needs_reauth`, and RUNBOOK will note "after changing a Gmail password, reconnect in GRU".
- ✅ Revoke: `POST https://oauth2.googleapis.com/revoke?token=...`; 200 means success. Revoking an access token also revokes its refresh token. (The docs only show the query-string form, so GRU uses that.)
- ✅ Gmail quota (projects created on or after 2026-05-01): 6,000 units per user per minute; messages.list = 5; messages.get = 20 (60 for format=full/raw). One tick at most is about 1 list + 12 metadata gets + a few full gets for alerts, well under 6,000.
- ⚠️ Gmail quota page notes a per-day billing threshold (80M units) with "charges ... planned later in 2026". GRU uses about 0.01% of that. Re-check quarterly.
- Batch HTTP: still supported, at most 100 calls per batch (50 recommended); quota counts each call. See D-009.

### A6. ntfy (public ntfy.sh)
Sources: https://docs.ntfy.sh/publish/, https://ntfy.sh/#pricing

- ✅ Verbatim: *"the topic is essentially a password, so pick something that's not easily guessable"*. GRU uses a 32+ char random topic, as the spec requires.
- ✅ `Click` header (alias of `X-Click`) opens a URL. Message size limit is 4,096 bytes.
- ⚠️ Read only through the fetch tool's summary, because the page is too long for verbatim retrieval: messages cached **12 h**; "all topics on ntfy.sh are public"; rate limit burst of 60 requests per visitor, refilling at 1 per 5 s; **250 messages/day** on ntfy.sh free. GRU sends about 1–6/day, so there is a large margin. Handling: Ani should spot-check the "Limitations" section of the publish docs; a 429 from ntfy is logged as `ntfy_rate_limited` and never retried in a loop.
- Privacy consequence: anyone who learns the topic can read GRU's (content-free) pings and send fake ones. That is acceptable only because messages carry no data. Spoofed pings can at worst open the app.

### A7. Tooling
- ⚠️ `wrangler@4.162.0` (latest on 2026-11-15) requires **Node >= 22.12.0**. This machine has Node 20.16.0. See D-015.

---

### A8. Cost and payment-method verification (deployment-cost check)
Sources: https://developers.cloudflare.com/workers/platform/pricing/ (Nov 13, 2026), https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ (Nov 12, 2026), https://developers.cloudflare.com/workers/observability/logs/workers-logs/ (Nov 12, 2026), https://developers.google.com/workspace/guides/create-project, https://developers.google.com/gmail/api/reference/quota, https://docs.ntfy.sh/, https://ntfy.sh/

| Component | Payment method needed? | Can it bill? | Guard in GRU |
|---|---|---|---|
| Workers Free | Not mentioned; "By default, users have access to the Workers Free plan" | Over the limit it fails (Error 1027), and no Free overage is listed | Never upgrade; SETUP step confirms there is no payment method on the Cloudflare account |
| D1 Free | No ("available on both the Workers Free and Workers Paid plans") | Over the limit, queries error | Degrade per D-011 |
| Static assets | No | "Requests to static assets are free and unlimited". ⚠️ Pricing footnote: with **Workers Caching** enabled, cache-served requests (including assets) are billed | Workers Caching is never enabled; `check:config` test |
| Cron Triggers | No | No | 1 of 5 |
| **Workers Logs** | No | Free today (200k events/day, 3-day retention). ⚠️ "Beginning **December 1, 2026**, Workers Logs will use Cloudflare Observability pricing" (not yet published). **New Workers have observability enabled by default** | **`observability.enabled = false`** set explicitly; `check:config` test. Debug with `wrangler tail`; CPU/subrequest metrics come from the dashboard's Workers metrics, not Logs (D-020) |
| workers.dev hostname | No | No | No custom domain (domains cost money) |
| R2, Workers AI paid models, Durable Objects, Queues, Access | n/a | R2 and paid models need billing | Not used; `check:config` rejects these bindings. Workers AI is Phase 8 only, after re-verification |
| Google Cloud project + Gmail API + OAuth client | ⚠️ Not stated explicitly. The guide says "Depending on the … APIs … you might also need to enable billing" | Gmail: "Usage under this threshold [80,000,000 units/day/project] doesn't incur extra charges". ⚠️ "planned to incur charges … later in 2026" with ≥90 days' notice | **Never attach a billing account and never start the GCP free trial.** With no billing account linked, there is nothing to charge. SETUP includes a check ("Billing → this project has no billing account"). GRU uses about 0.01% of the threshold |
| ntfy.sh | No ("Try ntfy for free without sign-up") | Paid tiers are optional | Content-free pings only |
| npm dependencies | No | No (open-source libraries, no SaaS) | Pinned exact |

**Conclusion (2026-11-15):** the architecture needs **no paid service, no payment method, and has no billing path**, provided the guards above hold. Two dated risks to re-check: the Workers Logs pricing change on 2026-12-01 (already neutralised by disabling it), and Gmail API threshold charges, which need a billing account we will never attach.

### A9. Argon2id CPU benchmark (local measurement, 2026-11-15)
Measured with `hash-wasm@4.12.0` (WebAssembly, the same engine family as workerd's V8) on Ani's laptop, Node 20, median of 5 wall-clock runs:

| Params | Wall time | Fits the 10 ms Workers Free CPU limit? |
|---|---|---|
| m=19 MiB, t=2, p=1 (OWASP minimum) | ~44 ms | ❌ about 4.5× over |
| m=12 MiB, t=3, p=1 (OWASP alt) | ~59 ms | ❌ |
| m=64 MiB, t=3, p=1 (RFC 9106 second recommendation) | ~209 ms | ❌ |
| m=4 MiB, t=1 | ~5 ms | ✅ but far below guidance |

The limits page says isolates have "some built-in flexibility … where your Worker infrequently runs over", without quantifying it. Consistent overruns get Error 1102. **Server-side Argon2id at a meaningful strength is not viable on Workers Free.** Ani chose client-side Argon2id (D-018).

### A10. CSP and WebAssembly
Source: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src
- ✅ "WebAssembly is blocked from loading and executing on the page" unless `script-src` includes `'wasm-unsafe-eval'` (or `'unsafe-eval'`, which GRU will never use).
- ⚠️ Browser-compatibility data did not render in the fetch. iOS Safari support for `'wasm-unsafe-eval'` must be checked on a real device during the Phase 0 walkthrough. If it fails, the fallback is a login-page-only CSP with a WASM hash/nonce approach, decided then.

### A11. Tooling and environment (2026-11-15)
- `wrangler@4.156.0` needs Node ≥ 22.0; latest `wrangler@4.162.0` needs ≥ 22.12.0. Vite 8 needs ≥ 20.19 or ≥ 22.12. Vitest 4 needs ^22.12 / ^24 / ≥26.
- Machine has **Node 20.16.0**. `winget install OpenJS.NodeJS.LTS` (resolves to **26.13.1**) failed with MSI 1603 because `node.exe` is held open by Antigravity's Stitch MCP bridge processes. Per Ani: do not kill them. Retry when Ani closes Antigravity, before any Wrangler step (D-015).

---

## Part B: Decisions

| ID | Decision | Status |
|---|---|---|
| D-001 | **App auth = single-user username + password** (Ani, 2026-11-15). Replaces both Cloudflare Access (which requires payment details at onboarding) and Google sign-in. No registration route exists. Gmail OAuth is completely separate: it only connects mailboxes, and only for an already-logged-in session. | ✅ decided |
| D-002 | No `jose`. Any JWT/HMAC work uses WebCrypto. | ✅ |
| D-003 | `SubrequestBudget(40)` counts **every** fetch and **every** D1 call (a `batch()` counts once). This is the stricter reading of the two Workers rows. | ✅ |
| D-004 | Multi-statement writes use `db.batch()`, assumed atomic. An integration test forces a mid-batch failure and asserts rollback; if that fails, writes become idempotent instead. | ✅ |
| D-005 | Field encryption: AES-256-GCM, envelope `v1.<keyid>.<iv>.<ct>`, AAD `table:column:rowid`. Rows needing an id before encryption pre-allocate it. | ✅ |
| D-006 | **Sessions are server-side** (needed for real expiry, logout and revocation). Token = 32 random bytes; cookie `__Host-gru_s`, HttpOnly, Secure, SameSite=Strict, Path=/. D1 `sessions` stores only SHA-256(token). Idle expiry 7 days, absolute expiry 30 days. `last_seen_at` is refreshed at most every 10 min to save writes. Logout deletes the row; `scripts/logout-all` and wipe delete all rows. | ✅ |
| D-007 | Token canary: keep the spec's `refresh_token_expires_in` check, plus a heuristic: `invalid_grant` 6–8 days after connect → "Google app may still be in Testing mode". SETUP makes "In production" a checkbox. | ✅ |
| D-008 | One cron, `*/15 * * * *`; `kv.tick_lock` with a 5-min expiry. | ✅ |
| D-009 | Gmail batch HTTP could cut about 12 subrequests to 1 per account per tick. Evaluate with a CPU benchmark in Phase 2; adopt only with Ani's approval. | deferred to Phase 2 |
| D-010 | Static assets binding with SPA fallback and **`run_worker_first: true`**: every request (assets included) passes through the Worker so security headers are guaranteed and tested in one place. Cost: each asset request counts toward the 100k/day Worker requests, which is negligible for one user. If the daily limit is hit, the Worker returns 429 instead of serving assets. | ✅ |
| D-011 | Daily-cap fallback: a D1 error ends the tick quietly; the next successful brief reports it; never retry in a loop. | ✅ |
| D-012 | `log(event, fields)` with an allowlist; ESLint `no-console` outside `log/`. | ✅ |
| D-013 | Wipe wording: GRU makes data **immediately inaccessible through GRU** and deletes all live rows and keys. It does **not** claim historical copies are destroyed: D1 Time Travel can keep restorable history for **up to 7 days** on Free. See PRIVACY.md. | ✅ |
| D-014 | Real Gmail addresses, the username, the password verifier and keys are never in the repo. | ✅ |
| D-015 | Node: system Node 20.16 is kept untouched (Antigravity/Stitch MCP use it). GRU uses **Node 24.22.3 LTS via fnm 1.39.0** (D-030). Stitch MCP did **not** need stopping: fnm installs under the user profile and never touches `C:Program Files
odejs
ode.exe`. | ✅ done 2026-11-15 |
| D-016 | **Calendar/tasks = option B** (Ani, 2026-11-15). GRU's own tasks and agenda ship with Notes in Phase 6: due date/time, priority, completion, interview and phone-call reminders, daily agenda, upcoming list, morning-brief integration, links to notes and applications. **No Google Calendar** in the initial build; a read-only Google Calendar phase stays a possible future option. | ✅ decided |
| D-017 | Persona: app named GRU and addresses the user as "Ani" in UI copy. Notifications remain fixed constant strings with no name and no content. | ✅ |
| D-018 | **Client-side Argon2id ("server relief")** (Ani, 2026-11-15). The login page derives `P = Argon2id(password, salt, m=64 MiB, t=3, p=1, 32 B)` in WebAssembly and posts it. The Worker stores only `V = SHA-256(P)` (in the secret `AUTH_VERIFIER`, not D1) and compares in constant time, in under 1 ms of CPU. An offline attacker holding `V` must pay a full Argon2id per guess, the same as server-side hashing. `P` is password-equivalent in transit, protected by TLS like a password. `/auth/params` returns the salt; for unknown usernames it returns a deterministic fake salt (HMAC of the username) so it doesn't reveal which usernames exist. | ✅ decided |
| D-019 | **Login rate limiting** in D1 table `login_attempts`, checked *before* any verification work. Per-client bucket (keyed by HMAC of `CF-Connecting-IP`, never the raw IP): 5 failures / 15 min → locked 15 min, doubling per repeat up to 24 h. Global bucket: 20 failures / hour → all logins locked 1 h (stops distributed guessing). Trade-off: an attacker can lock Ani out for up to an hour; recovery is documented in RUNBOOK §3. Locked responses are `429` + `Retry-After`; wrong credentials are a generic `401`. | ✅ |
| D-020 | `observability.enabled = false` in wrangler config (Workers Logs pricing changes 2026-12-01, and new Workers default to enabled). | ✅ |
| D-021 | Login page only: CSP adds `script-src 'self' 'wasm-unsafe-eval'`. All other responses keep the spec's CSP unchanged. | ✅ |
| D-022 | **Gmail authorisation loss** (Ani, item 6): on `invalid_grant` or a revoked or expired token, set the account to `needs_reauth` and stop syncing that account (other accounts continue). Show a red "Reconnect Gmail" status on Today + Settings and in the brief health line; send ntfy `action_needed` at most once per day. Reconnect re-runs OAuth and resumes from the stored cursor. RUNBOOK documents that changing a Google password revokes Gmail tokens. Built in Phase 2; documented now. | ✅ |
| D-023 | Repo moved to `C:\dev\GRU` (outside OneDrive). The OneDrive copy is removed only after the copy is verified with `npm test` green (waits on D-015). | in progress |
| D-024 | Schema additions for auth go in a new migration `0002_auth.sql` (`sessions`, `login_attempts`), so `0001_init.sql` stays the spec's schema verbatim. | ✅ |
| D-025 | In-app wipe empties tables with `DELETE FROM` every table (discovered from `sqlite_master`; D1 internals excluded) in **one atomic batch**, instead of DROP + CREATE. Same acceptance result (all tables exist and are empty) without duplicating the schema in Worker code, and future migrations are covered automatically. Neither approach securely erases SQLite free pages; PRIVACY §6 makes no such claim. | ✅ |
| D-026 | `@cloudflare/vitest-pool-workers` is **deprecated** (renamed). GRU uses `@cloudflare/vitest-plugin@1.4.11` (bundles wrangler 4.156.0, the same as our pin). | ✅ |
| D-027 | Single root `package.json` (no npm workspaces). The `apps/worker`, `apps/web` and `scripts` folders keep the spec layout; one lockfile is simpler to audit. | ✅ |
| D-028 | **Two tool lanes** (Ani: no silent downgrades). Root = Node 20 lane: hono, zod, hash-wasm, TypeScript 6, types; unit tests on built-in `node:test` (compiled by `tsc`, so no extra dependency); a dependency-free console-ban check stands in for ESLint `no-console`. `toolchain/` = Node 22 lane with its own package.json and lockfile: Wrangler, @cloudflare/vitest-plugin, Vitest, Vite, ESLint + typescript-eslint. It is not installed until Node 22 is available. Reason: typescript-eslint 8.72.1 declares Node ^20.9 but pulls `eslint-visitor-keys@5` (^20.19), Vite 8 needs ^20.19, and Wrangler/Miniflare need ≥ 22. All relative imports use explicit `.ts` extensions so one source tree serves both lanes. | ✅ |
| D-029 | **Security pin: hono 4.13.14 → 4.13.16** (2026-11-15). `npm audit` flagged 5 moderate advisories in hono ≤ 4.13.15, including GHSA-h7mg-cq63-vhpq (RegExpRouter can skip wildcard middleware; GRU's auth gate is wildcard middleware). 4.13.16 (published 2026-11-01) is the first fixed release and meets the ≥ 2-weeks-old rule. `npm audit` now reports 0 vulnerabilities. A Node 20 auth-gate test was added as a regression guard. It does **not** reproduce the advisory against GRU's routes (it also passes on 4.13.14), so the version pin is the actual fix. | ✅ |
| D-030 | **Node 24.22.3 LTS ("Krypton") via fnm**, pinned in `.node-version` (root and `toolchain/`). Chosen over 26.x, which had only 2 LTS releases on 2026-11-15; 24 is supported until 2028-04 and meets every toolchain floor (Wrangler ≥ 22, Vite ≥ 22.12, Vitest ≥ 24). fnm only activates in shells that run `fnm env`, so the system PATH (and Antigravity) still resolve Node 20. The root lane is verified on both 20.16 and 24.22.3. | ✅ |
| D-031 | npm 11 blocks dependency install scripts by default. Approved exactly two in `toolchain/package.json` → `allowScripts`: `esbuild@0.28.2` and `workerd@1.20261023.1`. Both are the official packages; their postinstall only selects or verifies the platform binary already fetched as an optional dependency. Any other script stays blocked. | ✅ |
| D-032 | `compatibility_date` 2026-11-01 → **2026-10-23**. The pinned workerd binary (from wrangler 4.156.0) supports dates only up to 2026-10-30, and workerd refused to start. Production accepts any past date; no flags differ in that window for GRU. | ✅ |
| D-033 | ESLint runs from the repo root (`cd .. && eslint --config toolchain/eslint.config.js --max-warnings 0 .`). Run from `toolchain/`, ESLint 9 silently linted only the 16 files in that folder. Now 64 files (apps, scripts, both test suites) are linted. Plain `.mjs` helpers declare their Node globals explicitly (no `globals` dependency). | ✅ |
 written as `# GRU: Decisions and verified findings

Findings were read from official documentation on **2026-11-15** unless stated otherwise. Every number in SPEC.md is a hypothesis; this file records what was actually verified. Re-verify quarterly (RUNBOOK.md §9).

Status legend:
- ✅ confirms the spec
- ⚠️ differs from the spec or is ambiguous, with handling noted
- ⛔ blocked or awaiting Ani

---

## Part A: Verified platform facts

### A1. Cloudflare Workers, Free plan
Source: https://developers.cloudflare.com/workers/platform/limits/ (page "Last updated Nov 13, 2026")

| Item | Spec hypothesis | Verified | Status |
|---|---|---|---|
| Requests/day | 100,000 | 100,000, reset at 00:00 UTC. Over the limit: Error 1027 (fail open or fail closed, configured per route) | ✅ |
| CPU per invocation | 10 ms | 10 ms per HTTP request **and per Cron Trigger**. Network wait (fetch, D1, KV) does not count. Over the limit: Error 1102 | ✅ |
| Cron wall time | n/a | 15 min per Cron Trigger | ✅ (not a constraint) |
| Memory | 128 MB | 128 MB per isolate | ✅ |
| Subrequests | 50, including D1 | 50 per invocation, defined as "Fetch API or ... Cloudflare services like R2, KV, or D1". A separate row lists "Subrequests to internal services: 1,000" on Free | ⚠️ see D-003 |
| Simultaneous open connections | n/a | 6 per invocation | ⚠️ cap fetch concurrency at 6 |
| Cron Triggers per account | n/a | 5 | ✅ GRU uses 1 |
| Worker size | n/a | 64 MiB uncompressed | ✅ |
| Env vars + secrets | n/a | 64 per Worker, 5 KB each | ✅ GRU uses about 10 |
| Startup time | n/a | 1 s | ✅ keep top-level init trivial |

### A2. Cloudflare D1, Free plan
Sources: https://developers.cloudflare.com/d1/platform/limits/ (Oct 30, 2026), https://developers.cloudflare.com/d1/platform/pricing/ (Oct 30, 2026), https://developers.cloudflare.com/d1/worker-api/d1-database/ (Jun 22, 2026), https://developers.cloudflare.com/d1/reference/time-travel/ (Nov 6, 2026)

| Item | Spec hypothesis | Verified | Status |
|---|---|---|---|
| Storage | 5 GB total | 5 GB per account, but **500 MB per database** | ⚠️ GRU's data is tiny, so 500 MB is ample. Recorded so it is not mistaken for 5 GB |
| Databases | n/a | 10 per account | ✅ |
| Rows read/day | 5M | 5,000,000 | ✅ |
| Rows written/day | 100k | 100,000 | ✅ |
| Reset | n/a | "Free daily usage limits reset at 00:00 UTC", which is 12:00 or 13:00 Auckland time | ✅ |
| Over limit | requests fail | "you will not be able to run queries against D1. D1 API will return errors" | ✅ see D-011 |
| Queries per invocation | n/a | 50 on Free. "a `db.batch()` call counts as a single query against it, not one query per statement" | ✅ see D-003 |
| Batch semantics | n/a | "Batched statements are SQL transactions ... it aborts or rolls back the entire sequence". The same section also mentions auto-commit | ⚠️ treated as atomic; an integration test asserts rollback (D-004) |
| Bound params per query | n/a | 100 | ⚠️ the emails_seen diff (`IN (...)` with up to 25 ids) fits; chunk anything larger |
| Statement length | n/a | 100 KB | ✅ |
| Time Travel (PITR) | "check and record" | **7 days on Free** (30 on Paid). The intro text says 30 days without naming a plan; the Notes section and the limits page both say 7 for Free | ⚠️ after a wipe, D1 history stays restorable by the account owner for up to 7 days. This goes in PRIVACY.md and the wipe checklist (D-013) |

### A3. Cloudflare Access / Zero Trust
Sources: https://developers.cloudflare.com/cloudflare-one/setup/, https://www.cloudflare.com/plans/zero-trust-services/, https://developers.cloudflare.com/workers/configuration/routing/workers-dev/, https://developers.cloudflare.com/workers/configuration/cloudflare-access/, https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

- ⚠️ **Payment method** (now moot, see D-001). The setup docs say: *"Complete your onboarding by selecting a subscription plan and entering your payment details. If you chose the Zero Trust Free plan, this step is still needed but you will not be charged."* Entering payment details violates spec rule 4. Per spec §7 we stop and ask. See D-001.
- ✅ Access can protect a `workers.dev` URL with no custom domain (Worker → Access tab → "Protect this Worker behind Access").
- JWT: JWKS at `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`; RS256; select the key by `kid` from `public_certs`; validate `aud` (the application AUD tag) and `iss` (the team domain). Keys rotate every 6 weeks, and old keys stay valid for 7 days.
- ⚠️ `ctx.access` is not passed to the user Worker by Static Assets routers, so if Access is ever used, GRU verifies the header JWT itself.
- ⚠️ The "50 users" Free-plan figure was not found on any page read. It is irrelevant for a single user.

### A4. Cloudflare Workers AI (Phase 8 only)
Sources: https://developers.cloudflare.com/workers-ai/platform/pricing/ (Nov 12, 2026), https://developers.cloudflare.com/workers-ai/platform/data-usage/ (Oct 16, 2026)

- ✅ Free allocation: 10,000 Neurons/day, reset at 00:00 UTC. On Workers Free, going over means "further operations will fail with an error"; overage pricing is only available on Workers Paid.
- ✅ Data: *"Cloudflare does not use Customer Content processed by Workers AI to train AI models."* Zero data retention for standard inference. Exceptions are R2/KV/DO/Vectorize storage, AI Gateway logging/caching, and stateful/batch features. GRU will use none of them.
- ⚠️ Some catalog models need a paid billing method (examples given: kimi-k2.6, glm-5.3). Any Phase 8 model must be confirmed free-eligible before use.
- **Terms change vs spec:** none adverse found. Re-verify at the Phase 8 gate.

### A5. Google OAuth and Gmail API
Sources: https://developers.google.com/identity/protocols/oauth2, https://developers.google.com/identity/protocols/oauth2/web-server, https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification, https://support.google.com/cloud/answer/7454865, https://developers.google.com/gmail/api/auth/scopes, https://developers.google.com/gmail/api/reference/quota, https://developers.google.com/gmail/api/guides/batch

- ✅ Testing-mode refresh tokens: "issued a refresh token expiring in 7 days" unless only name/email/profile scopes are requested. This confirms the spec's reason to move the app to In production.
- ⚠️ **Canary reliability.** `refresh_token_expires_in` is documented, but as *"only set when the user grants time-based access"*. Nothing says Testing-mode tokens carry it. The spec's canary may never fire. See D-007.
- ✅ `gmail.readonly` is listed under **Restricted scopes** ("require restricted scope OAuth App Verification"; storing restricted-scope data on servers triggers a security assessment).
- ✅ **Personal-use exception:** *"if you are the only user of your app or if your app is used by only a few users, all of whom are known personally to you"*, so no verification submission is needed. An unverified app in production shows the unverified-app screen and is capped at 100 new users. GRU has 2 accounts, both Ani's. My reading is that the exception also covers the security assessment, though the page does not name CASA explicitly.
- ⚠️ **Extra revocation causes** not in the spec: a refresh token is revoked if unused for 6 months, or **when the user changes their password and the token has Gmail scopes**. A limit of 100 refresh tokens per account per client applies (the oldest is silently invalidated). Handling: these surface as `invalid_grant` → `needs_reauth`, and RUNBOOK will note "after changing a Gmail password, reconnect in GRU".
- ✅ Revoke: `POST https://oauth2.googleapis.com/revoke?token=...`; 200 means success. Revoking an access token also revokes its refresh token. (The docs only show the query-string form, so GRU uses that.)
- ✅ Gmail quota (projects created on or after 2026-05-01): 6,000 units per user per minute; messages.list = 5; messages.get = 20 (60 for format=full/raw). One tick at most is about 1 list + 12 metadata gets + a few full gets for alerts, well under 6,000.
- ⚠️ Gmail quota page notes a per-day billing threshold (80M units) with "charges ... planned later in 2026". GRU uses about 0.01% of that. Re-check quarterly.
- Batch HTTP: still supported, at most 100 calls per batch (50 recommended); quota counts each call. See D-009.

### A6. ntfy (public ntfy.sh)
Sources: https://docs.ntfy.sh/publish/, https://ntfy.sh/#pricing

- ✅ Verbatim: *"the topic is essentially a password, so pick something that's not easily guessable"*. GRU uses a 32+ char random topic, as the spec requires.
- ✅ `Click` header (alias of `X-Click`) opens a URL. Message size limit is 4,096 bytes.
- ⚠️ Read only through the fetch tool's summary, because the page is too long for verbatim retrieval: messages cached **12 h**; "all topics on ntfy.sh are public"; rate limit burst of 60 requests per visitor, refilling at 1 per 5 s; **250 messages/day** on ntfy.sh free. GRU sends about 1–6/day, so there is a large margin. Handling: Ani should spot-check the "Limitations" section of the publish docs; a 429 from ntfy is logged as `ntfy_rate_limited` and never retried in a loop.
- Privacy consequence: anyone who learns the topic can read GRU's (content-free) pings and send fake ones. That is acceptable only because messages carry no data. Spoofed pings can at worst open the app.

### A7. Tooling
- ⚠️ `wrangler@4.162.0` (latest on 2026-11-15) requires **Node >= 22.12.0**. This machine has Node 20.16.0. See D-015.

---

### A8. Cost and payment-method verification (deployment-cost check)
Sources: https://developers.cloudflare.com/workers/platform/pricing/ (Nov 13, 2026), https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ (Nov 12, 2026), https://developers.cloudflare.com/workers/observability/logs/workers-logs/ (Nov 12, 2026), https://developers.google.com/workspace/guides/create-project, https://developers.google.com/gmail/api/reference/quota, https://docs.ntfy.sh/, https://ntfy.sh/

| Component | Payment method needed? | Can it bill? | Guard in GRU |
|---|---|---|---|
| Workers Free | Not mentioned; "By default, users have access to the Workers Free plan" | Over the limit it fails (Error 1027), and no Free overage is listed | Never upgrade; SETUP step confirms there is no payment method on the Cloudflare account |
| D1 Free | No ("available on both the Workers Free and Workers Paid plans") | Over the limit, queries error | Degrade per D-011 |
| Static assets | No | "Requests to static assets are free and unlimited". ⚠️ Pricing footnote: with **Workers Caching** enabled, cache-served requests (including assets) are billed | Workers Caching is never enabled; `check:config` test |
| Cron Triggers | No | No | 1 of 5 |
| **Workers Logs** | No | Free today (200k events/day, 3-day retention). ⚠️ "Beginning **December 1, 2026**, Workers Logs will use Cloudflare Observability pricing" (not yet published). **New Workers have observability enabled by default** | **`observability.enabled = false`** set explicitly; `check:config` test. Debug with `wrangler tail`; CPU/subrequest metrics come from the dashboard's Workers metrics, not Logs (D-020) |
| workers.dev hostname | No | No | No custom domain (domains cost money) |
| R2, Workers AI paid models, Durable Objects, Queues, Access | n/a | R2 and paid models need billing | Not used; `check:config` rejects these bindings. Workers AI is Phase 8 only, after re-verification |
| Google Cloud project + Gmail API + OAuth client | ⚠️ Not stated explicitly. The guide says "Depending on the … APIs … you might also need to enable billing" | Gmail: "Usage under this threshold [80,000,000 units/day/project] doesn't incur extra charges". ⚠️ "planned to incur charges … later in 2026" with ≥90 days' notice | **Never attach a billing account and never start the GCP free trial.** With no billing account linked, there is nothing to charge. SETUP includes a check ("Billing → this project has no billing account"). GRU uses about 0.01% of the threshold |
| ntfy.sh | No ("Try ntfy for free without sign-up") | Paid tiers are optional | Content-free pings only |
| npm dependencies | No | No (open-source libraries, no SaaS) | Pinned exact |

**Conclusion (2026-11-15):** the architecture needs **no paid service, no payment method, and has no billing path**, provided the guards above hold. Two dated risks to re-check: the Workers Logs pricing change on 2026-12-01 (already neutralised by disabling it), and Gmail API threshold charges, which need a billing account we will never attach.

### A9. Argon2id CPU benchmark (local measurement, 2026-11-15)
Measured with `hash-wasm@4.12.0` (WebAssembly, the same engine family as workerd's V8) on Ani's laptop, Node 20, median of 5 wall-clock runs:

| Params | Wall time | Fits the 10 ms Workers Free CPU limit? |
|---|---|---|
| m=19 MiB, t=2, p=1 (OWASP minimum) | ~44 ms | ❌ about 4.5× over |
| m=12 MiB, t=3, p=1 (OWASP alt) | ~59 ms | ❌ |
| m=64 MiB, t=3, p=1 (RFC 9106 second recommendation) | ~209 ms | ❌ |
| m=4 MiB, t=1 | ~5 ms | ✅ but far below guidance |

The limits page says isolates have "some built-in flexibility … where your Worker infrequently runs over", without quantifying it. Consistent overruns get Error 1102. **Server-side Argon2id at a meaningful strength is not viable on Workers Free.** Ani chose client-side Argon2id (D-018).

### A10. CSP and WebAssembly
Source: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src
- ✅ "WebAssembly is blocked from loading and executing on the page" unless `script-src` includes `'wasm-unsafe-eval'` (or `'unsafe-eval'`, which GRU will never use).
- ⚠️ Browser-compatibility data did not render in the fetch. iOS Safari support for `'wasm-unsafe-eval'` must be checked on a real device during the Phase 0 walkthrough. If it fails, the fallback is a login-page-only CSP with a WASM hash/nonce approach, decided then.

### A11. Tooling and environment (2026-11-15)
- `wrangler@4.156.0` needs Node ≥ 22.0; latest `wrangler@4.162.0` needs ≥ 22.12.0. Vite 8 needs ≥ 20.19 or ≥ 22.12. Vitest 4 needs ^22.12 / ^24 / ≥26.
- Machine has **Node 20.16.0**. `winget install OpenJS.NodeJS.LTS` (resolves to **26.13.1**) failed with MSI 1603 because `node.exe` is held open by Antigravity's Stitch MCP bridge processes. Per Ani: do not kill them. Retry when Ani closes Antigravity, before any Wrangler step (D-015).

---

## Part B: Decisions

| ID | Decision | Status |
|---|---|---|
| D-001 | **App auth = single-user username + password** (Ani, 2026-11-15). Replaces both Cloudflare Access (which requires payment details at onboarding) and Google sign-in. No registration route exists. Gmail OAuth is completely separate: it only connects mailboxes, and only for an already-logged-in session. | ✅ decided |
| D-002 | No `jose`. Any JWT/HMAC work uses WebCrypto. | ✅ |
| D-003 | `SubrequestBudget(40)` counts **every** fetch and **every** D1 call (a `batch()` counts once). This is the stricter reading of the two Workers rows. | ✅ |
| D-004 | Multi-statement writes use `db.batch()`, assumed atomic. An integration test forces a mid-batch failure and asserts rollback; if that fails, writes become idempotent instead. | ✅ |
| D-005 | Field encryption: AES-256-GCM, envelope `v1.<keyid>.<iv>.<ct>`, AAD `table:column:rowid`. Rows needing an id before encryption pre-allocate it. | ✅ |
| D-006 | **Sessions are server-side** (needed for real expiry, logout and revocation). Token = 32 random bytes; cookie `__Host-gru_s`, HttpOnly, Secure, SameSite=Strict, Path=/. D1 `sessions` stores only SHA-256(token). Idle expiry 7 days, absolute expiry 30 days. `last_seen_at` is refreshed at most every 10 min to save writes. Logout deletes the row; `scripts/logout-all` and wipe delete all rows. | ✅ |
| D-007 | Token canary: keep the spec's `refresh_token_expires_in` check, plus a heuristic: `invalid_grant` 6–8 days after connect → "Google app may still be in Testing mode". SETUP makes "In production" a checkbox. | ✅ |
| D-008 | One cron, `*/15 * * * *`; `kv.tick_lock` with a 5-min expiry. | ✅ |
| D-009 | Gmail batch HTTP could cut about 12 subrequests to 1 per account per tick. Evaluate with a CPU benchmark in Phase 2; adopt only with Ani's approval. | deferred to Phase 2 |
| D-010 | Static assets binding with SPA fallback and **`run_worker_first: true`**: every request (assets included) passes through the Worker so security headers are guaranteed and tested in one place. Cost: each asset request counts toward the 100k/day Worker requests, which is negligible for one user. If the daily limit is hit, the Worker returns 429 instead of serving assets. | ✅ |
| D-011 | Daily-cap fallback: a D1 error ends the tick quietly; the next successful brief reports it; never retry in a loop. | ✅ |
| D-012 | `log(event, fields)` with an allowlist; ESLint `no-console` outside `log/`. | ✅ |
| D-013 | Wipe wording: GRU makes data **immediately inaccessible through GRU** and deletes all live rows and keys. It does **not** claim historical copies are destroyed: D1 Time Travel can keep restorable history for **up to 7 days** on Free. See PRIVACY.md. | ✅ |
| D-014 | Real Gmail addresses, the username, the password verifier and keys are never in the repo. | ✅ |
| D-015 | Node: system Node 20.16 is kept untouched (Antigravity/Stitch MCP use it). GRU uses **Node 24.22.3 LTS via fnm 1.39.0** (D-030). Stitch MCP did **not** need stopping: fnm installs under the user profile and never touches `C:Program Files
odejs
ode.exe`. | ✅ done 2026-11-15 |
| D-016 | **Calendar/tasks = option B** (Ani, 2026-11-15). GRU's own tasks and agenda ship with Notes in Phase 6: due date/time, priority, completion, interview and phone-call reminders, daily agenda, upcoming list, morning-brief integration, links to notes and applications. **No Google Calendar** in the initial build; a read-only Google Calendar phase stays a possible future option. | ✅ decided |
| D-017 | Persona: app named GRU and addresses the user as "Ani" in UI copy. Notifications remain fixed constant strings with no name and no content. | ✅ |
| D-018 | **Client-side Argon2id ("server relief")** (Ani, 2026-11-15). The login page derives `P = Argon2id(password, salt, m=64 MiB, t=3, p=1, 32 B)` in WebAssembly and posts it. The Worker stores only `V = SHA-256(P)` (in the secret `AUTH_VERIFIER`, not D1) and compares in constant time, in under 1 ms of CPU. An offline attacker holding `V` must pay a full Argon2id per guess, the same as server-side hashing. `P` is password-equivalent in transit, protected by TLS like a password. `/auth/params` returns the salt; for unknown usernames it returns a deterministic fake salt (HMAC of the username) so it doesn't reveal which usernames exist. | ✅ decided |
| D-019 | **Login rate limiting** in D1 table `login_attempts`, checked *before* any verification work. Per-client bucket (keyed by HMAC of `CF-Connecting-IP`, never the raw IP): 5 failures / 15 min → locked 15 min, doubling per repeat up to 24 h. Global bucket: 20 failures / hour → all logins locked 1 h (stops distributed guessing). Trade-off: an attacker can lock Ani out for up to an hour; recovery is documented in RUNBOOK §3. Locked responses are `429` + `Retry-After`; wrong credentials are a generic `401`. | ✅ |
| D-020 | `observability.enabled = false` in wrangler config (Workers Logs pricing changes 2026-12-01, and new Workers default to enabled). | ✅ |
| D-021 | Login page only: CSP adds `script-src 'self' 'wasm-unsafe-eval'`. All other responses keep the spec's CSP unchanged. | ✅ |
| D-022 | **Gmail authorisation loss** (Ani, item 6): on `invalid_grant` or a revoked or expired token, set the account to `needs_reauth` and stop syncing that account (other accounts continue). Show a red "Reconnect Gmail" status on Today + Settings and in the brief health line; send ntfy `action_needed` at most once per day. Reconnect re-runs OAuth and resumes from the stored cursor. RUNBOOK documents that changing a Google password revokes Gmail tokens. Built in Phase 2; documented now. | ✅ |
| D-023 | Repo moved to `C:\dev\GRU` (outside OneDrive). The OneDrive copy is removed only after the copy is verified with `npm test` green (waits on D-015). | in progress |
| D-024 | Schema additions for auth go in a new migration `0002_auth.sql` (`sessions`, `login_attempts`), so `0001_init.sql` stays the spec's schema verbatim. | ✅ |
| D-025 | In-app wipe empties tables with `DELETE FROM` every table (discovered from `sqlite_master`; D1 internals excluded) in **one atomic batch**, instead of DROP + CREATE. Same acceptance result (all tables exist and are empty) without duplicating the schema in Worker code, and future migrations are covered automatically. Neither approach securely erases SQLite free pages; PRIVACY §6 makes no such claim. | ✅ |
| D-026 | `@cloudflare/vitest-pool-workers` is **deprecated** (renamed). GRU uses `@cloudflare/vitest-plugin@1.4.11` (bundles wrangler 4.156.0, the same as our pin). | ✅ |
| D-027 | Single root `package.json` (no npm workspaces). The `apps/worker`, `apps/web` and `scripts` folders keep the spec layout; one lockfile is simpler to audit. | ✅ |
| D-028 | **Two tool lanes** (Ani: no silent downgrades). Root = Node 20 lane: hono, zod, hash-wasm, TypeScript 6, types; unit tests on built-in `node:test` (compiled by `tsc`, so no extra dependency); a dependency-free console-ban check stands in for ESLint `no-console`. `toolchain/` = Node 22 lane with its own package.json and lockfile: Wrangler, @cloudflare/vitest-plugin, Vitest, Vite, ESLint + typescript-eslint. It is not installed until Node 22 is available. Reason: typescript-eslint 8.72.1 declares Node ^20.9 but pulls `eslint-visitor-keys@5` (^20.19), Vite 8 needs ^20.19, and Wrangler/Miniflare need ≥ 22. All relative imports use explicit `.ts` extensions so one source tree serves both lanes. | ✅ |
| D-029 | **Security pin: hono 4.13.14 → 4.13.16** (2026-11-15). `npm audit` flagged 5 moderate advisories in hono ≤ 4.13.15, including GHSA-h7mg-cq63-vhpq (RegExpRouter can skip wildcard middleware; GRU's auth gate is wildcard middleware). 4.13.16 (published 2026-11-01) is the first fixed release and meets the ≥ 2-weeks-old rule. `npm audit` now reports 0 vulnerabilities. A Node 20 auth-gate test was added as a regression guard. It does **not** reproduce the advisory against GRU's routes (it also passes on 4.13.14), so the version pin is the actual fix. | ✅ |
| D-030 | **Node 24.22.3 LTS ("Krypton") via fnm**, pinned in `.node-version` (root and `toolchain/`). Chosen over 26.x, which had only 2 LTS releases on 2026-11-15; 24 is supported until 2028-04 and meets every toolchain floor (Wrangler ≥ 22, Vite ≥ 22.12, Vitest ≥ 24). fnm only activates in shells that run `fnm env`, so the system PATH (and Antigravity) still resolve Node 20. The root lane is verified on both 20.16 and 24.22.3. | ✅ |
| D-031 | npm 11 blocks dependency install scripts by default. Approved exactly two in `toolchain/package.json` → `allowScripts`: `esbuild@0.28.2` and `workerd@1.20261023.1`. Both are the official packages; their postinstall only selects or verifies the platform binary already fetched as an optional dependency. Any other script stays blocked. | ✅ |
| D-032 | `compatibility_date` 2026-11-01 → **2026-10-23**. The pinned workerd binary (from wrangler 4.156.0) supports dates only up to 2026-10-30, and workerd refused to start. Production accepts any past date; no flags differ in that window for GRU. | ✅ |
| D-033 | ESLint runs from the repo root (`cd .. && eslint --config toolchain/eslint.config.js --max-warnings 0 .`). Run from `toolchain/`, ESLint 9 silently linted only the 16 files in that folder. Now 64 files (apps, scripts, both test suites) are linted. Plain `.mjs` helpers declare their Node globals explicitly (no `globals` dependency). | ✅ |
 in `.dev.vars` / `--env-file`. Production `wrangler secret put` is unaffected. | ✅ |
| D-040 | The service worker also registers on `localhost`/`127.0.0.1` (secure contexts) so installability is testable locally. It still caches only hashed `/assets/*`. | ✅ |
| D-041 | Navigation shows **only shipped sections**. Phase 1: desktop Today, Applications, Settings; mobile tabs Today, Applications, More. The 5-tab layout (Today, Jobs, Applications, Agenda, More) fills in as phases ship. | ✅ |
| D-042 | **Voice (Ani, 2026-11-15)**: an extra interface to the same backend; spec §19's "voice" non-goal is lifted. **Decided:** (a) speech recognition on the device first; when unavailable, **Cloudflare Workers AI Whisper**. Mic only after an explicit tap; audio processed in memory, never stored or logged; transcripts and conversation content never logged; text input a full alternative; no paid models. Allowance and retention to be re-verified at V1 start (2026-11-15: 10,000 Neurons/day, whisper-large-v3-turbo ≈ 46.6 Neurons/min, zero data retention, no training). (b) **Phase 8 not brought forward**: V1 after Phase 6 (spoken briefing, voice commands, confirmation cards); V2 in Phase 8 (real conversation, follow-ups, interruptible speech, shared access to existing data and memory, actions only via existing permission-controlled APIs). No separate voice database or duplicate memory. Speech output uses local device voices only. | ✅ decided |
| D-043 | Design defaults adopted (Ani didn't object): 5-tab mobile target, Agenda/Notes hidden until Phase 6, ring + band score display, masked Gmail addresses in Settings, STAR stories from Notes after Phase 6, Playwright for UI evidence. | ✅ |
| D-044 | ESLint 9.39.5 is now marked deprecated upstream (ESLint 10 is current). A maintenance item; upgrade together with typescript-eslint when Ani asks. | open |
| D-045 | The Google OAuth callback lives at public `/auth/google/callback`, authorised by a single-use 256-bit `state` bound to the initiating session's hash and verified via an encrypted `__Host-gru_oauth` cookie, with PKCE (`S256`). Replaces the spec's `/api/mail/callback` because `SameSite=Strict` cookies are not sent on cross-site redirects. | ✅ |
| D-046 | Gmail scope restricted to `https://www.googleapis.com/auth/gmail.metadata` in Phase 2. GRU never requests or reads email bodies or snippets. Only headers and labels are accessed. Token exchange validates granted scope and revokes/rejects if unexpected scopes are present. | ✅ |
| D-047 | Classification pipeline uses header-only rules. High-impact transitions (interview, rejection, offer) route to the review queue with `autoApplyHighImpact: false`. Auto-applied changes carry 24-hour undo (`/api/events/:id/undo`) and are displayed in the "Since yesterday" section on Today. | ✅ |
| D-048 | Synthetic evaluation dataset of 372 emails (tuning + held-out) with zero safety violations. High-impact auto-apply stays OFF until real-world precision is proven. | ✅ |
| D-049 | Gmail first-connect backfill window is **5 days** (was 90), per Ani 2026-11-15, for a fast first sync. Constant `BACKFILL_DAYS`. | ✅ |
| D-050 | Phase 3 daily loop: brief and check-in computed on read; ntfy pings are constant generic strings, claimed atomically in `notifications_sent` and released if delivery fails. | ✅ |
| D-051 | Phases 4-6 built together: interviews with 24 h / 2 h reminders and debriefs, resume profiles + deterministic 100-point scoring + Apply Tomorrow, notes with HMAC blind-index search, tasks, agenda, weekly review, export. | ✅ |
| D-052 | **Vacancies are added by the user (paste/URL), not parsed from Gmail alerts.** GRU uses the `gmail.metadata` scope, which cannot read message bodies, so job-alert bodies cannot be parsed without widening to `gmail.readonly` (a forbidden scope, spec §2). Revisit only with Ani's explicit approval. | ⚠️ deviation from §10 flagged |
| D-053 | Note tags are stored as plaintext short labels (`a-z0-9-`, max 24 chars). Note bodies, task titles, job descriptions, resume text, prep and debrief are encrypted. | ✅ |
| D-054 | Voice (spec §22) and Workers AI (Phase 8) are **not built**; both need separate approval. | ⏸ |
| D-055 | **Natural voice (Ani, 2026-11-15: "more natural human voice")** supersedes the device-voices-only rule of D-042 for *speaking*. GRU speaks via Workers AI `@cf/deepgram/aura-1` (binding `AI`). Verified 2026-11-15 in Cloudflare docs: zero data retention, no training on customer content; Free plan = 10,000 Neurons/day, hard failure (never billing) beyond it; Aura-1 = 1,363.64 Neurons per 1,000 characters. GRU caps itself at 5,500 characters/day (about 7,500 Neurons) and falls back to an on-device voice. Ani can switch to the on-device voice in the assistant's settings. Speech *recognition* is unchanged: on-device only. | ✅ |
| D-056 | The assistant never speaks or listens unprompted: audio and microphone start only from a tap (browsers also forbid autoplay). On the first visit each Auckland day the assistant sheet opens with the brief as text and a "Play my brief" button. | ✅ |
| D-057 | Mail details: applications created from email get the role (from the subject), the source (seek/linkedin/other/email from the sender domain) and the email's own date. A header-only enrichment pass (`emails_seen.enriched`) repairs earlier imports once. Review items show when the email arrived. Never overwrites fields Ani has edited. | ✅ |
| D-058 | **Body reading for job mail (Ani, 2026-11-15).** Scope `gmail.readonly` (narrowest scope that exposes bodies; Gmail cannot restrict by sender). Restriction enforced in code (`gmail/bodies.ts`): body opened only when class is one of application_received/update, assessment, interview_invite/update, rejection, offer, info_request AND linked to an application AND the connection has read access; max 3 per 15-minute tick to stay within the 10 ms Free CPU limit (measured about 2 ms for a 33 KB email). Extracted facts only: position, one proposed interview time (Auckland time assumed unless the text states another zone, then skipped), allow-listed meeting link (encrypted in `interviews.link_enc`). Proposals need Ani's confirmation before reminders. Existing connections stay header-only until reconnected. Supersedes D-046. | ✅ |
| D-059 | **Mail understood by its words (Ani, 2026-11-15).** The body pass classifies job mail from its text (rejection, offer, interview, assessment, received, update, job alert, outreach); only the rule id is stored. Eligible mail = stored job mail, plus mail from known job senders (boards, ATS, assessment, scheduling) or replies in a linked thread, stored as `candidate`. All other mail is never stored or opened (tested). Clear status changes apply automatically with 24 h undo (setting `auto_status_from_text`, default on; rejection/offer still need a thread already linked and confidence 0.95); otherwise they are queued with the text-based suggestion. Job alerts yield individual vacancies (Seek, LinkedIn, Indeed, Trade Me) linked to the alert email. Deadlines, interview proposals + encrypted meeting links, and recruiter contacts (name/address encrypted) are extracted. CPU safeguards for the Free 10 ms limit: html capped at 50 KB, text at 20 KB, 45 KB of work and at most 6 bodies per tick, and each email is marked handled BEFORE processing so a hard failure can never loop. Measured ~0.5 ms for a typical status mail, ~2.6 ms for an 89 KB alert (warm). | ✅ |
| D-060 | **Conversation and iPhone mic via Workers AI (Ani, 2026-11-15: AI chat, cloud transcription).** One daily Neuron ledger (`lib/aibudget.ts`): TTS 5,600 + Whisper 400 + chat 2,000 = 8,000 of the Free 10,000/day, hard-failing at the cap and falling back (device voice, typed input, rule-based commands). Chat model `@cf/google/gemma-4-26b-a4b-it` (thinking disabled), fallback `@cf/meta/llama-3.2-3b-instruct`; `llama-3.1-8b-instruct-fp8` avoided (deprecation 2026-11-20). Probed live 2026-11-16: grounded answers, correct action ids, off-topic declined, a hostile job title ignored. The model receives a read-only snapshot labelled untrusted, can only SUGGEST one of a fixed set of steps (ids validated against the database), and every change needs a tap. Whisper: `whisper-large-v3-turbo` on a 16 kHz mono WAV recorded on the device after a tap; audio is never stored. Cloudflare Workers AI: zero data retention, no training (verified 2026-11-15). | ✅ |
| D-061 | **Calendar feed.** `/cal/<secret>.ics` is read-only, token-protected (192-bit random in `kv.cal_token`, constant-time compare, resettable), no session, so Apple/Google can subscribe. It contains event titles (company names), meeting links and times, and the calendar provider fetches it from its own servers: disclosed in the UI. GRU never gets calendar access (no calendar scope). | ✅ |
| D-062 | **Bug: the app sent `Permissions-Policy: microphone=()`, which blocked the microphone everywhere.** Now `microphone=(self)` (camera and geolocation stay blocked). | ✅ |
| D-063 | **Fixes (Ani, 2026-11-16).** (1) A rejection that arrives in the same email that created the application ("Thank you for applying" + body "we chose another candidate") is now recognised (more rejection phrasings) and applied automatically, because that email is itself a certain link; an undo is never redone when mail is re-read; migration 0010 re-reads the last 5 days and rescoring is cleared. (2) Title-only vacancies from alerts get a provisional score from the dimensions that can be judged (scaled to 100, labelled provisional), so genuinely suitable roles can appear in **Apply today**. (3) Applications opens on **Apply today** (good matches ready to apply); **Other jobs** and **My applications** keep their filters; Jobs were folded into Applications. (4) One colour per status (banner, chip, list stripe). (5) Call-budget safety: catch-up work (repairs, body reading) now runs LAST with leftover budget, uses ~4-6 calls per email (one combined lookup, batched writes), checks the budget before each email, and releasing the tick lock no longer depends on the budget. | ✅ |
| D-064 | **Cron every 5 minutes** (was 15; still 1 of 5 free triggers; ~290 invocations/day against 100,000) and a cheaper idle run, because the per-run call limit left almost nothing for reading mail: the scheduler now reads already-sent notification keys in one query, and the sync loads linking data only when there is new mail. Added **Refresh** (pull-to-refresh and a button): `POST /api/sync` runs the same sync + catch-up with a fresh call budget, sharing the cron lock, limited to once per 10 s. AI second opinion (`lib/aiclassify.ts`) for job mail whose words the rules read only as a generic thank-you: the model must quote the proving sentence and GRU verifies the quote is in the email; costs ~9 Neurons per use from the chat share. `emails_seen.body_chars` records how much text was read (length only). | ✅ |

## Runtime dependencies (rule 6)
| Package | Version | Where | Why |
|---|---|---|---|
| `hono` | 4.13.16 | Worker | Routing and middleware; small, Workers-native, no transitive deps |
| `react`, `react-dom`, `react-router`, `@tanstack/react-query`, `@fontsource-variable/inter` | see D-036 | Web app bundle | UI stack per spec §4; self-hosted font |
| `zod` | 4.6.7 | Worker | Input validation at every API boundary |
| `pdfjs-dist` | 6.5.438 | Browser only, loaded on demand | Reads a resume PDF on the device (Apache-2.0). The file never leaves the phone |
| `mammoth` | 1.13.0 | Browser only, loaded on demand | Reads a resume DOCX on the device (BSD-2-Clause) |
| `hash-wasm` | 4.12.0 | **Browser login page + local scripts only, never the Worker** | Argon2id in WebAssembly (D-018); MIT, no dependencies |

Node 20 lane dev (root, pinned): `typescript` 6.0.3, `@types/node` 26.6.6, `@cloudflare/workers-types` 5.20261031.1.
Node 22 lane dev (`toolchain/`, pinned, not yet installed): `wrangler` 4.156.0, `@cloudflare/vitest-plugin` 1.4.11, `vitest` 4.1.12, `vite` 8.3.5, `eslint` 9.39.5, `@eslint/js` 9.39.5, `typescript-eslint` 8.72.1. Every version was published at least two weeks before 2026-11-15, as a supply-chain precaution.
