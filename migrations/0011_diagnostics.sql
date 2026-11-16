-- GRU migration 0011: record how much text was read from each email (length only), and re-read the last 5 days with the
-- AI second opinion for paraphrased rejections.
ALTER TABLE emails_seen ADD COLUMN body_chars INTEGER;
UPDATE emails_seen SET body_checked = 0 WHERE internal_date >= CAST(strftime('%s', 'now') AS INTEGER) - 5 * 86400;
