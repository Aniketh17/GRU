# Phase 3: Daily Loop (Implementation Plan)

## 1. Objectives & Scope
**In Scope:**
1. **Deterministic Morning Brief (`GET /api/brief`)**:
   - Changes since last brief (auto-applied events with undo).
   - Review queue count.
   - Follow-ups due (stale applications: applied/assessment > 14 days, interview done > 7 days).
   - Upcoming interviews (next 48h) & missing debriefs.
   - Pipeline summary counts.
   - System sync health line (e.g. "Synced 4 min ago · 2 accounts active").
2. **Daily Check-in Flow (`GET /api/checkin/today`, `POST /api/checkin/today`)**:
   - Up to 4 skippable prompt steps:
     1. Unresolved review items (quick resolve).
     2. Unrecorded applications ("Applied anywhere yesterday that did not come via email?").
     3. Interview prep (if interview in next 48h) or missing debrief.
     4. "What is the one thing that must happen today?" (saved encrypted in `checkins.answers_enc`).
   - Stored in existing D1 `checkins` table (keyed by Auckland date `YYYY-MM-DD`).
3. **Scheduled Notifications (`ntfy`)**:
   - Idempotent alerts triggered inside cron ticks via `notifications_sent` table.
   - Morning ping at brief time (default 08:30 Auckland time): `"GRU: your morning brief is ready"`.
   - Evening ping at 18:30 Auckland time if check-in pending or interview tomorrow: `"GRU: evening check-in ready"`.
   - Sync failure / reauth canary alert (at most once per day): `"GRU: action needed"`.
   - Strict privacy: **Constant generic strings only**. No company names, role titles, or counts in push notifications.
4. **Settings & Preferences (`GET /api/settings`, `PUT /api/settings`)**:
   - Configure brief time (default `08:30`), stale days threshold (default `14`), interview follow-up threshold (default `7`).
   - Stored in `kv` table (`settings`).
5. **Auckland Timezone & DST**:
   - Accurate local date calculations for `Pacific/Auckland` with tests across DST transitions (2026-09-27 and 2027-04-04).
6. **Frontend UI**:
   - Today page: Interactive Morning Brief card and Check-in modal/wizard.
   - Settings page: Daily loop settings (brief time, ntfy status).

**Out of Scope (Later Phases):**
- Full interview prep/debrief form (Phase 4).
- Job vacancy parsing and 100-point matching (Phase 5).
- AI summaries or LLM generation (Phase 8).

---

## 2. API Endpoints
- `GET /api/brief` – Returns computed brief object (changes, review count, follow-ups, pipeline, health).
- `GET /api/checkin/today` – Returns today's check-in status and prompt data.
- `POST /api/checkin/today` – Saves check-in response (`status: 'completed' | 'skipped'`, encrypted answers).
- `GET /api/settings` – Returns user preferences (brief time, stale thresholds).
- `PUT /api/settings` – Updates user preferences.

---

## 3. Database Schema
No new tables needed. Reuses existing schema created in `0001_init.sql`:
- `checkins` (`date TEXT PRIMARY KEY`, `status TEXT`, `answers_enc TEXT`, `completed_at INTEGER`)
- `notifications_sent` (`key TEXT PRIMARY KEY`, `sent_at INTEGER`)
- `kv` (`k TEXT PRIMARY KEY`, `v TEXT`)

---

## 4. Notification & Privacy Guarantees
- Push notifications use `https://ntfy.sh/<NTFY_TOPIC>` using `fetch`.
- If `NTFY_TOPIC` is not set or empty, push notifications are skipped gracefully.
- Payload contains only constant strings with `Click: https://gru.aniketh123ani.workers.dev`.
- No sensitive data (names, employers, statuses, counts) ever leave the Worker isolate.

---

## 5. Test Plan
- **Unit Tests**:
  - Date & timezone helpers: Auckland DST boundaries, local date formatting.
  - Stale detection logic.
  - Brief calculation logic.
  - Notification idempotency & generic string enforcement.
- **Integration Tests**:
  - `GET /api/brief` authenticated & data verification.
  - `GET /api/checkin/today` & `POST /api/checkin/today` happy path, idempotency, encryption.
  - `GET /api/settings` & `PUT /api/settings`.
  - Cron tick running daily loop: triggers morning brief ping at 08:30 local time and records `notifications_sent`.
