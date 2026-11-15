-- GRU migration 0008: body reading for job-related mail (Ani, 2026-11-15; DECISIONS D-058).
ALTER TABLE emails_seen ADD COLUMN body_checked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE interviews ADD COLUMN link_enc TEXT;  -- meeting link (encrypted JSON {url, kind})
