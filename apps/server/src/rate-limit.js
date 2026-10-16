/**
 * In-memory per-key token-bucket rate limiter.
 *
 * O(1) per request. Memory is bounded: when the table exceeds `maxKeys`
 * buckets that have fully refilled (i.e. idle clients) are evicted, and if
 * that is not enough the oldest entries are dropped (Map iteration order is
 * insertion order and we re-insert on access, so the head is least recent).
 */
/** Token bucket keyed by an arbitrary string (usually client IP). */
export class TokenBucketLimiter {
    buckets = new Map();
    ratePerMs;
    burst;
    maxKeys;
    now;
    constructor(opts) {
        if (!(opts.perMinute > 0) || !(opts.burst >= 1))
            throw new RangeError('perMinute must be > 0 and burst >= 1');
        this.ratePerMs = opts.perMinute / 60_000;
        this.burst = opts.burst;
        this.maxKeys = Math.max(1, opts.maxKeys ?? 10_000);
        this.now = opts.now ?? Date.now;
    }
    /** Number of tracked keys (for tests/metrics). */
    get size() {
        return this.buckets.size;
    }
    /** Consume `cost` tokens for `key` if available. */
    take(key, cost = 1) {
        const t = this.now();
        let b = this.buckets.get(key);
        if (b) {
            this.buckets.delete(key); // re-insert below to keep LRU order
            b.tokens = Math.min(this.burst, b.tokens + Math.max(0, t - b.updated) * this.ratePerMs);
            b.updated = t;
        }
        else {
            if (this.buckets.size >= this.maxKeys)
                this.evict(t);
            b = { tokens: this.burst, updated: t };
        }
        this.buckets.set(key, b);
        if (b.tokens >= cost) {
            b.tokens -= cost;
            return { allowed: true, remaining: Math.floor(b.tokens), retryAfterSec: 0, limit: this.burst };
        }
        const retryAfterSec = Math.max(1, Math.ceil((cost - b.tokens) / this.ratePerMs / 1000));
        return { allowed: false, remaining: 0, retryAfterSec, limit: this.burst };
    }
    /** Forget every bucket. */
    reset() {
        this.buckets.clear();
    }
    evict(t) {
        for (const [k, b] of this.buckets) {
            if (b.tokens + (t - b.updated) * this.ratePerMs >= this.burst)
                this.buckets.delete(k);
        }
        // Still full: drop least-recently-used entries until 10% headroom.
        const target = Math.floor(this.maxKeys * 0.9);
        for (const k of this.buckets.keys()) {
            if (this.buckets.size <= target)
                break;
            this.buckets.delete(k);
        }
    }
}
