-- GRU migration 0007: one-time enrichment of already-imported emails (role/source from headers).
ALTER TABLE emails_seen ADD COLUMN enriched INTEGER NOT NULL DEFAULT 0;
