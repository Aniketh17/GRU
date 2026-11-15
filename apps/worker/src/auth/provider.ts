// AuthProvider seam (spec section 7). Phase 0 ships one implementation: single-user
// password + server-side session (D-001). Kept as an interface so another provider
// could be added later without touching routes.
import type { Context } from "hono";

export interface Identity {
  kind: "owner";
}

export interface AuthProvider {
  authenticate(c: Context): Promise<Identity | null>;
}
