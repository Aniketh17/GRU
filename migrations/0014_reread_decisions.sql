-- GRU migration 0014: re-read mail that was concluded to be a rejection/offer/interview/assessment, so the improved rules
-- (lower auto-apply bar for clear text, and re-proposing after a dismissed wrong guess) take effect.
UPDATE emails_seen SET body_checked = 0
 WHERE internal_date >= CAST(strftime('%s', 'now') AS INTEGER) - 5 * 86400
   AND (class IN ('rejection', 'offer', 'interview_invite', 'interview_update', 'assessment', 'application_update', 'application_received') OR disposition = 'queued');
