-- GRU migration 0010: re-read the last 5 days of job mail with the improved text rules (e.g. "we chose another candidate"),
-- and rescore vacancies (title-only alert vacancies now get a provisional score from what can be judged).
UPDATE emails_seen SET body_checked = 0 WHERE internal_date >= CAST(strftime('%s', 'now') AS INTEGER) - 5 * 86400;
DELETE FROM job_matches;
