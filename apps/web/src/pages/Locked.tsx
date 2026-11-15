import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { LockIcon, WarningIcon } from "../components/Icons.tsx";
import { ApiError, api } from "../lib/api.ts";

/** Locked (keys absent), wiping, or wiped. Each state says plainly what happened and what to do. */
export function LockedPage() {
  const health = useQuery({ queryKey: ["health", "locked-page"], queryFn: api.health, retry: false });
  const state = health.error instanceof ApiError ? health.error.code : health.data?.locked ? "locked" : health.data ? "ok" : "loading";
  const copy =
    state === "wiped"
      ? { title: "GRU has been wiped", body: "All records were deleted and Gmail access was revoked. Nothing is readable through GRU any more. To start again, follow the setup guide." }
      : state === "wiping"
        ? { title: "Wipe in progress", body: "GRU is deleting your data. Check back in a minute." }
        : state === "ok"
          ? { title: "GRU is unlocked", body: "Everything is available again." }
          : { title: "GRU is locked", body: "Your data is encrypted and the keys aren’t loaded. Run scripts/unlock with the keys from your password manager." };
  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-4 text-ink">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-line bg-surface p-6">
        <span className="grid size-10 place-items-center rounded-xl bg-neutral-soft text-ink-2">{state === "wiped" ? <WarningIcon size={19} /> : <LockIcon size={19} />}</span>
        <h1 className="m-0 text-lg font-semibold">{state === "loading" ? "Checking…" : copy.title}</h1>
        {state !== "loading" && <p className="m-0 text-muted">{copy.body}</p>}
        {state === "ok" && <Link to="/" className="font-semibold text-accent-text">Go to Today →</Link>}
      </div>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-start gap-3 py-10">
      <h1 className="m-0 text-xl font-semibold">That page doesn’t exist</h1>
      <Link to="/" className="font-semibold text-accent-text">Back to Today</Link>
    </div>
  );
}
