// Desktop (≥1024 px): 248 px sidebar. Mobile: bottom tab bar with safe-area padding.
// Only sections that have shipped appear (Jobs, Interviews, Review, Agenda, Notes join in later phases).
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router";
import { api } from "../lib/api.ts";
import { BriefcaseIcon, CheckIcon, InboxIcon, ListIcon, MoreIcon, NoteIcon, PeopleIcon, SettingsIcon, SunIcon } from "./Icons.tsx";
import { VoiceAssistant } from "./VoiceAssistant.tsx";
import { Banner, cx } from "./ui.tsx";

const NAV = [
  { to: "/", label: "Today", icon: SunIcon, end: true },
  { to: "/applications", label: "Applications", icon: ListIcon, end: false },
  { to: "/jobs", label: "Jobs", icon: BriefcaseIcon, end: false },
  { to: "/agenda", label: "Agenda", icon: CheckIcon, end: false },
  { to: "/notes", label: "Notes", icon: NoteIcon, end: false },
  { to: "/people", label: "People", icon: PeopleIcon, end: false },
  { to: "/review", label: "Review", icon: InboxIcon, end: false },
] as const;

const TABS = [NAV[0], NAV[2], NAV[1], NAV[3]] as const; // Today, Jobs, Applications, Agenda

function SideLink({ to, end, icon: Icon, children }: { to: string; end: boolean; icon: typeof SunIcon; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cx(
          "flex h-9 items-center gap-2.5 rounded-[9px] px-2.5 no-underline transition-colors",
          isActive ? "bg-surface font-semibold text-ink shadow-[0_1px_0_var(--line)]" : "font-medium text-ink-2 hover:bg-surface/60 hover:text-ink",
        )
      }
    >
      <Icon size={17} />
      {children}
    </NavLink>
  );
}

function Sidebar() {
  return (
    <nav aria-label="Primary" className="hidden w-[248px] flex-none flex-col gap-5 border-r border-line bg-side px-3.5 py-5 lg:flex">
      <div className="flex items-center gap-2.5 px-2">
        <span className="grid size-[30px] place-items-center rounded-[9px] bg-ink text-[13px] font-bold tracking-wide text-side">G</span>
        <div className="flex flex-col leading-tight">
          <span className="text-[13px] font-bold tracking-[0.08em]">GRU</span>
          <span className="text-[12px] text-muted">for Ani</span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        {NAV.map((n) => (
          <SideLink key={n.to} to={n.to} end={n.end} icon={n.icon}>{n.label}</SideLink>
        ))}
      </div>
      <div className="mt-auto flex flex-col gap-0.5">
        <SideLink to="/settings" end={false} icon={SettingsIcon}>Settings</SideLink>
      </div>
    </nav>
  );
}

function TabBar() {
  const tabs = [...TABS, { to: "/more", label: "More", icon: MoreIcon, end: false }];
  return (
    <nav aria-label="Primary" className="pb-safe fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-surface px-1 pt-1.5 lg:hidden">
      {tabs.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cx("flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11px] no-underline", isActive ? "font-semibold text-ink" : "font-medium text-muted")
          }
        >
          {({ isActive }) => (
            <>
              <span className={cx("grid h-7 w-11 place-items-center rounded-full", isActive && "bg-accent-soft")}>
                <Icon size={19} />
              </span>
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, staleTime: 60_000 });
  return (
    <div className="flex min-h-dvh bg-bg text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Sidebar />
      <VoiceAssistant />
      <main id="main" className="min-w-0 flex-1 px-4 pt-safe pb-28 sm:px-6 lg:px-9 lg:pt-7 lg:pb-12">
        <div className="mx-auto flex max-w-[1140px] flex-col gap-5">
          {health.data?.paused && (
            <Banner tone="amber" title="GRU is paused.">Syncing and reminders are stopped. Resume it in Settings.</Banner>
          )}
          <Outlet />
        </div>
      </main>
      <TabBar />
    </div>
  );
}
