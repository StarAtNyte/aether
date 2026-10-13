/**
 * Pairing: the bridge prints a one-time code; the studio exchanges it for a
 * random bearer token (kept in memory only, never logged). Codes are single
 * use, expire, and are rotated after a few wrong guesses, so brute force is
 * hopeless (8 chars from a 32-symbol alphabet, ≤ 5 guesses per code).
 */
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Wrong guesses allowed per code before it is replaced. */
export const MAX_PAIR_ATTEMPTS = 5;
/** Codes expire after this long (ms). */
export const PAIR_CODE_TTL_MS = 10 * 60_000;
/** Tokens kept at once (oldest evicted). */
export const MAX_TOKENS = 16;

/** A fresh pairing code "ABCD-EFGH". */
export function newPairingCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** A fresh bearer token (32 random bytes, base64url, 43 chars). */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Outcome of a pairing attempt. */
export type PairOutcome = { ok: true; token: string } | { ok: false; locked: boolean };

/** In-memory pairing state. */
export class Pairing {
  private code: string;
  private issuedAt: number;
  private attempts = 0;
  private readonly tokens: string[] = [];

  /**
   * @param onCode called with every new code (printed to the terminal)
   * @param now clock (tests)
   */
  constructor(
    private readonly onCode: (code: string) => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {
    this.code = newPairingCode();
    this.issuedAt = now();
  }

  /** The current code (for the startup banner). */
  get currentCode(): string {
    this.refreshIfExpired();
    return this.code;
  }

  private rotate(): void {
    this.code = newPairingCode();
    this.issuedAt = this.now();
    this.attempts = 0;
    this.onCode(this.code);
  }

  private refreshIfExpired(): void {
    if (this.now() - this.issuedAt > PAIR_CODE_TTL_MS) this.rotate();
  }

  /** Exchange a code for a token. A correct code is consumed; wrong guesses count toward rotation. */
  pair(candidate: string): PairOutcome {
    this.refreshIfExpired();
    const clean = candidate.trim().toUpperCase().replace(/^([A-Z0-9]{4})([A-Z0-9]{4})$/, '$1-$2');
    if (safeEqual(clean, this.code)) {
      const token = this.issue();
      this.rotate();
      return { ok: true, token };
    }
    this.attempts++;
    if (this.attempts >= MAX_PAIR_ATTEMPTS) {
      this.rotate();
      return { ok: false, locked: true };
    }
    return { ok: false, locked: false };
  }

  /** Issue a token directly (used for the deep link printed at startup). */
  issue(): string {
    const token = newToken();
    this.tokens.push(token);
    while (this.tokens.length > MAX_TOKENS) this.tokens.shift();
    return token;
  }

  /** Constant-time token check. */
  verify(token: string | undefined): boolean {
    if (!token) return false;
    let ok = false;
    for (const t of this.tokens) if (safeEqual(t, token)) ok = true;
    return ok;
  }
}
