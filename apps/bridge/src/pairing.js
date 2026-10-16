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
export function newPairingCode() {
    let s = '';
    for (let i = 0; i < 8; i++)
        s += ALPHABET[randomInt(ALPHABET.length)];
    return `${s.slice(0, 4)}-${s.slice(4)}`;
}
/** A fresh bearer token (32 random bytes, base64url, 43 chars). */
export function newToken() {
    return randomBytes(32).toString('base64url');
}
function safeEqual(a, b) {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
}
/** In-memory pairing state. */
export class Pairing {
    onCode;
    now;
    code;
    issuedAt;
    attempts = 0;
    tokens = [];
    /**
     * @param onCode called with every new code (printed to the terminal)
     * @param now clock (tests)
     */
    constructor(onCode = () => undefined, now = Date.now) {
        this.onCode = onCode;
        this.now = now;
        this.code = newPairingCode();
        this.issuedAt = now();
    }
    /** The current code (for the startup banner). */
    get currentCode() {
        this.refreshIfExpired();
        return this.code;
    }
    rotate() {
        this.code = newPairingCode();
        this.issuedAt = this.now();
        this.attempts = 0;
        this.onCode(this.code);
    }
    refreshIfExpired() {
        if (this.now() - this.issuedAt > PAIR_CODE_TTL_MS)
            this.rotate();
    }
    /** Exchange a code for a token. A correct code is consumed; wrong guesses count toward rotation. */
    pair(candidate) {
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
    issue() {
        const token = newToken();
        this.tokens.push(token);
        while (this.tokens.length > MAX_TOKENS)
            this.tokens.shift();
        return token;
    }
    /** Constant-time token check. */
    verify(token) {
        if (!token)
            return false;
        let ok = false;
        for (const t of this.tokens)
            if (safeEqual(t, token))
                ok = true;
        return ok;
    }
}
