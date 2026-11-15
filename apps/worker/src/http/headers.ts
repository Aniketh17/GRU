// Security headers on every response (spec section 7, D-021).
export const BASE_CSP =
  "default-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
// The login page runs Argon2id in WebAssembly, which needs 'wasm-unsafe-eval' (DECISIONS A10).
export const LOGIN_CSP = `${BASE_CSP}; script-src 'self' 'wasm-unsafe-eval'`;

const LOGIN_PATHS = new Set(["/login", "/login.html", "/login/"]);

export function isNoStorePath(path: string): boolean {
  return path.startsWith("/api/") || path === "/api" || path.startsWith("/auth/");
}

export function applySecurityHeaders(res: Response, path: string): Response {
  // Re-wrap so headers are mutable even for responses from fetch()/ASSETS.
  const out = new Response(res.body, res);
  const h = out.headers;
  h.set("Content-Security-Policy", LOGIN_PATHS.has(path) ? LOGIN_CSP : BASE_CSP);
  h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  h.set("Referrer-Policy", "no-referrer");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Permissions-Policy", "camera=(), microphone=(self), geolocation=(), interest-cohort=()");
  if (isNoStorePath(path)) h.set("Cache-Control", "no-store");
  return out;
}
