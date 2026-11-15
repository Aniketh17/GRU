# Phase 2: Gmail. Implementation plan (revision 2)

Revision 2 (2026-11-15) incorporates Ani's eight changes: metadata scope, no previews, the callback security flow, real quota maths, backfill capacity, a synthetic dataset, process, and voice.
**Approved to implement and test locally once the synthetic suite and regressions pass. NOT approved: deploying, live Gmail OAuth, connecting a real inbox, or paid dependencies.**

## 1. Scope
**In:**
- Connect both Gmail accounts with the **`gmail.metadata`** scope.
- Token-expiry canary and reconnect handling.
- A 15-minute sync: a 90-day backfill, then incremental sync via Gmail history.
- Rules-only classification of headers, linking, a forward-only state machine, a review queue, and Undo.
- Settings → Gmail accounts, a Review page, and Today's "Since yesterday" changes and health line.
- A reusable synthetic email dataset and evaluation harness.

**Out:**
- Message bodies or snippets of any kind.
- Job-alert vacancy extraction (Phase 5, with `gmail.readonly` and renewed consent).
- ntfy (Phase 3), AI (Phase 8), interview date extraction.

## 2. Gmail permission: `gmail.metadata` now, `gmail.readonly` only in Phase 5
**Scopes requested in Phase 2:**
- `openid`
- `email`
- `https://www.googleapis.com/auth/gmail.metadata`

Google describes the last as "View your email message metadata such as labels and headers, but not the email body". Verified 2026-11-15.

**What `gmail.metadata` allows** (official reference pages, 2026-11-15):
| Call | Accepts `gmail.metadata` | Used for |
|---|---|---|
| `users.getProfile` (1 unit) | ✅ | `historyId` at connect time (the sync starting point) |
| `users.messages.list` (5 units) | ✅, **but `q` is not allowed**: "Parameter cannot be used when accessing the api using the gmail.metadata scope." | paging message ids for the backfill |
| `users.messages.get` with `format=metadata` (20 units) | ✅ (`full`/`raw` are refused under this scope) | the headers below |
| `users.history.list` (2 units) | ✅ | incremental sync after the backfill |

**Technical limitations and how the design handles them:**
1. **No server-side search.** GRU can't ask Gmail for "job emails only", so it lists **all** mail in the 90-day window, fetches each message's headers, and classifies locally.
   - Consequence: about 10–30× more `messages.get` calls than the readonly design.
   - Handled with Gmail **batch requests**: up to 50 calls per HTTP request, counted as 1 Cloudflare subrequest (§6).
   - Spam and trash are excluded by default.
2. **Headers only, no text.** Classification uses only the sender display name, sender domain, subject, `List-Unsubscribe`, `Content-Type` (e.g. `text/calendar` for invites), `Auto-Submitted`, and Gmail labels.
   - Messages whose meaning is only in the body (for example a rejection with the subject "Your application to Plexure") **can't be classified confidently**. They go to the **review queue** instead of changing status.
   - This is a deliberate accuracy-for-privacy trade. §5 measures it.
3. **Phase 5 upgrade.** Reading job-alert content needs `gmail.readonly`. Phase 5 will request it in a new, explicit consent screen (`prompt=consent`, shown to Ani with an explanation); until then GRU never holds it.
   - At the Phase 5 callback, the same granted-scope check will require `gmail.readonly` and refuse anything broader.

**Enforcement (tested):**
- A single `GMAIL_SCOPES` constant; a test fails if any other Google scope string appears in the code.
- Granted-scope check at the callback: `gmail.metadata` must be present. If **any** other Gmail scope or `https://mail.google.com/` is present, GRU revokes the token immediately and refuses.
- `include_granted_scopes=false`.
- The Gmail client can only build `GET` URLs for profile, messages.list (no `q`), messages.get (`format=metadata`) and history.list. Batch POST bodies contain only those GETs. Tests assert both.
- The `fields` mask **excludes `snippet`**: `fields=id,threadId,labelIds,internalDate,payload/headers`.

## 3. No previews, no bodies (resolves the earlier contradiction)
- GRU never requests or stores snippets or bodies. `emails_seen.snippet_enc` stays in the schema (SQLite can't easily drop columns) but is **always NULL**, and a test asserts it.
- **Stored per job-related email:** Gmail id, thread id, date, sender **domain**, class, confidence, rule id, linked application, disposition.
  - **Not stored:** sender address or name, subject, other headers.
  - Non-job mail ("other") is classified in memory and **not stored at all** (§6 explains why that's safe).
- **One necessary exception, for your approval:** a pending **review item** needs context for you to decide. GRU stores the subject and sender display name **encrypted** in `review_queue.context_enc`, deletes them when the item is resolved, and purges them after 30 days. The review card also offers **Open in Gmail** (a link built from the message id). If you'd rather store nothing, the card shows only the domain, date and the link; it's a one-line switch.

## 4. OAuth callback security flow: `/auth/google/callback` (D-045)
Why not `/api`: the GRU session cookie is `SameSite=Strict`, so the browser does not send it on the redirect back from Google.

1. **Start** (`POST /api/mail/connect {email}`):
   - Requires a valid GRU session plus JSON/X-App/Origin hygiene. `email` must be in `ALLOWED_EMAILS`.
   - Server generates, with WebCrypto CSPRNG:
     - `state`: 32 random bytes;
     - a PKCE `code_verifier`: 32 bytes → base64url, `code_challenge = SHA-256` (S256);
     - an OIDC `nonce`: 16 bytes;
     - a **browser binding** nonce: 32 bytes.
   - Server stores in `oauth_states`, keyed by SHA-256(state):
     - the encrypted verifier;
     - SHA-256(binding);
     - the nonce;
     - SHA-256(GRU session token);
     - the email hint;
     - `created_at`, `expires_at = now + 600`, `used = 0`.
   - The raw state is never stored.
   - The binding nonce goes to the browser as `__Host-gru_oauth` (HttpOnly; Secure; **SameSite=Lax**, so it is sent on the top-level redirect back from Google; Path=/; Max-Age=600).
   - Returns the Google URL; the page navigates to it.
2. **Google URL:**
   - `client_id`;
   - `redirect_uri` = `APP_ORIGIN + "/auth/google/callback"`, **built from server config only, never from the request**;
   - the three scopes;
   - `access_type=offline`, `prompt=consent`, `include_granted_scopes=false`;
   - `login_hint`, `state`, `nonce`, `code_challenge`, `code_challenge_method=S256`.
3. **Callback checks**, in order; any failure → generic error page, nothing stored:
   - request origin == `APP_ORIGIN`;
   - `state` format valid; SHA-256(state) row exists, **not used, not expired**;
   - row is atomically marked used (`UPDATE … WHERE used=0` must change 1 row, which **prevents replay** and races);
   - `__Host-gru_oauth` cookie present and SHA-256(cookie) == stored binding (**same browser that started it**);
   - the initiating GRU session is still valid in D1 (looked up by the stored hash);
   - Google `error` parameter → recorded as `oauth_denied`.
4. **Code exchange** (server → `oauth2.googleapis.com/token`, TLS):
   - sends `code`, `client_id`, `client_secret`, **the same `redirect_uri`** and `code_verifier`;
   - Google's web-server docs don't mention PKCE (checked 2026-11-15), so it's sent best-effort; if live setup shows Google rejects it, it's removed and recorded, and state + binding + client secret still protect the flow.
5. **Identity token checks**, on the `id_token` received directly from Google's token endpoint over TLS (Google's guidance allows skipping signature verification in this case):
   - `iss` ∈ {`accounts.google.com`, `https://accounts.google.com`};
   - `aud` == client id;
   - `exp` in the future;
   - `nonce` == stored nonce;
   - `email_verified` true;
   - `email` (lower-cased) == the hint **and** in `ALLOWED_EMAILS`.
6. **Scope check** (§2). Testing-mode canary: `refresh_token_expires_in` present → banner (D-007).
7. **Store and finish:**
   - the refresh token is encrypted (AAD `mail_accounts:refresh_token_enc:<id>`);
   - `getProfile` → `history_id`; the backfill floor = now − 90 days;
   - the binding cookie is cleared;
   - **303** to `/settings?gmail=connected`, with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, so the code never lingers in history or referrers.
8. **Session:** the callback **does not create or change a GRU login session**. Gmail OAuth only attaches a mailbox to the existing account (D-001). Afterwards the Settings page loads with the existing `__Host-gru_s` session.
9. **Housekeeping:** expired `oauth_states` rows are deleted daily (already built).

## 5. Classification, decisions and the safety gate
- **Classes:** `application_received`, `assessment`, `interview_invite`, `interview_update`, `rejection`, `offer`, `recruiter_outreach`, `info_request`, `alert`, `other`.
  - Rules are data (`rules.ts`) over headers only.
  - Confidence = rule weight, +0.1 for a known ATS or board domain, −0.3 per negative pattern, capped at 0.99.
  - Forwarded mail (`Fwd:`/`FW:`) and mail from Ani's own addresses are never auto-applied.
- **Linking:**
  1. the same thread as an already-linked email;
  2. exactly one application whose normalised company matches a company extracted from the sender display name (with "Careers", "Recruitment Team", "Talent", "via Greenhouse" and similar stripped), subject patterns ("applying to X", "application to/at/with X"), or the sender domain;
  3. otherwise unlinked.
- **Automatic changes in Phase 2 (deliberately conservative):**
  - Only `application_received` and `assessment`, when linked with confidence ≥ 0.90, and only along a **forward** transition.
  - An unlinked `application_received` with a confidently extracted company creates the application (source `email`).
- **Always review in Phase 2:** `interview_invite`, `interview_update`, `rejection`, `offer`, `recruiter_outreach`, `info_request`, and anything below threshold or conflicting.
  - Spec §9 allows auto-applying some of these after a real-world precision gate, and synthetic data can't establish real-world accuracy (Ani's rule).
  - So the setting `auto_apply_high_impact` stays **off**, and the evaluation report states it can't be turned on from synthetic results.
- **Never backwards:** the automatic transition table is forward-only and terminal states never change automatically. Property-tested over random email sequences.
- A late "application received" after an interview is linked and recorded, but changes nothing.

## 6. Sync workflow and capacity
**Per account, per tick** (cron every 15 min, or Sync now), within `SubrequestBudget(40)` for the whole tick:
1. Access token: reuse it if valid for 120 s or more; otherwise refresh (1 subrequest). `invalid_grant` → `needs_reauth`, skip; other accounts continue.
2. **Incremental first:** `history.list(startHistoryId, historyTypes=messageAdded)` gives new message ids.
   - HTTP 404 (history expired; "typically valid for at least a week") → reset `history_id` via `getProfile` and re-run the backfill from `last_success_at − 1 day` (a "full sync", as Google advises).
3. **Backfill** (until done): `messages.list(maxResults=200, pageToken)`, no `q`, spam/trash excluded.
4. Fetch headers for at most **200 ids per account per tick** via **4 batch requests of 50** (`format=metadata`, `fields` mask without snippet).
5. Classify in memory. Diff the job-related ids against `emails_seen` (1 D1 query). Write emails_seen, events, application changes, review items, the sync run and cursor in **one D1 batch** (atomic).
6. Cursor safety:
   - The page token / history id advance only if every message in the page was processed.
   - A failed batch part (429/5xx) leaves the cursor; the page is redone next tick.
   - Re-processing is idempotent: job-related ids are de-duplicated by primary key, and "other" mail has no side effects.
   - The backfill stops when a full page is older than the floor (now − 90 days at connect), or there's no next page.

**Subrequests per tick (worst case, both accounts):**
- 2 × (1 refresh + 1 history + 1 list + 4 batch + 1 D1 diff + 1 D1 write) = **18**;
- plus about 5 tick overhead (state, lock, release, housekeeping);
- = **≈ 23 of 40**.

**Gmail quota per tick per account** (new quotas for projects created on or after 1 May 2026):
- 200 × 20 (messages.get) + 5 (list) + 2 (history) = **4,007 units**;
- the limit is **6,000 units per user per minute**. Each mailbox is its own user, and a tick's calls land within one minute, so 4,007 ≤ 6,000 with 33% headroom;
- per project: 2 × 4,007 = 8,014 units in that minute ≪ **1,200,000 units per project per minute**.

**Where the old "47,000 units/day" came from** (now replaced): it assumed the readonly design's 12 fetches every tick: 2 accounts × 96 ticks × (5 list + 12 × 20 get) = 47,040.

**New daily figures:**
| Mode | Messages/day/account | Units/day (both accounts) | vs Google's published 80,000,000/day per-project threshold |
|---|---|---|---|
| Backfill at full speed | 19,200 (96 ticks × 200) | 2 × 96 × 4,007 ≈ **769,000** | 0.96% |
| Steady state, 120 emails/day/account | 120 | 2 × (96 × 2 history + 120 × 20) ≈ **5,200** | 0.007% |

The 80M figure is Google's published daily threshold after which charges are "planned … later in 2026". The project has **no billing account**, so nothing can be charged; GRU stays at or below 1% of it even during a backfill.

**Backfill capacity** (90 days, per account, at 19,200 messages/day):
| Mailbox volume (all mail) | Messages in 90 days | List pages (200) | Ticks | Time |
|---|---|---|---|---|
| Light: 40/day | 3,600 | 18 | 18 | ≈ 4.5 h |
| Typical: 120/day | 10,800 | 54 | 54 | ≈ 13.5 h |
| Heavy: 300/day | 27,000 | 135 | 135 | ≈ 34 h (1.4 days) |
| Extreme: 500/day | 45,000 | 225 | 225 | ≈ 56 h (2.3 days); exceeds the target, reported honestly |

Both accounts backfill in parallel, since quotas are per user.

**Fallback if Gmail batch HTTP doesn't work live** (Google's batch guide doesn't print the endpoint URL; GRU uses the default `/batch/gmail/v1` path, to be confirmed at the first live connect): individual GETs within the budget allow ~14 messages/account/tick, so the typical mailbox would take ~8 days. GRU would show progress and tell you, and nothing breaks.

**CPU** (10 ms per invocation, network wait excluded): parsing 4 × 50 metadata responses plus classifying 200 messages is benchmarked locally before relying on it. If it measures over 5 ms, the per-tick batch size drops (configurable) and the table above is recalculated.

## 7. Cloudflare free tier (re-checked 2026-11-15; Workers limits page updated 13 Nov 2026, D1 pricing 30 Oct 2026)
| Resource | Free limit (quoted) | Phase 2 worst day (backfill) | Steady day |
|---|---|---|---|
| Requests | "100,000 requests, resetting at midnight UTC" | 96 ticks + ~600 app ≈ 700 | ≈ 700 |
| CPU | "10 ms" per request and per Cron Trigger | benchmarked < 5 ms target | same |
| Subrequests | 50 per invocation | ≈ 23 per tick | ≈ 15 |
| Cron Triggers | 5 per account | 1 | 1 |
| D1 rows read | "5 million / day" | ≈ 25k (diff reads + UI) | ≈ 16k |
| D1 rows written | "100,000 / day" | only job-related emails are stored: e.g. 3% of 19,200 × 2 ≈ 1,150 emails × ~3 rows incl. indexes + 192 sync runs + cursor updates ≈ **4–5k** | ≈ 1.5k |
| D1 storage | 5 GB total (500 MB per database) | < 5 MB | — |

Over-limit behaviour is failure, not billing: Workers return Error 1027; D1 "will not be able to run queries". The Workers pricing page says "By default, users have access to the Workers Free plan" and doesn't mention a payment method; SETUP keeps the explicit checks "no payment method on the Cloudflare account" and "no billing account on the Google Cloud project". **No paid service, billing account or payment method is required anywhere in Phase 2.** The config guard test still fails the build on paid bindings.

## 8. Database changes: migration `0003_gmail.sql` (additive)
```sql
ALTER TABLE mail_accounts ADD COLUMN label TEXT;
ALTER TABLE mail_accounts ADD COLUMN granted_scope TEXT;
ALTER TABLE mail_accounts ADD COLUMN last_success_at INTEGER;
ALTER TABLE mail_accounts ADD COLUMN reauth_since INTEGER;
ALTER TABLE mail_accounts ADD COLUMN history_id TEXT;
ALTER TABLE mail_accounts ADD COLUMN backfill_floor INTEGER;        -- now − 90 days at connect
ALTER TABLE mail_accounts ADD COLUMN messages_scanned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE oauth_states ADD COLUMN binding_hash TEXT;
ALTER TABLE oauth_states ADD COLUMN session_hash TEXT;
ALTER TABLE oauth_states ADD COLUMN oidc_nonce TEXT;
ALTER TABLE oauth_states ADD COLUMN created_at INTEGER;
ALTER TABLE review_queue ADD COLUMN context_enc TEXT;               -- encrypted subject + sender name; deleted on resolve
CREATE INDEX idx_seen_account_date ON emails_seen(account_id, internal_date);
CREATE INDEX idx_review_open ON review_queue(resolved_at, created_at);
CREATE INDEX idx_events_app ON events(app_id, at);
```
- `oauth_states.state` stores **SHA-256 of the state**, not the state itself.
- Housekeeping adds: `review_queue.context_enc` → NULL after 30 days.

## 9. Synthetic dataset and evaluation harness (no real emails required)
- **Generator:** `test/fixtures/synthetic/` (deterministic, seeded, committed). Output to `eval/generated/` is **git-ignored**; tests generate in memory.
  - Fictional companies, people and domains; public ATS and job-board domains only.
  - Bodies are never needed in Phase 2. Alert fixtures also get synthetic vacancy text for Phase 5.
  - Ani's five pasted examples were used only as **style references**: no names, companies or text copied.
- **Size and categories:** ≥ 100 emails (target ~300) across:
  - application confirmations, rejections, interview invitations, scheduling changes, offers and offer updates;
  - recruiter outreach, requests for more information, job alerts (Indeed/SEEK/LinkedIn/Employment Hero-style digests and single "match" emails), newsletters;
  - unrelated personal mail, look-alikes (e.g. a newsletter saying "unfortunately", a bank "application" update, a course "offer");
  - duplicates and forwards, ambiguous messages, misleading or conflicting wording.
- **Each email** has an expected class, an expected decision (ignore / alert / auto / review / create), and, in scenario threads, the expected application status afterwards.
- **Splits:** a deterministic **tuning** set (for writing rules) and a **held-out** set (never used for tuning), by seeded hash.
- **Metrics:** precision, recall and F1 per class, plus a confusion matrix, on the held-out set (`npm run eval:synthetic` prints the report).
- **Hard assertions (tests fail otherwise):**
  - zero incorrect automatic status changes;
  - every ambiguous, conflicting, forwarded or look-alike email → review or ignore, never automatic;
  - no automatic backwards move across all scenario timelines and random sequences.
- **Reported, not over-claimed:** synthetic results say nothing about real-world accuracy. The report says so, and the high-impact auto-apply stays off.
- `npm run eval` (real labelled CSV) stays available for when Ani has real examples. **Optional, not a dependency.**
- **High-volume tests:** in-memory fake Gmail mailboxes at 40, 120, 300 and 500 emails/day over 90 days, run through real ticks in workerd. Assert ticks to completion, subrequests ≤ 40 per tick, Gmail units ≤ 6,000 per user per tick, D1 rows written per simulated day, history-404 recovery, partial batch failure, and duplicates.

## 10. Other tests
- **Unit:**
  - each rule plus negatives; company extraction; linking order; decision table;
  - OAuth helpers: URL parameters, `redirect_uri` from config, state/binding/nonce, `id_token` claim checks (iss/aud/exp/nonce/email_verified/allowlist), scope check including revoke-on-extra;
  - batch request builder (GETs only, metadata, no `q`, no snippet) and multipart parser (including part-level errors);
  - the backfill planner.
- **Integration (workerd + D1, Google mocked at `fetch`):**
  - connect → callback happy path;
  - replay, expiry, wrong browser cookie, expired session, allowlist rejection, scope failures, Testing-mode canary;
  - `invalid_grant`, disconnect revokes, wipe revokes;
  - no plaintext subject or address in D1; `snippet_enc` always NULL;
  - review resolve; Undo of an automatic change.
- **E2E (390 / 1440, light and dark):** Settings account states (seeded), Review resolution, "Since yesterday" with Undo, no horizontal scroll, screenshots.

## 11. Gate (spec §17)
| Item | Status path |
|---|---|
| Synthetic eval: hard assertions pass; metrics reported | local |
| Real-world precision gate (spec) | **not claimable** without real data; high-impact auto-apply stays off |
| Both accounts connected; 24 h of ticks; CPU/subrequest metrics recorded | needs SETUP + **Ani's deploy approval** |
| All unit, integration, e2e, lint, typecheck, audit green | local |

## 12. Voice (unchanged, recorded)
- Whisper is the fallback when on-device recognition is unavailable; the mic turns on only after a tap; audio is transient and never stored or logged; text input remains complete.
- V1 after Phase 6, V2 in Phase 8, with no separate voice database or memory.
- Workers AI allowance and retention are re-checked when V1 starts.
