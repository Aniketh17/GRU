-- Revamp R2: tailored resume kit per job + resume version (the AI rewrite part; the keyword analysis is computed on the device).
CREATE TABLE job_kits (
  job_id INTEGER NOT NULL,
  resume_profile_id INTEGER NOT NULL,
  kit_enc TEXT NOT NULL,          -- encrypted JSON: rewrites, flags, summary, posting fingerprint
  model TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (job_id, resume_profile_id));
