// Types for Gmail API and OAuth interactions (Phase 2 revision 2 §2, §6).

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate: string;
  payload?: {
    headers?: GmailHeader[];
  };
}

export interface GmailListResponse {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailProfileResponse {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

export interface GmailHistoryMessageAdded {
  message: {
    id: string;
    threadId: string;
    labelIds?: string[];
  };
}

export interface GmailHistoryRecord {
  id: string;
  messages?: { id: string; threadId: string }[];
  messagesAdded?: GmailHistoryMessageAdded[];
}

export interface GmailHistoryResponse {
  history?: GmailHistoryRecord[];
  historyId?: string;
  nextPageToken?: string;
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
  refresh_token_expires_in?: number;
}

export interface IdTokenClaims {
  iss: string;
  aud: string;
  exp: number;
  nonce?: string;
  email: string;
  email_verified?: boolean;
}
