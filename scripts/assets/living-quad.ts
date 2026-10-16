/**
 * Four-legged animals from one parametric anatomy: a barrel of three smooth-unioned masses, a neck that rises to a
 * skull and a muzzle, legs with shoulder, knee and fetlock, a tail, ears, eyes and (for stags) antlers. The same
 * description drives the skeleton and the walk, trot and idle clips, so the legs plant where the body moves.
 * Species differ by numbers (deer, cat, rabbit, boar, ...): proportions, coat and gait.
 */
import { cone, ellipsoid, sphere, type Prim } from './sdf';
import { buildCreatureParts, ear, eyeBall, tubeMesh, type QuadSpec } from './living-parts';
import { fbm, lin, mixc, noise3, occlusion, sstep, type BoneDef, type Channel, type Clip, type Creature } from './living-kit';
import type { V3 } from './vehicle-geo';

export type { QuadSpec } from './living-parts';

const TAU = Math.PI * 2;
const sin = Math.sin;
const cos = Math.cos;

/** Leg names in order: front left, front right, rear left, rear right. */
const LEGS = ['fl', 'fr', 'rl', 'rr'] as const;
type Leg = (typeof LEGS)[number];

/** Build the creature of a species description. */
export function quadruped(s: QuadSpec): Creature {
  const L = s.torso;
  const H = s.hipHeight;
  const hipX = -L / 2;
  const shX = L / 2;
  const backY = H + s.backRise;
  const bones: BoneDef[] = [];
  const bone = (name: string, parent: string | null, at: V3): void => void bones.push({ name, parent, at });
  bone('root', null, [0, H * 0.95, 0]);
  bone('hips', 'root', [hipX * 0.8, H * 0.98, 0]);
  bone('spine', 'hips', [0, H * 1.0, 0]);
  bone('chest', 'spine', [shX * 0.7, H * 1.02, 0]);
  const neckBase: V3 = [shX + 0.02 * L, backY + 0.02, 0];
  const a = s.neckAngle;
  const nl = s.neck;
  const neckMid: V3 = [neckBase[0] + cos(a) * nl * 0.5, neckBase[1] + sin(a) * nl * 0.5, 0];
  const headBase: V3 = [neckBase[0] + cos(a) * nl, neckBase[1] + sin(a) * nl, 0];
  bone('neck1', 'chest', neckBase);
  bone('neck2', 'neck1', neckMid);
  bone('head', 'neck2', headBase);
  const hd = s.head;
  bone('jaw', 'head', [headBase[0] + hd.skull[0] * 0.35, headBase[1] - hd.skull[1] * 0.2, 0]);
  // Tail: three bones along the back line, pointing back (and up by `tailRise`).
  const tailAt = (k: number): V3 => [hipX - 0.12 * L - s.tail * (k / 3) * cos(s.tailRise), backY - 0.02 + s.tail * (k / 3) * sin(s.tailRise), 0];
  bone('tail1', 'hips', tailAt(0));
  bone('tail2', 'tail1', tailAt(1));
  bone('tail3', 'tail2', tailAt(2));
  const earAt = (side: 1 | -1): V3 => [headBase[0] + hd.skull[0] * s.earX, headBase[1] + hd.skull[1] * 0.8, side * hd.skull[2] * 0.7];
  bone('earR', 'head', earAt(1));
  bone('earL', 'head', earAt(-1));

  // Legs: [upper, lower, foot] lengths and offsets.
  const lw = s.legSpread * s.torsoWidth;
  const legPivot = (leg: Leg): V3 => {
    const front = leg[0] === 'f';
    const side = leg[1] === 'r' ? 1 : -1;
    return [front ? shX - 0.02 * L : hipX + 0.02 * L, front ? H * 0.99 : H * 1.0, side * lw];
  };
  const legPoints = (leg: Leg): { top: V3; knee: V3; ankle: V3; toe: V3 } => {
    const front = leg[0] === 'f';
    const top = legPivot(leg);
    const [lu, ll, lf] = front ? s.foreLeg : s.hindLeg;
    // Front legs hang straight; hind legs angle forward to the knee and back to the hock.
    const kneeBend = front ? 0.03 : s.hindKnee;
    const hockBend = front ? 0.0 : -s.hindHock;
    const knee: V3 = [top[0] + sin(kneeBend) * lu, top[1] - cos(kneeBend) * lu, top[2]];
    const ankle: V3 = [knee[0] + sin(hockBend) * ll, knee[1] - cos(hockBend) * ll, top[2]];
    // The foot always ends on the ground (its length follows from where the ankle ended up).
    const toe: V3 = [ankle[0] + s.toe, 0.012, top[2]];
    void lf;
    return { top, knee, ankle, toe };
  };
  for (const leg of LEGS) {
    const p = legPoints(leg);
    const parent = leg[0] === 'f' ? 'chest' : 'hips';
    bone(`${leg}_upper`, parent, p.top);
    bone(`${leg}_lower`, `${leg}_upper`, p.knee);
    bone(`${leg}_foot`, `${leg}_lower`, p.ankle);
  }

  // ---- Primitives -------------------------------------------------------------------------------------------------
  const prims: Prim[] = [];
  const tw = s.torsoWidth;
  prims.push(ellipsoid('hips', [hipX + 0.02 * L, H + s.backRise * 0.4, 0], [0.26 * L, s.rumpDepth, tw * 0.95], -0.04));
  prims.push(ellipsoid('spine', [0, H + s.backRise * 0.1 - s.belly * 0.2, 0], [0.34 * L, s.waistDepth, tw * 0.9], 0));
  prims.push(ellipsoid('chest', [shX - 0.02 * L, H + s.backRise * 0.45 - (s.chestDepth - s.waistDepth) * 0.3, 0], [0.26 * L, s.chestDepth, tw * 0.92], 0.05));
  // Neck: a round cone, thick at the shoulder, with a throat and a mane ridge for the species that have one.
  prims.push(cone('neck1', neckBase, neckMid, s.neckR[0], (s.neckR[0] + s.neckR[1]) / 2, { k: 0.05 }));
  prims.push(cone('neck2', neckMid, headBase, (s.neckR[0] + s.neckR[1]) / 2, s.neckR[1], { k: 0.04 }));
  // Head: skull, muzzle, nose pad, brow, cheek, and a carved mouth line.
  const skullC: V3 = [headBase[0] + hd.skull[0] * 0.55, headBase[1] + hd.skull[1] * 0.1 + hd.droop, 0];
  prims.push(ellipsoid('head', skullC, hd.skull, hd.pitch, 0, { k: 0.02 }));
  const muzzleA: V3 = [skullC[0] + hd.skull[0] * 0.5, skullC[1] - hd.skull[1] * 0.1, 0];
  const muzzleB: V3 = [muzzleA[0] + hd.muzzle, muzzleA[1] - hd.muzzle * hd.muzzleDrop, 0];
  prims.push(cone('head', muzzleA, muzzleB, hd.skull[2] * hd.muzzleW0, hd.skull[2] * hd.muzzleW1, { k: 0.02 }));
  prims.push(ellipsoid('jaw', [muzzleA[0] + hd.muzzle * 0.45, muzzleA[1] - hd.skull[2] * 0.62 - hd.muzzle * hd.muzzleDrop * 0.4, 0], [hd.muzzle * 0.55, hd.skull[2] * 0.3, hd.skull[2] * hd.muzzleW0 * 0.72], hd.pitch - 0.05, 0, { k: 0.012 }));
  prims.push(sphere('head', [muzzleB[0] + 0.005, muzzleB[1] + hd.skull[2] * 0.12, 0], hd.skull[2] * hd.muzzleW1 * 1.0, { k: 0.01 }));
  for (const side of [1, -1] as const) {
    prims.push(sphere('head', [skullC[0] - hd.skull[0] * 0.15, skullC[1] + hd.skull[1] * 0.35, side * hd.skull[2] * 0.7], hd.skull[2] * 0.3, { k: 0.015 }));
    // Eye sockets (carved a little) so the eyes sit in the head.
    prims.push(sphere('head', [skullC[0] + hd.skull[0] * 0.12, skullC[1] + hd.skull[1] * 0.28, side * hd.skull[2] * 0.93], hd.skull[2] * 0.2, { carve: true, k: 0.012 }));
  }
  // Tail.
  const tr = s.tailR;
  prims.push(cone('tail1', tailAt(0), tailAt(1), tr[0], tr[1], { k: 0.02 }));
  prims.push(cone('tail2', tailAt(1), tailAt(2), tr[1], tr[2], { k: 0.015 }));
  prims.push(cone('tail3', tailAt(2), tailAt(3), tr[2], tr[3], { k: 0.01 }));
  // Legs.
  for (const leg of LEGS) {
    const front = leg[0] === 'f';
    const side = leg[1] === 'r' ? 1 : -1;
    const p = legPoints(leg);
    const r = front ? s.foreR : s.hindR;
    // Shoulder / thigh mass sits in the torso so the leg grows out of the body.
    prims.push(ellipsoid(`${leg}_upper`, [p.top[0] + (front ? -0.01 : -0.02) * L, p.top[1] - r[0] * 0.2, p.top[2] + side * 0.0], [r[0] * (front ? 1.7 : 2.2), r[0] * (front ? 2.3 : 2.9), r[0] * 1.35], front ? 0.1 : -0.15, 0, { k: 0.05 }));
    prims.push(cone(`${leg}_upper`, p.top, p.knee, r[0], r[1], { k: 0.035 }));
    prims.push(cone(`${leg}_lower`, p.knee, p.ankle, r[1], r[2], { k: 0.02 }));
    prims.push(cone(`${leg}_foot`, p.ankle, p.toe, r[2], r[3], { k: 0.012 }));
    if (s.paw) prims.push(ellipsoid(`${leg}_foot`, [p.toe[0] + r[3] * 0.4, p.toe[1] + r[3] * 0.5, p.toe[2]], [r[3] * 1.6, r[3] * 1.0, r[3] * 1.15], 0, 0, { k: 0.01 }));
  }

  // ---- Rigid parts ------------------------------------------------------------------------------------------------
  const rigid = buildCreatureParts(s, { skullC, headBase, muzzleB, hd, earAt, tailAt, legPoints });

  // ---- Coat -------------------------------------------------------------------------------------------------------
  const coat = (p: V3, n: V3, sc: Parameters<Creature['coat']>[2]): V3 => {
    const c = s.coat;
    const base = lin(c.base);
    const back = lin(c.back ?? c.base);
    const belly = lin(c.belly ?? c.base);
    const mask = lin(c.mask ?? c.base);
    // Vertical gradient (dark back, light belly) with a soft transition at the flank.
    const yRel = (p[1] - H * 0.55) / (H * 0.7);
    let col = mixc(belly, back, sstep(-0.1, 0.45, yRel * 0.8 + n[1] * 0.45));
    col = mixc(col, base, 0.35);
    // Muzzle, face mask and lower legs.
    const fx = (p[0] - (skullC[0] - hd.skull[0] * 0.2)) / (hd.skull[0] * 1.9 + hd.muzzle);
    if (p[0] > skullC[0] - hd.skull[0] * 0.3 && p[1] > H * 0.45) col = mixc(col, mask, sstep(0.1, 0.9, fx) * (c.maskAmount ?? 0.6));
    if (c.legs) {
      const lowerT = sstep(H * 0.5, H * 0.1, p[1]);
      col = mixc(col, lin(c.legs), lowerT * 0.85);
    }
    if (c.throat) col = mixc(col, lin(c.throat), sstep(0.2, 0.9, -n[1]) * sstep(shX - 0.1, shX + 0.2, p[0]) * sstep(backY - 0.25, backY - 0.05, p[1] + 0.1));
    if (c.rump) col = mixc(col, lin(c.rump), sstep(hipX + 0.1 * L, hipX - 0.05 * L, p[0]) * sstep(H * 0.8, H * 1.0, p[1]) * 0.9);
    // Mottling in the fur and hair-fine streaks along the body.
    const m = fbm(p[0] * 9, p[1] * 9, p[2] * 9);
    col = mixc(col, mixc(col, back, 0.6), (m - 0.45) * (c.mottle ?? 0.5));
    const streak = noise3(p[0] * 38, p[1] * 7, p[2] * 7);
    const tone = 0.92 + (streak - 0.5) * (c.streak ?? 0.16);
    if (c.spots) {
      const sp = noise3(p[0] * c.spots.scale, p[1] * c.spots.scale, p[2] * c.spots.scale);
      col = mixc(col, lin(c.spots.color), sstep(c.spots.cut, c.spots.cut + 0.08, sp) * c.spots.amount * sstep(0.1, 0.55, yRel * 0.9 + n[1] * 0.5));
    }
    if (c.stripes) {
      const st = Math.abs(sin((p[0] * c.stripes.freq + noise3(p[0] * 6, p[1] * 6, p[2] * 6) * 1.6 + (p[1] - H) * 3) * 1.0));
      col = mixc(col, lin(c.stripes.color), sstep(c.stripes.cut, c.stripes.cut + 0.18, st) * c.stripes.amount * sstep(0.0, 0.5, yRel * 0.8 + n[1] * 0.4 + 0.2));
    }
    // Contact shading in creases and a hint of warm rim at the ridges.
    const ao = occlusion(sc, p, n, 0.05);
    const shade = (0.55 + 0.45 * ao) * tone;
    return [col[0] * shade, col[1] * shade, col[2] * shade];
  };

  // ---- Clips ------------------------------------------------------------------------------------------------------
  const clips = quadClips(s, legPoints);

  return {
    id: s.id,
    name: s.name,
    tags: s.tags,
    bones,
    prims,
    voxel: s.voxel,
    k: s.k,
    tris: s.tris,
    sigma: s.sigma ?? 0.022,
    coat,
    mats: {
      coat: { color: [1, 1, 1], rough: 0.92 },
      eye: { color: [0.02, 0.015, 0.012], rough: 0.08 },
      horn: { color: lin(s.horn ?? '#cbbd9e'), rough: 0.7 },
      nose: { color: lin(s.noseColor ?? '#1e1714'), rough: 0.45 },
      inner: { color: lin(s.coat.inner ?? '#c99a8a'), rough: 0.9, double: true },
      hoof: { color: lin(s.hoofColor ?? '#2a221c'), rough: 0.55 },
      whisker: { color: [0.8, 0.8, 0.78], rough: 0.6 },
    },
    rigid,
    clips,
  };
}

/** Bone name list of a leg, upper first. */
const legBones = (leg: Leg): [string, string, string] => [`${leg}_upper`, `${leg}_lower`, `${leg}_foot`];

/** Walk, trot (run), idle and graze clips. */
function quadClips(s: QuadSpec, legPoints: (leg: Leg) => { top: V3; knee: V3; ankle: V3; toe: V3 }): Clip[] {
  const frontLen = s.foreLeg[0] + s.foreLeg[1] + s.foreLeg[2];
  const swing = s.swing;
  // Period from the stride: a foot moves 2 L sin(A) back while it is planted for `duty` of the cycle.
  const period = (speed: number, duty: number, amp: number): number => Math.max(0.28, (2 * frontLen * Math.sin(amp)) / (duty * speed));
  const walkT = period(s.walkSpeed, 0.62, swing);
  const runT = period(s.runSpeed, 0.4, swing * 1.25);

  const legChannels = (phases: Record<Leg, number>, amp: number, flex: number, duty: number): Channel[] => {
    const out: Channel[] = [];
    for (const leg of LEGS) {
      const front = leg[0] === 'f';
      const [u, l, f] = legBones(leg);
      const ph = phases[leg];
      const theta = (t: number): number => amp * sin(TAU * (t + ph));
      // Knee flexion while the leg swings forward (cos > 0 half of the cycle), a little extension in stance.
      const flexion = (t: number): number => flex * Math.max(0, cos(TAU * (t + ph))) ** 1.3;
      out.push({ bone: u, rot: (t) => [0, 0, theta(t) + (front ? 0 : 0.0)] });
      out.push({ bone: l, rot: (t) => [0, 0, (front ? -1 : 1) * flexion(t) * (front ? 1.0 : 0.9) + (front ? 0 : -0.18 * sin(TAU * (t + ph)))] });
      out.push({ bone: f, rot: (t) => [0, 0, -theta(t) * 0.55 + (front ? 1 : -1) * -flexion(t) * 0.35] });
    }
    void duty;
    return out;
  };

  const body = (t: number, bob: number, nod: number, flexAmp: number, ph: number): Channel[] => {
    void t;
    return [
      { bone: 'root', pos: (u) => [0, bob * sin(TAU * (2 * u + ph)), 0] },
      { bone: 'spine', rot: (u) => [0.015 * sin(TAU * u), 0.03 * sin(TAU * u), flexAmp * sin(TAU * (2 * u + ph + 0.25))] },
      { bone: 'chest', rot: (u) => [0.02 * sin(TAU * u + 1), -0.03 * sin(TAU * u), flexAmp * 0.6 * sin(TAU * (2 * u + ph))] },
      { bone: 'neck1', rot: (u) => [0, 0.05 * sin(TAU * u + 0.5), nod * sin(TAU * (2 * u + ph + 0.2))] },
      { bone: 'neck2', rot: (u) => [0, 0.04 * sin(TAU * u + 0.9), nod * 0.8 * sin(TAU * (2 * u + ph + 0.35))] },
      { bone: 'head', rot: (u) => [0, 0.03 * sin(TAU * u + 1.4), -nod * 1.2 * sin(TAU * (2 * u + ph + 0.35))] },
      { bone: 'tail1', rot: (u) => [0, s.tailSway * sin(TAU * u + 0.2), 0.05 * sin(TAU * (2 * u))] },
      { bone: 'tail2', rot: (u) => [0, s.tailSway * 1.2 * sin(TAU * u - 0.5), 0.05 * sin(TAU * (2 * u) - 0.4)] },
      { bone: 'tail3', rot: (u) => [0, s.tailSway * 1.4 * sin(TAU * u - 1.1), 0.06 * sin(TAU * (2 * u) - 0.9)] },
    ];
  };

  // Lateral-sequence walk: rear left, front left, rear right, front right a quarter apart.
  const walkPh: Record<Leg, number> = { rl: 0, fl: 0.25, rr: 0.5, fr: 0.75 };
  const walk: Clip = {
    name: 'walk',
    duration: walkT,
    channels: [...legChannels(walkPh, swing, s.flex, 0.62), ...body(0, s.bob, 0.025, 0.012, 0)],
  };
  // Run: a trot (diagonal pairs) for stiff-backed animals, a bound for the flexible ones.
  const bound = s.gait === 'bound';
  const runPh: Record<Leg, number> = bound ? { fl: 0, fr: 0.04, rl: 0.42, rr: 0.46 } : { fl: 0, rr: 0, fr: 0.5, rl: 0.5 };
  const run: Clip = {
    name: 'run',
    duration: runT,
    channels: [...legChannels(runPh, swing * 1.25, s.flex * 1.35, 0.4), ...body(0, s.bob * 2.2, 0.05, bound ? 0.2 : 0.05, bound ? 0.1 : 0)],
  };
  // Idle: breathing, a slow head turn, an ear flick and a tail swish; legs planted.
  const idleLegs: Channel[] = [];
  for (const leg of LEGS) {
    const [u, l, f] = legBones(leg);
    idleLegs.push({ bone: u, rot: () => [0, 0, 0] }, { bone: l, rot: () => [0, 0, 0] }, { bone: f, rot: () => [0, 0, 0] });
  }
  const idleT = 4.2;
  const idle: Clip = {
    name: 'idle',
    duration: idleT,
    channels: [
      ...idleLegs,
      { bone: 'root', pos: (u) => [0, 0.004 * sin(TAU * u * 2), 0] },
      { bone: 'spine', rot: (u) => [0, 0, 0.012 * sin(TAU * u * 2)] },
      { bone: 'chest', rot: (u) => [0, 0, 0.016 * sin(TAU * u * 2 - 0.4)] },
      { bone: 'neck1', rot: (u) => [0, 0.16 * sin(TAU * u), 0.03 * sin(TAU * u * 2 + 0.8)] },
      { bone: 'neck2', rot: (u) => [0, 0.2 * sin(TAU * u - 0.2), 0.03 * sin(TAU * u * 2 + 0.2)] },
      { bone: 'head', rot: (u) => [0.03 * sin(TAU * u * 3), 0.12 * sin(TAU * u - 0.4), -0.04 * sin(TAU * u * 2)] },
      { bone: 'earR', rot: (u) => [0.0, 0.0, 0.22 * Math.max(0, sin(TAU * u * 3 + 0.5)) ** 6] },
      { bone: 'earL', rot: (u) => [0.0, 0.0, 0.2 * Math.max(0, sin(TAU * u * 2 + 2.1)) ** 8] },
      { bone: 'tail1', rot: (u) => [0, 0.22 * sin(TAU * u * 2), 0.04 * sin(TAU * u * 4)] },
      { bone: 'tail2', rot: (u) => [0, 0.3 * sin(TAU * u * 2 - 0.6), 0] },
      { bone: 'tail3', rot: (u) => [0, 0.36 * sin(TAU * u * 2 - 1.2), 0] },
    ],
  };
  // Graze / sniff: head to the ground and back.
  const dip = (u: number): number => sstep(0.1, 0.35, u) * (1 - sstep(0.65, 0.9, u));
  const graze: Clip = {
    name: 'graze',
    duration: 6,
    channels: [
      ...idleLegs,
      { bone: 'neck1', rot: (u) => [0, 0, -s.grazeDip * 0.5 * dip(u)] },
      { bone: 'neck2', rot: (u) => [0, 0, -s.grazeDip * 0.55 * dip(u)] },
      { bone: 'head', rot: (u) => [0, 0.05 * sin(TAU * u * 4) * dip(u), -s.grazeDip * 0.25 * dip(u) + 0.06 * sin(TAU * u * 7) * dip(u)] },
      { bone: 'spine', rot: (u) => [0, 0, 0.02 * dip(u)] },
      { bone: 'tail1', rot: (u) => [0, 0.2 * sin(TAU * u * 3), 0] },
      { bone: 'earR', rot: (u) => [0, 0, 0.18 * Math.max(0, sin(TAU * u * 4)) ** 5] },
    ],
  };
  void legPoints;
  return [idle, walk, run, graze];
}

void ear;
void eyeBall;
void tubeMesh;
