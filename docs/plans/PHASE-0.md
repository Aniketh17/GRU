# Phase 0: Foundations. Plan and checklist

**Approved by Ani on 2026-11-15**, with changes:
- password auth with Argon2id (computed in the browser: D-001, D-018);
- Node upgrade;
- move to `C:\dev\GRU`;
- tasks and agenda via option B in Phase 6;
- PRIVACY wording on Time Travel;
- Gmail recovery;
- generic ntfy.

See docs/ARCHITECTURE.md for the system design.

## Gate (spec §17 plus Ani's additions)
**Status 2026-11-15, Node 24.22.3 (fnm), all lanes run:**

| Gate item | Evidence | Result |
|---|---|---|
| Unauthenticated access blocked | workerd: every `/api/*` route → 401 + empty body, forged cookie rejected, unknown /api paths 401; live `wrangler dev`: `GET /api/health` → 401, `Content-Length: 0` | ✅ |
| Security headers verified | workerd: 200 asset, login, 401, authenticated 200, 415, 429, 423 all carry CSP/HSTS/Referrer-Policy/nosniff, with `no-store` on /api and /auth; live curl confirms; login-only `wasm-unsafe-eval` | ✅ |
| Crypto tests green | 15 unit tests (round trip, tamper, wrong AAD/key, rotation, Locked, RFC vectors) | ✅ |
| Wipe on an empty DB | workerd: in-app wipe on an empty DB (all 18 tables kept, empty, state=wiped, later calls 423) and on seeded synthetic data (Gmail revoke called); `wipe.ts --dry-run` | ✅ |
| Login | workerd: cookie flags, generic 401, 5-failure 429 + Retry-After, global 20-failure lock, reset on success, no raw IP, idle/absolute expiry, logout revokes. **Live wrangler dev round trip**: wrong 401, correct 200, session works, logout → 401 | ✅ |
| Environment check | Node 24.22.3 via fnm; `npm ci` (root) and toolchain install; typecheck (worker, web, unit, toolchain); D1 migrations 0001+0002 applied locally | ✅ |
| Security check | root `npm audit`: 0; ESLint 64 files, 0 problems, max-warnings 0; git-ignore proven; no `console.*` outside `log/`; no personal data in the repo. **Toolchain audit: 7 moderate, minimatch via typescript-eslint (dev only), D-034 open** | ⚠️ pending Ani on D-034 |
| Deployment-cost check | config guard green (observability off, no paid bindings, workers.dev only, one cron) | ✅ |
| D1 batch atomicity (D-004) | workerd: a failing statement rolls back earlier ones | ✅ confirmed |
| 390×844 screenshots | Phase 0 UI is a placeholder; screenshots move to the Phase 1 walkthrough with the designed UI | deferred to Phase 1 |
| OneDrive copy removed | waiting for Ani's approval | ⏸ |

Totals: unit 78/78 (Node 20.16 and Node 24.22.3), integration 56/56 (workerd), lint 0, root audit 0.

## Environment checklist
- [x] Repo copied to `C:devGRU`, byte-identical (diff -r).
- [x] `git init` in `C:devGRU`, branch `main`. No commits until Ani approves.
- [x] fnm 1.39.0 installed (winget, user scope); Node 24.22.3 LTS installed; system Node 20.16 untouched; Stitch MCP never stopped.
- [x] Root lane and toolchain lane installed; install scripts limited to esbuild and workerd (D-031).
- [ ] Remove the OneDrive copy (Ani's approval).

## Files
```
package.json            workspaces apps/*; scripts: dev, build:web, test, typecheck, lint, check, upgrade-check, db:migrate:local
wrangler.jsonc          name gru; main apps/worker/src/index.ts; compatibility_date 2026-11-01; observability.enabled false;
                        d1 binding DB (migrations_dir migrations); assets dir apps/web/dist, SPA fallback,
                        run_worker_first true (D-010); crons ["*/15 * * * *"]; vars APP_ORIGIN
tsconfig.base.json, tsconfig.json, eslint.config.js, vitest.config.ts, .gitignore, .dev.vars.example, .npmrc (save-exact)
migrations/0001_init.sql   spec §6 schema verbatim + kv seeds
migrations/0002_auth.sql   sessions, login_attempts
apps/worker/src/
  index.ts                Hono app + scheduled() (lock + kill/pause check; no sync yet)
  env.ts                  Env type
  log/index.ts            allowlisted logger (the only console user)
  crypto/b64.ts           base64url helpers
  crypto/envelope.ts      AES-256-GCM envelope, keyring, LockedError
  crypto/hmac.ts          HMAC-SHA256, SHA-256, constant-time equal
  db/budget.ts            SubrequestBudget(40), BudgetExhausted
  db/kv.ts                kv get/set, kill_state, paused
  db/schema.ts            table list + recreate SQL for wipe (read from the migrations at build time)
  http/headers.ts         security headers
  http/hygiene.ts         JSON + X-App + Origin checks
  auth/provider.ts        AuthProvider interface
  auth/password.ts        verifier parse, fake salt, verify proof
  auth/session.ts         create/validate/touch/revoke sessions, cookie
  auth/ratelimit.ts       buckets, lockout, Retry-After
  kill/guard.ts           kill-state + locked middleware
  kill/wipe.ts            in-app wipe (phrase → wiping → revoke tokens → drop/recreate → kv reset → wiped)
  routes/auth.ts          GET /auth/params, POST /auth/login, POST /auth/logout
  routes/health.ts        GET /api/health
  routes/admin.ts         POST /api/admin/pause | resume | wipe
apps/web/
  index.html              placeholder shell ("Hi Ani, GRU is getting ready")
  login.html + src/login.ts   Argon2id in the browser (hash-wasm), form, error/lockout states
  locked.html             Locked / Wiped page
  vite.config.ts          multi-page build → apps/web/dist
scripts/
  gen-keys.ts             DATA_KEY_V1, INDEX_KEY, SESSION_SECRET, NTFY_TOPIC (stdout only)
  set-password.ts         username + strong password → AUTH_USERNAME / AUTH_VERIFIER (stdout only)
  logout-all.ts           prints the wrangler d1 command to clear sessions (confirms first)
  lock.ts / unlock.ts     wrangler secret delete / put (confirm each step)
  wipe.ts                 full teardown, every step [y/N], --dry-run
test/                     see the test table
docs/                     ARCHITECTURE, DECISIONS, SETUP, PRIVACY, RUNBOOK, plans/
```

## Tests
| Area | Cases |
|---|---|
| crypto | round trip; tampered ciphertext / IV / tag fails; wrong AAD fails; wrong key fails; unknown key id fails; envelope format; random IV (two encryptions differ); missing key → LockedError |
| hmac | known-answer vectors; constant-time equal (length mismatch, equal, differ) |
| log | drops `subject, snippet, body, from, to, email, resume, description, password, token, ip`; keeps allowlisted keys; drops nested objects; never throws |
| budget | 40 allowed, 41st throws; batch counts as 1; `remaining()` |
| password | parses verifier; rejects malformed; correct proof verifies; wrong proof fails; fake salt is deterministic per username and differs from the real salt; params identical for real and fake users |
| login (integration) | success sets `__Host-gru_s` with HttpOnly, Secure, SameSite=Strict, Path=/ and no Domain; wrong password → 401 generic; wrong username → 401 identical body; 5 failures → 429 + Retry-After; lock blocks even correct credentials; global bucket; success resets the client bucket; raw IP never stored |
| session | valid → 200; missing/garbage → 401; idle > 7 d → 401 and row deleted; absolute > 30 d → 401; logout → row gone, cookie cleared, next request 401; touch at most every 10 min |
| auth gate | every registered `/api/*` route → 401 without a session, empty body; `/`, `/login`, `/auth/params` public |
| headers | CSP, HSTS, Referrer-Policy, nosniff on every response class; `no-store` on `/api` and `/auth`; `wasm-unsafe-eval` only on `/login` |
| hygiene | missing JSON → 415; missing X-App → 403; foreign Origin → 403; also applies to `/auth/login` |
| kill | pause/resume flip kv; `wiping` → 423; `wiped` → 423; locked (no key) → 423 `{locked:true}` |
| wipe | wrong phrase → 400; empty DB → completes, all tables present and empty, kill_state=wiped, sessions gone; seeded synthetic DB → all rows gone |
| batch (D-004) | failing statement mid-batch rolls back the earlier ones |
| scheduled | paused → no work; lock prevents overlap; expired lock is taken over |
| config (cost guard) | wrangler.jsonc: observability.enabled === false; no `routes`/custom domains; no r2_buckets, ai, queues, durable_objects, browser, vectorize, hyperdrive; exactly 1 cron; no `limits.cpu_ms` (Paid only) |
| scripts | `wipe.ts --dry-run` lists every step and makes no wrangler call; `gen-keys` output formats |

## Walkthrough evidence (end of Phase 0)
- `node -v`, `npm ci`, `npm run check` (typecheck + lint + test) output
- `npm audit` summary, plus the `git check-ignore` / `git status --ignored` proof
- `curl -i` against `wrangler dev`: `/api/health` 401 with headers; `/login` 200 with the login CSP; a full login via `scripts/dev-login` (synthetic credentials); 429 after 5 failures
- Screenshots of login / locked at 390×844
- Optional, if Ani completes SETUP: first deploy to `gru.<subdomain>.workers.dev` and a real login on the phone, including an iOS Safari check of `wasm-unsafe-eval` (A10)

## Risks
| Risk | Mitigation |
|---|---|
| Node upgrade blocked | Write code now; run everything right after the upgrade |
| `'wasm-unsafe-eval'` unsupported on Ani's phone browser | Real-device check in the walkthrough; fallback decided then |
| Argon2id 64 MiB too slow or memory-heavy on an old phone | Parameters live in the verifier; `set-password --m 47104 --t 1` (OWASP alt) re-provisions without code changes |
| Attacker locks Ani out via the global bucket | Max 1 h; RUNBOOK §3 recovery command |
| D1 batch not atomic | D-004 test |
| Lost DATA_KEY_V1 | By design; SETUP insists on password-manager storage |

## Not in Phase 0
React SPA/PWA (Phase 1), Gmail (Phase 2; D-022 recovery is built there), ntfy (Phase 3), tasks/agenda (Phase 6).
