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
import { Quaternion, QuaternionKeyframeTrack, Vector3, type SkinnedMesh } from 'three';
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

/** The skinned (non-outline) meshes of a rig. */
function skinned(rig: CharacterRig): SkinnedMesh[] {
  const out: SkinnedMesh[] = [];
  rig.root.traverse((o) => { const m = o as SkinnedMesh; if (m.isSkinnedMesh && !/outline/i.test(o.name)) out.push(m); });
  return out;
}

/** The mouth: the posed centre of the vertices the open-mouth morph moves (the lips). */
function mouthPoint(rig: CharacterRig): Vector3 {
  const v = new Vector3(), d = new Vector3(), sum = new Vector3();
  let n = 0;
  for (const m of skinned(rig)) {
    const slot = m.morphTargetDictionary?.['mouth_open'];
    const md = slot === undefined ? undefined : m.geometry.morphAttributes['position']?.[slot];
    if (!md) continue;
    let max = 0;
    for (let i = 0; i < md.count; i++) max = Math.max(max, d.fromBufferAttribute(md, i).length());
    if (max === 0) continue;
    m.updateMatrixWorld(true);
    m.skeleton.update();
    for (let i = 0; i < md.count; i++) {
      if (d.fromBufferAttribute(md, i).length() < 0.3 * max) continue;
      m.getVertexPosition(i, v);
      sum.add(v.applyMatrix4(m.matrixWorld));
      n++;
    }
  }
  return sum.multiplyScalar(1 / n);
}

/** A finger's tip: the posed vertex bound to its last phalanx farthest from the phalanx's joint. */
function fingertip(rig: CharacterRig, bone: string): Vector3 {
  const joint = pos(rig, bone);
  const v = new Vector3(), best = new Vector3();
  let far = -1;
  for (const m of skinned(rig)) {
    const bi = m.skeleton.bones.findIndex((b) => b.name === bone);
    if (bi < 0) continue;
    const si = m.geometry.attributes['skinIndex']!, sw = m.geometry.attributes['skinWeight']!;
    m.skeleton.update();
    for (let i = 0; i < si.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bi) w += sw.getComponent(i, k);
      if (w < 0.5) continue;
      m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
      const dd = v.distanceTo(joint);
      if (dd > far) { far = dd; best.copy(v); }
    }
  }
  return best;
}

describe.each(['kaho-vrm', 'mio-vrm'])('%s: the gesture hands meet the body', (id) => {
  it('two_fingers: the index fingertip touches the mouth through the hold', async () => {
    const { rig } = await loadBodyRig(id);
    const far: string[] = [];
    let worst = 0;
    runScenario(rig, gesture('two_fingers', 2.2), (r, t) => {
      // (the hold: the clip's pose keys at 0.6, 1.4 and 2.0 s)
      if (t < 0.7 || t > 1.9) return;
      const d = fingertip(r, 'Bip01_R_Finger12').distanceTo(mouthPoint(r));
      worst = Math.max(worst, d);
      if (d > 0.03) far.push(`t=${t.toFixed(2)}: index tip ${(d * 100).toFixed(1)} cm from the mouth`);
    });
    console.log(`${id} two_fingers: worst index tip to mouth ${(worst * 100).toFixed(1)} cm`);
    expect(far.slice(0, 6)).toEqual([]);
  }, 60_000);

  it('hand_to_chest: the palm lies on the chest, not on the shoulder', async () => {
    const { rig } = await loadBodyRig(id);
    const bad: string[] = [];
    let worst = 0;
    runScenario(rig, gesture('hand_to_chest', 2.5), (r, t) => {
      // (the hold: the clip's pose keys at 0.7 and 1.8 s)
      if (t < 0.75 || t > 1.75) return;
      const palm = pos(r, 'Bip01_R_Hand').add(pos(r, 'Bip01_R_Finger2')).multiplyScalar(0.5);
      // the nearest torso vertex (not the right arm's own skin)
      const v = new Vector3();
      let near = Infinity;
      for (const m of skinned(r)) {
        const si = m.geometry.attributes['skinIndex']!, sw = m.geometry.attributes['skinWeight']!;
        const arm = new Set(m.skeleton.bones.flatMap((b, i) => (/_R_(UpperArm|Forearm|Hand|Finger)/.test(b.name) ? [i] : [])));
        m.skeleton.update();
        for (let i = 0; i < si.count; i++) {
          let w = 0;
          for (let k = 0; k < 4; k++) if (arm.has(si.getComponent(i, k))) w += sw.getComponent(i, k);
          if (w > 0.2) continue;
          near = Math.min(near, m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld).distanceTo(palm));
        }
      }
      const chest = pos(r, 'Bip01_Spine2');
      worst = Math.max(worst, near);
      if (near > 0.04) bad.push(`t=${t.toFixed(2)}: palm ${(near * 100).toFixed(1)} cm off the body`);
      // (she stands at the origin facing +z: x is across her)
      if (Math.abs(palm.x - chest.x) > 0.12) bad.push(`t=${t.toFixed(2)}: palm ${(Math.abs(palm.x - chest.x) * 100).toFixed(1)} cm to the side of the breastbone`);
    });
    console.log(`${id} hand_to_chest: palm within ${(worst * 100).toFixed(1)} cm of the body`);
    expect(bad.slice(0, 6)).toEqual([]);
  }, 60_000);
});

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
