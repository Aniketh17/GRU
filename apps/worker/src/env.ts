// Bindings and secrets. Secrets are optional at the type level because GRU must
// behave correctly (Locked / not configured) when one is missing.
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  DATA_KEY_V1?: string | undefined;
  INDEX_KEY?: string | undefined;
  SESSION_SECRET?: string | undefined;
  AUTH_USERNAME?: string | undefined;
  AUTH_VERIFIER?: string | undefined;
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
  ALLOWED_EMAILS?: string | undefined;
  NTFY_TOPIC?: string | undefined;
  AI?: Ai | undefined;
}

export const nowSec = (): number => Math.floor(Date.now() / 1000);
