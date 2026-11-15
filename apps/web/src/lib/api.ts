// Typed client for the GRU Worker API. Every mutating call sends JSON + X-App (request hygiene).
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
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
  if (!res.ok) throw new ApiError(res.status, typeof data.error === "string" ? data.error : "request_failed");
  return data as T;
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
  recentEvents: () => request<{ items: RecentEvent[] }>("/api/events/recent"),
};
