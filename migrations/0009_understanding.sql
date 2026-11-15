-- GRU migration 0009: understanding job mail by its words, vacancies from alerts, deadlines, recruiter contacts.
ALTER TABLE emails_seen ADD COLUMN body_class TEXT;   -- class decided from the email text (rule only, never the text)

-- Dates stated in emails that need action (assessment due, offer reply, interview reply).
CREATE TABLE deadlines (
  id INTEGER PRIMARY KEY,
  app_id INTEGER,
  kind TEXT NOT NULL,            -- assessment|offer_reply|interview_reply|other
  due_at INTEGER NOT NULL,       -- UTC epoch seconds
  account_id INTEGER, gmail_id TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX idx_deadline_unique ON deadlines(app_id, kind, due_at);
CREATE INDEX idx_deadline_due ON deadlines(done, due_at);

-- People who write to you about jobs. Name and address are encrypted; addr_hmac is a keyed hash for de-duplication.
CREATE TABLE contacts (
  id INTEGER PRIMARY KEY,
  addr_hmac TEXT NOT NULL UNIQUE,
  name_enc TEXT, email_enc TEXT, notes_enc TEXT,
  company TEXT, app_id INTEGER,
  first_seen_at INTEGER NOT NULL, last_contact_at INTEGER NOT NULL,
  msg_count INTEGER NOT NULL DEFAULT 1);
CREATE INDEX idx_contacts_recent ON contacts(last_contact_at);
