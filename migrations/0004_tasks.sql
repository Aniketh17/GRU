-- GRU migration 0004: Phase 6 tasks (spec section 21 amendment 2). Titles are encrypted.
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  title_enc TEXT NOT NULL,
  due_at INTEGER,                         -- UTC epoch seconds, optional
  priority INTEGER NOT NULL DEFAULT 2,    -- 1 high, 2 normal, 3 low
  kind TEXT NOT NULL DEFAULT 'task',      -- task|call|interview_prep
  done_at INTEGER,
  app_id INTEGER,
  note_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL);
CREATE INDEX idx_tasks_open ON tasks(done_at, due_at);
