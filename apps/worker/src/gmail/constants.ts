// Google OAuth and Gmail API constants (spec §8, Phase 2 rev 2 §2; amended by Ani 2026-11-15, DECISIONS D-058).
// Read-only access. The code only ever opens the BODY of an email that its headers already identified as job-application mail
// linked to one of Ani's applications (gmail/bodies.ts). All other mail stays header-only. Nothing is written to Gmail, ever.

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_LEGACY_METADATA_SCOPE = "https://www.googleapis.com/auth/gmail.metadata";

export const GMAIL_SCOPES = [
  "openid",
  "email",
  GMAIL_READONLY_SCOPE,
] as const;

/** Any scope that can change, send, label or delete mail. Never requested; revoked immediately if ever granted. */
export const FORBIDDEN_GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.insert",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://www.googleapis.com/auth/gmail.settings.sharing",
  "https://mail.google.com/",
] as const;

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
export const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
export const GMAIL_BATCH_ENDPOINT = "https://gmail.googleapis.com/batch/gmail/v1";

/**
 * Message body fields. Real emails nest deeply (mixed > related > alternative > html, or forwards inside forwards), so the MIME tree is
 * requested 8 levels down. size/attachmentId are only used to describe an email's shape when diagnosing; attachments are never fetched.
 */
const PART = "mimeType,body(data,size,attachmentId)";
const nest = (depth: number): string => (depth === 0 ? `parts(${PART})` : `parts(${PART},${nest(depth - 1)})`);
export const GMAIL_FULL_FIELDS = `id,threadId,labelIds,internalDate,payload(headers,${PART},${nest(7)})`;

/** Fields mask for header-only messages.get: id, threadId, labelIds, internalDate, headers. No snippet. */
export const GMAIL_METADATA_FIELDS = "id,threadId,labelIds,internalDate,payload/headers";

/** Backfill window on first connect. Kept short (5 days) so the first sync is fast (Ani, 2026-11-15). */
export const BACKFILL_DAYS = 5;
