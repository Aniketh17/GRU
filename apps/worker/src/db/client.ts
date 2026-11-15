// Thin D1 wrapper that charges every call to the SubrequestBudget. No ORM.
import { SubrequestBudget } from "./budget.ts";

export type SqlParam = string | number | null;

export class Db {
  constructor(
    readonly d1: D1Database,
    readonly budget: SubrequestBudget = new SubrequestBudget(),
  ) {}

  /** Build a statement without executing it (for batch()). Costs nothing. */
  stmt(sql: string, ...params: SqlParam[]): D1PreparedStatement {
    const s = this.d1.prepare(sql);
    return params.length ? s.bind(...params) : s;
  }

  async first<T>(sql: string, ...params: SqlParam[]): Promise<T | null> {
    this.budget.take();
    return this.stmt(sql, ...params).first<T>();
  }

  async all<T>(sql: string, ...params: SqlParam[]): Promise<T[]> {
    this.budget.take();
    const r = await this.stmt(sql, ...params).all<T>();
    return r.results;
  }

  async run(sql: string, ...params: SqlParam[]): Promise<D1Result> {
    this.budget.take();
    return this.stmt(sql, ...params).run();
  }

  /** One subrequest, executed as a transaction (D-004). */
  async batch(stmts: D1PreparedStatement[]): Promise<D1Result[]> {
    if (stmts.length === 0) return [];
    this.budget.take();
    return this.d1.batch(stmts);
  }
}
