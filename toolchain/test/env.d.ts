// Test bindings (vitest.config.ts) on top of the Worker's own Env.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    APP_ORIGIN: string;
    DATA_KEY_V1?: string;
    INDEX_KEY?: string;
    SESSION_SECRET?: string;
    AUTH_USERNAME?: string;
    AUTH_VERIFIER?: string;
    TEST_PROOF: string;
    TEST_MIGRATIONS: { name: string; queries: string[] }[];
  }
}
