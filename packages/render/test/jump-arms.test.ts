import { describe, expect, it } from 'vitest';
import { ArmSpring, DEG, jumpArmTarget, jumpClipPhase } from '../src/characters/motion';

/** A jump of speed 6 m/s, gravity 9.81 rising and 1.7x falling, sampled at 60 Hz until the ground. */
function arc(): { vy: number; t: number }[] {
  const out: { vy: number; t: number }[] = [];
  let vy = 6;
  let y = 0;
  for (let i = 0; i < 200; i++) {
    out.push({ vy, t: i / 60 });
    vy -= 9.81 * (vy < 0 ? 1.7 : 1) / 60;
    y += vy / 60;
    if (y <= 0) break;
  }
  return out;
}

describe('jump arms', () => {
  it('swings up on take-off, opens out when falling, and rests on the ground', () => {
    const a = arc();
    const take = jumpArmTarget(true, 6, 6, 0.3);
    const late = a[a.length - 1] as { vy: number; t: number };
    const land = jumpArmTarget(true, late.vy, 6, late.t);
    expect(take.swing).toBeGreaterThan(60 * DEG);
    expect(land.swing).toBeLessThan(take.swing - 40 * DEG);
    expect(jumpArmTarget(false, 0, 0, 0)).toEqual({ swing: 0, tuck: 0 });
  });

  it('target is continuous across the whole arc', () => {
    let prev = jumpArmTarget(true, 6, 6, 0);
    for (const s of arc().slice(1)) {
      const cur = jumpArmTarget(true, s.vy, 6, s.t);
      expect(Math.abs(cur.swing - prev.swing)).toBeLessThan(8 * DEG);
      prev = cur;
    }
  });

  it('spring follows without overshoot or a per-frame jump, even from a hard target switch', () => {
    const sp = new ArmSpring();
    const hi = { swing: 72 * DEG, tuck: 30 * DEG };
    let last = 0;
    let max = 0;
    for (let i = 0; i < 90; i++) {
      const o = sp.step(hi, 1 / 60);
      expect(o.swing - last).toBeGreaterThanOrEqual(-1e-9);
      expect(o.swing - last).toBeLessThan(6 * DEG);
      max = Math.max(max, o.swing);
      last = o.swing;
    }
    expect(max).toBeLessThanOrEqual(hi.swing + 1e-6);
    expect(last).toBeGreaterThan(hi.swing * 0.99);
    for (let i = 0; i < 120; i++) sp.step({ swing: 0, tuck: 0 }, 1 / 60);
    expect(Math.abs(sp.swing)).toBeLessThan(0.01);
  });

  it('clip phase runs 0 to 1 over the arc and never backwards', () => {
    let p = 0;
    const phases = arc().map((s) => (p = jumpClipPhase(s.vy, 6, p)));
    expect(phases[0]).toBe(0);
    expect(phases.some((x) => Math.abs(x - 0.5) < 0.06)).toBe(true);
    expect(phases[phases.length - 1]).toBeGreaterThan(0.85);
    for (let i = 1; i < phases.length; i++) expect(phases[i]).toBeGreaterThanOrEqual(phases[i - 1] as number);
    expect(jumpClipPhase(5, 6, 0.8)).toBe(0.8);
  });
});
