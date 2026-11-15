// Application domain constants and validation (spec sections 6, 9, 12).
import { z } from "zod";

export const STATUSES = ["applied", "assessment", "interview", "offer", "accepted", "declined", "rejected", "withdrawn"] as const;
export type Status = (typeof STATUSES)[number];
export const ACTIVE_STATUSES: readonly Status[] = ["applied", "assessment", "interview", "offer"];
export const CLOSED_STATUSES: readonly Status[] = ["accepted", "declined", "rejected", "withdrawn"];
export const SOURCES = ["manual", "email", "seek", "linkedin", "referral", "other"] as const;

export const STALE_AFTER_DAYS = 14;
export const UNDO_WINDOW_SECONDS = 24 * 3600;
export const MAX_PAGE = 50;

const epoch = z.number().int().min(946684800).max(4102444800); // 2000-01-01 .. 2100-01-01
const text = (max: number) => z.string().trim().max(max);

export const CreateApplication = z.object({
  company: text(120).min(1),
  role: text(160).optional(),
  source: z.enum(SOURCES).default("manual"),
  status: z.enum(STATUSES).default("applied"),
  applied_at: epoch.optional(),
  next_action: text(200).optional(),
  next_action_due: epoch.nullable().optional(),
  notes: z.string().max(5000).optional(),
});
export type CreateApplicationInput = z.infer<typeof CreateApplication>;

export const UpdateApplication = z
  .object({
    company: text(120).min(1),
    role: text(160).nullable(),
    source: z.enum(SOURCES),
    applied_at: epoch.nullable(),
    next_action: text(200).nullable(),
    next_action_due: epoch.nullable(),
    notes: z.string().max(5000).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "empty_update" });

export const StatusChange = z.object({ status: z.enum(STATUSES) });

export const ListQuery = z.object({
  status: z.enum([...STATUSES, "active", "closed", "all"]).default("active"),
  q: z.string().trim().max(80).optional(),
  stale: z.enum(["1"]).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(MAX_PAGE),
  cursor: z.string().regex(/^\d{1,12}_\d{1,12}$/).optional(),
});
