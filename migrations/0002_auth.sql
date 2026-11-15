-- GRU migration 0002: single-user app auth (D-006, D-019, D-024).

-- Server-side sessions. Only SHA-256(token) is stored; the raw token lives in the cookie.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

-- Login rate limiting. bucket = 'global' or 'c:<HMAC of client IP>' (raw IP never stored).
CREATE TABLE login_attempts (
  bucket TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0,
  strikes INTEGER NOT NULL DEFAULT 0);
