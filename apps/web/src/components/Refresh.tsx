// Refresh: pull down on any page (phone) or tap the Refresh button. It checks Gmail now, reads waiting job mail, and reloads everything on screen.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { RefreshIcon } from "./Icons.tsx";
import { useToast } from "./Toast.tsx";
import { cx } from "./ui.tsx";

export function useRefresh() {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const r = await api.syncNow();
      await qc.invalidateQueries();
      if (!r.ran && r.reason === "paused") toast({ text: "GRU is paused, so Gmail wasn’t checked. Resume it in Settings." });
      else if (r.ran && r.pending > 0) toast({ text: `Checked Gmail. ${r.pending} older email${r.pending === 1 ? " is" : "s are"} still being read in the background.` });
      else if (r.ran) toast({ text: "Checked Gmail. You’re up to date." });
      else toast({ text: "Refreshed." });
    } catch {
      await qc.invalidateQueries();
      toast({ text: "Refreshed what’s on screen. Couldn’t reach Gmail just now." });
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [qc, toast]);

  return { refresh, busy };
}

export function RefreshButton({ onClick, busy, className, label = "Refresh" }: { onClick: () => void; busy: boolean; className?: string; label?: string }) {
  return (
    <button type="button" aria-label="Refresh" onClick={onClick} disabled={busy} className={cx("inline-flex cursor-pointer items-center gap-2 rounded-lg disabled:cursor-wait", className)}>
      <RefreshIcon size={17} className={busy ? "animate-spin" : undefined} />
      {label}
    </button>
  );
}

const TRIGGER = 80; // px of pull needed

/** Pull down from the top of any page. Ignored while a dialog is open or when the page is scrolled. */
export function PullToRefresh({ onRefresh, busy }: { onRefresh: () => void; busy: boolean }) {
  const [pull, setPull] = useState(0);
  const cb = useRef(onRefresh);
  cb.current = onRefresh;

  useEffect(() => {
    let startY = 0;
    let pulling = false;
    let dy = 0;
    const start = (e: TouchEvent) => {
      if (window.scrollY > 0 || document.querySelector("dialog[open]") || !e.touches[0]) return;
      startY = e.touches[0].clientY;
      pulling = true;
      dy = 0;
    };
    const move = (e: TouchEvent) => {
      if (!pulling || !e.touches[0]) return;
      dy = e.touches[0].clientY - startY;
      if (window.scrollY > 0 || dy <= 0) { setPull(0); return; }
      setPull(Math.min(dy, 140));
    };
    const end = () => {
      if (!pulling) return;
      pulling = false;
      const go = dy > TRIGGER;
      setPull(0);
      if (go) cb.current();
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    window.addEventListener("touchcancel", end, { passive: true });
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, []);

  if (pull === 0 && !busy) return null;
  const ready = pull > TRIGGER;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center pt-safe" style={{ transform: `translateY(${busy ? 12 : Math.max(0, pull * 0.55 - 28)}px)` }}>
      <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12.5px] font-medium text-ink shadow-[0_4px_14px_rgba(0,0,0,.18)]">
        <RefreshIcon size={15} className={cx(busy && "animate-spin", !busy && ready && "rotate-180 transition-transform")} />
        {busy ? "Checking your mail…" : ready ? "Release to refresh" : "Pull to refresh"}
      </span>
    </div>
  );
}
