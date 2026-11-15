// Opens a job email inside GRU (instead of bouncing to the Gmail app, which can't open a specific message on iPhone).
// The text is fetched live, shown and never stored. Only emails GRU already filed as job mail can be opened.
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.ts";
import { formatDateTime } from "../lib/format.ts";
import { Modal } from "./Dialog.tsx";
import { Button, ErrorState, Pill, SkeletonRows } from "./ui.tsx";

const CLASS_LABEL: Record<string, string> = {
  application_received: "Application received", application_update: "Application update", assessment: "Assessment",
  interview_invite: "Interview invite", interview_update: "Interview update", rejection: "Rejection", offer: "Offer",
  recruiter_outreach: "Recruiter", info_request: "Info request", alert: "Job alert",
};

function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https:\/\/[^\s<>"')\]]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="break-all text-accent-text underline">{p.length > 70 ? `${p.slice(0, 67)}…` : p}</a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function MailViewer({ accountId, gmailId, onClose }: { accountId: number; gmailId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["mail-view", accountId, gmailId], queryFn: () => api.mailView(accountId, gmailId), retry: false, staleTime: 5 * 60_000 });
  const m = q.data;
  return (
    <Modal open onClose={onClose} title="Email" wide>
      {q.isPending ? <SkeletonRows rows={4} label="Opening email" /> : q.isError || !m ? <ErrorState onRetry={() => q.refetch()} message="Couldn’t open that email. Gmail may be unreachable, or it was deleted." /> : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="m-0 text-[16px] leading-snug font-semibold">{m.subject || "(no subject)"}</h3>
            <p className="m-0 text-[12.5px] text-muted">{m.from} · {m.date ? formatDateTime(m.date) : ""}</p>
            {m.class && <div><Pill tone="neutral">{CLASS_LABEL[m.class] ?? m.class}</Pill></div>}
          </div>
          {m.meeting_link && (
            <a href={m.meeting_link.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 w-fit items-center rounded-[10px] bg-accent px-4 text-[13.5px] font-semibold text-accent-ink no-underline">Join {m.meeting_link.kind} ↗</a>
          )}
          {m.text !== null ? (
            <div className="max-h-[48dvh] overflow-y-auto rounded-[10px] border border-line bg-sunken p-3 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-2"><Linkified text={m.text} /></div>
          ) : (
            <p className="m-0 rounded-[10px] bg-amber-soft px-3 py-2 text-[13px] text-amber-text">GRU can only show the headers here. Reconnect this Gmail account in Settings to read job emails inside GRU.</p>
          )}
          <div className="flex justify-end">
            <a href={m.gmail_url} target="_blank" rel="noopener noreferrer"><Button size="sm">Open in Gmail ↗</Button></a>
          </div>
        </div>
      )}
    </Modal>
  );
}
