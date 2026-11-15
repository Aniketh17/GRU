# GRU: Privacy

Last updated 2026-11-15. This file describes what GRU stores, where it lives, who can read it, and what "wipe" does and does not do. It is written so that every claim is true; where a guarantee is limited, the limit is stated.

## 1. Where data lives
- **Cloudflare D1** (one SQLite database in Ani's own Cloudflare account) holds all application data.
- **Cloudflare Worker secrets** hold keys, the login verifier and OAuth client credentials.
- **Nothing else.** GRU has no analytics, no telemetry, no error-reporting service, no third-party scripts or fonts, and no third-party LLM. Cloudflare Workers Logs is switched off (`observability.enabled = false`).

## 2. What is stored
| Data | Stored as | Notes |
|---|---|---|
| Application company, role, status, dates | Plaintext | Needed for filtering and sorting |
| Application notes, interview prep and debriefs, check-in answers, notes, task titles and bodies | AES-256-GCM encrypted | Key `DATA_KEY_V1` (Worker secret) |
| Gmail refresh/access tokens | Encrypted | Read-only scope |
| Email metadata: Gmail id, thread id, date, sender **domain**, class, confidence | Plaintext | No subject, no sender address, no body |
| Email snippet (first 300 chars) | Encrypted | Set to NULL after 90 days (backfill itself only reads the last 5 days) |
| Ordinary email bodies | **Never fetched, never stored** | |
| Job-alert email bodies | **Processed in memory only, never stored** | Only the extracted vacancy fields are kept; descriptions and requirements are encrypted |
| Resume text and structured profile | Encrypted | |
| Match evidence and gaps | Encrypted | |
| Login: username and password verifier | Worker secrets, not D1 | The verifier is SHA-256 of an Argon2id output (m=64 MiB, t=3). The password itself never leaves the browser |
| Sessions | SHA-256 of the session token, plus timestamps | The raw token exists only in the browser cookie |
| Login attempts | HMAC of the client IP, counters | Raw IP addresses are never stored |

## 3. Who can read it
- **GRU itself**, when the Worker holds `DATA_KEY_V1`.
- **Anyone with access to Ani's Cloudflare account** can read plaintext columns. With the Worker secrets, they could decrypt the rest. Protect that account with a passkey or app-based 2FA (SETUP step 9).
- **Cloudflare**, as the infrastructure provider, under its own terms.
- **Not** ntfy: notifications are fixed strings such as "Morning check-in is ready". They never contain job, email, interview, task or personal details. ntfy.sh topics are public to anyone who knows the topic name, so the name is a 40-character random secret, and spoofed pings could at most prompt Ani to open the app.

## 4. Search limitation (blind index)
Encrypted notes and tasks are searched through an HMAC-SHA256 token index keyed by `INDEX_KEY`. Only **exact whole words** (3 or more characters, case-insensitive) can be found: no partial words, no fuzzy matching, no phrase search. The index reveals to someone with database access which notes share a word, but not the word itself.

## 5. Logs
One logging helper accepts only ids, counts, status codes, durations and error codes. Any other field, including subject, snippet, body, sender, email address, resume, password, token or IP, is dropped before anything is written. A test enforces this.

## 6. Deletion and wipe: what is and isn't guaranteed

**Deleting an item** (a job, resume version, note, task or application) deletes its live database rows, including encrypted descriptions and the match results tied to it.

**Pause** stops all syncing and scheduled work. Data stays.

**Lock** deletes `DATA_KEY_V1` and `INDEX_KEY` from the Worker. Encrypted fields become unreadable until the keys are restored from Ani's password manager. Plaintext columns (company, role, status, dates) remain in D1.

**Wipe (in-app)** does the following, in this order:
1. sets GRU to `wiping`, so every route except the static shell returns 423;
2. asks Google to revoke each Gmail refresh token;
3. drops and recreates every table empty, including sessions, jobs, matches, resume profiles and encrypted descriptions;
4. resets settings and sets GRU to `wiped`.

From that moment, **the data is immediately inaccessible through GRU.**

**What wipe does *not* do:** it does not instantly destroy every historical copy. Cloudflare D1's point-in-time recovery ("Time Travel") lets the account owner restore the database to any point in the **previous 7 days on the Workers Free plan** (verified 2026-11-15). Until that window passes, someone with access to Ani's Cloudflare account could restore pre-wipe data. If the keys are still held, they could also decrypt it. To shorten that exposure:
- run **Lock** as well (or the full teardown), so the encryption keys are gone and restored ciphertext can't be read without the copy in Ani's password manager;
- run the **full teardown** (`scripts/wipe.ts`), which deletes the D1 database itself. Cloudflare's own backup and retention practices still apply after deletion, so GRU makes no claim beyond what Cloudflare documents.

Google may keep its own records of token grants and revocations under Google's policies. Revoking access in GRU or at myaccount.google.com/permissions stops further access; it does not delete Google-side logs.

## 7. Changing a Google password
Google revokes refresh tokens with Gmail scopes when the account password changes. GRU then shows "Reconnect Gmail" and pauses syncing for that account. This is expected; see RUNBOOK §4.

## 8. Voice (planned, not yet built)
When voice ships (ROADMAP V1), speech is recognised on the device; audio is never sent to GRU or stored. GRU stores only the text transcript, encrypted, for 30 days, and it is included in export and wipe. Spoken replies use voices installed on your device. Any change GRU suggests by voice waits for your tap.
