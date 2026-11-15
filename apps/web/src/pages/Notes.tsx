// Phase 6: quick capture, tags, blind-index search (encrypted at rest; search runs on HMAC tokens).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "../components/Toast.tsx";
import { Button, Card, EmptyState, ErrorState, Field, PageHeader, Pill, SkeletonRows, TextArea } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { formatRelative } from "../lib/format.ts";

const parseTags = (s: string) => [...new Set(s.toLowerCase().split(/[\s,]+/).map((t) => t.replace(/^#/, "").replace(/[^a-z0-9-]/g, "").slice(0, 24)).filter(Boolean))].slice(0, 8);

export function NotesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const term = search.trim();
  const q = useQuery({ queryKey: ["notes", term], queryFn: () => (term.length >= 3 ? api.searchNotes(term) : api.notes()) });
  const save = useMutation({
    mutationFn: () => api.saveNote({ body: body.trim(), tags: parseTags(tags) }, editing ?? undefined),
    onSuccess: () => { setBody(""); setTags(""); setEditing(null); qc.invalidateQueries({ queryKey: ["notes"] }); toast({ text: "Note saved" }); },
    onError: () => toast({ text: "Couldn’t save note" }),
  });
  const remove = useMutation({ mutationFn: api.deleteNote, onSuccess: () => qc.invalidateQueries({ queryKey: ["notes"] }) });

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4">
      <PageHeader title="Notes" subtitle="Encrypted. Search matches whole words and finds results instantly." />
      <Card className="flex flex-col gap-3 p-4">
        <TextArea label={editing ? "Edit note" : "Quick capture"} rows={3} maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1"><Field label="Tags (space or comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} /></div>
          {editing && <Button onClick={() => { setEditing(null); setBody(""); setTags(""); }}>Cancel</Button>}
          <Button variant="primary" disabled={!body.trim() || save.isPending} onClick={() => save.mutate()}>{editing ? "Update" : "Save note"}</Button>
        </div>
      </Card>
      <Field label="Search notes" type="search" placeholder="Type a word (3+ letters)" value={search} onChange={(e) => setSearch(e.target.value)} />
      {q.isPending ? <SkeletonRows rows={3} label="Loading notes" /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : q.data.items.length === 0 ? (
        <Card><EmptyState title={term ? "No notes match" : "No notes yet"}>{term ? "Search finds whole words only." : "Capture a thought above."}</EmptyState></Card>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {q.data.items.map((n) => (
            <li key={n.id}>
              <Card className="flex flex-col gap-2 p-4">
                <p className="m-0 whitespace-pre-wrap text-[14px]">{n.body}</p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap gap-1.5">{n.tags.map((t) => <Pill key={t} tone="neutral">#{t}</Pill>)}<span className="text-[12px] text-muted">{formatRelative(n.updated_at)}</span></span>
                  <span className="flex gap-2">
                    <Button size="sm" onClick={() => { setEditing(n.id); setBody(n.body ?? ""); setTags(n.tags.join(" ")); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit</Button>
                    <Button size="sm" variant="quiet" onClick={() => remove.mutate(n.id)}>Delete</Button>
                  </span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
