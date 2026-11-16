-- GRU migration 0012: record each email's MIME shape (types and sizes, never content) so an unreadable email can be diagnosed,
-- and re-read the last 5 days now that the reader looks 8 levels deep.
ALTER TABLE emails_seen ADD COLUMN body_shape TEXT;
UPDATE emails_seen SET body_checked = 0 WHERE internal_date >= CAST(strftime('%s', 'now') AS INTEGER) - 5 * 86400;
