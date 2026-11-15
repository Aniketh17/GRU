-- GRU migration 0001: spec section 6 schema, verbatim, plus kv seed rows.
-- Timestamps are integer epoch seconds (UTC). Columns ending in _enc hold AES-GCM envelopes.

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

INSERT INTO kv (k, v) VALUES ('kill_state', 'running'), ('paused', '0');
