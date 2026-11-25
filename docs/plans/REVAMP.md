# GRU Revamp: a premium personal job-search workspace (approved 2026-11-25; R1 to R5 shipped, see D-065 to D-068)

Written for Ani. Built and deployed in the phases at the end. Differences from the plan: the Documents page was folded into each job's Tailor tab (copy as notes) rather than a separate page; the navigation keeps Jobs, Board and My applications as tabs inside one Jobs section instead of separate Jobs and Pipeline sections; the AI starter list for companies became a fixed, labelled ideas list so nothing is invented.

## 1. What you asked for, and where it lands

| # | Your request | Delivered as |
|---|---|---|
| 1 | Make resume-to-job matching prominent; one detailed page per job; how the resume should look for that job | **Job workspace** page with Fit, **Tailor kit**, Insights and Notes tabs (section 3A/3B) |
| 2 | When mail can't be classified let me classify it; keep "not related" for wrongly pulled mail | **Inbox** page: classify, link, "Not job related", and "never read this sender" (3D) |
| 3 | Clear the Talk-to-GRU history after every conversation | History deleted when the assistant closes; server copy deleted; "Remember" switch off by default (3F) |
| 4 | Remove jobs I already applied to elsewhere; deeper insights per job | **Already-applied detection** + insights block on the job page (3C) |
| 5 | Internship networking: 100 companies, people, curiosity-first outreach | **Network** module: target companies, people pipeline, outreach drafts, follow-up reminders, weekly goals (3E) |
| 6 | A proper premium personal tracking website | New navigation, Kanban pipeline, Insights, Documents, command palette, polish (3G, 3H) |

## 2. New navigation (mobile bottom bar: Today, Jobs, Pipeline, Network, More)

- **Today**: command centre: brief, focus, top 3 "apply today", follow-ups (applications and outreach), interviews, deadlines, inbox count, weekly goal rings.
- **Jobs**: Apply today (default), Other jobs, Saved. Tap a job to open its workspace.
- **Pipeline**: your applications as a Kanban board or list, with the status colours; application page keeps timeline, interviews, notes.
- **Network**: Companies, People, This week (outreach queue), Goals.
- **Inbox**: mail that needs you, recently handled mail, blocked senders.
- **Calendar**, **Insights**, **Documents**, **Tasks**, **Notes**, **Settings** (under More on phone; sidebar on desktop).

## 3. Feature specs

### 3A. Job workspace (`/jobs/:id`)
Tabs: **Overview** (title, company, location, source, link, closing date, "came from alert on 14 Nov" with open-email button, paste-description box), **Fit**, **Tailor**, **Insights**, **Notes**.
- **Fit**: the 100-point score with the seven dimensions, matched evidence quotes from your resume, gaps, and a plain "why this score". Provisional (title-only) scores are labelled until you paste the description.
- Actions pinned on every tab: Apply (opens the posting), I applied, Not interested, Shortlist, Set reminder.

### 3B. Tailor kit (your LinkedIn feedback, made prominent)
Input: the job description (pasted once, stored encrypted) and your active resume. Output (cached per job + resume version, so re-opening costs nothing):
1. **Keyword gap**: the 8 most important keywords from the posting that are missing or buried in your CV, each with where it would fit.
2. **Lead with these 2 achievements**: the two strongest, most relevant achievements already in your CV.
3. **Top 3 bullets rewritten** for this role. Each rewrite shows the original, the new text and a diff.
4. **How the resume should look for this job**: section order, a one-line summary suggestion, skills ordering, what to cut or shorten, target length, and an ATS check (keyword coverage %).
5. Optional **cover note** (short, no invented facts) and **interview prep** (likely questions mapped to your CV bullets).
- **No inventing, enforced in code**: every number, tool name and proper noun in a rewrite must already appear in your resume. Anything that doesn't is flagged amber ("not in your CV, keep only if true") and excluded by default. Keywords from the posting are offered as prompts ("mention X if you've used it"), never inserted as claims.
- Export: copy as text/Markdown/LaTeX bullets, or print a clean one-page layout to PDF. Saved in Documents against the job.
- Keyword extraction and the ATS check run **in your browser** (saves Worker CPU); only the writing step uses the AI.

### 3C. Already-applied detection and insights (stops double applications)
- A vacancy is compared with everything you have applied to: same posting link (certain); same company + similar title (likely, similarity at least 0.75); same company, different role (informational).
- "Likely already applied" jobs leave **Apply today** and appear in a collapsed section with the reason ("You applied to Acme Robotics on 12 Nov via Seek") and a **Not the same job** button.
- Duplicate postings across boards (Seek and LinkedIn) merge into one job showing all sources.
- **Insights block** on the job page: your history with the company (applications, outcomes, last contact), people you know there (from Network), the same role on other boards, deadline countdown, reply-time pattern for similar roles from your own data.
- Confirmation emails count as evidence (they already create applications).

### 3D. Inbox triage
- New **Inbox** page. Each card: sender, subject, date, GRU's best guess and why.
- One-tap **classify** chips: Rejection, Offer, Interview, Assessment, Application received, Update, Recruiter, Job alert; choose the application to link and the status to set; changes still have Undo.
- **Not job related**: marks it ignored and removes it from GRU's memory. Option **Never read mail from this sender** (domain rule), so it stops being fetched at all, which is also better privacy.
- Encrypted subject and sender are kept for **30 days** (needed to show this page), then deleted; covered by wipe and export.

### 3E. Network (internship strategy: build the network before you need it)
GRU can't read LinkedIn or send messages (no public API, against their terms, and your spec forbids acting for you). So Network is a **CRM, a coach and a reminder system**; you do the LinkedIn clicks.
1. **Target companies** (aim: 100): add by paste or CSV; auto-added from companies in your job alerts and applications; **AI starter list** for NZ AI/data/backend (labelled "verify, may be out of date"). Each has priority, why, tags and a pipeline status: Not contacted, Researching, Contacted, In conversation, Referral, Applied.
2. **Find people**: per company, buttons that open prefilled LinkedIn/Google searches (founders, engineering managers, data leads, alumni of your university). Add a person with name, role, profile link, how you found them.
3. **People pipeline**: To reach out, Message drafted, Sent, Replied, Call booked, Call done, Thank-you sent, Follow-up due. Warmth rating, notes, next follow-up date.
4. **Curiosity-first drafts**: connection note (200-character limit), coffee-chat request, follow-up nudge, thank-you, and a question list about their work, how they got in, what skills they look for and what problems they're solving. Personalised from your CV and their role; never asks for a job. Always editable; copy button; falls back to good templates when the AI allowance is used up.
5. **Conversation notes**: what they said, skills they look for, problems they're solving, action items (become tasks). A skills-demand view collects these across conversations.
6. **Reminders**: follow-ups land on the calendar and in the brief; a generic phone alert ("GRU: networking follow-up due").
7. **Weekly goals**: new outreach, conversations held, thank-yous sent; streak and progress rings. Targets are yours to set (defaults: 5 outreach, 2 conversations).
8. **Joined up with jobs**: if you know someone at a company you are about to apply to, the job page says so and suggests asking for a referral.

### 3F. Chat history
Closing the Talk-to-GRU sheet clears the conversation on screen and deletes it from the server. Opening starts fresh. Setting "Remember conversations for 30 days" exists but is off by default. The daily brief text is never saved.

### 3G. Pipeline, Insights, Documents
- **Pipeline board**: drag cards between status columns on desktop (a menu on phones); stale and follow-up flags; filters; the status colours.
- **Insights** (inline SVG charts, no chart library): funnel (applied, replied, interview, offer), reply rate by source and by week, time to first reply, weekly activity and streaks, top skills asked for across the postings you saved, networking funnel.
- **Documents**: resume versions, tailored versions per job, cover notes; one list with search; export.
- **Preferences**: target roles, locations, skills, level (feed the scoring), saved search shortcuts that open Seek/LinkedIn with your queries.

### 3H. Premium polish
Refreshed design system (type scale, spacing, cards, elevation, motion), skeleton loading everywhere, **command palette** (Ctrl/Cmd+K: jump to any job, application, person, note), keyboard shortcuts on desktop, onboarding checklist, helpful empty states, install prompt, accessibility pass (contrast, focus, screen reader labels), route-level code splitting, and a real review at 390 px and desktop widths with screenshots (synthetic data only).

## 4. Data model (new migrations 0015 onward, all additive)
- `jobs`: `title_norm`, `applied_app_id`, `dedupe_status` (none/likely_applied/confirmed/not_same), `dedupe_reason`, `dup_group`.
- `job_kits(job_id, resume_profile_id, kit_enc, model, created_at)`.
- `emails_seen`: `subject_enc`, `from_enc`, `user_class`, `ignored`; `sender_rules(domain, action, class)`.
- `net_companies`, `people`, `touchpoints` (all free text encrypted), goals in settings.
- Retention job deletes subjects after 30 days and old voice rows; everything is covered by wipe, export and tests.

## 5. Staying free: budgets and guards
| Limit (Workers Free) | Now | Plan |
|---|---|---|
| Worker size (3 MiB gzip) | 196 KiB | Code-split the app; Worker stays well under 1 MiB; size check added to `npm run check` |
| D1 storage (5 GB) | 0.45 MB | Encrypted notes/kits are small text; retention on subjects |
| D1 reads/writes (5M / 100k per day) | tiny | Indexed lookups only; precomputed dedupe at insert time; counters instead of scans |
| Requests (100k per day) | a few hundred | Unchanged; refresh and sync are rate-limited |
| CPU (10 ms per run) | 0.5 to 3 ms per email | Heavy text analysis moves to the browser; caps and mark-before-process kept |
| Calls per run (about 50) | budgeted | Every new endpoint capped at about 8 database calls and tested |
| Workers AI (10,000 Neurons/day) | 8,000 ceiling | One ledger, split: voice 3,500, speech-to-text 400, chat and mail second opinions 1,200, **tailor kits 1,800 (about 40/day)**, drafts/prep/suggestions 1,100. A "today's allowance" meter in Settings. Cached results; every AI feature has a no-AI fallback. |
| Cron | 1 trigger every 5 minutes | Unchanged |

Voice replies get shorter and the device voice takes over sooner to free Neurons for tailoring. Still $0, no card, no custom domain.

## 6. Privacy and safety rules (unchanged, extended)
Read-only Gmail, job mail only; email bodies never stored; AI sees only what a feature needs and treats it as untrusted; AI can only suggest, you tap to apply; network notes, kits and subjects are encrypted; no scraping of job boards or LinkedIn; GRU never sends messages or applies for you.

## 7. Build phases (each tested, deployed and pushed before the next)
- **R1: Your five fixes.** Inbox triage; chat history clearing; already-applied detection and Apply today clean-up; job workspace with Fit and Insights.
- **R2: Tailor kit** with grounding validator, caching, export, Documents, AI ledger rebalance and allowance meter.
- **R3: Network** (companies, people, drafts, reminders, goals, job integration).
- **R4: Pipeline board, Insights, Preferences, goals on Today.**
- **R5: Premium polish** (navigation, design system, command palette, onboarding, accessibility, performance).
- **R6: Hardening** (free-tier audit tests, docs, PRIVACY and RUNBOOK updates, screenshots).

Tests per phase: unit (parsers, similarity, grounding validator), integration (routes, quotas, retention, wipe), end-to-end on phone and desktop, plus the budget tests.

## 8. Limits, honestly
- Job descriptions must be pasted: job boards can't be scraped. Alert vacancies stay "provisional" until you do.
- AI company suggestions can be wrong or out of date, so they're labelled and need your check.
- LinkedIn actions (finding people, sending notes) stay manual; GRU prepares, tracks and reminds.
- The AI allowance is shared: a heavy day of tailoring leaves less for voice.

## 9. Defaults I'll use unless you say otherwise
1. New navigation as in section 2 (Jobs and Pipeline become separate again).
2. Subjects and senders kept encrypted for 30 days for the Inbox page.
3. History clears on close; "Remember" setting off.
4. Network defaults: AI-suggested NZ AI/data/backend starter list, weekly targets 5 outreach and 2 conversations.
5. Apply today hides likely duplicates behind a "Likely already applied" section instead of deleting them.
