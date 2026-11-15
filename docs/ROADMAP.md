# GRU: Roadmap

Last updated 2026-11-15. Every phase starts with a plan and ends with a walkthrough and gate (SPEC §17).

| Phase | What ships | Status |
|---|---|---|
| 0 Foundations | Auth, crypto, kill switch, security baseline, docs | ✅ done (gate met; toolchain lint warning documented, D-034) |
| 1 Dashboard | Applications CRUD, timeline, filters, search, manual status, undo, PWA shell, theme schedule | ✅ built (see plans/PHASE-1.md) |
| 2 Gmail | Read-only sync, rules classifier, linking, review queue, reconnect handling | next |
| 3 Daily loop | Morning brief, check-in, ntfy, follow-up rules | |
| 4 Interviews | Interview records, prep, reminders, debriefs | |
| 5 Job discovery | Job-alert parsing, resume profile, 100-point scoring, Apply Tomorrow | |
| 6 Notes, tasks & agenda | Notes + blind-index search, tasks, agenda, reminders (D-016) | |
| **V1 Voice: commands & briefing** | See below | after Phase 6 |
| 7 Hardening | Failure drills, wipe drill, export, audits | |
| 8 Optional AI | Workers AI classifier / semantic matcher | |
| **V2 Voice: conversation** | See below | with Phase 8 |

## Voice: Talk to GRU (added by Ani, 2026-11-15)

**Principle (Ani):** voice is an additional interface to the existing GRU backend. It is not a separate assistant, and it has no separate database or memory. Every voice action goes through the same API, validation, encryption, undo and audit trail as a tap.

| # | Feature | V1 (deterministic, no AI) | V2 (with Workers AI) |
|---|---|---|---|
| 1 | Talk to GRU, spoken replies | Fixed command grammar; replies composed from data | Natural conversation (small instruct model) |
| 2 | Daily voice briefing | ✅ the brief from Phase 3, read aloud in chapters | Summarised, conversational |
| 3 | Voice commands: tasks, job search, application updates, notes | ✅ parsed into a **confirm card**; nothing changes until tapped | Same confirm card, wider phrasing |
| 4 | Conversation history | ✅ transcripts encrypted in D1, 30-day retention, covered by wipe/export | Same |
| 5 | Interrupt and respond | ✅ Stop button; speaking stops when you start talking | Same |
| 6 | Personality | Concise, warm, proactive templates | Same rules, applied to model output |
| 7 | Text fallback | ✅ everything works typed, without microphone permission | Same |

**Design:** canvas row "Voice" (desktop Talk to GRU, mobile talking/interrupt, voice briefing, text fallback).

**Privacy design (DECISIONS D-042):**
- Speech-to-text runs **on-device** via the browser's `processLocally` mode. Never Chrome's default server recognition, which sends audio to a third-party service.
- Where on-device recognition isn't available: Cloudflare Workers AI Whisper (zero data retention, ~200 free minutes/day), or text-only. ⛔ Ani to choose.
- Text-to-speech uses **only voices installed on the device** (`SpeechSynthesisVoice.localService === true`); otherwise GRU shows the text.
- Audio is never stored. Transcripts are encrypted like notes.
- Any change GRU proposes from voice needs an explicit tap to confirm (SPEC §19: nothing acts on Ani's behalf without a tap).
