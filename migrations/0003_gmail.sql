-- GRU migration 0003: Phase 2 Gmail OAuth, sync cursors, review queue context, and performance indexes.

ALTER TABLE mail_accounts ADD COLUMN label TEXT;
ALTER TABLE mail_accounts ADD COLUMN granted_scope TEXT;
ALTER TABLE mail_accounts ADD COLUMN last_success_at INTEGER;
ALTER TABLE mail_accounts ADD COLUMN reauth_since INTEGER;
ALTER TABLE mail_accounts ADD COLUMN history_id TEXT;
ALTER TABLE mail_accounts ADD COLUMN backfill_floor INTEGER;
ALTER TABLE mail_accounts ADD COLUMN messages_scanned INTEGER NOT NULL DEFAULT 0;

ALTER TABLE oauth_states ADD COLUMN binding_hash TEXT;
ALTER TABLE oauth_states ADD COLUMN session_hash TEXT;
ALTER TABLE oauth_states ADD COLUMN oidc_nonce TEXT;
ALTER TABLE oauth_states ADD COLUMN created_at INTEGER;

ALTER TABLE review_queue ADD COLUMN context_enc TEXT;

CREATE INDEX IF NOT EXISTS idx_seen_account_date ON emails_seen(account_id, internal_date);
CREATE INDEX IF NOT EXISTS idx_review_open ON review_queue(resolved_at, created_at);
CREATE INDEX IF NOT EXISTS idx_events_app ON events(app_id, at);
