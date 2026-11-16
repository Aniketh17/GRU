-- GRU migration 0013: bodies whose size was not a multiple of 3 bytes carried base64 "=" padding and were read as empty.
-- Now that padding is handled, re-read the last 5 days.
UPDATE emails_seen SET body_checked = 0 WHERE internal_date >= CAST(strftime('%s', 'now') AS INTEGER) - 5 * 86400;
