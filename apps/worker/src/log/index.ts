// The only place in the Worker allowed to write to the console (spec section 7, D-012).
// Fields are allowlisted by key AND value shape: anything that could carry email text,
// resume text, names, addresses, tokens or IPs is dropped before it is written.

export type LogValue = string | number | boolean | null;
export type LogFields = Record<string, unknown>;

const ALLOWED_KEYS = new Set([
  "id", "count", "status", "code", "error_code", "ms", "duration_ms", "phase",
  "kind", "method", "attempt", "state", "http_status",
]);
const ALLOWED_SUFFIXES = ["_id", "_count", "_ms"];

// Short machine tokens only: no spaces, no '@', no quotes. Emails and prose can't pass.
const SAFE_STRING = /^[A-Za-z0-9_.:/-]{0,64}$/;
const SAFE_EVENT = /^[a-z0-9_.]{1,64}$/;

function keyAllowed(key: string): boolean {
  return ALLOWED_KEYS.has(key) || ALLOWED_SUFFIXES.some((s) => key.endsWith(s));
}

export function sanitize(fields: LogFields): Record<string, LogValue> {
  const out: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!keyAllowed(key)) continue;
    if (value === null || typeof value === "boolean") out[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "string" && SAFE_STRING.test(value)) out[key] = value;
    // Objects, arrays, long or unsafe strings: dropped.
  }
  return out;
}

export function log(event: string, fields: LogFields = {}): void {
  try {
    const ev = SAFE_EVENT.test(event) ? event : "invalid_event";
    console.log(JSON.stringify({ ev, ...sanitize(fields) }));
  } catch {
    // Logging must never break a request.
  }
}

export function errorCode(err: unknown): string {
  if (err instanceof Error && SAFE_STRING.test(err.name)) return err.name;
  return "unknown";
}
