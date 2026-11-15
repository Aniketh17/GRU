import type { Db } from "./client.ts";

export type KillState = "running" | "wiping" | "wiped";

export interface SystemState {
  kill: KillState;
  paused: boolean;
}

export async function getKv(db: Db, k: string): Promise<string | null> {
  const row = await db.first<{ v: string | null }>("SELECT v FROM kv WHERE k = ?", k);
  return row?.v ?? null;
}

export function setKvStmt(db: Db, k: string, v: string): D1PreparedStatement {
  return db.stmt("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v);
}

export async function setKv(db: Db, k: string, v: string): Promise<void> {
  await db.batch([setKvStmt(db, k, v)]);
}

export async function getSystemState(db: Db): Promise<SystemState> {
  const rows = await db.all<{ k: string; v: string | null }>(
    "SELECT k, v FROM kv WHERE k IN ('kill_state', 'paused')",
  );
  const map = new Map(rows.map((r) => [r.k, r.v]));
  const raw = map.get("kill_state");
  // Unknown or missing values fail closed to the most restrictive state.
  const kill: KillState = raw === "running" || raw === "wiping" || raw === "wiped" ? raw : "wiping";
  return { kill, paused: map.get("paused") === "1" };
}
