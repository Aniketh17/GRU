// Recruiters and hiring contacts, built automatically from the people who email you about jobs.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { useToast } from "../components/Toast.tsx";
import { Button, Card, EmptyState, ErrorState, PageHeader, SkeletonRows, TextArea } from "../components/ui.tsx";
import { api, type Contact } from "../lib/api.ts";
import { daysSince, formatRelative } from "../lib/format.ts";

function ContactCard({ c }: { c: Contact }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(c.notes ?? "");
  const save = useMutation({
    mutationFn: () => api.saveContactNotes(c.id, notes),
    onSuccess: () => { setEditing(false); qc.invalidateQueries({ queryKey: ["contacts"] }); toast({ text: "Saved" }); },
  });
  const remove = useMutation({ mutationFn: () => api.deleteContact(c.id), onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }) });
  const days = daysSince(c.last_contact_at);
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 truncate text-[15px] font-semibold">{c.name ?? "Unknown"}</p>
          <p className="m-0 truncate text-[13px] text-muted">
            {c.app_id ? <Link to={`/applications/${c.app_id}`} className="text-accent-text">{c.company ?? "Application"}</Link> : c.company ?? "Company not known"}
            {" · "}last wrote {formatRelative(c.last_contact_at)}{c.msg_count > 1 ? ` · ${c.msg_count} emails` : ""}
          </p>
        </div>
        {days >= 7 && <span className="flex-none text-[12px] font-medium text-amber-text">{days} days ago</span>}
      </div>
      {c.email && (
        <p className="m-0 flex flex-wrap items-center gap-2 text-[13px]">
          <a href={`mailto:${c.email}`} className="break-all text-accent-text">{c.email}</a>
          <Button size="sm" variant="quiet" onClick={() => { void navigator.clipboard?.writeText(c.email ?? ""); toast({ text: "Address copied" }); }}>Copy</Button>
        </p>
      )}
      {editing ? (
        <>
          <TextArea label="Notes · encrypted" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex justify-end gap-2"><Button size="sm" onClick={() => setEditing(false)}>Cancel</Button><Button size="sm" variant="primary" onClick={() => save.mutate()}>Save</Button></div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 text-[13px] whitespace-pre-wrap text-ink-2">{c.notes ?? ""}</p>
          <span className="flex gap-2">
            <Button size="sm" onClick={() => setEditing(true)}>{c.notes ? "Edit notes" : "Add note"}</Button>
            <Button size="sm" variant="quiet" onClick={() => remove.mutate()}>Remove</Button>
          </span>
        </div>
      )}
    </Card>
  );
}

export function PeoplePage() {
  const q = useQuery({ queryKey: ["contacts"], queryFn: api.contacts });
  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4">
      <PageHeader title="People" subtitle="Recruiters and hiring contacts who have emailed you about a job. Built automatically; names and addresses are encrypted." />
      {q.isPending ? <SkeletonRows rows={3} label="Loading people" /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : q.data.items.length === 0 ? (
        <Card><EmptyState title="No contacts yet">When a recruiter or hiring manager emails you, they appear here with the company and when they last wrote.</EmptyState></Card>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">{q.data.items.map((c) => <li key={c.id}><ContactCard c={c} /></li>)}</ul>
      )}
    </div>
  );
}
