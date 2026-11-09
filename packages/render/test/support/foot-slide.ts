/**
 * Foot sliding of a walking rig: the ground contact point of each foot (the lower of its heel and its ball) is tracked
 * through the cycle; while it is on the ground (within `touch` of the floor) its speed along the ground, against the
 * ground speed the body moves at, is the slide. Headless, on the real rig.
 */
import { Vector3, type Object3D } from 'three';
import type { CharacterRig } from '../../src/characters/rig';
import { DT, FWD } from './gait-scenarios';

export interface SlideResult {
  speed: number;
  clip: string;
  /** Frames with a foot planted. */
  contacts: number;
  /** Mean and 95th percentile of the planted foot's ground speed (m/s). */
  mean: number;
  p95: number;
  /** Mean as a share of the speed. */
  share: number;
  /** Peak-to-peak of the pelvis height (m) and mean cadence (steps/s) over the run. */
  bob: number;
  steps: number;
}

interface FootPts {
  foot: Object3D;
  toe: Object3D;
  heelLocal: Vector3;
}

function pts(rig: CharacterRig): FootPts[] {
  rig.root.updateMatrixWorld(true);
  return (['L', 'R'] as const).map((s) => {
    const foot = rig.root.getObjectByName(`Bip01_${s}_Foot`)!;
    const toe = rig.root.getObjectByName(`Bip01_${s}_Toe0`)!;
    const fp = new Vector3().setFromMatrixPosition(foot.matrixWorld);
    const tp = new Vector3().setFromMatrixPosition(toe.matrixWorld);
    const ballFwd = Math.hypot(tp.x - fp.x, tp.z - fp.z);
    // the heel: under the ankle, back along the foot by 45 % of the ball's distance (floor level at rest)
    const heelWorld = new Vector3(fp.x, 0, fp.z + 0.45 * ballFwd);
    return { foot, toe, heelLocal: foot.worldToLocal(heelWorld) };
  });
}

/** Walk `seconds` at `speed` on flat ground (after a settle) and measure the planted feet's slide. */
export function measureSlide(rig: CharacterRig, speed: number, seconds = 6, touch = 0.012): SlideResult {
  rig.autoMotion = false;
  rig.ground = null;
  rig.root.position.set(0, 0, 0);
  rig.input.speed = 0;
  rig.input.sprinting = speed > 4;
  for (let i = 0; i < 90; i++) {
    rig.update(DT, 2);
    rig.root.updateMatrixWorld(true);
  }
  const fp = pts(rig);
  const prev: Array<Vector3 | null> = [null, null, null, null];
  const slides: number[] = [];
  const pelvis = rig.root.getObjectByName('Bip01_Pelvis')!;
  let pMin = Infinity;
  let pMax = -Infinity;
  const p = new Vector3();
  const heel = new Vector3();
  const ball = new Vector3();
  let strikes = 0;
  const wasLow = [false, false, false, false];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    rig.input.speed = speed;
    rig.root.position.z += FWD * speed * DT;
    rig.update(DT, 2);
    rig.root.updateMatrixWorld(true);
    if (i < 120) continue;
    pelvis.getWorldPosition(p);
    pMin = Math.min(pMin, p.y);
    pMax = Math.max(pMax, p.y);
    fp.forEach((f, k) => {
      heel.copy(f.heelLocal).applyMatrix4(f.foot.matrixWorld);
      ball.setFromMatrixPosition(f.toe.matrixWorld);
      [heel, ball].forEach((pt, m) => {
        const idx = k * 2 + m;
        const on = pt.y < touch;
        if (on && !wasLow[idx]) strikes++;
        wasLow[idx] = on;
        if (on && prev[idx]) slides.push(Math.hypot(pt.x - prev[idx]!.x, pt.z - prev[idx]!.z) / DT);
        prev[idx] = on ? pt.clone() : null;
      });
    });
  }
  slides.sort((a, b) => a - b);
  const mean = slides.reduce((a, b) => a + b, 0) / Math.max(1, slides.length);
  return {
    speed,
    clip: rig.clipName,
    contacts: slides.length,
    mean,
    p95: slides[Math.floor(slides.length * 0.95)] ?? 0,
    share: mean / speed,
    bob: pMax - pMin,
    steps: strikes / 2 / ((n - 120) * DT),
  };
}
