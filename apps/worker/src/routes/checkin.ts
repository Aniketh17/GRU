// Daily Check-in API (spec section 11).
// Provides the 4-prompt check-in flow and securely stores responses encrypted at rest.
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { aadFor, decryptField, encryptField, keyringFromEnv } from "../crypto/envelope.ts";
import { nowSec } from "../env.ts";
import { aucklandDate } from "../lib/timezone.ts";
import { computeBrief } from "./brief.ts";

export const checkinRoutes = new Hono<AppEnv>();

const checkinSubmitSchema = z.object({
  status: z.enum(["completed", "skipped"]),
  today_focus: z.string().max(280).optional(),
  applied_off_email: z.boolean().optional(),
});

checkinRoutes.get("/today", async (c) => {
  const db = c.get("db");
  const now = nowSec();
  const today = aucklandDate(now);
  const ring = keyringFromEnv(c.env);

  // Check if today's checkin exists
  const existing = await db.first<{
    date: string;
    status: string;
    answers_enc: string | null;
    completed_at: number | null;
  }>("SELECT date, status, answers_enc, completed_at FROM checkins WHERE date = ?", today);

  let answers: { today_focus?: string; applied_off_email?: boolean } | null = null;
  if (existing?.answers_enc) {
    try {
      const plaintext = await decryptField(ring, existing.answers_enc, aadFor("checkins", "answers_enc", today));
      answers = JSON.parse(plaintext);
    } catch {
      answers = null;
    }
  }

  // Fetch contextual prompts for checkin
  const reviewItems = await db.all<{
    id: number;
    account_id: number;
    app_id: number | null;
    proposal_json: string;
  }>("SELECT id, account_id, app_id, proposal_json FROM review_queue WHERE resolved_at IS NULL LIMIT 5");

  const reviewPrompts = reviewItems.map((r) => {
    let proposal: Record<string, unknown> = {};
    try {
      proposal = JSON.parse(r.proposal_json);
    } catch {
      proposal = {};
    }
    return {
      id: r.id,
      app_id: r.app_id,
      proposal,
    };
  });

  const brief = await computeBrief(db, now);
  return c.json({
    date: today,
    interviews_upcoming: brief.interviews_upcoming,
    missing_debriefs: brief.missing_debriefs,
    status: existing?.status ?? "pending",
    completed_at: existing?.completed_at ?? null,
    answers,
    review_prompts: reviewPrompts,
  });
});

checkinRoutes.post("/today", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = checkinSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_input", details: parsed.error.issues }, 400);
  }

  const db = c.get("db");
  const now = nowSec();
  const today = aucklandDate(now);
  const ring = keyringFromEnv(c.env);

  let answersEnc: string | null = null;
  if (parsed.data.today_focus?.trim() || parsed.data.applied_off_email !== undefined) {
    const payload = JSON.stringify({ today_focus: parsed.data.today_focus?.trim(), applied_off_email: parsed.data.applied_off_email });
    answersEnc = await encryptField(ring, payload, aadFor("checkins", "answers_enc", today));
  }

  await db.run(
    `INSERT INTO checkins (date, status, answers_enc, completed_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(date) DO UPDATE SET
       status = excluded.status,
       answers_enc = excluded.answers_enc,
       completed_at = excluded.completed_at`,
    today,
    parsed.data.status,
    answersEnc,
    now,
  );

  return c.json({
    date: today,
    status: parsed.data.status,
    completed_at: now,
  });
});
