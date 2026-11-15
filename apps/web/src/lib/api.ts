// Typed client for the GRU Worker API. Every mutating call sends JSON + X-App (request hygiene).
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly data: Record<string, unknown> = {}) {
    super(code);
    this.name = "ApiError";
  }
}

export type Status = "applied" | "assessment" | "interview" | "offer" | "accepted" | "declined" | "rejected" | "withdrawn";
export type Source = "manual" | "email" | "seek" | "linkedin" | "referral" | "other";

export interface Application {
  id: number;
  company: string;
  role: string | null;
  source: Source;
  status: Status;
  applied_at: number | null;
  last_event_at: number | null;
  next_action: string | null;
  next_action_due: number | null;
  created_at: number;
  updated_at: number;
  stale: boolean;
  notes?: string | null;
}

export interface TimelineEvent {
  id: number;
  type: string;
  at: number;
  prev_status: Status | null;
  auto_applied: number;
  confidence: number | null;
  undone: number;
}

export interface Health {
  ok: boolean;
  kill_state: "running" | "wiping" | "wiped";
  paused: boolean;
  locked: boolean;
}

export interface MailAccount {
  id: number;
  email: string;
  label: string | null;
  status: "disconnected" | "active" | "needs_reauth" | "paused";
  last_sync_at: number | null;
  last_error_code: string | null;
  reauth_since: number | null;
  messages_scanned: number;
  testing_mode_detected: boolean;
}

export interface ReviewItem {
  id: number;
  kind: "classify" | "link" | "interview_time" | "action" | "outreach" | "dedupe";
  accountId: number | null;
  gmailId: string | null;
  appId: number | null;
  company: string | null;
  appStatus: Status | null;
  proposal: {
    class?: string;
    suggested?: Status | null;
    reason?: string;
    company?: string | null;
  } | null;
  context: {
    subject?: string;
    from?: string;
  } | null;
  createdAt: number;
  receivedAt: number | null;
}

export interface RecentEvent {
  id: number;
  app_id: number;
  type: string;
  at: number;
  prev_status: Status | null;
  auto_applied: number;
  undone: number;
  company: string;
  current_status: Status;
}

export type ApplicationInput = {
  company: string;
  role?: string | null;
  source?: Source;
  status?: Status;
  applied_at?: number | null;
  next_action?: string | null;
  next_action_due?: number | null;
  notes?: string | null;
};

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const mutating = method !== "GET";
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: mutating ? { "Content-Type": "application/json", "X-App": "gru" } : { "X-App": "gru" },
    ...(mutating ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  if (res.status === 401) {
    if (!location.pathname.startsWith("/login")) location.assign("/login");
    throw new ApiError(401, "unauthenticated");
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 423) {
    window.dispatchEvent(new CustomEvent("gru:locked", { detail: data }));
    throw new ApiError(423, typeof data.state === "string" ? data.state : "locked");
  }
  if (!res.ok) throw new ApiError(res.status, typeof data.error === "string" ? data.error : "request_failed", data);
  return data as T;
}

export interface Brief {
  date: string;
  review_count: number;
  interviews_upcoming: { id: number; app_id: number; company: string; at: number; format: string | null; prep_ready: boolean }[];
  missing_debriefs: { id: number; app_id: number; company: string; at: number }[];
  follow_ups: { id: number; company: string; role: string | null; status: string; days_stale: number }[];
  health: { summary: string; needs_reauth: boolean };
  jobs: { new_count: number; top: { id: number; title: string; company: string | null; score: number | null }[]; closing_soon: number; queue_count: number };
  tasks_due: number;
}
export interface Checkin {
  date: string;
  status: "pending" | "completed" | "skipped";
  answers: { today_focus?: string; applied_off_email?: boolean } | null;
  review_prompts: { id: number }[];
  interviews_upcoming: Brief["interviews_upcoming"];
  missing_debriefs: Brief["missing_debriefs"];
}
export interface Settings {
  brief_time: string;
  stale_days: number;
  interview_stale_days: number;
  shortlist_threshold: number;
  ntfy_configured?: boolean;
}

export interface Interview {
  id: number; app_id: number; company: string; role: string | null; state: string; start_utc: number | null; tz: string | null;
  format: string | null; rating: number | null; followup_sent: boolean; prep: string | null; debrief: Record<string, string | null> | null;
}
export interface Job {
  id: number; title: string; company: string | null; location: string | null; work_arrangement: string | null; employment_type: string | null;
  source: string; url: string | null; closing_at: number | null; status: string; first_seen_at: number;
  score: number | null; band: "strong" | "good" | "possible" | "low" | null; confidence: string | null;
}
export interface JobDetail extends Job {
  description: string | null;
  match: { components: Record<string, number>; evidence: { matched: { skill: string; evidence: string }[]; explanation: string; provisional: boolean } | null; gaps: string[] } | null;
}
export interface JobInput {
  title: string; company?: string; location?: string; work_arrangement?: "remote" | "hybrid" | "onsite"; url?: string;
  description?: string; closing_at?: number;
}
export interface ResumeProfile { id: number; version: number; label: string; active: boolean; created_at: number; skills: string[] }
export interface Note { id: number; body: string | null; tags: string[]; created_at: number; updated_at: number }
export interface Task { id: number; title: string | null; due_at: number | null; priority: number; kind: string; done_at: number | null; app_id: number | null }
export interface Agenda {
  date: string; overdue: Task[]; today: Task[]; upcoming: Task[]; someday: Task[];
  interviews: { id: number; app_id: number; company: string; start_utc: number; format: string | null }[];
}
export interface Weekly {
  is_sunday: boolean; applications_added: number; status_changes: number; interviews_done: number; tasks_done: number;
  tasks_open: number; notes_added: number; checkins_done: number; jobs_found: number;
}
export interface DebriefInput {
  rating: number; questions: string; went_well: string; improve: string; followup_sent: boolean; next_step: string; next_date: string | null;
}

export interface ListParams {
  status?: string;
  q?: string;
  stale?: boolean;
  cursor?: string | null;
}

export const api = {
  health: () => request<Health>("/api/health"),
  listApplications: (p: ListParams = {}) => {
    const qs = new URLSearchParams();
    if (p.status) qs.set("status", p.status);
    if (p.q) qs.set("q", p.q);
    if (p.stale) qs.set("stale", "1");
    if (p.cursor) qs.set("cursor", p.cursor);
    return request<{ items: Application[]; next_cursor: string | null }>(`/api/applications?${qs}`);
  },
  summary: () => request<{ counts: Partial<Record<Status, number>>; stale: number }>("/api/applications/summary"),
  getApplication: (id: number) => request<Application>(`/api/applications/${id}`),
  createApplication: (input: ApplicationInput) => request<Application>("/api/applications", "POST", input),
  updateApplication: (id: number, input: Partial<ApplicationInput>) => request<Application>(`/api/applications/${id}`, "PATCH", input),
  deleteApplication: (id: number) => request<{ deleted: true }>(`/api/applications/${id}`, "DELETE"),
  setStatus: (id: number, status: Status) =>
    request<{ application: Application; event_id: number | null }>(`/api/applications/${id}/status`, "POST", { status }),
  timeline: (id: number) => request<{ items: TimelineEvent[] }>(`/api/applications/${id}/timeline`),
  undo: (eventId: number) => request<{ undone: true; status: Status }>(`/api/events/${eventId}/undo`, "POST"),
  pause: () => request<{ paused: true }>("/api/admin/pause", "POST"),
  resume: () => request<{ paused: false }>("/api/admin/resume", "POST"),
  wipe: (phrase: string) => request<{ wiped: true }>("/api/admin/wipe", "POST", { phrase }),
  logout: () => request<{ ok: true }>("/auth/logout", "POST"),
  mailAccounts: () => request<{ accounts: MailAccount[] }>("/api/mail/accounts"),
  connectMail: (email: string) => request<{ url: string }>("/api/mail/connect", "POST", { email }),
  disconnectMail: (email: string) => request<{ ok: true }>("/api/mail/disconnect", "POST", { email }),
  listReview: () => request<{ items: ReviewItem[] }>("/api/review"),
  resolveReview: (id: number, data: { action: "confirm" | "dismiss"; appId?: number; status?: Status }) =>
    request<{ ok: true }>(`/api/review/${id}/resolve`, "POST", data),
  brief: () => request<Brief>("/api/brief"),
  checkin: () => request<Checkin>("/api/checkin/today"),
  saveCheckin: (d: { status: "completed" | "skipped"; today_focus?: string; applied_off_email?: boolean }) =>
    request<{ status: string }>("/api/checkin/today", "POST", d),
  settings: () => request<Settings>("/api/settings"),
  saveSettings: (d: Omit<Settings, "ntfy_configured">) => request<Settings>("/api/settings", "PUT", d),
  interviews: (appId?: number) => request<{ items: Interview[] }>(`/api/interviews${appId ? `?app_id=${appId}` : ""}`),
  createInterview: (d: { app_id: number; start_utc: number; format: string; review_id?: number }) => request<{ id: number }>("/api/interviews", "POST", d),
  patchInterview: (id: number, d: Record<string, unknown>) => request<Interview>(`/api/interviews/${id}`, "PATCH", d),
  debrief: (id: number, d: DebriefInput) => request<{ ok: true }>(`/api/interviews/${id}/debrief`, "POST", d),
  deleteInterview: (id: number) => request<{ deleted: true }>(`/api/interviews/${id}`, "DELETE"),
  jobs: (status = "open", band = "") => request<{ has_resume: boolean; items: Job[] }>(`/api/jobs?status=${status}${band ? `&band=${band}` : ""}`),
  jobQueue: () => request<{ has_resume: boolean; threshold: number; items: Job[] }>("/api/jobs/queue"),
  job: (id: number) => request<JobDetail>(`/api/jobs/${id}`),
  createJob: (d: JobInput) => request<{ id: number; duplicate: boolean }>("/api/jobs", "POST", d),
  jobDecision: (id: number, decision: "shortlist" | "save" | "dismiss" | "reopen") => request<{ ok: true }>(`/api/jobs/${id}/decision`, "POST", { decision }),
  markApplied: (id: number, d: { link_application_id?: number; create_new?: boolean } = {}) => request<{ ok: true; app_id: number }>(`/api/jobs/${id}/mark-applied`, "POST", d),
  deleteJob: (id: number) => request<{ deleted: true }>(`/api/jobs/${id}`, "DELETE"),
  resumes: () => request<{ items: ResumeProfile[] }>("/api/resume-profiles"),
  getResume: (id: number) => request<{ id: number; label: string; text: string | null }>(`/api/resume-profiles/${id}`),
  saveResume: (d: { label: string; text: string }) => request<{ id: number }>("/api/resume-profiles", "POST", d),
  updateResume: (id: number, d: { label: string; text: string }) => request<{ ok: true }>(`/api/resume-profiles/${id}`, "PATCH", d),
  activateResume: (id: number) => request<{ ok: true }>(`/api/resume-profiles/${id}/activate`, "POST"),
  deleteResume: (id: number) => request<{ deleted: true }>(`/api/resume-profiles/${id}`, "DELETE"),
  notes: () => request<{ items: Note[] }>("/api/notes"),
  searchNotes: (q: string) => request<{ items: Note[] }>(`/api/notes/search?q=${encodeURIComponent(q)}`),
  saveNote: (d: { body: string; tags: string[] }, id?: number) => request<{ id?: number }>(id ? `/api/notes/${id}` : "/api/notes", id ? "PATCH" : "POST", d),
  deleteNote: (id: number) => request<{ deleted: true }>(`/api/notes/${id}`, "DELETE"),
  tasks: (status: "open" | "done" = "open") => request<{ items: Task[] }>(`/api/tasks?status=${status}`),
  createTask: (d: { title: string; due_at?: number | null; priority?: number; kind?: string }) => request<{ id: number }>("/api/tasks", "POST", d),
  patchTask: (id: number, d: { done?: boolean; title?: string; due_at?: number | null; priority?: number }) => request<{ ok: true }>(`/api/tasks/${id}`, "PATCH", d),
  deleteTask: (id: number) => request<{ deleted: true }>(`/api/tasks/${id}`, "DELETE"),
  agenda: () => request<Agenda>("/api/agenda"),
  weekly: () => request<Weekly>("/api/agenda/weekly"),
  exportTable: (table: string, after = "") => request<{ items: unknown[]; next: string | null }>(`/api/export?table=${table}${after ? `&after=${encodeURIComponent(after)}` : ""}`),
  voiceHistory: () => request<{ items: { id: number; role: "user" | "gru"; text: string | null; at: number }[] }>("/api/voice/history"),
  saveVoiceEntry: (role: "user" | "gru", text: string) => request<{ id: number }>("/api/voice/history", "POST", { role, text }),
  clearVoiceHistory: () => request<{ deleted: true }>("/api/voice/history", "DELETE"),
  recentEvents: () => request<{ items: RecentEvent[] }>("/api/events/recent"),
};
