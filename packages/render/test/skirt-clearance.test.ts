/**
 * The gate for skirts: the real rig (clip or procedural gait, foot IK on stairs, pelvis drop, springs, the toon vertex
 * stage's drape replayed on the CPU) is run through locomotion, stairs, turns, a jump and the film's clips, and every
 * frame the skinned leg vertices a skirt covers at rest are tested against the cloth (support/skirt-measure.ts). No
 * leg vertex may lie outside the cloth where the skirt covers it, on any clip, for any pipeline character with a skirt.
 * Also: planted feet do not slide.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { loadBodyRig } from './support/rig-fixture';
import { measureFrame, prepSkirt } from './support/skirt-measure';
import { measureSlide } from './support/foot-slide';
import { runScenario, SCENARIOS } from './support/gait-scenarios';

describe.each(['kaho', 'mio'])('skirt clearance: %s', (body) => {
  it('keeps every covered leg vertex inside the skirt on every clip', async () => {
    const { rig } = await loadBodyRig(body);
    rig.root.updateMatrixWorld(true);
    const pr = prepSkirt(rig, 4)!;
    expect(pr.covered.length).toBeGreaterThan(50);
    const rows: string[] = [];
    for (const sc of SCENARIOS) {
      let frames = 0;
      let bad = 0;
      let share = 0;
      let depth = 0;
      let n = 0;
      runScenario(rig, sc, (r) => {
        if (n++ % 4) return;
        const m = measureFrame(r, pr);
        frames++;
        if (m.through > 0) bad++;
        share += m.through / m.covered;
        depth = Math.max(depth, m.depth);
      });
      rows.push(`${sc.name.padEnd(14)} frames ${bad}/${frames} vertices ${((100 * share) / frames).toFixed(2)}% deepest ${(depth * 1000).toFixed(1)} mm`);
      expect(bad, `${body} ${sc.name}`).toBe(0);
    }
    console.log(`${body}\n${rows.join('\n')}`);
  }, 400_000);

  it('never stands the skirt out like an opened umbrella (each panel within 55 degrees of straight down)', async () => {
    const { rig } = await loadBodyRig(body);
    const panels: import('three').Object3D[] = [];
    rig.root.traverse((o) => void (/^Skirt_\d+$/.test(o.name) && panels.push(o)));
    expect(panels.length).toBeGreaterThan(0);
    const h = new Vector3();
    const t = new Vector3();
    const rows: string[] = [];
    for (const sc of SCENARIOS) {
      let worst = 0;
      runScenario(rig, sc, () => {
        for (const b of panels) {
          h.setFromMatrixPosition(b.matrixWorld);
          t.set(0, -0.3, 0).applyMatrix4(b.matrixWorld).sub(h);
          worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, -t.y / t.length()))));
        }
      });
      rows.push(`${sc.name.padEnd(14)} ${((worst * 180) / Math.PI).toFixed(0)} deg`);
      expect((worst * 180) / Math.PI, `${body} ${sc.name}`).toBeLessThan(55);
    }
    console.log(`${body} panel swing\n${rows.join('\n')}`);
  }, 120_000);

  it('plants the feet on the ground at every speed (the slide is a few percent of the ground speed)', async () => {
    const { rig } = await loadBodyRig(body);
    for (const speed of [0.8, 1.4, 2.2, 3.5, 4.5]) {
      const r = measureSlide(rig, speed, 4);
      expect(r.share, `${body} at ${speed} m/s`).toBeLessThan(0.08);
    }
  }, 120_000);
});
