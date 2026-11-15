import { app } from "./app.ts";
import type { Env } from "./env.ts";
import { applySecurityHeaders } from "./http/headers.ts";
import { runTick } from "./tick.ts";

export default {
  async fetch(request, env, ctx) {
    const res = await app.fetch(request, env, ctx);
    // Outermost layer, so every response class (assets, errors, 401/423/429) gets the headers.
    return applySecurityHeaders(res, new URL(request.url).pathname);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runTick(env, Math.floor(controller.scheduledTime / 1000)));
  },
} satisfies ExportedHandler<Env>;
