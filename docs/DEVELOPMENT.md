# GRU: Development guide

Last updated 2026-11-15.

## Node
GRU uses **Node 24.22.3 LTS via fnm**, pinned in `.node-version` (D-030, D-035). The system Node 20.16 in `C:\Program Files\nodejs` stays untouched for Antigravity and its Stitch MCP. fnm only takes effect in a terminal where it's activated:

```powershell
fnm env --use-on-cd | Out-String | Invoke-Expression   # PowerShell, once per terminal
cd C:\dev\GRU                                          # fnm switches to 24.22.3 here
```

## Everyday commands
| Command | What it does |
|---|---|
| `npm ci` | Install exact, locked dependencies (install scripts limited to esbuild and workerd, D-031) |
| `npm run dev` | Build the web app and run the Worker locally (`wrangler dev`, local D1) |
| `npm run check` | TypeScript (worker, web, unit) + ESLint + console ban + unit + workerd integration tests |
| `npm run e2e` | Real-browser tests and screenshots (Playwright, isolated `.wrangler/e2e` database, throwaway `.e2e/` credentials) |
| `npm run db:migrate:local` / `:remote` | Apply D1 migrations |
| `npm run deploy` | `check`, then `wrangler deploy` |
| `node scripts/gen-icons.mjs` | Regenerate PNG app icons |
| `npm run upgrade-check` | List outdated packages (upgrade only when Ani asks) |

First-time e2e setup: `npx playwright install chromium`.

## Tests
- `test/unit/` (Node's built-in `node:test`, compiled by `tsc`): crypto, logging, rate limits, password protocol, headers, normalisation, theme schedule and DST, scripts, cost guard.
- `test/integration/` (Vitest + `@cloudflare/vitest-plugin`, real workerd + D1): auth, sessions, kill switch, wipe, tick, applications API.
- `test/e2e/` (Playwright, phone 390×844 + desktop 1440): flows, theme schedule with a fake clock, installability, no horizontal scroll, screenshots → `docs/screenshots/`.

## Local credentials
`.dev.vars` (git-ignored) holds throwaway values; see `.dev.vars.example`. **Write every `$` in `AUTH_VERIFIER` as `\$`**, because wrangler expands `$name` in env files, even inside quotes (D-039). Production secrets set with `wrangler secret put` are not affected.

## History
Until 2026-11-15 the repo had two lanes (Node 20 root + Node 22 `toolchain/`, D-028), because the machine only had Node 20. With Node 24 available via fnm, they were merged into one package (D-035).
