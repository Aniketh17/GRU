// Header-only email metadata (gmail.metadata scope: no snippet, no body).
export interface MailMeta {
  id: string;
  threadId: string;
  /** Epoch seconds. */
  internalDate: number;
  labelIds: string[];
  /** Raw From header, e.g. `Fonterra Careers <careers@fonterra.example>`. */
  from: string;
  subject: string;
  listUnsubscribe: boolean;
  contentType: string;
  autoSubmitted: string;
}

export const CLASSES = [
  "application_received",
  "assessment",
  "interview_invite",
  "interview_update",
  "application_update",
  "rejection",
  "offer",
  "recruiter_outreach",
  "info_request",
  "alert",
  "other",
] as const;
export type MailClass = (typeof CLASSES)[number];

export interface Sender {
  name: string;
  address: string;
  domain: string;
}

export interface Classification {
  cls: MailClass;
  confidence: number;
  ruleId: string;
  /** True when two different classes scored within 0.05: always reviewed. */
  tie: boolean;
  forwarded: boolean;
  sender: Sender;
}
