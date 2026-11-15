import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { InterviewPanel } from "../components/InterviewPanel.tsx";
import { ApplicationForm } from "../components/ApplicationForm.tsx";
import { ConfirmDialog } from "../components/Dialog.tsx";
import { ChevronLeft, ListIcon, PlusIcon, SearchIcon, TrashIcon } from "../components/Icons.tsx";
import { useToast } from "../components/Toast.tsx";
import { Button, Card, EmptyState, ErrorState, PageHeader, SkeletonRows, StatusChip, TextArea, cx } from "../components/ui.tsx";
import { api, type Application, type Status } from "../lib/api.ts";
import { STATUS_LABEL, STATUS_ORDER, daysSince, eventLabel, formatRelative, formatShort } from "../lib/format.ts";

const FILTERS: { value: string; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "applied", label: "Applied" },
  { value: "assessment", label: "Assessment" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ApplicationsPage() {
  const { id } = useParams();
  const selected = id && /^\d+$/.test(id) ? Number(id) : null;
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "active";
  const stale = params.get("stale") === "1";
  const [search, setSearch] = useState(params.get("q") ?? "");
  const q = useDebounced(search.trim(), 250);
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  const summary = useQuery({ queryKey: ["summary"], queryFn: api.summary });

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (q) next.set("q", q);
    else next.delete("q");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [q, params, setParams]);

  const list = useInfiniteQuery({
    queryKey: ["applications", { status, q, stale }],
    queryFn: ({ pageParam }) => api.listApplications({ status, q, stale, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = Object.values(summary.data?.counts ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  const qs = params.toString() ? `?${params}` : "";

  const setFilter = (value: string) => {
    const next = new URLSearchParams(params);
    next.set("status", value);
    next.delete("stale");
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Applications"
        subtitle={summary.data ? `${total} tracked · ${summary.data.stale} need a follow-up` : "Loading…"}
        actions={<Button variant="primary" onClick={() => setAdding(true)}><PlusIcon size={14} />Add application</Button>}
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <label className="relative w-full max-w-[360px] flex-[1_1_260px]">
          <span className="sr-only">Search company or role</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company or role"
            className="h-10 w-full rounded-[10px] border border-line bg-surface pr-3 pl-9 text-[14px] text-ink placeholder:text-muted"
          />
          <span className="pointer-events-none absolute top-3 left-3 text-muted"><SearchIcon size={15} /></span>
        </label>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => {
            const on = !stale && status === f.value;
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(f.value)}
                className={cx("h-8 flex-none cursor-pointer rounded-full border px-3 text-[12.5px] font-medium", on ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink-2 hover:text-ink")}
              >
                {f.label}
              </button>
            );
          })}
          {stale && <span className="flex h-8 flex-none items-center rounded-full bg-amber-soft px-3 text-[12.5px] font-semibold text-amber-text">Needs follow-up</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <Card className={cx("min-w-0 flex-[1.4_1_480px] overflow-hidden", selected !== null && "hidden lg:block")} aria-label="Applications list">
          {list.isPending ? (
            <SkeletonRows rows={5} label="Loading applications" />
          ) : list.isError ? (
            <ErrorState onRetry={() => list.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<ListIcon size={19} />}
              title={q || status !== "active" || stale ? "Nothing matches" : "No applications yet"}
              action={!q && <Button variant="primary" onClick={() => setAdding(true)}><PlusIcon size={14} />Add your first application</Button>}
            >
              {q || status !== "active" || stale
                ? "Try a different search or filter."
                : "Add the applications you’ve already sent. Once Gmail is connected, GRU will keep their status up to date from your inbox."}
            </EmptyState>
          ) : (
            <ul className="m-0 list-none p-0">
              {items.map((a) => (
                <li key={a.id} className="border-b border-line last:border-b-0">
                  <Link
                    to={`/applications/${a.id}${qs}`}
                    aria-current={selected === a.id ? "true" : undefined}
                    className={cx("flex items-center gap-3 px-4 py-3 text-ink no-underline hover:bg-sunken sm:px-5", selected === a.id && "bg-accent-wash")}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-semibold">{a.company}</span>
                      <span className="truncate text-[12.5px] text-muted">{a.role ?? "Role not set"}</span>
                    </span>
                    <span className="hidden w-[150px] flex-none flex-col text-[12.5px] tabular-nums sm:flex">
                      <span className={cx(a.stale ? "font-semibold text-amber-text" : "text-ink-2")}>
                        {a.stale ? `${daysSince(a.last_event_at ?? a.applied_at)} days · follow up` : formatRelative(a.last_event_at ?? a.created_at)}
                      </span>
                      <span className="truncate text-muted">{a.next_action ?? `Applied ${formatShort(a.applied_at)}`}</span>
                    </span>
                    <StatusChip status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {list.hasNextPage && (
            <div className="border-t border-line p-3 text-center">
              <Button variant="quiet" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </Card>

        {selected !== null ? (
          <ApplicationDetail id={selected} onClose={() => navigate(`/applications${qs}`)} />
        ) : (
          <Card className="hidden min-w-0 flex-[1_1_340px] lg:block" aria-label="Application detail">
            <EmptyState title="Select an application">Its timeline, next action and private notes appear here.</EmptyState>
          </Card>
        )}
      </div>

      <ApplicationForm open={adding} onClose={() => setAdding(false)} onSaved={(a) => navigate(`/applications/${a.id}${qs}`)} />
    </>
  );
}

function ApplicationDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const app = useQuery({ queryKey: ["application", id], queryFn: () => api.getApplication(id) });
  const timeline = useQuery({ queryKey: ["timeline", id], queryFn: () => api.timeline(id) });
  const [notes, setNotes] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["applications"] });
    qc.invalidateQueries({ queryKey: ["summary"] });
    qc.invalidateQueries({ queryKey: ["application", id] });
    qc.invalidateQueries({ queryKey: ["timeline", id] });
  };

  const undo = useMutation({
    mutationFn: (eventId: number) => api.undo(eventId),
    onSuccess: (r) => {
      refresh();
      toast({ text: `Back to ${STATUS_LABEL[r.status]}` });
    },
    onError: () => toast({ text: "That change can no longer be undone" }),
  });
  const setStatus = useMutation({
    mutationFn: (s: Status) => api.setStatus(id, s),
    onSuccess: (r) => {
      refresh();
      const eventId = r.event_id;
      toast({ text: `Moved to ${STATUS_LABEL[r.application.status]}`, ...(eventId ? { action: { label: "Undo", run: () => undo.mutate(eventId) } } : {}) });
    },
  });
  const saveNotes = useMutation({
    mutationFn: (value: string) => api.updateApplication(id, { notes: value || null }),
    onSuccess: (a) => {
      qc.setQueryData(["application", id], a);
      setNotes(null);
      toast({ text: "Notes saved" });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteApplication(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      toast({ text: "Application deleted" });
      onClose();
    },
  });

  const a: Application | undefined = app.data;
  return (
    <Card as="aside" className="min-w-0 flex-[1_1_340px] overflow-hidden" aria-label="Application detail">
      <div className="flex items-center justify-between border-b border-line px-3 py-2 lg:hidden">
        <Button variant="quiet" size="sm" onClick={onClose}><ChevronLeft size={16} />All applications</Button>
      </div>
      {app.isPending ? (
        <SkeletonRows rows={3} label="Loading application" />
      ) : app.isError || !a ? (
        <ErrorState onRetry={() => app.refetch()} message="This application couldn’t be loaded. It may have been deleted." />
      ) : (
        <div className="fade-in">
          <div className="flex flex-col gap-2 border-b border-line px-5 pt-4 pb-3.5">
            <div className="flex items-center justify-between gap-2">
              <StatusChip status={a.status} />
              <label className="relative">
                <span className="sr-only">Change status</span>
                <select
                  value={a.status}
                  disabled={setStatus.isPending}
                  onChange={(e) => setStatus.mutate(e.target.value as Status)}
                  className="h-8 cursor-pointer appearance-none rounded-lg border border-line bg-transparent pr-7 pl-2.5 text-[12.5px] font-medium text-ink-2"
                >
                  {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
                <span className="pointer-events-none absolute top-2 right-2 text-muted" aria-hidden="true">▾</span>
              </label>
            </div>
            <h2 className="m-0 text-[19px] font-semibold tracking-[-0.01em]">{a.company}</h2>
            <p className="m-0 text-[13.5px] text-ink-2">{a.role ?? "Role not set"} · via {a.source === "manual" ? "direct" : a.source}</p>
          </div>

          <dl className="m-0 grid grid-cols-2 gap-3 border-b border-line px-5 py-3.5 tabular-nums">
            <div><dt className="text-[12px] text-muted">Next action</dt><dd className="m-0 font-semibold">{a.next_action ?? "None set"}</dd></div>
            <div><dt className="text-[12px] text-muted">Applied</dt><dd className="m-0 font-semibold">{formatShort(a.applied_at)} · {daysSince(a.applied_at)} days ago</dd></div>
          </dl>
          {a.stale && (
            <p className="m-0 border-b border-line bg-amber-soft px-5 py-2.5 text-[13px] font-medium text-amber-text">
              No activity for {daysSince(a.last_event_at ?? a.applied_at)} days. A polite follow-up might help.
            </p>
          )}

          <InterviewPanel appId={a.id} onChanged={refresh} />

          <div className="px-5 py-4">
            <h3 className="mt-0 mb-2.5 text-[13.5px] font-semibold">Timeline</h3>
            {timeline.isPending ? (
              <p className="m-0 text-muted">Loading…</p>
            ) : (
              <ol className="m-0 list-none p-0">
                {timeline.data?.items.map((e, i, arr) => {
                  const canUndo = e.type.startsWith("status:") && !e.undone && e.prev_status && Date.now() / 1000 - e.at < 86400;
                  return (
                    <li key={e.id} className="grid grid-cols-[16px_minmax(0,1fr)] gap-3">
                      <span className="flex flex-col items-center">
                        <span className={cx("mt-1.5 size-2.5 rounded-full", e.type.startsWith("status:") && !e.undone ? "bg-accent" : "bg-line-strong")} />
                        {i < arr.length - 1 && <span className="w-px flex-1 bg-line" />}
                      </span>
                      <div className="pb-3.5">
                        <p className={cx("m-0 font-medium", e.undone === 1 && "text-muted line-through")}>{eventLabel(e.type, e.prev_status)}</p>
                        <p className="m-0 text-[12.5px] text-muted">{formatRelative(e.at)} · {e.auto_applied ? "automatic, from email" : "by you"}</p>
                        {canUndo && (
                          <Button size="sm" className="mt-1.5" onClick={() => undo.mutate(e.id)} disabled={undo.isPending}>Undo</Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-line px-5 py-4">
            <TextArea
              label="Private notes · encrypted"
              rows={3}
              maxLength={5000}
              value={notes ?? a.notes ?? ""}
              onChange={(e) => setNotes(e.target.value)}
            />
            {notes !== null && notes !== (a.notes ?? "") && (
              <div className="flex justify-end gap-2">
                <Button size="sm" onClick={() => setNotes(null)}>Discard</Button>
                <Button size="sm" variant="primary" onClick={() => saveNotes.mutate(notes)} disabled={saveNotes.isPending}>Save notes</Button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap justify-between gap-2 border-t border-line bg-sunken px-5 py-3">
            <Button size="sm" onClick={() => setEditing(true)}>Edit details</Button>
            <Button size="sm" variant="quiet" onClick={() => setConfirmDelete(true)}><TrashIcon size={14} />Delete</Button>
          </div>
          <ApplicationForm open={editing} onClose={() => setEditing(false)} existing={a} />
          <ConfirmDialog
            open={confirmDelete}
            onClose={() => setConfirmDelete(false)}
            title={`Delete ${a.company}?`}
            body="This removes the application, its timeline and its notes. It can’t be undone."
            confirmLabel="Delete application"
            danger
            onConfirm={() => remove.mutate()}
          />
        </div>
      )}
    </Card>
  );
}
