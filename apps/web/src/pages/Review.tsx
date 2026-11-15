import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MailViewer } from "../components/MailViewer.tsx";
import { useToast } from "../components/Toast.tsx";
import { Button, Card, EmptyState, PageHeader, Pill } from "../components/ui.tsx";
import { api, type ReviewItem, type Status } from "../lib/api.ts";
import { formatDateTime } from "../lib/format.ts";

export function ReviewPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["review"], queryFn: api.listReview });

  const resolve = useMutation({
    mutationFn: (vars: { id: number; action: "confirm" | "dismiss"; appId?: number; status?: Status }) => {
      const payload: { action: "confirm" | "dismiss"; appId?: number; status?: Status } = { action: vars.action };
      if (vars.appId !== undefined) payload.appId = vars.appId;
      if (vars.status !== undefined) payload.status = vars.status;
      return api.resolveReview(vars.id, payload);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["review"] });
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      toast({ text: vars.action === "confirm" ? "Change confirmed" : "Item dismissed" });
    },
    onError: () => {
      toast({ text: "Failed to resolve item" });
    },
  });

  const items = data?.items ?? [];

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-5">
      <PageHeader
        title="Review"
        subtitle="Confirm or clarify incoming updates before they change your tracked applications."
      />

      {isLoading ? (
        <Card className="p-8 text-center text-muted">Loading review queue…</Card>
      ) : items.length === 0 ? (
        <EmptyState title="All clear">
          No email classifications or link matches need manual review.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((item) => (
            <ReviewCard
              key={item.id}
              item={item}
              onConfirm={(status) => {
                const vars: { id: number; action: "confirm"; appId?: number; status?: Status } = {
                  id: item.id,
                  action: "confirm",
                };
                if (item.appId !== null && item.appId !== undefined) vars.appId = item.appId;
                if (status !== undefined) vars.status = status;
                resolve.mutate(vars);
              }}
              onDismiss={() => resolve.mutate({ id: item.id, action: "dismiss" })}
              disabled={resolve.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({
  item,
  onConfirm,
  onDismiss,
  disabled,
}: {
  item: ReviewItem;
  onConfirm: (status?: Status) => void;
  onDismiss: () => void;
  disabled: boolean;
}) {
  const [viewing, setViewing] = useState(false);
  const company = item.company || item.proposal?.company || "Unknown company";
  const suggested = item.proposal?.suggested;
  const reason = item.proposal?.reason;

  return (
    <Card className="flex flex-col gap-3.5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Pill tone={suggested ? "accent" : "neutral"}>
            {suggested ? `Suggests: ${suggested}` : item.kind}
          </Pill>
          <span className="text-[14px] font-semibold text-ink">{company}</span>
        </div>
        <span className="text-[12px] text-muted">Received {formatDateTime(item.receivedAt ?? item.createdAt)}</span>
      </div>

      {item.context && (
        <div className="rounded-[9px] border border-line bg-sunken p-3 text-[13px]">
          {item.context.subject && (
            <p className="m-0 font-medium text-ink">
              <span className="text-muted">Subject: </span>
              {item.context.subject}
            </p>
          )}
          {item.context.from && (
            <p className="m-0 text-[12px] text-muted">
              From: {item.context.from}
            </p>
          )}
        </div>
      )}

      {reason && (
        <p className="m-0 text-[12.5px] text-muted">
          Reason: {reason}
        </p>
      )}

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-line">
        {item.gmailId && item.accountId ? (
          <Button size="sm" onClick={() => setViewing(true)}>Open email</Button>
        ) : <span />}

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onDismiss} disabled={disabled}>
            Dismiss
          </Button>
          {suggested && (
            <Button variant="primary" onClick={() => onConfirm(suggested)} disabled={disabled}>
              Confirm {suggested}
            </Button>
          )}
        </div>
      </div>
      {viewing && item.gmailId && item.accountId && <MailViewer accountId={item.accountId} gmailId={item.gmailId} onClose={() => setViewing(false)} />}
    </Card>
  );
}
