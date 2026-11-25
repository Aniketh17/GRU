-- Revamp R1: inbox triage, already-applied detection (docs/plans/REVAMP.md). All additive.
-- Jobs: duplicate / already-applied detection.
ALTER TABLE jobs ADD COLUMN title_norm TEXT;
ALTER TABLE jobs ADD COLUMN applied_app_id INTEGER;
ALTER TABLE jobs ADD COLUMN dedupe_status TEXT NOT NULL DEFAULT 'none'; -- none | likely_applied | confirmed | not_same
ALTER TABLE jobs ADD COLUMN dedupe_reason TEXT;
CREATE INDEX idx_jobs_company ON jobs(company_norm);

-- Mail: encrypted subject and sender (kept 30 days) so the Inbox can show mail GRU could not classify; the user's own decision.
ALTER TABLE emails_seen ADD COLUMN subject_enc TEXT;
ALTER TABLE emails_seen ADD COLUMN from_enc TEXT;
ALTER TABLE emails_seen ADD COLUMN user_class TEXT;
ALTER TABLE emails_seen ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_seen_inbox ON emails_seen(disposition, ignored, internal_date);

-- "Never read mail from this sender": checked before anything about a message is stored.
CREATE TABLE sender_rules (
  domain TEXT PRIMARY KEY,
  action TEXT NOT NULL DEFAULT 'ignore',
  created_at INTEGER NOT NULL);

-- Chat history is now deleted when the chat closes: clear what is already stored (Revamp 3F).
DELETE FROM voice_log;
