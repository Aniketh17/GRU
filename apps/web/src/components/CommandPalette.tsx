// Command palette (Ctrl/Cmd+K, or the Search button): jump to any page, job, application or person. Everything is matched on this
// device from data already fetched; nothing is sent anywhere except the normal GRU API calls.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../lib/api.ts";
import { SearchIcon } from "./Icons.tsx";
import { cx } from "./ui.tsx";

interface Hit { key: string; label: string; hint: string; to: string }

const PAGES: Hit[] = [
  { key: "p-today", label: "Today", hint: "Page", to: "/" },
  { key: "p-apply", label: "Apply today", hint: "Page", to: "/applications" },
  { key: "p-other", label: "Other jobs", hint: "Page", to: "/applications?tab=other" },
  { key: "p-track", label: "My applications", hint: "Page", to: "/applications?tab=tracked" },
  { key: "p-board", label: "Pipeline board", hint: "Page", to: "/applications?tab=board" },
  { key: "p-net", label: "Network", hint: "Page", to: "/network" },
  { key: "p-ins", label: "Insights", hint: "Page", to: "/insights" },
  { key: "p-inbox", label: "Inbox", hint: "Page", to: "/inbox" },
  { key: "p-review", label: "Review", hint: "Page", to: "/review" },
  { key: "p-cal", label: "Calendar", hint: "Page", to: "/calendar" },
  { key: "p-tasks", label: "Tasks", hint: "Page", to: "/agenda" },
  { key: "p-notes", label: "Notes", hint: "Page", to: "/notes" },
  { key: "p-rec", label: "Recruiters", hint: "Page", to: "/people" },
  { key: "p-set", label: "Settings", hint: "Page", to: "/settings" },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const jobs = useQuery({ queryKey: ["jobs", "all", ""], queryFn: () => api.jobs("all"), enabled: open, staleTime: 60_000 });
  const people = useQuery({ queryKey: ["net", "people", "all"], queryFn: () => api.netPeople(), enabled: open, staleTime: 60_000 });
  const apps = useQuery({ queryKey: ["applications", "palette"], queryFn: () => api.listApplications({ status: "all" }), enabled: open, staleTime: 60_000 });

  useEffect(() => { if (open) { setText(""); setActive(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);

  const hits = useMemo<Hit[]>(() => {
    const q = text.trim().toLowerCase();
    const all: Hit[] = [
      ...PAGES,
      ...(apps.data?.items ?? []).map((a) => ({ key: `a${a.id}`, label: `${a.company}${a.role ? ` · ${a.role}` : ""}`, hint: "Application", to: `/applications/${a.id}?status=all` })),
      ...(jobs.data?.items ?? []).map((j) => ({ key: `j${j.id}`, label: `${j.title}${j.company ? ` · ${j.company}` : ""}`, hint: "Job", to: `/jobs/${j.id}` })),
      ...(people.data?.items ?? []).map((p) => ({ key: `n${p.id}`, label: `${p.name}${p.company ? ` · ${p.company}` : ""}`, hint: "Person", to: `/network?person=${p.id}` })),
    ];
    if (!q) return PAGES;
    const words = q.split(/\s+/);
    return all.filter((h) => words.every((w) => h.label.toLowerCase().includes(w))).slice(0, 12);
  }, [text, apps.data, jobs.data, people.data]);

  useEffect(() => { setActive(0); }, [text]);
  if (!open) return null;
  const go = (h: Hit | undefined) => { if (h) { onClose(); nav(h.to); } };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-[var(--scrim)] px-4 pt-[12dvh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Search GRU" className="w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_20px_50px_rgba(0,0,0,.25)]"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(hits.length - 1, i + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
          else if (e.key === "Enter") go(hits[active]);
        }}>
        <label className="relative block border-b border-line">
          <span className="sr-only">Search pages, jobs, applications and people</span>
          <span className="pointer-events-none absolute top-3.5 left-4 text-muted"><SearchIcon size={16} /></span>
          <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Search pages, jobs, applications, people" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={hits[active] ? `pal-${hits[active]?.key}` : undefined}
            className="h-12 w-full bg-transparent pr-4 pl-11 text-[15px] text-ink placeholder:text-muted focus:outline-none" />
        </label>
        <ul id="palette-list" role="listbox" className="m-0 max-h-[50dvh] list-none overflow-y-auto p-1.5">
          {hits.length === 0 ? <li className="px-3 py-4 text-center text-[13px] text-muted">Nothing found</li> : hits.map((h, i) => (
            <li key={h.key} id={`pal-${h.key}`} role="option" aria-selected={i === active}>
              <button type="button" tabIndex={-1} onMouseEnter={() => setActive(i)} onClick={() => go(h)} className={cx("flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[14px]", i === active ? "bg-accent-soft text-ink" : "text-ink-2")}>
                <span className="truncate">{h.label}</span><span className="flex-none text-[11.5px] text-muted">{h.hint}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="m-0 border-t border-line px-4 py-2 text-[11.5px] text-muted">↑ ↓ to move · Enter to open · Esc to close</p>
      </div>
    </div>
  );
}
