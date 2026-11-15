// JSON-in-envelope helpers: every *_enc column is AES-GCM with AAD = table:column:rowid.
import { aadFor, decryptField, encryptField, keyringFromEnv } from "../crypto/envelope.ts";
import type { Env } from "../env.ts";

export const encJson = (env: Env, table: string, col: string, rowid: number | string, value: unknown): Promise<string> =>
  encryptField(keyringFromEnv(env), JSON.stringify(value), aadFor(table, col, rowid));

export async function decJson<T>(env: Env, table: string, col: string, rowid: number | string, enc: string | null): Promise<T | null> {
  if (!enc) return null;
  try {
    return JSON.parse(await decryptField(keyringFromEnv(env), enc, aadFor(table, col, rowid))) as T;
  } catch (e) {
    if (e instanceof Error && e.name === "LockedError") throw e;
    return null;
  }
}

export const encText = (env: Env, table: string, col: string, rowid: number | string, value: string): Promise<string> =>
  encryptField(keyringFromEnv(env), value, aadFor(table, col, rowid));

export async function decText(env: Env, table: string, col: string, rowid: number | string, enc: string | null): Promise<string | null> {
  if (!enc) return null;
  try {
    return await decryptField(keyringFromEnv(env), enc, aadFor(table, col, rowid));
  } catch (e) {
    if (e instanceof Error && e.name === "LockedError") throw e;
    return null;
  }
}
