# Phase 2: Gmail. Implementation plan

Status: **awaiting Ani's approval. No code, migrations, OAuth configuration or deployment until approved.**
Spec: §8 (OAuth and sync), §9 (classification and state machine), §5 (free-tier rules), §16 (tests).

## 1. Scope
**In:**
- Connect both Gmail accounts read-only, with a token-expiry canary and reconnect handling (D-022).
- A 15-minute sync tick with 90-day backfill.
- Rules-only classification, linking emails to applications, the automatic state machine, and a review queue.
- Undo for automatic changes; the "Since yesterday" changes on Today; a Review page; Gmail accounts in Settings.
- An eval harness for Ani's own labelled emails.

**Out:**
- Job-alert body parsing and vacancy extraction (Phase 5).
- ntfy pings (Phase 3; Phase 2 shows banners in the app only).
- Any AI (Phase 8).
- Interview date extraction (spec: not in Phase 2).

## 2. Gmail OAuth: scopes and read-only guarantees
**Requested scopes (exactly three):**
- `openid`
- `email`
- `https://www.googleapis.com/auth/gmail.readonly`

Google describes `gmail.readonly` as "View your email messages and settings" (restricted scope, verified 2026-11-15). GRU never requests `gmail.modify`, `gmail.send`, `gmail.compose`, `gmail.labels`, `gmail.insert` or `https://mail.google.com/`.

**Guarantees, enforced and tested:**
1. **A single scope constant.** The scope list is one constant, `GMAIL_SCOPES`. A unit test fails if any scope other than the three above appears anywhere in the source.
2. **Granted scopes are checked at the callback:**
   - The token response's `scope` field must contain `gmail.readonly`; otherwise the connection is refused ("GRU needs read-only Gmail access").
   - It must contain **no** other Gmail scope; if it does, GRU revokes the token immediately and refuses.
   - With only one non-sign-in scope Google shows no per-scope checkboxes, but GRU checks regardless (Google's guidance: "can't assume users grant all requested scopes").
   - `include_granted_scopes=false`, so scopes granted earlier never ride along.
3. **Read-only API calls only:** `users.messages.list` and `users.messages.get` with `format=metadata`. A test asserts that every Gmail URL the client can build is one of those GET endpoints. No POST, PUT, PATCH or DELETE ever goes to `gmail.googleapis.com`.
4. **No message bodies:** `format=metadata` returns "only email message ID, labels, and email headers". `full` and `raw` are never used in Phase 2; a test asserts the format.
5. **Considered and rejected:** the narrower `gmail.metadata` scope. It can't run the search query (`q`) the sync needs, and Phase 5 must read job-alert bodies. This will be re-verified when Phase 2 starts.

**Connect flow:**
1. Settings → Connect calls `POST /api/mail/connect {hint}`. This requires a GRU session, checks the hint against `ALLOWED_EMAILS`, and creates a single-use `state`:
   - 256 random bits, 10-minute expiry;
   - stored with the session's hash and an encrypted PKCE verifier.
2. The browser is redirected to Google with:
   - `access_type=offline`, `prompt=consent`, `include_granted_scopes=false`, `login_hint`;
   - `code_challenge` (S256): best-effort, see below.
3. **Callback at `/auth/google/callback`, not under `/api` — deviation from spec §12, D-045.** GRU's session cookie is `SameSite=Strict`, so the browser won't send it on the redirect back from accounts.google.com, and an `/api` callback would always get 401. The callback is instead authorised by the single-use, unguessable `state` (bound to the session that started it), and then:
   - marks the state used;
   - exchanges the code (with `client_secret`, plus PKCE if Google accepts it);
   - reads `email` + `email_verified` from the `id_token` received directly from Google over TLS, and checks `aud`, `iss` and `exp`;
   - enforces the allowlist and the scope checks above;
   - encrypts and stores the refresh token;
   - applies the Testing-mode canary (D-007);
   - redirects to `/settings?connected=1`.
4. **PKCE** isn't documented for Google's web-server flow (checked 2026-11-15). GRU sends it anyway. If Google rejects it during setup, it's removed and recorded; `state` + `client_secret` remain the protection either way.

**Disconnect:** `POST /api/mail/:id/disconnect` revokes the token at Google (`oauth2.googleapis.com/revoke`), deletes the stored tokens and sets status `disconnected`. Wipe also revokes (already built).

## 3. Database changes: migration `0003_gmail.sql` (additive only)
```sql
ALTER TABLE mail_accounts ADD COLUMN label TEXT;              -- "Primary" / "University" (UI shows masked address)
ALTER TABLE mail_accounts ADD COLUMN granted_scope TEXT;      -- scope string from the token response, for audit
ALTER TABLE mail_accounts ADD COLUMN last_success_at INTEGER; -- last fully successful tick (health line, 6 h alert)
ALTER TABLE mail_accounts ADD COLUMN reauth_since INTEGER;    -- when needs_reauth began (banner copy, D-022)
ALTER TABLE oauth_states ADD COLUMN session_hash TEXT;        -- binds a connect attempt to the session that started it
ALTER TABLE oauth_states ADD COLUMN created_at INTEGER;
CREATE INDEX idx_seen_account_date ON emails_seen(account_id, internal_date);
CREATE INDEX idx_review_open ON review_queue(resolved_at, created_at);
CREATE INDEX idx_events_app ON events(app_id, at);
```
- **No new tables.** `emails_seen.disposition` gains one value, `alert_pending` (the column is TEXT; documented in code).
- **What is stored per email** (spec §8): Gmail id, thread id, date, **sender domain only** (never the address or name), class, confidence, rule id, disposition, and an **encrypted** 300-character snippet (snippets are cleared after 90 days, already in housekeeping).
- **Never stored:** subject, full headers, body.

## 4. Sync workflow: one tick (cron every 15 min, or Sync now)
1. Take the `tick_lock`. Exit if paused, wiping or wiped (built).
2. Accounts in order of oldest `last_sync_at`. For each `active` account, while the budget allows:
   1. **Access token:** reuse it if valid for 120 s or more; otherwise refresh (1 subrequest). On `invalid_grant`: set `needs_reauth` + `reauth_since`, record a sync_run, and skip the account. Other accounts continue (D-022).
   2. **List:** `messages.list` with `q = jobQuery + after:<sync_after_epoch − 300>`, `maxResults=25`, and `pageToken` while backfilling.
   3. **Dedupe:** diff the ids against `emails_seen` in one D1 query.
   4. **Fetch:** up to 12 unseen messages with `format=metadata`, headers From, Subject, Date, List-Unsubscribe and Content-Type, and a `fields` mask.
   5. **Classify** (rules), **link** to an application, apply the **state machine**, and write everything (emails_seen, events, applications, review_queue, sync_run) in **one D1 batch** (atomic, verified in Phase 0).
   6. **Advance the cursor** (`sync_after_epoch`) only past fully processed messages. Keep the page token while the backlog drains; an expired page token restarts the page safely (duplicates are ignored by the primary key).
3. **Budget:** `SubrequestBudget(40)`. When the remaining budget can't cover the next account's minimum, stop cleanly and resume next tick.
4. **Gmail batch HTTP (D-009):** benchmark CPU on synthetic multipart responses first. Adopt only if CPU stays under about 5 ms; it would cut 12 fetches to 1 per account. **Reported back for approval before adopting.**

## 5. Classification, linking, state machine (spec §9)
- **Rules as data** (`rules.ts`): `application_received`, `assessment`, `interview_invite`, `rejection`, `offer`, `recruiter_outreach`, `alert`, `other`.
  - Confidence = rule weight, +0.1 for a known ATS or job-board domain, +0.1 when subject and snippet both match, −0.3 per negative pattern, capped at 0.99.
  - Ties go to the higher-impact class and are queued.
- **Linking order:** (1) the same thread as an already-linked email; (2) exactly one application whose `company_norm` matches the sender display name, an ATS subject pattern ("at X", "to X", "with X") or the domain; (3) otherwise unlinked.
- **Automatic transitions:**
  - applied → assessment / interview / offer / rejected;
  - assessment → interview / offer / rejected;
  - interview → offer / rejected;
  - offer → rejected.
  - **No automatic downgrades** (property-tested). Terminal states never change automatically.
- **Auto-apply rules:**
  - linked + confidence ≥ 0.90 for received, assessment or interview;
  - **thread-linked** + ≥ 0.95 for rejection or offer;
  - everything else → the review queue.
  - An unlinked `application_received` with a confident company creates a new application (source `email`).
  - Interview invites create an `interview` in state `proposed` plus an `interview_time` review item (no date extraction).
- **Eval gate (spec §16):** until Ani's own labelled set shows ≥ 95% precision for `rejection`, `interview_invite` and `offer`, those classes **always go to review**. This is enforced by a setting that the eval script reports against.
- **Undo:** every automatic change records `prev_status` and shows in "Since yesterday" with Undo for 24 hours (built in Phase 1).

## 6. Job-alert handling in Phase 2
- Mail matching the alert rules is classified `alert` and stored as `disposition = 'alert_pending'`. Alert rules: a known board or ATS domain, or `List-Unsubscribe` plus a digest subject such as "jobs you may like", "job alert", "new jobs" or "recommended jobs". Generic newsletters stay `other`.
- **Phase 2 never fetches alert bodies.** Phase 5 picks up `alert_pending` ids and reads each body once, in memory, to extract vacancies. The body is never stored. The Gmail id stays for de-duplication.
- Alerts never change application status.
- Today's health line says how many alerts are waiting, and that extraction arrives in Phase 5.

## 7. Security and privacy controls
| Area | Control |
|---|---|
| Tokens | Refresh/access tokens AES-GCM encrypted with AAD `mail_accounts:<col>:<id>`; never logged; revoked on disconnect and wipe |
| Account allowlist | `ALLOWED_EMAILS` secret checked at connect (hint) **and** at the callback (`id_token` email, `email_verified=true`) |
| OAuth state | 256-bit, single-use, 10-min expiry, bound to the initiating session hash, expired rows cleared daily |
| Scopes | §2: exact scope constant, granted-scope check, read-only endpoint allowlist, `format=metadata` |
| Email content | Sender domain only; subject never stored; snippet encrypted, cleared after 90 days; no bodies |
| Logging | Allowlisted logger (built): ids, counts, codes only. New test: Gmail ids, thread ids, subjects, domains and snippets are rejected or never passed |
| Untrusted input | Headers and snippets are treated as data; regexes are precompiled and linear-time; header lengths capped before matching |
| Failure visibility | `needs_reauth`, Testing-mode canary, budget exhaustion and D1 caps all appear in Settings and the Today health line (D-011, D-022) |
| Requests | New mutating routes inherit session + hygiene (JSON, X-App, Origin); the callback is the only new public route, protected by `state` |

## 8. Free-tier usage estimates (Workers Free, no payment method)
Assumptions: 2 accounts, about 30 job-related emails/day, a 90-day backfill of about 1,500 messages, Ani using the app about 30 times a day.

| Resource | Free limit | Phase 2 estimate | Headroom |
|---|---|---|---|
| Worker requests | 100,000 / day | 96 ticks + ~600 app/asset requests ≈ **700** | ~140× |
| CPU per invocation | 10 ms | tick: regex classification of ≤ 24 messages + JSON parse, est. 2–5 ms (network wait excluded) | to be measured and recorded |
| Subrequests per invocation | 50 (budget 40) | worst tick ≈ 2 × (1 refresh + 1 list + 1 diff + 12 gets + 1 batch) + 3 state = **35** | within budget; batch HTTP would cut this to ~13 |
| D1 rows read | 5,000,000 / day | ticks ~6k + UI ~10k ≈ **16k** | ~300× |
| D1 rows written | 100,000 / day | steady ~1.5k (incl. index writes); backfill days ≤ ~6k | ~16× |
| D1 storage | 500 MB per database | ~1 KB per email with indexes → ~2 MB per year | negligible |
| Gmail API | 6,000 units/min/user; billing threshold 80M units/day | per tick ≤ 5 + 12×20 = 245 units/account; ~47k units/day total | ~1,700× under the threshold; no billing account exists |
| Workers AI / ntfy | n/a in Phase 2 | 0 | — |

**Conclusion:** Phase 2 stays well inside the free tier and adds no paid service. Backfill drains at ≤ 12 messages per account per tick (~1,150/day/account), so 90 days of mail is caught up within 1–2 days.

## 9. UI changes (from the approved design)
- **Settings → Gmail accounts:** Connect / Reconnect / Disconnect, masked address, last sync, emails checked, error state, Testing-mode banner, Sync now.
- **Review page** (nav item appears, D-041): one-tap Confirm / Edit / Dismiss, and the interview-time form.
- **Today:**
  - "Since yesterday" automatic changes with Undo;
  - a "Needs your input" count;
  - a health line ("Synced 6 min ago · 2 accounts", or the failure).

## 10. Test plan
**Unit (`node:test`):**
- One test per rule id plus negatives, including look-alikes (a newsletter containing "unfortunately").
- The confidence formula and tie-breaking.
- Company extraction from display names and subjects.
- Linking order.
- State machine property tests: no automatic downgrades; terminal states never change automatically.
- Auto-apply thresholds; the eval-gate setting.
- The `jobQuery` builder and the `after:` overlap.
- Scope validation: missing readonly, extra Gmail scope, unexpected scope.
- `id_token` claim checks: wrong `aud`, wrong `iss`, expired, `email_verified=false`, email not on the allowlist.
- The read-only endpoint allowlist and `format=metadata`.
- Budget arithmetic.

**Integration (workerd + D1, a fake Gmail and OAuth client injected through an interface, no network):**
- Connect → callback happy path.
- Allowlist rejection; state reuse, expiry and session mismatch.
- Granted-scope failures, including revoke-on-extra-scope.
- Testing-mode canary.
- Backfill across several ticks.
- Duplicate messages; an expired page token.
- `invalid_grant` → `needs_reauth`, with the other account still syncing.
- Two accounts in one tick under budget; budget exhaustion persisting the cursor.
- Auto-apply vs queue; review resolve; undo of an automatic change.
- Disconnect revokes; wipe revokes connected accounts.
- No plaintext subject, address or snippet in D1.

**Fixtures:** at least 40 synthetic metadata-only emails in `eval/fixtures/`: every class, NZ ATS styles, look-alikes, alerts, malformed headers.

**Eval harness:** `npm run eval` reads `eval/private/labelled.csv` (git-ignored, **Ani provides about 50 real labelled emails**) and prints precision and recall per class plus a confusion matrix.

**E2E (Playwright, 390 and 1440, light and dark):**
- Settings accounts states (seeded): connected, needs reconnect, Testing-mode.
- Review queue one-tap resolution.
- "Since yesterday" with Undo.
- No horizontal scroll; screenshots.

**Benchmarks:** tick CPU with 24 fixture messages; D-009 batch-HTTP parse CPU.

## 11. Gate (spec §17 Phase 2)
| Gate item | How it's met | Needs |
|---|---|---|
| Eval gate met | `npm run eval` precision ≥ 95% on rejection / interview / offer; otherwise those stay review-only | Ani's labelled CSV |
| Both accounts connected | Real OAuth on the deployed Worker | SETUP steps 2–6 + **Ani's deploy approval** |
| 24 h of ticks with no unexplained errors | `sync_runs` + dashboard | deployed |
| CPU and subrequest metrics recorded | Dashboard p99 → DECISIONS | deployed |
| All tests green | unit + integration + e2e + lint + typecheck + audit | — |

Everything except the deployed items can be completed and tested locally before any deployment.

## 12. Voice decisions recorded (Ani, 2026-11-15; no voice code in Phase 2)
- **Fallback STT = Cloudflare Workers AI Whisper** when on-device recognition is unavailable:
  - the mic turns on only after an explicit tap;
  - audio is processed in memory and never stored or logged;
  - transcripts and conversation content are never logged;
  - text input stays a full alternative.
- **Allowance and retention**, verified 2026-11-15 and to be **re-verified at V1 start**: Workers AI free allocation 10,000 Neurons/day, reset 00:00 UTC; whisper-large-v3-turbo ≈ 46.6 Neurons/audio-minute (about 214 min/day); "Zero data retention" and "No training" per the data-usage page. No paid models.
- **Phase 8 is not brought forward.** V1 (after Phase 6): spoken briefings, voice commands, confirmation cards. V2 (Phase 8): genuine conversation with follow-ups, interruptible speech, shared access to GRU's existing data and memory, and actions only through the existing permission-controlled APIs. No separate voice database or duplicate memory.

## 13. Risks
| Risk | Mitigation |
|---|---|
| Google rejects PKCE on a web client | Drop the parameter, record it; state + client_secret remain |
| Testing-mode tokens expire after 7 days | Canary + "In production" SETUP checkbox |
| CPU near 10 ms on large ticks | Fewer messages per tick (configurable); measure p99 after deploy |
| Over-eager classification | Eval gate; high-impact classes review-only until precision is proven; Undo everywhere |
| Gmail search query misses some ATS mail | Editable `jobQuery.ts`; eval set shows the misses |
