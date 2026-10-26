/**
 * Runtime quality probes above the hardware hint. Try one tier at a time only after sustained
 * fast motion at full resolution; retreat quickly if the experiment costs smoothness.
 * A failed probe backs off rather than permanently blacklisting a tier: culling, edits and
 * lighter environments can create new capacity later. Low-memory/software exclusions live
 * at the call site, so measured speed never bypasses those resource limits.
 */
import type { RenderTier } from './finishing';

const TIERS: readonly RenderTier[] = ['low', 'medium', 'high', 'ultra'];
const WINDOW = 48;
export const TIER_PROBE = Object.freeze({ upFps: 57, downFps: 50, upAfter: 20, downAfter: 1, retryAfter: 60, maxRetry: 240 });

export class AdaptiveTier {
  private base: RenderTier | null = null;
  private index = 0;
  private fast = 0;
  private slow = 0;
  private cooldown = 0;
  private retry: number = TIER_PROBE.retryAfter;
  private filled = 0;
  private cursor = 0;
  private readonly ring = new Float32Array(WINDOW);
  private readonly sorted = new Float32Array(WINDOW);

  /** Hardware hints choose the starting point; measured performance can reach high (ultra remains explicit). */
  resolve(base: RenderTier): RenderTier {
    return this.base === base ? TIERS[Math.max(TIERS.indexOf(base), this.index)]! : base;
  }

  reset(): void {
    this.base = null;
    this.index = 0;
    this.cooldown = 0;
    this.retry = TIER_PROBE.retryAfter;
    this.clearWindow();
  }

  private clearWindow(): void {
    this.filled = 0;
    this.cursor = 0;
    this.fast = 0;
    this.slow = 0;
    this.ring.fill(Infinity);
  }

  /** Returns true only if the effective tier changed. Idle, load and hidden-tab intervals provide no evidence. */
  record(dt: number, continuous: boolean, scale: number, base: RenderTier, allowed: boolean): boolean {
    const before = this.resolve(base);
    if (!allowed) {
      if (this.base === null) return false;
      this.reset();
      return before !== base;
    }
    if (this.base !== base) {
      this.reset();
      this.base = base;
      this.index = TIERS.indexOf(base);
    }
    if (!continuous || !(dt > 0) || !Number.isFinite(dt) || dt > 0.25) {
      this.clearWindow();
      return false;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.ring[this.cursor] = dt;
    this.cursor = (this.cursor + 1) % WINDOW;
    this.filled = Math.min(WINDOW, this.filled + 1);
    if (this.filled < WINDOW) return false;
    this.sorted.set(this.ring);
    this.sorted.sort();
    const fps = 1 / this.sorted[Math.floor(WINDOW * 0.9)]!;
    const baseIndex = TIERS.indexOf(base);
    this.slow = fps < TIER_PROBE.downFps || (scale > 0 && scale < 0.99) ? this.slow + dt : 0;
    if (this.index > baseIndex && this.slow >= TIER_PROBE.downAfter) {
      this.index--;
      this.cooldown = this.retry;
      this.retry = Math.min(TIER_PROBE.maxRetry, this.retry * 2);
      this.clearWindow();
      return true;
    }
    const headroom = fps >= TIER_PROBE.upFps && (scale === 0 || scale >= 0.99);
    this.fast = headroom && this.cooldown === 0 ? this.fast + dt : 0;
    if (this.index < 2 && this.fast >= TIER_PROBE.upAfter) {
      this.index++;
      this.clearWindow();
      return true;
    }
    return false;
  }
}
