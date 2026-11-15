// Recruiter / hiring contacts, built from sender headers. Names and addresses are encrypted at rest.
import { b64urlEncode } from "../crypto/b64.ts";
import { hmacSha256 } from "../crypto/hmac.ts";
import type { Db } from "../db/client.ts";
import type { Env } from "../env.ts";
import type { Person } from "../classify/people.ts";
import { encJson } from "./enc.ts";

export async function upsertContact(env: Env, db: Db, p: Person, company: string | null, appId: number | null, at: number): Promise<void> {
  if (!env.INDEX_KEY) return;
  const hash = b64urlEncode(await hmacSha256(env.INDEX_KEY, `contact:${p.address}`));
  const existing = await db.first<{ id: number }>("SELECT id FROM contacts WHERE addr_hmac = ?", hash);
  if (existing) {
    await db.run(
      "UPDATE contacts SET last_contact_at = MAX(last_contact_at, ?1), msg_count = msg_count + 1, company = COALESCE(company, ?2), app_id = COALESCE(app_id, ?3) WHERE id = ?4",
      at, company, appId, existing.id,
    );
    return;
  }
  const ins = await db.first<{ id: number }>(
    "INSERT INTO contacts (addr_hmac, company, app_id, first_seen_at, last_contact_at) VALUES (?, ?, ?, ?, ?) RETURNING id",
    hash, company, appId, at, at,
  );
  if (!ins) return;
  await db.run(
    "UPDATE contacts SET name_enc = ?, email_enc = ? WHERE id = ?",
    await encJson(env, "contacts", "name_enc", ins.id, p.name),
    await encJson(env, "contacts", "email_enc", ins.id, p.address),
    ins.id,
  );
}
