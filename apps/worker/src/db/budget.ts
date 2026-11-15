// Spec section 5 rule 1 / D-003: every fetch and every D1 call (a batch counts once)
// goes through this budget. 40 leaves headroom under the Free plan's 50 per invocation.
export class BudgetExhausted extends Error {
  constructor() {
    super("budget_exhausted");
    this.name = "BudgetExhausted";
  }
}

export class SubrequestBudget {
  private used = 0;
  constructor(readonly limit = 40) {}

  take(n = 1): void {
    if (this.used + n > this.limit) throw new BudgetExhausted();
    this.used += n;
  }

  get remaining(): number {
    return this.limit - this.used;
  }

  get usedCount(): number {
    return this.used;
  }

  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    this.take();
    return fetch(input, init);
  }
}
