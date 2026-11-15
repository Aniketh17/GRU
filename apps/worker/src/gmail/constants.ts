// Google OAuth and Gmail API constants (spec §8, Phase 2 rev 2 §2).
// GRU requests only metadata: headers, labels, and thread/internal IDs. Never bodies or snippets.

export const GMAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.metadata",
] as const;

export const FORBIDDEN_GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
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

/** Fields mask for messages.get: strictly metadata headers, id, threadId, labelIds, internalDate. No snippet! */
export const GMAIL_METADATA_FIELDS = "id,threadId,labelIds,internalDate,payload/headers";
