-- GRU migration 0006: voice conversation history (ROADMAP Voice #4). Transcripts are encrypted; 30-day retention.
CREATE TABLE voice_log (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL,          -- user|gru
  text_enc TEXT NOT NULL,
  created_at INTEGER NOT NULL);
CREATE INDEX idx_voice_created ON voice_log(created_at);
