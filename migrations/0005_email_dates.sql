-- GRU migration 0005: show the real email date, not the date GRU first saw the email.
UPDATE applications SET
  applied_at = COALESCE((SELECT MIN(e.internal_date) FROM emails_seen e WHERE e.app_id = applications.id AND e.internal_date > 0), applied_at),
  last_event_at = COALESCE((SELECT MAX(e.internal_date) FROM emails_seen e WHERE e.app_id = applications.id AND e.internal_date > 0), last_event_at)
WHERE source = 'email';

UPDATE events SET at = COALESCE(
  (SELECT e.internal_date FROM emails_seen e WHERE e.account_id = events.account_id AND e.gmail_id = events.gmail_id AND e.internal_date > 0), at)
WHERE gmail_id IS NOT NULL;
