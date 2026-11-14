/**
 * The converted VRM bodies (kaho-vrm, mio-vrm: scripts/characters/vrm-character.ts) and the Blender ones they stand in
 * for stay whole in every motion the Cloudwatch film asks of them: walks, runs, stairs up and down (walked and run),
 * starts, stops, turns, a jump, and the film's gestures (wave, look_up, hand_to_chest, two_fingers, run_stop, nod).
 *
 * The bug this guards: the converter copied the body clips' quantized rotations (normalized int16) as raw integers, so
 * every gesture clip turned the whole body upside down with the legs folded into the hips. Asserted per frame: the hips
 * stay upright (the thighs below the neck), the legs are never longer than the rest pose's (no stretched or torn leg)
 * nor folded flat, and the skinned mesh keeps a person's size; and every body clip's rotation keys are unit quaternions.
 */
import { Quaternion, QuaternionKeyframeTrack, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { loadBodyRig } from './support/rig-fixture';
import { runScenario, SCENARIOS, type Scenario } from './support/gait-scenarios';
import { classify, posedWorld } from './support/raster';
import type { CharacterRig } from '../src/characters/rig';

const BODIES = ['kaho-vrm', 'mio-vrm', 'kaho', 'mio'];
const GESTURES = ['wave', 'look_up', 'hand_to_chest', 'two_fingers', 'run_stop', 'nod'];

function gesture(clip: string, seconds = 3): Scenario {
  return { name: `gesture-${clip}`, seconds, step: (rig, t) => { rig.input.speed = 0; if (t === 0) rig.playClip(clip); } };
}

const pos = (rig: CharacterRig, n: string, out = new Vector3()): Vector3 => rig.root.getObjectByName(n)!.getWorldPosition(out);

describe.each(BODIES)('%s stays whole in the film\'s motions', (id) => {
  it('every body clip rotation key is a unit quaternion', async () => {
    const { clips } = await loadBodyRig(id);
    const q = new Quaternion();
    for (const c of clips) for (const tr of c.tracks) {
      if (!(tr instanceof QuaternionKeyframeTrack)) continue;
      for (let i = 0; i < tr.values.length; i += 4) {
        q.fromArray(tr.values, i);
        expect(Math.abs(q.length() - 1), `${c.name} ${tr.name} key ${i / 4}`).toBeLessThan(0.01);
      }
    }
  });

  it('hips upright, legs within the rest pose\'s length, body its own size', async () => {
    const { rig } = await loadBodyRig(id);
    const bp = classify(rig)!;
    // rest measures (standing idle)
    runScenario(rig, { name: 'settle', seconds: 0.5, step: (r) => void (r.input.speed = 0) }, () => undefined);
    rig.root.updateMatrixWorld(true);
    const legRest = Math.max(
      pos(rig, 'Bip01_L_Thigh').distanceTo(pos(rig, 'Bip01_L_Calf')) + pos(rig, 'Bip01_L_Calf').distanceTo(pos(rig, 'Bip01_L_Foot')),
      pos(rig, 'Bip01_R_Thigh').distanceTo(pos(rig, 'Bip01_R_Calf')) + pos(rig, 'Bip01_R_Calf').distanceTo(pos(rig, 'Bip01_R_Foot')),
    );
    const extent = (): number => {
      const P = posedWorld(rig, bp, false);
      let lo = Infinity, hi = -Infinity;
      for (let i = 1; i < P.length; i += 3) { lo = Math.min(lo, P[i]!); hi = Math.max(hi, P[i]!); }
      return hi - lo;
    };
    const restHeight = extent();
    expect(restHeight).toBeGreaterThan(1.3);

    const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3();
    const bad: string[] = [];
    for (const sc of [...SCENARIOS, ...GESTURES.map((g) => gesture(g))]) {
      let k = 0;
      runScenario(rig, sc, (r, t) => {
        const lt = pos(r, 'Bip01_L_Thigh', a), rt = pos(r, 'Bip01_R_Thigh', b);
        const mid = c.copy(lt).add(rt).multiplyScalar(0.5);
        const up = pos(r, 'Bip01_Neck', n).sub(mid).normalize().y;
        if (up < 0.7) bad.push(`${sc.name} t=${t.toFixed(2)}: hips not upright (up ${up.toFixed(2)})`);
        for (const s of ['L', 'R']) {
          const th = pos(r, `Bip01_${s}_Thigh`, a), ft = pos(r, `Bip01_${s}_Foot`, b);
          const reach = th.distanceTo(ft);
          if (reach > legRest * 1.01) bad.push(`${sc.name} t=${t.toFixed(2)}: ${s} leg stretched (${reach.toFixed(3)} > ${legRest.toFixed(3)})`);
          // (a knee lifted to run up a stair brings the foot to about a fifth of the leg below the hip; a folded or flipped leg has it level or above)
          if (th.y - ft.y < 0.12 * legRest) bad.push(`${sc.name} t=${t.toFixed(2)}: ${s} foot not below the hip (${(th.y - ft.y).toFixed(3)})`);
        }
        if (k++ % 15 === 0) {
          const h = extent();
          if (h > restHeight * 1.15 || h < restHeight * 0.55) bad.push(`${sc.name} t=${t.toFixed(2)}: skinned height ${h.toFixed(2)} (rest ${restHeight.toFixed(2)})`);
        }
      });
    }
    expect(bad.slice(0, 12)).toEqual([]);
  }, 180_000);
});
