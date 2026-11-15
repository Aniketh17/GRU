// Decision engine: what an email may do to an application. Automatic changes are
// conservative and strictly forward-only (spec §9; Phase 2 revision 2 §5).
import type { Status } from "../domain/applications.ts";
import type { Classification } from "./types.ts";

/** Automatic transitions only. Manual overrides by Ani are separate and unrestricted. */
export const AUTO_TRANSITIONS: Record<Status, readonly Status[]> = {
  applied: ["assessment", "interview", "offer", "rejected"],
  assessment: ["interview", "offer", "rejected"],
  interview: ["offer", "rejected"],
  offer: ["rejected"],
  accepted: [],
  declined: [],
  rejected: [],
  withdrawn: [],
};

export const canAutoTransition = (from: Status, to: Status): boolean => AUTO_TRANSITIONS[from].includes(to);

const TARGET: Partial<Record<string, Status>> = {
  assessment: "assessment",
  interview_invite: "interview",
  rejection: "rejected",
  offer: "offer",
};

export interface LinkResult {
  appId: number | null;
  appStatus: Status | null;
  via: "thread" | "company" | null;
  /** Best company guess when unlinked (used to create an application). */
  company: { name: string; confident: boolean } | null;
  /** More than one application matched: never guess. */
  ambiguous: boolean;
}

export type ReviewKind = "classify" | "link" | "interview_time" | "action" | "outreach";

export type Decision =
  | { action: "ignore"; reason: string }
  | { action: "alert"; reason: string }
  | { action: "link_only"; reason: string }
  | { action: "auto_status"; to: Status; reason: string }
  | { action: "create_application"; company: string; reason: string }
  | { action: "review"; kind: ReviewKind; suggested: Status | null; reason: string };

export interface DecideSettings {
  /** Spec §9 auto-apply for interview/rejection/offer. OFF until a real-world precision gate is met. */
  autoApplyHighImpact: boolean;
}

export const DEFAULT_SETTINGS: DecideSettings = { autoApplyHighImpact: false };
const AUTO_MIN = 0.9;
const LINK_MIN = 0.8;
const CREATE_MIN = 0.85;
const HIGH_IMPACT_MIN = 0.95;

export function decide(c: Classification, link: LinkResult, settings: DecideSettings = DEFAULT_SETTINGS): Decision {
  const { cls, confidence } = c;
  if (cls === "other") return { action: "ignore", reason: "not job-related" };
  if (cls === "alert") return { action: c.forwarded ? "ignore" : "alert", reason: "job alert (Phase 5 extracts vacancies)" };

  const review = (kind: ReviewKind, reason: string, suggested: Status | null = null): Decision => ({ action: "review", kind, suggested, reason });
  if (c.forwarded) return review("classify", "forwarded message: never applied automatically");
  if (c.tie) return review("classify", "conflicting signals");
  if (link.ambiguous) return review("link", "matches more than one application");
  if (cls === "recruiter_outreach") return review("outreach", "recruiter outreach");
  if (cls === "info_request") return review("action", "information requested");
  if (cls === "application_update") return review("classify", "status not clear from the subject");

  const app = link.appId !== null && link.appStatus !== null ? { id: link.appId, status: link.appStatus } : null;

  if (cls === "application_received") {
    // Linking never changes status, so a slightly lower bar is safe here.
    if (app) return confidence >= LINK_MIN ? { action: "link_only", reason: "confirmation for a tracked application" } : review("classify", "low confidence");
    if (confidence >= CREATE_MIN && link.company?.confident) return { action: "create_application", company: link.company.name, reason: "new application confirmed by email" };
    return review("link", "application confirmation for an unknown company");
  }

  if (cls === "interview_update") {
    return app ? review("interview_time", "interview time may have changed") : review("link", "interview update for an unknown application");
  }

  const target = TARGET[cls];
  if (!target) return review("classify", "unhandled class");
  if (!app) return review("link", "status email for an unknown application", target);
  if (app.status === target) return { action: "link_only", reason: "already at this status" };
  if (!canAutoTransition(app.status, target)) return review("classify", `conflicts with current status (${app.status})`, null);

  if (cls === "assessment") {
    return confidence >= AUTO_MIN ? { action: "auto_status", to: target, reason: "assessment invitation" } : review("classify", "low confidence", target);
  }
  // interview_invite, rejection, offer: review-only unless the real-world gate enabled them.
  if (settings.autoApplyHighImpact) {
    const threadOnly = cls === "rejection" || cls === "offer";
    const ok = threadOnly ? link.via === "thread" && confidence >= HIGH_IMPACT_MIN : confidence >= AUTO_MIN;
    if (ok) return { action: "auto_status", to: target, reason: "high-impact auto-apply enabled" };
  }
  return review(cls === "interview_invite" ? "interview_time" : "classify", "important change: confirm first", target);
}
