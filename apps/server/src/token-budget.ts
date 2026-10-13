/**
 * Daily (UTC) LLM token budget shared by every client of this server.
 *
 * Protects a public deployment from runaway cost: once the budget for
 * the current UTC day is spent, `/api/llm` answers 429 until midnight UTC.
 */

/** Snapshot of the budget state. */
export interface BudgetStatus {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  used: number;
  /** 0 = unlimited. */
  limit: number;
  exhausted: boolean;
  /** Seconds until the budget resets (next UTC midnight). */
  resetInSec: number;
}

const DAY_MS = 86_400_000;

/** In-memory counter of tokens consumed per UTC day. */
export class DailyTokenBudget {
  private day = '';
  private used = 0;

  /**
   * @param limit tokens per UTC day; 0 disables the guard
   * @param now clock in ms since epoch (injectable for tests)
   */
  constructor(
    private readonly limit: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Current state (rolls over to a new day when needed). */
  status(): BudgetStatus {
    const t = this.now();
    this.roll(t);
    const resetInSec = Math.max(1, Math.ceil((DAY_MS - (t % DAY_MS)) / 1000));
    return { day: this.day, used: this.used, limit: this.limit, exhausted: this.limit > 0 && this.used >= this.limit, resetInSec };
  }

  /** Record consumed tokens (negative / non-finite input is ignored). */
  record(tokens: number): void {
    if (!Number.isFinite(tokens) || tokens <= 0) return;
    this.roll(this.now());
    this.used += Math.floor(tokens);
  }

  private roll(t: number): void {
    const day = new Date(t - (t % DAY_MS)).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.used = 0;
    }
  }
}
