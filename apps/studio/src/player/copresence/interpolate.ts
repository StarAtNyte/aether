/**
 * Smooth motion of a remote visitor from its `state` samples (about 10 a second, irregular, sometimes late).
 *
 * The buffer maps the sender's clock onto ours with the smallest delay seen (`arrival - ts`: the fastest sample is the
 * closest to the true offset), then draws the visitor {@link COPRESENCE_DELAY_MS} behind the newest sample, between
 * the two samples around that moment: position linearly, heading along the shorter arc. Past the newest sample it
 * holds it (no guessing ahead); a jump of more than {@link SNAP_M} (a viewpoint change, a respawn) is not slid
 * through. A sender whose clock jumps (wrapped, or a new page) starts a fresh buffer.
 */
import { COPRESENCE_DELAY_MS, dequantiseState, type PresencePose, type PresenceState } from '@aether/core/copresence';

/** Samples kept per visitor. */
const MAX_SAMPLES = 24;
/** A move longer than this between two samples is a jump, drawn without sliding. */
export const SNAP_M = 12;
/** A sender clock that moves back, or ahead by more than this, starts over. */
const CLOCK_JUMP_MS = 30_000;

interface Sample {
  ts: number;
  pose: PresencePose;
}

/** Shortest signed difference `b - a` of two angles in degrees (-180..180). */
export function angleDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

export class PoseBuffer {
  private samples: Sample[] = [];
  /** Our clock minus the sender's, at the smallest delay seen. */
  private offset = Number.POSITIVE_INFINITY;

  constructor(private readonly delayMs: number = COPRESENCE_DELAY_MS) {}

  /** Number of samples held. */
  get size(): number {
    return this.samples.length;
  }

  /** Add a sample that arrived at `arrivalMs` (our clock). Out-of-order samples are ignored. */
  push(state: PresenceState, arrivalMs: number): void {
    const last = this.samples[this.samples.length - 1];
    if (last) {
      const d = state.ts - last.ts;
      // The sender's clock moved far back (wrapped, reloaded) or skipped far ahead: start over.
      if (d < -CLOCK_JUMP_MS || d > CLOCK_JUMP_MS) this.reset();
      else if (d <= 0) return;
    }
    this.offset = Math.min(this.offset, arrivalMs - state.ts);
    this.samples.push({ ts: state.ts, pose: dequantiseState(state) });
    if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, this.samples.length - MAX_SAMPLES);
  }

  reset(): void {
    this.samples = [];
    this.offset = Number.POSITIVE_INFINITY;
  }

  /** The pose to draw at `nowMs` (our clock), or null before the first sample. */
  sample(nowMs: number): PresencePose | null {
    const s = this.samples;
    const first = s[0];
    if (!first) return null;
    const t = nowMs - this.offset - this.delayMs;
    if (t <= first.ts) return first.pose;
    const last = s[s.length - 1] as Sample;
    if (t >= last.ts) return last.pose;
    // The newest pair around t (samples are few: a linear scan from the end).
    let i = s.length - 1;
    while (i > 0 && (s[i - 1] as Sample).ts > t) i--;
    const a = s[i - 1] as Sample;
    const b = s[i] as Sample;
    // Samples older than the pair are no longer needed.
    if (i > 2) s.splice(0, i - 2);
    const pa = a.pose.position;
    const pb = b.pose.position;
    if (Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]) > SNAP_M) return a.pose;
    const k = (t - a.ts) / (b.ts - a.ts);
    const yaw = a.pose.yawDeg + angleDelta(a.pose.yawDeg, b.pose.yawDeg) * k;
    return {
      position: [pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k, pa[2] + (pb[2] - pa[2]) * k],
      yawDeg: ((yaw % 360) + 360) % 360,
      motion: k < 0.5 ? a.pose.motion : b.pose.motion,
    };
  }
}
