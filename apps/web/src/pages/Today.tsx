// Today (Phase 1 & Phase 2): pipeline, follow-ups due, since yesterday updates with Undo, and Gmail sync health.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { ApplicationForm } from "../components/ApplicationForm.tsx";
import { ListIcon, PlusIcon } from "../components/Icons.tsx";
import { ThemeToggle } from "../components/ThemeContext.tsx";
import { useToast } from "../components/Toast.tsx";
import { Button, Card, EmptyState, ErrorState, SectionTitle, SkeletonRows, StatusChip } from "../components/ui.tsx";
import { api, type RecentEvent, type Status } from "../lib/api.ts";
import { daysSince, formatLong, formatRelative, formatTime, greeting } from "../lib/format.ts";

const PIPELINE: { label: string; statuses: Status[]; tone: string }[] = [
  { label: "Applied", statuses: ["applied"], tone: "bg-line-strong" },
  { label: "Assessment", statuses: ["assessment"], tone: "bg-blue" },
  { label: "Interview", statuses: ["interview"], tone: "bg-accent" },
  { label: "Offer", statuses: ["offer", "accepted"], tone: "bg-accent" },
  { label: "Closed", statuses: ["declined", "rejected", "withdrawn"], tone: "bg-line-strong" },
];

export function TodayPage() {
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const summary = useQuery({ queryKey: ["summary"], queryFn: api.summary });
  const followUps = useQuery({ queryKey: ["applications", { status: "active", q: "", stale: true }], queryFn: () => api.listApplications({ status: "active", stale: true }) });
  const recent = useQuery({ queryKey: ["applications", { status: "all", q: "", stale: false }], queryFn: () => api.listApplications({ status: "all" }) });
  const recentEvents = useQuery({ queryKey: ["events", "recent"], queryFn: api.recentEvents });
  const accountsQuery = useQuery({ queryKey: ["mailAccounts"], queryFn: api.mailAccounts });

  const undoMutation = useMutation({
    mutationFn: (eventId: number) => api.undo(eventId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["applications"] });
      toast({ text: `Update undone · reverted to ${data.status}` });
    },
    onError: () => {
      toast({ text: "Failed to undo update" });
    },
  });

  const counts = summary.data?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const now = Math.floor(Date.now() / 1000);

  const autoChanges = (recentEvents.data?.items ?? []).filter(
    (e) => e.auto_applied === 1 && e.undone === 0,
  );

  const accounts = accountsQuery.data?.accounts ?? [];
  const needsReauth = accounts.some((a) => a.status === "needs_reauth");
  const activeAccounts = accounts.filter((a) => a.status === "active");
  const lastSyncTime = Math.max(0, ...accounts.map((a) => a.last_sync_at ?? 0));

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <p className="m-0 text-[13px] font-medium text-muted">{formatLong(now)} · Auckland</p>
          <h1 className="m-0 text-[26px] leading-tight font-semibold tracking-[-0.015em]">{greeting()}, Ani</h1>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="primary" size="sm" className="rounded-full" onClick={() => setAdding(true)}><PlusIcon size={14} />Add application</Button>
        </div>
      </header>

      {summary.isSuccess && total === 0 ? (
        <Card>
          <EmptyState
            icon={<ListIcon size={19} />}
            title="Let’s set up your pipeline"
            action={<Button variant="primary" onClick={() => setAdding(true)}><PlusIcon size={14} />Add your first application</Button>}
          >
            Start with the applications you’ve already sent. When Gmail is connected (next phase), GRU will spot replies, interviews and rejections for you.
          </EmptyState>
        </Card>
      ) : (
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-5">
            <Card>
              <SectionTitle aside={<Link to="/applications" className="text-[13px] font-medium text-accent-text no-underline">All applications →</Link>}>Pipeline</SectionTitle>
              {summary.isPending ? (
                <SkeletonRows rows={1} label="Loading pipeline" />
              ) : summary.isError ? (
                <ErrorState onRetry={() => summary.refetch()} />
              ) : (
                <div className="grid grid-cols-3 gap-3 px-5 pt-2 pb-5 sm:grid-cols-5">
                  {PIPELINE.map((p) => {
                    const n = p.statuses.reduce((a, s) => a + (counts[s] ?? 0), 0);
                    return (
                      <Link key={p.label} to={`/applications?status=${p.statuses.length === 1 ? p.statuses[0] : p.label === "Closed" ? "closed" : "all"}`} className="flex flex-col gap-1.5 rounded-lg text-ink no-underline">
                        <span className="text-[12.5px] text-muted">{p.label}</span>
                        <span className="text-[22px] font-semibold tracking-[-0.01em] tabular-nums">{n}</span>
                        <span className="h-1 overflow-hidden rounded-sm bg-track">
                          <span className={`block h-1 ${p.tone}`} style={{ width: `${total ? Math.round((n / total) * 100) : 0}%` }} />
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </Card>

            {autoChanges.length > 0 && (
              <Card className="overflow-hidden border-accent/40">
                <SectionTitle aside={<span className="text-[12.5px] text-muted">24-hour undo available</span>}>
                  Since yesterday
                </SectionTitle>
                <ul className="m-0 list-none p-0">
                  {autoChanges.map((ev) => {
                    const newStatus = ev.type.startsWith("status:") ? ev.type.slice(7) : ev.current_status;
                    return (
                      <li key={ev.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 hover:bg-sunken">
                        <div className="flex min-w-0 flex-1 flex-col">
                          <Link to={`/applications/${ev.app_id}`} className="truncate font-medium text-ink hover:underline">
                            {ev.company}
                          </Link>
                          <span className="text-[12px] text-muted">
                            Automatically moved {ev.prev_status ?? "applied"} → <strong className="text-ink">{newStatus}</strong> · {formatRelative(ev.at)}
                          </span>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={undoMutation.isPending}
                          onClick={() => undoMutation.mutate(ev.id)}
                        >
                          Undo
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}

            <Card className="overflow-hidden">
              <SectionTitle aside={<span className="text-[12.5px] text-muted">Latest first</span>}>Recent activity</SectionTitle>
              {recent.isPending ? (
                <SkeletonRows rows={3} label="Loading recent activity" />
              ) : recent.isError ? (
                <ErrorState onRetry={() => recent.refetch()} />
              ) : (
                <ul className="m-0 list-none p-0">
                  {recent.data.items.slice(0, 6).map((a) => (
                    <li key={a.id} className="border-t border-line">
                      <Link to={`/applications/${a.id}?status=all`} className="flex items-center gap-3 px-5 py-3 text-ink no-underline hover:bg-sunken">
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium">{a.company}</span>
                          <span className="truncate text-[12.5px] text-muted">{a.role ?? "Role not set"} · {formatRelative(a.last_event_at ?? a.created_at)}</span>
                        </span>
                        <StatusChip status={a.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-5">
            <Card className="overflow-hidden">
              <SectionTitle aside={followUps.data && followUps.data.items.length > 0 ? <Link to="/applications?stale=1" className="text-[13px] font-medium text-accent-text no-underline">See all</Link> : undefined}>Follow-ups due</SectionTitle>
              {followUps.isPending ? (
                <SkeletonRows rows={2} label="Loading follow-ups" />
              ) : followUps.isError ? (
                <ErrorState onRetry={() => followUps.refetch()} />
              ) : followUps.data.items.length === 0 ? (
                <p className="m-0 px-5 pb-4 text-[13px] text-muted">Nothing is waiting on you. Applications with no reply after 14 days show up here.</p>
              ) : (
                <ul className="m-0 list-none p-0 pb-1">
                  {followUps.data.items.slice(0, 5).map((a) => (
                    <li key={a.id}>
                      <Link to={`/applications/${a.id}?stale=1`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-ink no-underline hover:bg-sunken">
                        <span className="min-w-0 truncate font-medium">{a.company}</span>
                        <span className="flex-none text-[12.5px] font-semibold text-amber-text tabular-nums">{daysSince(a.last_event_at ?? a.applied_at)} days</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <section className="flex flex-col gap-1.5 rounded-[14px] border border-dashed border-line-strong px-5 py-4">
              <p className="m-0 text-[12.5px] font-semibold text-muted">System health</p>
              <p className="m-0 text-[13px] text-ink-2">Tracking {total} application{total === 1 ? "" : "s"}. Data encrypted at rest.</p>
              {needsReauth ? (
                <p className="m-0 text-[13px] font-medium text-red-text">
                  Action needed: Reconnect your Gmail account in <Link to="/settings" className="underline">Settings</Link>.
                </p>
              ) : activeAccounts.length > 0 ? (
                <p className="m-0 text-[13px] text-ink-2">
                  Gmail sync active · {activeAccounts.length} mailbox{activeAccounts.length === 1 ? "" : "es"} connected
                  {lastSyncTime > 0 ? ` · synced ${formatRelative(lastSyncTime)}` : ""}.
                </p>
              ) : (
                <p className="m-0 text-[13px] text-ink-2">
                  No Gmail accounts connected yet. Connect in <Link to="/settings" className="underline">Settings</Link>.
                </p>
              )}
            </section>
          </div>
        </div>
      )}

      <ApplicationForm open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
