// Settings cards for Phase 5 (resume profiles) and Phase 7 (export).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api.ts";
import { Modal } from "./Dialog.tsx";
import { useToast } from "./Toast.tsx";
import { Button, Card, Field, Pill, TextArea } from "./ui.tsx";

export function ResumeCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ["resumes"], queryFn: api.resumes });
  const [edit, setEdit] = useState<{ id?: number; label: string; text: string } | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["resumes"] });
    qc.invalidateQueries({ queryKey: ["jobs"] });
  };
  const save = useMutation({
    mutationFn: async (e: { id?: number; label: string; text: string }) => {
      if (e.id) await api.updateResume(e.id, e);
      else await api.saveResume(e);
    },
    onSuccess: () => { refresh(); setEdit(null); toast({ text: "Resume saved and activated. Jobs will re-score." }); },
    onError: () => toast({ text: "Couldn’t save (text must be at least 50 characters)" }),
  });
  const activate = useMutation({ mutationFn: api.activateResume, onSuccess: () => { refresh(); toast({ text: "Resume activated" }); } });
  const remove = useMutation({ mutationFn: api.deleteResume, onSuccess: refresh });
  const open = async (id: number) => {
    const r = await api.getResume(id);
    setEdit({ id, label: r.label, text: r.text ?? "" });
  };
  return (
    <Card className="flex flex-col gap-3 p-5" aria-labelledby="s-resume">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="s-resume" className="m-0 text-[15px] font-semibold">Resume profiles</h2>
          <p className="m-0 text-[12.5px] text-muted">Paste your resume text. Encrypted at rest; used only to score jobs. Skills are listed only if they appear in your text.</p>
        </div>
        <Button size="sm" variant="primary" onClick={() => setEdit({ label: "", text: "" })}>Add</Button>
      </div>
      {list.data?.items.length === 0 && <p className="m-0 text-[13px] text-muted">No resume yet. Jobs will show “Not scored – add a resume”.</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {list.data?.items.map((r) => (
          <li key={r.id} className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-sunken px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{r.label} <span className="text-[12px] text-muted">v{r.version}</span></span>
              {r.active ? <Pill tone="accent">Active</Pill> : <Button size="sm" onClick={() => activate.mutate(r.id)}>Activate</Button>}
            </div>
            <p className="m-0 text-[12px] text-muted">{r.skills.length ? `Skills found: ${r.skills.slice(0, 14).join(", ")}${r.skills.length > 14 ? "…" : ""}` : "No known skills detected yet."}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => open(r.id)}>Edit</Button>
              <Button size="sm" variant="quiet" onClick={() => remove.mutate(r.id)}>Delete</Button>
            </div>
          </li>
        ))}
      </ul>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? "Edit resume" : "Add resume"} wide>
          <Field label="Label" value={edit.label} maxLength={120} placeholder="Resume – AI/Software – Nov 2026" onChange={(e) => setEdit({ ...edit, label: e.target.value })} />
          <TextArea label="Resume text" rows={12} maxLength={40000} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
          <Button variant="primary" disabled={!edit.label.trim() || edit.text.length < 50 || save.isPending} onClick={() => save.mutate(edit)}>Save</Button>
        </Modal>
      )}
    </Card>
  );
}

const TABLES = ["applications", "interviews", "jobs", "notes", "tasks", "resume_profiles", "checkins"] as const;

export function ExportCard() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (table: string) => {
    setBusy(table);
    try {
      const all: unknown[] = [];
      let after = "";
      for (let n = 0; n < 40; n++) {
        const page = await api.exportTable(table, after);
        all.push(...page.items);
        if (!page.next) break;
        after = page.next;
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(all, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `gru-${table}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ text: `Exported ${all.length} ${table}` });
    } catch {
      toast({ text: "Export failed" });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="flex flex-col gap-3 p-5" aria-labelledby="s-export">
      <div>
        <h2 id="s-export" className="m-0 text-[15px] font-semibold">Export your data</h2>
        <p className="m-0 text-[12.5px] text-muted">Downloads decrypted JSON to this device only. Keep the file somewhere private.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {TABLES.map((t) => <Button key={t} size="sm" disabled={busy !== null} onClick={() => run(t)}>{busy === t ? "Exporting…" : t.replace("_", " ")}</Button>)}
      </div>
    </Card>
  );
}
