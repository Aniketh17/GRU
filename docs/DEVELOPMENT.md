# GRU: Development guide

Last updated 2026-11-15. GRU's code is one codebase with **two tool lanes**, because the Cloudflare toolchain now requires Node ≥ 22 while Ani's laptop runs Node 20.16 (D-028).

| Lane | Folder | Node | What it does | Status |
|---|---|---|---|---|
| **Node 20 lane** | repo root | ≥ 20.16 | TypeScript strict type-check (worker, web, tests, scripts), console-ban check, unit tests (`node:test`), key generation and password provisioning scripts | ✅ installed and green |
| **Node 22 lane** | `toolchain/` | ≥ 22.12 (uses 24.22.3 via fnm) | Wrangler (local dev, D1, secrets, deploy), workerd integration tests, Vite web build, ESLint | ✅ installed and green (2026-11-15) |

Both lanes check the **same source files**. All relative imports use explicit `.ts` extensions, so the code runs unchanged under `tsc`-compiled Node 20, Wrangler/esbuild, Vite and Node 22.

## Node 20 lane (now)
```
cd C:\dev\GRU
npm ci
npm run check          # typecheck + no-console check + unit tests
npm audit
```
Scripts that work on Node 20 (after `npm run build:unit`):
- `node build/unit/scripts/gen-keys.js`
- `node build/unit/scripts/set-password.js`

Scripts that call Wrangler (lock, unlock, logout-all, wipe) need the Node 22 lane. Their `--dry-run` modes work on Node 20.

## Compatibility check (2026-11-15, Node 20.16.0, from each package's declared `engines`)
| Package | Declared Node support | Works on 20.16? | Lane |
|---|---|---|---|
| hono 4.13.16 | ≥ 16.9 | ✅ | root (runtime) |
| zod 4.6.7 | none declared | ✅ | root (runtime) |
| hash-wasm 4.12.0 | none declared | ✅ (Argon2id runs; benchmarked) | root (runtime) |
| typescript 6.0.3 | ≥ 14.17 | ✅ | root |
| @types/node 26.6.6, @cloudflare/workers-types | types only | ✅ | root |
| eslint 9.39.5 | ^20.9 | ✅ itself, but… | toolchain |
| typescript-eslint 8.72.1 | declares ^20.9, **but** depends on `eslint-visitor-keys@5` which needs ^20.19 | ❌ (npm engine-strict refuses) | toolchain |
| vitest 4.1.12 | ^20.0 | ✅ itself, but it needs Vite 6–8, and only Vite 6 supports 20.16 | toolchain |
| vite 8.3.5 | ^20.19 or ≥ 22.12 | ❌ | toolchain |
| wrangler 4.156.0 | ≥ 22.0 | ❌ | toolchain |
| miniflare / @cloudflare/vitest-plugin 1.4.11 | ≥ 22.0 (miniflare) | ❌ | toolchain |

Not done, by design (Ani: no silent downgrades): pinning Vite 6, an older typescript-eslint, or an older Wrangler just to satisfy Node 20. Each would be an unsupported or outdated combination chosen only to get past a version check.

## Exactly what requires Node 22
| # | Task | Why | Phase |
|---|---|---|---|
| 1 | `wrangler dev`: run the Worker locally with a local D1 | Wrangler ≥ 22 | 0 gate |
| 2 | Apply migrations (`d1 migrations apply`, local and remote) and `d1 create` | Wrangler | 0 / deploy |
| 3 | **workerd integration tests** in `toolchain/test/` (10 files): login, sessions, global lockout, hygiene, kill states, in-app wipe on an empty DB and on seeded data, cron tick, headers on real asset responses, D1 batch atomicity, the auth gate with a real D1 | Miniflare/workerd ≥ 22 | **0 gate** |
| 4 | Vite build of `apps/web` (login page, Phase 1 React SPA, PWA manifest and service worker) | Vite 8 ≥ 20.19 | 0 gate, 1 |
| 5 | Browser checks: screenshots at 390×844, focus order, Lighthouse PWA installability | needs a built app (#4) | 0 walkthrough, 1 gate |
| 6 | iOS Safari check of `'wasm-unsafe-eval'` on the real login page | needs a deploy (#8) | 0 walkthrough |
| 7 | Full ESLint (`toolchain: npm run lint`) | typescript-eslint dependency | 0 gate (the console ban is already enforced on Node 20) |
| 8 | `wrangler secret put/delete`, `wrangler deploy`, `wrangler tail`; the lock, unlock, logout-all and wipe scripts for real | Wrangler | deploy, 7 |
| 9 | Dashboard CPU / subrequest metrics | needs a deploy | 2 |
| 10 | Running `.ts` scripts directly (`node scripts/x.ts`) | Node ≥ 22.18 type stripping; on Node 20 use the compiled `build/unit/scripts/*.js` | convenience only |

## Node 24 side by side (done 2026-11-15, D-030)
In any terminal: `fnm env --use-on-cd | Out-String | Invoke-Expression` (PowerShell), then `cd C:devGRU`. fnm reads `.node-version` (24.22.3). Other terminals and Antigravity keep the system Node 20.16.

### Original plan (kept for reference)
Goal: add Node 22 **without** replacing `C:\Program Files\nodejs` (used by Antigravity and the Stitch MCP).
- **Recommended: fnm** (Fast Node Manager). It installs Node versions under your user profile and activates one per terminal session, so the system Node 20 stays untouched. Then in a GRU terminal: `fnm use 22`, `cd toolchain`, `npm ci`, `npm run check`.
- **Avoid nvm-windows** for this: it manages Node through a symlink at the system level and expects existing installs removed, which would affect Antigravity.
- Exact install commands will be verified against fnm's current docs at that time and recorded in DECISIONS.md.

## Security note on Node 20
Node.js 20 reached end-of-life on 2026-04-30 and no longer gets security fixes. That's acceptable here because Node 20 is only a **local dev tool**: GRU runs on Cloudflare's workerd runtime, not on Node. Avoid using this Node 20 for anything that fetches or runs untrusted code beyond this project's pinned dependencies. Moving the GRU terminal to Node 22 via fnm also fixes this.
