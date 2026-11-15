// Hono app. Pipeline (ARCHITECTURE section 3):
// [fetch wrapper: security headers] -> db/budget -> kill guard -> /api: session -> locked -> hygiene -> route
import { Hono } from "hono";
import type { Env } from "./env.ts";
import { requireSession } from "./auth/middleware.ts";
import { SubrequestBudget } from "./db/budget.ts";
import { Db } from "./db/client.ts";
import { hygiene } from "./http/hygiene.ts";
import { killGuard, lockedGuard } from "./kill/guard.ts";
import { errorCode, log } from "./log/index.ts";
import { adminRoutes } from "./routes/admin.ts";
import { applicationRoutes } from "./routes/applications.ts";
import { authRoutes } from "./routes/auth.ts";
import { eventRoutes } from "./routes/events.ts";
import { healthRoutes } from "./routes/health.ts";

export type AppEnv = { Bindings: Env; Variables: { db: Db } };

export const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  c.set("db", new Db(c.env.DB, new SubrequestBudget()));
  await next();
});
app.use("*", killGuard);
app.use("/api/*", requireSession);
app.use("/api/*", lockedGuard);
app.use("*", hygiene);

app.route("/auth", authRoutes);
app.route("/api", healthRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/applications", applicationRoutes);
app.route("/api/events", eventRoutes);

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));
app.all("/auth/*", (c) => c.json({ error: "not_found" }, 404));
// Everything else is the static app (public shell, /login, /locked) with SPA fallback.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((err, c) => {
  log("unhandled_error", { code: errorCode(err) });
  return c.json({ error: "internal" }, 500);
});
