// Inbox triage (Revamp 3D): job mail GRU could not classify. Pick what it is, link it, or say it is not job related.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Modal } from "../components/Dialog.tsx";
import { MailViewer } from "../components/MailViewer.tsx";
import { useToast } from "../components/Toast.tsx";
import { Button, Card, EmptyState, ErrorState, Field, PageHeader, Pill, Select, SkeletonRows } from "../components/ui.tsx";
import { api, type InboxItem } from "../lib/api.ts";
import { formatDateTime, formatRelative } from "../lib/format.ts";

const CHOICES: { key: string; label: string; hint: string }[] = [
  { key: "rejection", label: "Rejection", hint: "Sets the application to Rejected" },
  { key: "interview", label: "Interview", hint: "Sets the application to Interview" },
  { key: "assessment", label: "Assessment", hint: "Sets the application to Assessment" },
  { key: "offer", label: "Offer", hint: "Sets the application to Offer" },
  { key: "application_received", label: "Application received", hint: "Creates or links an application" },
  { key: "update", label: "Status update", hint: "Links it, status stays" },
  { key: "recruiter", label: "Recruiter", hint: "Links it, status stays" },
  { key: "alert", label: "Job alert", hint: "Just files it as an alert" },
];

export function InboxPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["inbox"], queryFn: api.inbox });
  const [pick, setPick] = useState<InboxItem | null>(null);
  const [view, setView] = useState<InboxItem | null>(null);
  const done = () => { qc.invalidateQueries({ queryKey: ["inbox"] }); qc.invalidateQueries({ queryKey: ["inboxCount"] }); qc.invalidateQueries({ queryKey: ["applications"] }); qc.invalidateQueries({ queryKey: ["brief"] }); };
  const toast = useToast();
  const ignore = useMutation({
    mutationFn: (v: { it: InboxItem; block: boolean }) => api.inboxIgnore({ account_id: v.it.account_id, gmail_id: v.it.gmail_id, block_sender: v.block }),
    onSuccess: (r) => { done(); toast({ text: r.blocked ? `Forgotten. GRU will no longer read mail from ${r.blocked}.` : "Forgotten. Not job related." }); },
  });
  const unblock = useMutation({ mutationFn: api.inboxUnblock, onSuccess: () => { done(); toast({ text: "Sender allowed again" }); } });
  const items = q.data?.items ?? [];

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4">
      <PageHeader title="Inbox" subtitle="Mail GRU could not work out. You decide what it is; wrongly pulled mail can be forgotten, and a sender can be blocked so GRU never reads it again." />
      {q.isPending ? <SkeletonRows rows={3} label="Loading inbox" /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : items.length === 0 ? (
        <Card><EmptyState title="Nothing needs sorting">When GRU can’t tell what a job email means, it lands here so you can classify it in one tap.</EmptyState></Card>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {items.map((it) => (
            <li key={`${it.account_id}:${it.gmail_id}`}>
              <Card className="flex flex-col gap-2.5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-[15px] font-semibold">{it.subject ?? "Subject not kept"}</p>
                    <p className="m-0 truncate text-[13px] text-muted">{it.from ?? it.domain ?? "Unknown sender"}</p>
                  </div>
                  <span className="flex-none text-[12px] text-muted" title={formatDateTime(it.at)}>{formatRelative(it.at)}</span>
                </div>
                <p className="m-0 text-[12.5px] text-ink-2">{it.unreadable ? "GRU couldn’t read the text of this email." : "GRU read it but couldn’t tell what it means."} {it.app_id ? "It looks related to an application you track." : ""}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" onClick={() => setPick(it)}>Classify</Button>
                  <Button size="sm" onClick={() => setView(it)}>Open email</Button>
                  <Button size="sm" variant="quiet" onClick={() => ignore.mutate({ it, block: false })}>Not job related</Button>
                  {it.domain && <Button size="sm" variant="quiet" onClick={() => ignore.mutate({ it, block: true })}>Never read {it.domain}</Button>}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {(q.data?.blocked.length ?? 0) > 0 && (
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="m-0 text-[14px] font-semibold">Blocked senders</h2>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {q.data?.blocked.map((d) => <li key={d}><Pill tone="neutral">{d}</Pill> <button type="button" className="cursor-pointer text-[12px] text-accent-text underline" onClick={() => unblock.mutate(d)}>allow</button></li>)}
          </ul>
        </Card>
      )}
      {view && <MailViewer accountId={view.account_id} gmailId={view.gmail_id} onClose={() => setView(null)} />}
      {pick && <ClassifyDialog item={pick} apps={q.data?.applications ?? []} onClose={() => setPick(null)} onDone={() => { setPick(null); done(); }} />}
    </div>
  );
}

function ClassifyDialog({ item, apps, onClose, onDone }: { item: InboxItem; apps: { id: number; company: string; role: string | null; status: string }[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [cls, setCls] = useState("");
  const [appId, setAppId] = useState(item.app_id ? String(item.app_id) : "");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const save = useMutation({
    mutationFn: () => api.inboxClassify({
      account_id: item.account_id, gmail_id: item.gmail_id, class: cls,
      ...(appId ? { app_id: Number(appId) } : company.trim() ? { create: { company: company.trim(), ...(role.trim() ? { role: role.trim() } : {}) } } : {}),
    }),
    onSuccess: () => { toast({ text: "Classified" }); onDone(); },
    onError: () => toast({ text: "Couldn’t save that" }),
  });
  const needsApp = ["rejection", "interview", "assessment", "offer", "application_received", "update", "recruiter"].includes(cls);
  return (
    <Modal open onClose={onClose} title="What is this email?">
      <p className="m-0 truncate text-[13px] text-muted">{item.subject ?? item.domain}</p>
      <div className="grid grid-cols-2 gap-2">
        {CHOICES.map((c) => (
          <button key={c.key} type="button" onClick={() => setCls(c.key)} aria-pressed={cls === c.key}
            className={`cursor-pointer rounded-xl border px-3 py-2 text-left text-[13px] ${cls === c.key ? "border-accent bg-accent-soft font-semibold" : "border-line bg-surface hover:bg-sunken"}`}>
            {c.label}<span className="block text-[11.5px] font-normal text-muted">{c.hint}</span>
          </button>
        ))}
      </div>
      {needsApp && (
        <>
          <Select label="Which application?" value={appId} onChange={(e) => setAppId(e.target.value)}>
            <option value="">None / new application</option>
            {apps.map((a) => <option key={a.id} value={a.id}>{a.company}{a.role ? ` · ${a.role}` : ""} ({a.status})</option>)}
          </Select>
          {!appId && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Or create: company" value={company} onChange={(e) => setCompany(e.target.value)} />
              <Field label="Role (optional)" value={role} onChange={(e) => setRole(e.target.value)} />
            </div>
          )}
        </>
      )}
      <Button variant="primary" disabled={!cls || save.isPending} onClick={() => save.mutate()}>Save</Button>
    </Modal>
  );
}
