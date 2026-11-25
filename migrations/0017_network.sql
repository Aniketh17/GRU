-- Revamp R3: Network (internship strategy: build relationships before you need them). A CRM, a coach and a reminder system.
-- GRU never reads LinkedIn and never sends anything: Ani does the contacting. Free text about people is encrypted.
CREATE TABLE net_companies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL UNIQUE,
  priority INTEGER NOT NULL DEFAULT 2,           -- 1 high, 2 normal, 3 low
  status TEXT NOT NULL DEFAULT 'not_contacted',  -- not_contacted | researching | contacted | conversation | referral | applied
  source TEXT NOT NULL DEFAULT 'manual',         -- manual | starter | application | seen_hiring
  why_enc TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX idx_netco_status ON net_companies(status, priority);

CREATE TABLE net_people (
  id INTEGER PRIMARY KEY,
  company_id INTEGER,
  name_enc TEXT NOT NULL,
  role_enc TEXT,
  url_enc TEXT,                                   -- their LinkedIn profile link, pasted by Ani
  how_enc TEXT,                                   -- how Ani found them
  stage TEXT NOT NULL DEFAULT 'to_reach',         -- to_reach | drafted | sent | replied | call_booked | call_done | thanked
  warmth INTEGER NOT NULL DEFAULT 1,              -- 1 cold, 2 warm, 3 hot
  next_followup_at INTEGER,
  last_touch_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX idx_netpeople_company ON net_people(company_id);
CREATE INDEX idx_netpeople_follow ON net_people(next_followup_at);

CREATE TABLE net_touches (
  id INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                             -- note | sent | reply | call | thanks
  at INTEGER NOT NULL,
  note_enc TEXT,
  created_at INTEGER NOT NULL);
CREATE INDEX idx_nettouch_person ON net_touches(person_id, at);
CREATE INDEX idx_nettouch_at ON net_touches(kind, at);
