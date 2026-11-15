import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ApiError, api, type Application, type ApplicationInput, type Source, type Status } from "../lib/api.ts";
import { STATUS_LABEL, STATUS_ORDER, dateInputToEpoch, epochToDateInput } from "../lib/format.ts";
import { Modal } from "./Dialog.tsx";
import { useToast } from "./Toast.tsx";
import { Button, Field, Select, TextArea } from "./ui.tsx";

const SOURCES: { value: Source; label: string }[] = [
  { value: "manual", label: "Direct / company site" },
  { value: "seek", label: "SEEK" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "referral", label: "Referral" },
  { value: "email", label: "Email" },
  { value: "other", label: "Other" },
];

export function ApplicationForm({ open, onClose, existing, onSaved }: { open: boolean; onClose: () => void; existing?: Application; onSaved?: (a: Application) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const today = epochToDateInput(Math.floor(Date.now() / 1000));

  const save = useMutation({
    mutationFn: (input: ApplicationInput) => (existing ? api.updateApplication(existing.id, input) : api.createApplication(input)),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.setQueryData(["application", a.id], a);
      toast({ text: existing ? "Application updated" : `${a.company} added` });
      onSaved?.(a);
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError && e.status === 400 ? "Please check the fields and try again." : "Couldn’t save. Check your connection and try again."),
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const str = (k: string) => String(f.get(k) ?? "").trim();
    const company = str("company");
    if (!company) return setError("Company is required.");
    const input: ApplicationInput = {
      company,
      role: str("role") || null,
      source: str("source") as Source,
      applied_at: dateInputToEpoch(str("applied")),
      next_action: str("next") || null,
      notes: str("notes") || null,
    };
    if (!existing) input.status = str("status") as Status;
    if (!existing) {
      // Create rejects explicit nulls for optional fields; omit empties instead.
      for (const k of Object.keys(input) as (keyof ApplicationInput)[]) if (input[k] === null) delete input[k];
    }
    save.mutate(input);
  };

  return (
    <Modal open={open} onClose={onClose} title={existing ? "Edit application" : "Add an application"} wide>
      <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Company" name="company" required maxLength={120} defaultValue={existing?.company ?? ""} autoComplete="off" autoFocus />
          <Field label="Role" name="role" maxLength={160} defaultValue={existing?.role ?? ""} autoComplete="off" />
          <Select label="Source" name="source" defaultValue={existing?.source ?? "manual"}>
            {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
          <Field label="Applied on" name="applied" type="date" defaultValue={existing ? epochToDateInput(existing.applied_at) : today} max={today} />
          {!existing && (
            <Select label="Status" name="status" defaultValue="applied">
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
          )}
          <Field label="Next action" name="next" maxLength={200} placeholder="e.g. Follow up on 20 Nov" defaultValue={existing?.next_action ?? ""} />
        </div>
        <TextArea label="Private notes · encrypted" name="notes" rows={3} maxLength={5000} defaultValue={existing?.notes ?? ""} />
        {error && <p role="alert" className="m-0 text-[13px] font-medium text-red-text">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={save.isPending}>{save.isPending ? "Saving…" : existing ? "Save changes" : "Add application"}</Button>
        </div>
      </form>
    </Modal>
  );
}
