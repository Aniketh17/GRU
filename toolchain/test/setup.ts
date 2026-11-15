import { applyD1Migrations, env } from "cloudflare:test";

// Idempotent: applied migrations are tracked in d1_migrations.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
