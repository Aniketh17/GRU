# GRU: Private Job-Search Assistant (spec)

> Source: build prompt by Ani, dated 15 November 2026, saved verbatim except:
> - the two real Gmail addresses are replaced with `<GMAIL_ACCOUNT_1>` / `<GMAIL_ACCOUNT_2>` (spec rule 5: no real data in the repo; the real values live only in the `ALLOWED_EMAILS` secret),
> - the persona addendum below.
>
> **Persona addendum (Ani, 2026-11-15):** the assistant is named **GRU** and addresses the user as **Ani**. Vision: "like Jarvis, but for job search and my everyday tasks and calendar schedules." The calendar/everyday-tasks part conflicts with non-goal §19 ("calendar integration") and was resolved by Ani on 2026-11-15 (option B, see §21).
>
> Where docs/DECISIONS.md records a verified finding that contradicts a number here, DECISIONS.md wins.

---

## 0. Operating rules for the agent
You are building a single-user, privacy-first, $0-cost personal assistant. These rules apply to the whole project.
1. Plan before code. At the start of every phase, produce an implementation plan (files, schema changes, tests, risks). Write no code until I approve it. After each phase, produce a walkthrough with evidence: test output, plus screenshots at 390x844 for any UI.
2. Stop at every gate (section 16) and wait for my approval.
3. Verify, do not assume. Before relying on any Cloudflare, Google or ntfy limit or feature, read the current official docs and record what you found, with the date, in docs/DECISIONS.md. Treat every number in this prompt as a hypothesis.
4. $0 rule. Never enable a paid plan, add a payment method, or use a feature that needs billing. If a requirement cannot be met on the free tier, stop and give me options.
5. No secrets or real data in the repo, tests, logs, commits or chat. Use synthetic fixtures only. Secrets live in Cloudflare secrets and a git-ignored .dev.vars file.
6. Minimal dependencies. Pin exact versions. Justify each runtime dependency in DECISIONS.md. Prefer platform APIs (WebCrypto, fetch, Intl).
7. Ask before running any terminal command that deletes or overwrites remote resources or changes account-level settings.
8. Scope discipline. Build only what this spec lists (non-goals are in section 18). Record and flag any deviation.
9. Every testable behaviour in this spec gets a test.

## 1. Product
- User: one person, Ani, in Auckland, NZ (timezone Pacific/Auckland), job hunting for graduate, junior and internship roles in AI and software.
- What it is: a phone-first web app that (a) tracks every application and its status, (b) watches two Gmail inboxes read-only and updates statuses from application emails, (c) detects job-alert emails, extracts individual vacancies, scores each vacancy against the user's current resume out of 100, and prepares a ranked Apply Tomorrow shortlist, (d) gives a deterministic morning brief and a short check-in, (e) manages interviews (prep, reminders, debriefs), and (f) later holds quick notes.
- Success: each morning the user opens one screen, sees application changes plus a ranked shortlist of suitable jobs discovered from job alerts, can review the match score and evidence, and answers at most four quick prompts in under 90 seconds. The system is correct, visibly honest when it fails, and costs nothing.

## 2. Non-negotiable constraints
- Cost: $0 software and hosting. Cloudflare Workers Free, D1, static assets, cron triggers. No paid third-party service.
- Privacy: no third-party LLM API, ever. Gmail is read-only. Ordinary email bodies are never stored. Job-alert email content may be fetched and processed transiently because vacancy details are required; persist only extracted job fields, a short encrypted description/summary where needed, the source message ID, and the job URL. Never retain the raw email body. Resume content is sensitive and must be encrypted at rest. No email text, resume text, job-description text or match rationale in logs, notifications, analytics or error reports. No telemetry, no third-party scripts, no web fonts from CDNs.
- Kill switch: pause, lock and wipe, all working and tested (section 14).
- Phone-first: installable PWA, usable one-handed at 390px wide, works on iPhone and Android.
- Low maintenance: every failure is surfaced in the app and in the morning brief, never silent. No manual weekly chores.
- Single user: no multi-tenant code, no sign-up flow.

## 3. Identity, accounts and manual setup
Mail sources (both are the user's own Gmail accounts):
- `<GMAIL_ACCOUNT_1>`
- `<GMAIL_ACCOUNT_2>`

Store these as an allowlist in the Worker secret ALLOWED_EMAILS (comma-separated), never hard-coded in source. The same allowlist gates (a) who can log in and (b) which Google accounts may be connected. Reject any other account at the OAuth callback.

Manual steps the human does (write them into docs/SETUP.md as a numbered checklist with exact click paths, and walk me through them):
1. Cloudflare account, wrangler login, create D1 database, set secrets.
2. Google Cloud project: enable Gmail API; OAuth consent screen type External; scopes gmail.readonly, openid, email; create a Web application OAuth client with redirect URIs for the deployed Worker and for http://localhost:8787; then set the publishing status to In production (an unverified-app warning screen is expected; click through it). Reason: refresh tokens issued while the app is in Testing expire after 7 days.
3. Generate keys with scripts/gen-keys.ts (DATA_KEY_V1, INDEX_KEY, SESSION_SECRET, NTFY_TOPIC) and store them in a password manager as well as in Cloudflare secrets. If DATA_KEY_V1 is lost, data is unrecoverable by design.
4. Install the ntfy app on the phone and subscribe to the random topic.
5. Passkey or app-based 2FA on the Cloudflare account and on both Google accounts (account takeover is the main residual risk).

Token expiry canary: when exchanging an authorization code, if the token response contains refresh_token_expires_in, the app is still in Testing mode. Show a red banner on the Settings and Today screens and notify.

## 4. Stack and repo layout
- Runtime: Cloudflare Worker, TypeScript (strict), Hono for routing, Zod for validation.
- Database: D1 with numbered SQL migrations (wrangler d1 migrations). No ORM.
- Frontend: Vite + React + TypeScript + Tailwind, TanStack Query, React Router. System font stack. Served by the same Worker via the static assets binding with SPA fallback.
- Tests: Vitest with @cloudflare/vitest-pool-workers; Playwright or the Antigravity browser agent for UI checks.
- Scheduling: Cron Triggers.
- Notifications: ntfy (public server, content-free messages only), behind a Notifier interface. Notifications may say that new matched jobs are ready, but must not contain job titles, companies, scores, salary or other personal/job details.
- Auth: AuthProvider interface (section 7).

```
/apps/worker/src  index.ts routes/ mail/ classify/ jobs/ matching/ resume/ crypto/ db/ auth/ notify/ kill/ log/
/apps/web/src     pages/ components/ lib/ sw/
/migrations       0001_init.sql ...
/scripts          gen-keys.ts lock.ts unlock.ts wipe.ts
/eval             fixtures/ (synthetic) private/ (git-ignored)
/docs             SETUP.md DECISIONS.md RUNBOOK.md PRIVACY.md
```

## 5. Free-tier engineering rules (design around these)
Hypotheses to verify in the docs first. As far as I know, Workers Free allows 100,000 requests/day, 10 ms CPU per invocation (network waiting does not count), 128 MB memory and 50 subrequests per invocation, where D1 and other Cloudflare service calls also count. D1 Free is 5 GB total, 5M rows read/day, 100k rows written/day. Workers AI Free is 10,000 neurons/day with a hard stop until 00:00 UTC. Exceeding a daily cap makes requests fail rather than slow down.

Rules that follow:
1. Implement SubrequestBudget (limit 40 per invocation). Every fetch and D1 call goes through it. When exhausted, persist the cursor and stop cleanly.
2. Use D1 batch() for multi-statement writes; confirm in docs how batches count.
3. Fetch Gmail messages with format=metadata and a fields mask only. Never parse MIME in the sync path.
4. Precompile regexes, avoid backtracking-prone patterns, no heavy libraries in the Worker.
5. Process at most 12 messages per tick; the backlog drains over successive ticks.
6. After deploying, read CPU-time and subrequest metrics in the dashboard and record the p99 in DECISIONS.md. If CPU is near 10 ms, reduce batch sizes.
7. If Gmail batch HTTP requests would materially cut subrequests, evaluate them and report before adopting.
8. Provide a documented fallback when any free daily cap is hit: degrade (queue for review, skip AI), never error loudly or loop.

## 6. Data model (migration 0001)
Timestamps are integer epoch seconds (UTC). Columns ending in _enc hold AES-GCM envelopes (section 7).

```sql
CREATE TABLE mail_accounts (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE,
  refresh_token_enc TEXT, access_token_enc TEXT, access_expires_at INTEGER,
  status TEXT NOT NULL DEFAULT 'disconnected', -- disconnected|active|needs_reauth|paused
  last_sync_at INTEGER, last_error_code TEXT,
  sync_after_epoch INTEGER, backfill_page_token TEXT, backfill_done INTEGER NOT NULL DEFAULT 0,
  testing_mode_detected INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);

CREATE TABLE applications (
  id INTEGER PRIMARY KEY, company TEXT NOT NULL, company_norm TEXT NOT NULL,
  role TEXT, role_norm TEXT,
  source TEXT NOT NULL DEFAULT 'manual', -- manual|email|seek|linkedin|referral|other
  status TEXT NOT NULL DEFAULT 'applied',
  -- applied|assessment|interview|offer|accepted|declined|rejected|withdrawn
  applied_at INTEGER, last_event_at INTEGER, next_action TEXT, next_action_due INTEGER,
  stale INTEGER NOT NULL DEFAULT 0, notes_enc TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX idx_app_status ON applications(status, last_event_at);
CREATE INDEX idx_app_company ON applications(company_norm);

-- Resume profile: one active, versioned resume profile for matching.
CREATE TABLE resume_profiles (
  id INTEGER PRIMARY KEY, version INTEGER NOT NULL, label TEXT NOT NULL,
  resume_text_enc TEXT NOT NULL, structured_json_enc TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL);
CREATE INDEX idx_resume_active ON resume_profiles(active, version);

-- Individual vacancies extracted from job-alert emails.
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY, source TEXT NOT NULL, source_account_id INTEGER,
  source_gmail_id TEXT, source_domain TEXT, external_id TEXT,
  canonical_url TEXT, title TEXT NOT NULL, company TEXT, company_norm TEXT,
  location TEXT, work_arrangement TEXT, employment_type TEXT,
  salary_text TEXT, posted_at INTEGER, closing_at INTEGER,
  description_enc TEXT, summary_enc TEXT, requirements_enc TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  -- new|shortlisted|saved|dismissed|applied|expired|closed
  first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX idx_jobs_url ON jobs(canonical_url) WHERE canonical_url IS NOT NULL;
CREATE INDEX idx_jobs_status_score ON jobs(status, first_seen_at);

-- One match result per job and resume version; re-score when resume changes.
CREATE TABLE job_matches (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL,
  resume_profile_id INTEGER NOT NULL, score INTEGER NOT NULL,
  band TEXT NOT NULL, -- strong|good|possible|low
  skills_score INTEGER NOT NULL, role_score INTEGER NOT NULL,
  experience_score INTEGER NOT NULL, education_score INTEGER NOT NULL,
  location_score INTEGER NOT NULL, work_type_score INTEGER NOT NULL,
  domain_score INTEGER NOT NULL, evidence_json_enc TEXT NOT NULL,
  gaps_json_enc TEXT NOT NULL, confidence TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'pending',
  -- pending|shortlisted|dismissed|needs_review
  scored_at INTEGER NOT NULL,
  UNIQUE(job_id, resume_profile_id));
CREATE INDEX idx_job_matches_score ON job_matches(score DESC, decision);

CREATE TABLE emails_seen (
  account_id INTEGER NOT NULL, gmail_id TEXT NOT NULL, thread_id TEXT NOT NULL,
  internal_date INTEGER NOT NULL, from_domain TEXT, class TEXT, confidence REAL, rule_id TEXT,
  app_id INTEGER, disposition TEXT NOT NULL, -- ignored|auto_applied|queued|linked
  snippet_enc TEXT, PRIMARY KEY (account_id, gmail_id));
CREATE INDEX idx_seen_thread ON emails_seen(account_id, thread_id);

CREATE TABLE events (
  id INTEGER PRIMARY KEY, app_id INTEGER NOT NULL, type TEXT NOT NULL, at INTEGER NOT NULL,
  account_id INTEGER, gmail_id TEXT, confidence REAL, auto_applied INTEGER NOT NULL DEFAULT 0,
  prev_status TEXT, undone INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);

CREATE TABLE interviews (
  id INTEGER PRIMARY KEY, app_id INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'proposed',
  -- proposed|scheduled|done|cancelled
  start_utc INTEGER, tz TEXT, format TEXT, -- video|phone|onsite|assessment
  prep_enc TEXT, debrief_enc TEXT, rating INTEGER, followup_sent INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);

CREATE TABLE review_queue (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, -- classify|link|interview_time|dedupe
  account_id INTEGER, gmail_id TEXT, app_id INTEGER, proposal_json TEXT,
  created_at INTEGER NOT NULL, resolved_at INTEGER, resolution TEXT);

CREATE TABLE checkins (
  date TEXT PRIMARY KEY, -- local YYYY-MM-DD
  status TEXT NOT NULL DEFAULT 'pending', answers_enc TEXT, completed_at INTEGER);

CREATE TABLE notes (id INTEGER PRIMARY KEY, body_enc TEXT NOT NULL, tags TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE note_tokens (note_id INTEGER NOT NULL, token_hmac TEXT NOT NULL);
CREATE INDEX idx_note_tokens ON note_tokens(token_hmac);

CREATE TABLE notifications_sent (key TEXT PRIMARY KEY, sent_at INTEGER NOT NULL);
CREATE TABLE sync_runs (id INTEGER PRIMARY KEY, account_id INTEGER, started_at INTEGER NOT NULL,
  fetched INTEGER, classified INTEGER, queued INTEGER, error_code TEXT, budget_exhausted INTEGER);
CREATE TABLE oauth_states (state TEXT PRIMARY KEY, verifier_enc TEXT NOT NULL,
  account_hint TEXT, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT); -- paused, kill_state, settings, tick_lock
```

Retention: delete sync_runs older than 30 days, emails_seen.snippet_enc older than 90 days (set NULL), expired oauth_states daily. Retain job-alert source message IDs for deduplication, but do not retain raw alert bodies. Allow the user to delete saved jobs and their encrypted descriptions. Keep historical match results tied to the resume version used; delete them when the associated job or resume version is deleted.

## 7. Security, encryption and logging
Auth (AuthProvider interface).
- Preferred: Cloudflare Access (Zero Trust Free) in front of the Worker, policy allowing only the ALLOWED_EMAILS identities. The Worker must still verify the Cf-Access-Jwt-Assertion JWT (RS256, team JWKS, aud tag, email in allowlist). First confirm in the docs whether the free plan needs a payment method. If it does, stop and ask me.
- Fallback: in-Worker Google sign-in (scopes openid email, PKCE, email_verified true, email in allowlist) issuing an HMAC-SHA256 signed session cookie: HttpOnly, Secure, SameSite=Strict, 30-day expiry. Do not use PBKDF2 or bcrypt; they blow the 10 ms CPU budget.
- Unauthenticated requests get 401 and no data. Only the static shell and the login route are public.

Request hygiene. All mutating routes require JSON content type, a custom X-App header, and an Origin check. Security headers on every response: CSP default-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self', HSTS, Referrer-Policy: no-referrer, X-Content-Type-Options: nosniff, and Cache-Control: no-store on /api.

Field encryption. AES-256-GCM via WebCrypto, random 96-bit IV, envelope v1.<keyid>.<iv>.<ciphertext> (base64url), AAD = table:column:rowid. Key from Worker secret DATA_KEY_V1; support multiple key ids for rotation. Encrypt: refresh and access tokens, snippets, notes, prep, debriefs, check-in answers, application notes. Leave plaintext only what queries need: company, role, status, dates. Tests: round trip, tamper detection, wrong AAD fails, wrong key fails.

Blind index for notes. Encrypted notes are searched with an HMAC-SHA256 token index keyed by INDEX_KEY (lowercase words, 3+ chars, deduplicated, max 64 per note). Exact-word search only. Document this limitation in PRIVACY.md.

Logging. One log(event, fields) helper whose fields are an allowlist (ids, counts, status codes, durations, error codes). Anything else is dropped. Lint-ban raw console.* elsewhere. A test must prove that keys like subject, snippet, body, from and email are rejected.

Notifications are content-free (section 13).

## 8. Gmail OAuth and sync
Connect flow. /api/mail/connect?hint=<email> creates a single-use state (10-minute expiry, stored in oauth_states with an encrypted PKCE verifier) and redirects to Google with scopes gmail.readonly openid email, access_type=offline, prompt=consent, include_granted_scopes=false, login_hint. The callback verifies state, exchanges the code, reads the email from the id_token (email_verified true), rejects anything not in the allowlist, stores the refresh token encrypted, applies the token expiry canary (section 3), and sets status=active with sync_after_epoch = now - 90 days.

Tick (every 15 minutes, one cron). A tick takes a lock in kv (tick_lock, 5-minute expiry), then:
1. If kv paused or kill_state is not running, exit immediately.
2. Order accounts by oldest last_sync_at. For each active account while budget remains:
   - Reuse the cached access token if it is valid for another 120 seconds, else refresh it (1 subrequest). On invalid_grant, set needs_reauth, notify (generic), and skip.
   - messages.list with q built by jobQuery.ts plus after:<sync_after_epoch - 300> (overlap protects against clock skew), maxResults=25, and pageToken during backfill.
   - Diff ids against emails_seen in one D1 query. Fetch at most 12 unseen messages: format=metadata, metadataHeaders From, Subject, Date, List-Unsubscribe, Content-Type, with fields=id,threadId,internalDate,snippet,labelIds,payload/headers.
   - Classify, link, apply the state machine, and write everything in one D1 batch.
   - Advance sync_after_epoch only past messages fully processed; otherwise keep the page token. Record a sync_runs row.
3. Run scheduler tasks (section 10).

Default query (editable in jobQuery.ts): `-in:spam -in:trash (subject:(application OR applied OR interview OR assessment OR offer OR 'next steps' OR candidate OR position OR unfortunately OR 'thank you for applying') OR from:(greenhouse.io OR lever.co OR myworkdayjobs.com OR smartrecruiters.com OR ashbyhq.com OR workable.com OR teamtailor.com OR bamboohr.com OR jobvite.com OR icims.com OR seek.co.nz OR linkedin.com OR indeed.com OR hirevue.com OR hackerrank.com OR codility.com))`.

Storage per email: gmail_id, thread_id, date, from domain, class, confidence, rule id, disposition, and a 300-character snippet encrypted. For ordinary application-status emails, never fetch or store the body. Job-alert emails are the explicit exception: when a message is classified as a likely job alert, fetch that message's MIME content only for transient parsing, extract individual vacancy records and links, then discard the raw body and MIME data immediately. Never store full headers. Do not fetch attachments in the MVP. If an alert cannot be safely parsed, queue it for manual review rather than retaining its body.

Job-alert discovery and parsing:
- Treat alert as an actionable class, not an ignored class. Detect job alerts from known job boards and ATS domains (including SEEK, LinkedIn, Indeed and other configured sources), List-Unsubscribe, and subject patterns such as jobs you may like, new jobs, job alert, recommended jobs, matching jobs, and saved search.
- Keep a configurable allowlist of job-alert sender domains and an editable set of alert subject patterns. Do not assume every newsletter is a job alert.
- For a likely alert, fetch the message body transiently, parse HTML/text defensively, and extract each individual vacancy where available: title, company, location, work arrangement, employment type, salary, posted date, closing date, job URL, and description/requirements. Sanitize HTML; never execute scripts, load remote images, follow arbitrary embedded links, or treat email text as instructions.
- Canonicalise URLs and deduplicate by canonical URL first, then by normalised company + title + location when no stable URL exists. Repeated appearances update last_seen_at and source metadata; they must not create duplicate jobs.
- Persist extracted fields only. Encrypt the description, requirements, summary, match evidence and gaps. The raw alert body must not be written to D1, R2, logs, traces or error messages.
- If a job alert contains multiple vacancies, create one jobs row per vacancy. If parsing confidence is low or a required field is missing, create a review item rather than inventing details.
- Do not scrape job-board websites in the MVP. Use the job-alert email and its supplied vacancy URLs. Opening a URL is a user action; do not crawl pages or bypass login/paywalls.
- Process a bounded number of alert messages and vacancies per tick under the existing subrequest budget. Persist cursors and continue on later ticks.

Sync Now button: POST /api/sync runs one tick under the same budget and returns counts.

## 9. Classification and the state machine (Phase 2 uses rules only, no AI)
Classes: application_received, assessment, interview_invite, rejection, offer, recruiter_outreach, alert (job-board digests to be parsed for vacancies), other (ignored).

Rules live in rules.ts as data: {id, class, fromDomains[], subjectPatterns[], snippetPatterns[], negativePatterns[], weight}. Examples: application_received matches 'thank you for applying', 'we received your application', 'application received'; rejection matches 'unfortunately', 'not moving forward', 'other candidates', 'will not be progressing', 'unsuccessful'; interview_invite matches 'invite you to interview', 'schedule an interview', 'availability', calendar content-type, scheduling-tool domains; assessment matches 'online assessment', 'coding challenge', 'take-home', HackerRank, Codility, HireVue; offer matches 'pleased to offer', 'offer of employment', 'offer letter'. Mail with List-Unsubscribe whose subject looks like a job digest ('jobs you may like', 'job alert', 'new jobs', 'recommended jobs') is alert; generic newsletters remain other.

Confidence: base weight per rule, +0.1 for a known ATS or board domain, +0.1 when subject and snippet both match, minus 0.3 per negative pattern, cap 0.99. Ties go to the highest-impact class and are queued.

Linking an email to an application, in order:
1. Same account and thread_id as a previous linked email.
2. Exactly one application whose company_norm matches the company extracted from the sender display name, ATS subject patterns ('at X', 'to X', 'with X') or domain.
3. Otherwise unlinked.

Normalisation (company_norm, role_norm): lowercase, strip punctuation and legal suffixes (ltd, limited, inc, nz), collapse whitespace.

Transitions:

| From | Allowed to |
|---|---|
| applied | assessment, interview, offer, rejected, withdrawn |
| assessment | interview, offer, rejected, withdrawn |
| interview | offer, rejected, withdrawn |
| offer | accepted, declined, rejected, withdrawn |
| accepted, declined, rejected, withdrawn | none automatically (user can override) |

No automatic downgrades: a late 'application received' email never moves an application out of interview.

Auto-apply policy. Auto-apply only when the email is linked AND confidence >= 0.90 AND the class is application_received, assessment or interview_invite. rejection and offer auto-apply only when thread-linked with confidence >= 0.95. Everything else becomes a review_queue item. An unlinked application_received with a confident company creates a new application (source=email); with no company it is queued. Every auto change records prev_status and shows in the brief with an Undo (revert within 24 hours, creating an undone event).

Interview invites create an interview in state proposed plus a review item interview_time (one-tap form for date, time, timezone, format). Do not extract dates in Phase 2.

Optional Phase 7 (feature flag AI_CLASSIFIER, default off). Add a Workers AI adapter for emails that rules leave unresolved. Input is only sender domain, subject and a 300-character snippet, wrapped in delimiters and labelled as untrusted data. Temperature 0, output validated against a strict Zod schema {class, confidence}, anything invalid goes to review. Track daily neuron use and degrade to the review queue at the cap. The model must never cause an action. Pick a small instruct model after reading the current catalog. First read Cloudflare's current Workers AI data-usage page and record it.

## 10. Resume-based job matching
Resume setup:
- Add a Resume section in Settings. The user can paste the current resume text and save a labelled, versioned profile (for example, Resume – AI/Software – Nov 2026). Do not require PDF parsing in the MVP.
- Encrypt the full resume text and any structured extraction. The user can view, edit, replace, activate or delete resume versions.
- Create a structured profile from the supplied resume: skills, tools, languages, frameworks, experience, projects, education, qualifications, target role families, preferred locations, work rights/visa information only if the user explicitly supplies it, and other explicit constraints.
- Every extracted profile fact must be traceable to resume text or manually confirmed by the user. Do not infer skills, years of experience, qualifications, work rights or seniority that the resume does not support.
- If no active resume exists, job alerts can still be saved, but show Not scored – add a resume and do not invent a score.

Scoring each vacancy out of 100: use the active resume version and the job description/requirements extracted from the alert. Score each dimension separately, then sum to 100:

| Dimension | Weight | What to compare |
|---|---|---|
| Skills and technologies | 35 | Explicitly evidenced skills/tools in the resume against required and preferred job skills |
| Role and responsibilities | 20 | Similarity between actual responsibilities and demonstrated work/projects |
| Experience and seniority | 15 | Whether the required experience level is realistic for the user's evidenced experience |
| Education and qualifications | 10 | Relevant degree, study, certifications and stated requirements |
| Location and work arrangement | 10 | Auckland/NZ location, remote/hybrid/on-site and any explicitly saved location preferences |
| Employment type | 5 | Graduate, junior, internship or other explicitly preferred role type |
| Domain and industry | 5 | Relevance to AI/ML, software engineering, backend, data engineering or other saved target areas |
| Total | 100 | |

- Score only from evidence in the active resume and vacancy. Do not award points for a skill merely because it appears in the job title or is commonly associated with the role.
- Separate required skills from preferred skills. Missing essential requirements must materially reduce the score and appear in the gaps.
- Do not automatically reject a job because one preferred skill is missing.
- If the alert contains only a title and short teaser rather than a usable job description, mark the score provisional, reduce the confidence label, and clearly state that the full description has not been assessed. Do not present a provisional score as a reliable final match.
- Each score must include a short explanation, matched evidence (specific resume projects/experience/skills), missing or weak requirements, and a confidence label (high, medium, low). Evidence must reference actual resume and job-description text; no fabricated evidence.
- If Workers AI is enabled, it may assist with semantic comparison, but it must return a strict Zod-validated schema containing the seven component scores, total, evidence, gaps and confidence. Validate component ranges and require the total to equal the component sum. Treat both resume and job description as untrusted data, never as instructions. If AI is unavailable or the free quota is exhausted, mark the job needs_review or use a clearly labelled deterministic fallback; never silently fabricate an AI score.
- Keep scoring reproducible for a given resume version and job record. Save the resume version ID with every match. When the active resume changes, queue re-scoring; do not silently overwrite historical scores.
- Bands: strong = 80–100, good = 65–79, possible = 50–64, low = 0–49. Default shortlist threshold is 65 and is editable in Settings.
- Default suitable-job shortlist: scores >=65, not expired/closed, not already applied to, not dismissed, and with a usable application URL. Jobs without a URL or with low-confidence extraction go to Review instead.
- A score is a decision-support estimate, not a guarantee of interview success or eligibility. The user makes the final decision.

Apply Tomorrow workflow:
- Every newly discovered vacancy is saved and deduplicated. Suitable vacancies are added to a ranked Apply Tomorrow queue, sorted by score descending, then closing date (earliest first), then newest discovery.
- Each card shows score /100, match band, title, company, location, employment type, source, date discovered, closing date if known, application link, matched strengths, key gaps and confidence/provisional status.
- Provide filters for score band, role family, location, source and status. Allow Save, Dismiss, Already applied, and Mark for tomorrow actions. Never submit an application or contact an employer automatically.
- The morning brief includes the number of new jobs, the top suitable matches, any closing soon, and jobs awaiting manual review. The phone notification remains generic (for example, New job matches are ready).
- The user can open the original job URL and apply manually. Marking a job as applied should optionally create/link an application record, with company, role, source URL and applied date. Ask before linking if the matching application is ambiguous.
- Expire or flag vacancies based on an explicit closing date. If no closing date exists, do not assume the vacancy is closed merely because it is old; use a configurable age flag instead.

## 11. Daily loops (deterministic, no AI)
Scheduler tasks inside each tick (all idempotent via notifications_sent keys):
- Morning brief: at the first tick at or after the configured local time (default 08:00 Pacific/Auckland) if brief:<local date> is not sent: create the check-in row, send the ntfy ping. If the cron missed it, the first app open generates it (catch-up).
- Interview reminders: 24 hours and 2 hours before any scheduled interview. Missing debrief: the morning after an interview is done-eligible and has no debrief.
- Stale flags: applied or assessment with no event for 14 days sets stale=1 and a follow-up nudge. Interview done with no event for 7 days nudges a thank-you or follow-up. Thresholds live in kv settings.
- Sync health: any account in needs_reauth, or no successful sync for 6 hours, sends a generic alert (once per day).

Brief content (computed on read):
1. Changes since the last brief (auto-applied, with Undo).
2. Needs your input (review count).
3. Interviews in the next 48 hours and missing debriefs.
4. Follow-ups due.
5. Pipeline counts by status.
6. New job matches: count, top matches, closing-soon jobs and review-needed alerts.
7. A health line: 'Synced 6 min ago, 2 accounts' or the failure.

Check-in (max four prompts, all skippable):
1. Review items, one at a time, with Confirm / Edit / Dismiss chips.
2. 'Applied anywhere yesterday that did not come via email?' opens the quick-add form.
3. Interview in 48 hours: open the prep card. Interview yesterday without a debrief: open the debrief form.
4. 'What is the one thing that must happen today?' (short text, saved encrypted). The Jobs tab separately presents the ranked Apply Tomorrow queue; reviewing or applying to a job is not forced into the four-prompt check-in.

Debrief fields: rating 1-5, questions asked, what went well, what to improve, follow-up sent (checkbox), next step and date.

Timezone rules. Store UTC plus an IANA tz. Compute local dates with Intl.DateTimeFormat. Tests must cover NZ daylight-saving boundaries: starts 2026-09-27, ends 2027-04-04.

## 12. API (all under /api, auth required, Zod-validated)
- GET /health, POST /sync
- GET/POST /applications, GET/PATCH/DELETE /applications/:id, POST /applications/:id/status (manual override), GET /applications/:id/timeline
- POST /events/:id/undo
- GET /interviews, POST /interviews, PATCH /interviews/:id, POST /interviews/:id/debrief
- GET /review, POST /review/:id/resolve
- GET /brief, GET/POST /checkin/today
- GET /mail/accounts, GET /mail/connect, GET /mail/callback, POST /mail/:id/disconnect
- GET/PUT /settings
- GET /export (decrypted JSON, paginated by table)
- POST /admin/pause, POST /admin/resume, POST /admin/wipe
- GET/POST /resume-profiles, PATCH/DELETE /resume-profiles/:id, POST /resume-profiles/:id/activate
- GET /jobs, GET /jobs/:id, PATCH /jobs/:id, POST /jobs/:id/decision, POST /jobs/:id/mark-applied
- GET /job-matches, GET /job-matches/:id, POST /jobs/rescore
- Phase 6: notes CRUD and GET /notes/search?q=

Paginate every list. Cap page size at 50.

## 13. Frontend (mobile-first, 390px baseline, installable PWA)
Bottom tab bar: Today, Jobs, Applications, Interviews, Review, More.
- Today: health chip, brief cards, new-job-match summary, top Apply Tomorrow matches, closing-soon alerts, check-in flow, quick-add (+) button.
- Jobs: ranked Apply Tomorrow queue, score out of 100, match band, matched evidence, gaps, confidence, filters, original application link, and Save / Dismiss / Already applied actions. Include a clear explanation of how the score was calculated.
- Resume: accessible from More/Settings; add, view, edit, activate and delete versioned resume profiles. Show which resume version was used for each job score.
- Applications: status filter chips, search by company or role, stale indicator, swipe or long-press for quick status change. Detail: timeline, next action, notes, linked interviews.
- Interviews: upcoming and past, prep card (static template plus company notes), debrief form.
- Review: the queue with one-tap resolutions.
- More: Settings (accounts with connect, reconnect, disconnect; pause; brief time; thresholds; export), then a Danger zone (wipe), then Notes in Phase 5.

Requirements: touch targets at least 44px, safe-area insets, dark mode via prefers-color-scheme, reduced-motion respected, labelled form controls, visible focus, loading and empty and error states for every screen, no layout shift. PWA manifest and icons, apple-touch-icon, standalone display. The service worker caches hashed static assets only. It must never cache /api responses.

## 14. Notifications (ntfy)
Notifier.send(kind) accepts only a fixed enum, each mapped to a constant string with no variables: brief_ready ('Morning check-in is ready'), interview_soon ('Interview coming up'), review_needed ('Review needed'), action_needed ('Action needed: reconnect Gmail'), followup_due ('Follow-up due'), jobs_ready ('New job matches are ready'). A Click header opens the app URL. NTFY_TOPIC is a 32+ character random secret. A type-level test must make it impossible to pass free text. Read the current ntfy free-tier limits and record them. Keep the interface so self-hosting or Web Push can replace it later.

## 15. Kill switch (built in Phase 0, tested in Phase 7)

| Level | What it does | How |
|---|---|---|
| Pause | Sync and scheduler stop; data stays | In-app toggle sets kv paused; /api/admin/pause |
| Lock | Data becomes unreadable until unlocked | scripts/lock.ts runs wrangler secret delete DATA_KEY_V1 and INDEX_KEY; scripts/unlock.ts restores them from a key the user supplies. App shows a Locked page when decryption is impossible |
| Wipe (in-app) | Revokes access and purges data | Typed phrase WIPE EVERYTHING plus a 10-second hold; sets kill_state=wiping (all other routes 423); revokes each Gmail refresh token at https://oauth2.googleapis.com/revoke; drops and recreates all tables empty; clears kv; sets kill_state=wiped |
| Wipe (full teardown) | Removes the deployment | scripts/wipe.ts (needs the human at the terminal, confirms each step): delete DATA_KEY_V1, INDEX_KEY and all secrets; delete the D1 database; delete the Worker and its assets; print a manual checklist (delete the Google Cloud OAuth client or project; remove the Access app; remove the ntfy subscription; delete the home-screen app; check Cloudflare for any retained point-in-time history for D1 and record the retention you find) |

Independent backstops, documented in RUNBOOK.md: revoke the app at myaccount.google.com/permissions for either Gmail account; delete the OAuth client in Google Cloud (kills every refresh token); disable the Access policy.

Acceptance: after Wipe, a protected API call returns 423 or 401, Google's token endpoint returns invalid_grant for the old refresh token, all tables are empty, and no key material remains. A wipe drill on seeded synthetic data is a Phase 7 gate.

The app must never hold a Cloudflare API token (a stolen token would be worse than the data). That is why full teardown is a local script. Wipe must also delete all saved jobs, match results, resume profiles and encrypted vacancy descriptions.

## 16. Testing and evaluation
- Unit: crypto, log allowlist, SubrequestBudget, rules (one test per rule id plus negatives), state machine (property tests: no automatic downgrades, terminal states hold), normalisation, linking order, scheduler idempotency, DST boundaries, brief composition, undo.
- Integration (Miniflare D1 plus a mocked Gmail API): backfill across several ticks, invalid_grant handling, duplicate messages, expired historic page tokens, two accounts in one tick under budget, allowlist rejection at OAuth callback, token canary.
- Fixtures: synthetic only. Create at least 40 fake emails covering every class, NZ ATS styles, multi-job alerts, malformed HTML, tracking URLs, duplicate vacancies, alerts with missing descriptions, and look-alikes (for example, a newsletter containing the word 'unfortunately'). Never commit real resume content or real job-alert emails.
- Job extraction tests: prove that multiple jobs in one alert are extracted independently; duplicate URLs do not create duplicate jobs; malformed or low-confidence alerts go to Review; raw email bodies are not persisted; unsafe HTML and prompt-injection text are treated as untrusted data.
- Scoring tests: create labelled synthetic resume/job pairs covering strong, partial and poor matches. Assert component scores are within their weights, total equals the sum and is 0–100, missing essential requirements reduce the score, unsupported resume claims are never used as evidence, provisional jobs are labelled, and every match references the resume version used.
- Shortlist tests: only jobs meeting the configured threshold and suitability rules appear in Apply Tomorrow; dismissed, expired, closed and already-applied jobs do not appear; closing-date ordering works; marking a job applied creates or links an application only after user confirmation.
- Eval harness: npm run eval reads /eval/private/labelled.csv (git-ignored; I will hand-label about 50 of my real emails: columns id, from_domain, subject, snippet, true_class) and prints precision and recall per class plus the confusion matrix. Gate: precision >= 95% on rejection, interview_invite and offer before their auto-apply thresholds are enabled. Below that, those classes always go to review.
- UI: at 390x844 verify every screen's states, keyboard focus order, and that nothing causes horizontal scroll.
- Failure drills (Phase 6): revoke a token mid-sync, hit a simulated daily cap, drop network for a tick, run a tick with a malformed Gmail response, and open the app while locked and while wiped. Each must produce a visible, calm, accurate state.

## 17. Phases and gates
Each phase starts with an approved plan and ends with a walkthrough. Stop at each gate.

| Phase | Build | Gate (all must pass) |
|---|---|---|
| 0 Foundations | Repo, wrangler config, migrations, crypto module, log helper, AuthProvider, kv kill_state, pause toggle, lock/unlock/wipe script skeletons, docs/SETUP.md | Unauthenticated access blocked; security headers verified; crypto tests green; wipe skeleton runs on an empty DB |
| 1 Dashboard | Application CRUD, events timeline, filters, search, manual status, PWA shell, bottom tabs | Fully usable on a phone with zero Gmail; Lighthouse PWA installable |
| 2 Gmail | OAuth for both accounts, tick, backfill, rules, linking, state machine, review queue, undo, token canary | Eval gate met; both accounts connected; 24 hours of ticks with no unexplained errors; CPU and subrequest metrics recorded |
| 3 Daily loop | Brief, check-in, ntfy, scheduler tasks, stale and follow-up rules | Three real mornings in a row; DST tests green; no duplicate pings |
| 4 Interviews | Interview records, time form, prep card, reminders, debriefs | A real invite flows to reminder to debrief |
| 5 Job discovery | Job-alert parsing, vacancy extraction, deduplication, resume profile, 100-point scoring, Apply Tomorrow queue | Synthetic multi-job alerts produce correct deduplicated records; scores show evidence and gaps; suitable jobs appear in the morning queue |
| 6 Notes | Quick capture, tags, blind-index search, daily priority, Sunday weekly review | Search finds a note by an exact word in under a second |
| 7 Hardening | Failure drills, real wipe drill, export, dependency audit (npm audit, lockfile review), RUNBOOK.md, PRIVACY.md | All drills pass; wipe acceptance criteria met; docs complete |
| 8 Optional AI | Workers AI email classifier and/or resume-to-job semantic matcher behind separate flags | Only after current Workers AI terms and data handling are verified, evaluation demonstrates value, and my explicit approval is given |

## 18. Maintenance design
- Settings and Today show per-account last sync, last error code, queue sizes and the token-canary status.
- Dependencies pinned; a documented npm run upgrade-check that lists outdated packages. Upgrade only when I ask.
- RUNBOOK.md: how to reconnect an account, rotate keys, read metrics, pause, lock, wipe, and redeploy from scratch.
- Record the free-tier limits as verified on the build date in DECISIONS.md, and add a quarterly reminder line to RUNBOOK.md to re-check them.

## 19. Non-goals (do not build)
Sending email or any write access to Gmail; calendar integration; embeddings or semantic search; voice; Notion or Composio export; multi-user; analytics, telemetry or error-reporting SaaS; third-party fonts or scripts; native apps; any paid service; storing raw email bodies; automatic job applications or employer contact; any feature that acts on my behalf without my explicit tap. Job-alert emails may be processed transiently to extract vacancy details as explicitly specified in sections 8 and 10.

## 20. Kickoff instruction
Start with Phase 0 only. First, read the current Cloudflare, Google and ntfy documentation relevant to sections 3, 5, 7 and 14 and write docs/DECISIONS.md with dated findings, flagging anything that contradicts this spec (especially whether Cloudflare Access Free needs a payment method, how D1 batches count against subrequests, and whether Always-free Workers AI terms have changed). Then produce the Phase 0 implementation plan and stop for my approval. Do not write code yet.

## 21. Amendments (approved by Ani, 2026-11-15)
These override the sections they name. Details: docs/ARCHITECTURE.md and docs/DECISIONS.md.
1. **Auth (§7, §3):** replace Cloudflare Access and Google sign-in with single-user username + strong password. Argon2id is computed in the browser (server relief, D-018) because server-side Argon2id exceeds the 10 ms CPU limit. Server-side sessions in a `__Host-` cookie (HttpOnly, Secure, SameSite=Strict) with idle and absolute expiry. Login rate limiting. No registration. Gmail OAuth is fully separate from app login.
2. **Tasks and agenda (§19 non-goal clarified):** Phase 6 adds GRU's own tasks (due date/time, priority, completion), interview and phone-call reminders, a daily agenda and upcoming list, morning-brief integration, and links between tasks, notes and applications. Google Calendar integration remains out of the initial build (a possible future optional phase).
3. **Wipe wording (§15):** wipe makes data immediately inaccessible through GRU but must not claim historical copies are destroyed; D1 Time Travel keeps up to 7 days of restorable history on Free (PRIVACY.md §6).
4. **Gmail recovery (§8):** revoked or expired authorisation → `needs_reauth`, that account's sync pauses, a clear Reconnect status appears, and RUNBOOK documents that a Google password change requires reconnecting.
5. **Notifications (§14):** unchanged and reaffirmed, generic fixed strings only. Phase 6 adds the fixed kind `task_due`.
6. **Cost guard:** Workers Logs disabled; a config test fails the build on paid-only settings or bindings.

## 22. Amendment: voice (approved by Ani, 2026-11-15)
"Voice" is removed from the §19 non-goals. GRU gains a voice interface, as an **additional interface to the existing backend** (no separate assistant, database or memory): talk to GRU with spoken replies, a daily voice briefing, voice commands (tasks, job search, application updates, notes), conversation history, interrupt-and-respond, a concise proactive personality, and full text fallback without microphone permission. Privacy constraints and phasing: docs/ROADMAP.md and DECISIONS D-042.

## 23. Amendment: read job-application email bodies (approved by Ani, 2026-11-15)
Overrides the Phase 2 metadata-only restriction (§8, D-046) and the "no raw email bodies" rule for **job-application mail only**. GRU requests `gmail.readonly` (as originally written in §3) and may open the body of an email only if its headers were classified as job-application mail and it is linked to one of Ani's applications. Bodies are processed in memory and never stored or logged; only the position, a proposed interview time and a meeting link (encrypted) are kept. Write scopes stay forbidden. Details: D-058, PRIVACY.md section 9.
