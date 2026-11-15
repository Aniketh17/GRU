// Review queue API (spec §9, Phase 2 rev 2 §3).
// Holds ambiguous classifications, link conflicts and high-impact changes for Ani's confirmation.
// When an item is resolved, context_enc (encrypted subject/sender) is immediately deleted.

import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { aadFor, decryptField, keyringFromEnv } from "../crypto/envelope.ts";
import { STATUSES, type Status } from "../domain/applications.ts";
import { nowSec } from "../env.ts";
import { safeJson } from "../http/hygiene.ts";
import { log } from "../log/index.ts";

export const reviewRoutes = new Hono<AppEnv>();

const ResolveBody = z.object({
  action: z.enum(["confirm", "dismiss"]),
  appId: z.number().int().positive().optional(),
  status: z.enum(STATUSES).optional(),
});

reviewRoutes.get("/", async (c) => {
  const db = c.get("db");
  const rows = await db.all<{
    id: number;
    kind: string;
    account_id: number | null;
    gmail_id: string | null;
    app_id: number | null;
    proposal_json: string | null;
    context_enc: string | null;
    created_at: number;
    company: string | null;
    app_status: string | null;
  }>(
    `SELECT r.id, r.kind, r.account_id, r.gmail_id, r.app_id, r.proposal_json, r.context_enc, r.created_at,
            a.company, a.status as app_status
     FROM review_queue r
     LEFT JOIN applications a ON r.app_id = a.id
     WHERE r.resolved_at IS NULL
     ORDER BY r.created_at DESC
     LIMIT 50`,
  );

  const ring = keyringFromEnv(c.env);
  const items = await Promise.all(
    rows.map(async (r) => {
      let context: { subject?: string; from?: string } | null = null;
      if (r.context_enc) {
        try {
          const raw = await decryptField(ring, r.context_enc, aadFor("review_queue", "context", r.id));
          context = JSON.parse(raw);
        } catch {
          // If decryption fails, leave context null
        }
      }

      let proposal = null;
      if (r.proposal_json) {
        try {
          proposal = JSON.parse(r.proposal_json);
        } catch {
          // ignore parse error
        }
      }

      return {
        id: r.id,
        kind: r.kind,
        accountId: r.account_id,
        gmailId: r.gmail_id,
        appId: r.app_id,
        company: r.company,
        appStatus: r.app_status,
        proposal,
        context,
        createdAt: r.created_at,
      };
    }),
  );

  return c.json({ items });
});

reviewRoutes.post("/:id/resolve", async (c) => {
  const idStr = c.req.param("id");
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "bad_request" }, 400);

  const body = ResolveBody.safeParse(await safeJson(c.req));
  if (!body.success) return c.json({ error: "bad_request" }, 400);

  const db = c.get("db");
  const item = await db.first<{
    id: number;
    kind: string;
    app_id: number | null;
    account_id: number | null;
    gmail_id: string | null;
    proposal_json: string | null;
    resolved_at: number | null;
  }>("SELECT id, kind, app_id, account_id, gmail_id, proposal_json, resolved_at FROM review_queue WHERE id = ?", id);

  if (!item) return c.json({ error: "not_found" }, 404);
  if (item.resolved_at !== null) return c.json({ error: "already_resolved" }, 409);

  const now = nowSec();
  const action = body.data.action;
  const targetAppId = body.data.appId ?? item.app_id;

  if (action === "confirm" && targetAppId && body.data.status) {
    const app = await db.first<{ id: number; status: string }>(
      "SELECT id, status FROM applications WHERE id = ?",
      targetAppId,
    );
    if (!app) return c.json({ error: "application_not_found" }, 404);

    const prevStatus = app.status;
    const newStatus = body.data.status as Status;

    await db.batch([
      db.stmt(
        "UPDATE applications SET status = ?, last_event_at = ?, updated_at = ? WHERE id = ?",
        newStatus,
        now,
        now,
        targetAppId,
      ),
      db.stmt(
        "INSERT INTO events (app_id, type, at, account_id, gmail_id, auto_applied, prev_status, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
        targetAppId,
        `status:${newStatus}`,
        now,
        item.account_id,
        item.gmail_id,
        prevStatus,
        now,
      ),
      db.stmt(
        "UPDATE review_queue SET resolved_at = ?, resolution = ?, context_enc = NULL WHERE id = ?",
        now,
        "applied",
        id,
      ),
    ]);
  } else {
    // Dismissal or confirm without status change
    await db.run(
      "UPDATE review_queue SET resolved_at = ?, resolution = ?, context_enc = NULL WHERE id = ?",
      now,
      action === "confirm" ? "confirmed" : "dismissed",
      id,
    );
  }

  log("review_resolved", { id, action });
  return c.json({ ok: true });
});
