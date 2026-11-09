/**
 * A procedural walk and run for toon bodies: the legs, pelvis, spine, arms and head are posed each frame from the
 * ground speed, not played from a clip, so the stride matches the speed exactly (a planted foot does not slide), the
 * proportions of the body set the step, and every pipeline character walks the same good cycle.
 *
 * The cycle (phase 0 = left heel strike): each foot rolls heel strike, foot flat, heel rise, toe-off, then swings to the
 * next heel strike. While a foot is planted its pivot (heel, then ball) is fixed on the ground: the pelvis moves on
 * relative to it at the ground speed, so the ankle's path follows from the foot's roll, not from a guess. The swing
 * leaves the toe-off at the planted foot's velocity and arrives at the next heel strike at the ground's (a cubic
 * Hermite), lifted by a clearance arc. The legs are two-bone IK to the ankles; the pelvis height follows the legs'
 * reach (bounded by the explicit bob), shifts over the planted foot, turns and drops with the swing; the spine
 * counter-rotates; the arms swing opposite the legs with bent elbows; the head is held level on top of all of it.
 * Walk to run is one continuous family (the duty factor drops below a half: a flight phase, a forward lean, bent arms,
 * a bigger bounce).
 *
 * Every pose is the body's own idle pose (sampled from the idle clip once) plus the deltas, so the hands, the hair and
 * the face keep what the clips give them, and the pose blends into the clip's with a weight (starts and stops).
 */
import { Quaternion, Vector3, type AnimationClip, type Bone, type Group, type Object3D } from 'three';
import { solveTwoBone } from './ik';

const D = Math.PI / 180;
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

const _qa = new Quaternion();
const _qb = new Quaternion();
const _qc = new Quaternion();
const _qm = new Quaternion();
const _qp = new Quaternion();
const _qd = new Quaternion();
const _va = new Vector3();
const _vb = new Vector3();
const _vc = new Vector3();
const _vt = new Vector3();
const _vp = new Vector3();

/** Rotate `bone` by `angle` about `axis` given in the model's own frame (glTF: +X her left, +Y up, +Z forward). */
function turn(bone: Object3D, model: Group, axis: Vector3, angle: number): void {
  if (Math.abs(angle) < 1e-6) return;
  bone.parent?.updateWorldMatrix(true, false);
  if (bone.parent) bone.parent.getWorldQuaternion(_qp);
  else _qp.identity();
  model.getWorldQuaternion(_qm);
  _qd.setFromAxisAngle(axis, angle).premultiply(_qm).multiply(_qc.copy(_qm).invert());
  // local' = P^-1 · D · P · local
  _qa.copy(_qp).invert();
  bone.quaternion.premultiply(_qd.premultiply(_qa).multiply(_qp));
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const frac = (x: number): number => x - Math.floor(x);

/** The shape of the cycle at one speed. */
export interface GaitShape {
  /** Seconds per full cycle (two steps). */
  period: number;
  /** Share of the cycle a foot is planted. */
  duty: number;
  /** Walk (0) to run (1). */
  run: number;
  /** Heel strike point ahead of the pelvis and ball at toe-off behind it (root units). */
  heelAhead: number;
  ballBehind: number;
}

/** Body measures the gait is built from (root units, standing idle pose). */
export interface GaitBody {
  legLength: number;
  hipHeight: number;
  ankleHeight: number;
  /** Ankle to heel (behind) and ankle to ball (ahead). */
  heel: number;
  ball: number;
  footLateral: number;
  hipLateral: number;
}

/** The cycle for a ground speed `v` (m/s) on a body of the given leg length: cadence, duty, the strike points. */
export function gaitShape(v: number, body: Pick<GaitBody, 'legLength' | 'heel' | 'ball'>, vigor = 1): GaitShape {
  const run = smooth(1.9, 3.0, v);
  const k = Math.sqrt(0.86 / Math.max(0.3, body.legLength));
  const walkCad = 1.3 + 0.45 * v;
  const runCad = 2.5 + 0.13 * v;
  const cadence = lerp(walkCad, runCad, run) * k * (0.9 + 0.1 * vigor);
  let period = 2 / cadence;
  const duty = lerp(0.62, 0.34, run);
  // a stride the legs can reach: the heel strike no farther ahead than about a third of the leg
  period = Math.min(period, (0.8 * body.legLength + body.heel + body.ball) / (Math.max(0.1, v) * duty));
  const travel = v * duty * period;
  const span = Math.max(0.05, travel - (body.heel + body.ball));
  return { period, duty, run, heelAhead: 0.52 * span, ballBehind: 0.48 * span };
}

interface Rest {
  q: Quaternion;
  p: Vector3 | null;
}

/** Sample a clip's rotation (and position) tracks at `t`: the rest of every animated node by name. */
function sampleClip(clip: AnimationClip, t: number): Map<string, Rest> {
  const out = new Map<string, Rest>();
  for (const tr of clip.tracks) {
    const dot = tr.name.lastIndexOf('.');
    if (dot < 0) continue;
    const node = tr.name.slice(0, dot);
    const prop = tr.name.slice(dot + 1);
    const r = out.get(node) ?? { q: new Quaternion(), p: null };
    const v = (tr as unknown as { createInterpolant(): { evaluate(t: number): ArrayLike<number> } }).createInterpolant().evaluate(t);
    if (prop === 'quaternion') r.q.fromArray(v);
    else if (prop === 'position') r.p = new Vector3().fromArray(v);
    else continue;
    out.set(node, r);
  }
  return out;
}

interface Leg {
  thigh: Bone;
  calf: Bone;
  foot: Bone;
  toe: Bone | null;
  /** Foot flat orientation in the model's frame. */
  flat: Quaternion;
  side: 1 | -1;
}

/** Tuning that can be changed per body (an older or a heavier character moves less). */
export interface GaitStyle {
  /** 0..1: the size of the bounce, sway and swing (1 = a young girl). */
  vigor: number;
}

const CONTROLLED = [
  'Bip01_Pelvis', 'Bip01_Spine', 'Bip01_Spine1', 'Bip01_Spine2', 'Bip01_Neck', 'Bip01_Head',
  'Bip01_L_UpperArm', 'Bip01_L_Forearm', 'Bip01_L_Hand', 'Bip01_R_UpperArm', 'Bip01_R_Forearm', 'Bip01_R_Hand',
  'Bip01_L_Thigh', 'Bip01_L_Calf', 'Bip01_L_Foot', 'Bip01_R_Thigh', 'Bip01_R_Calf', 'Bip01_R_Foot',
] as const;

export class ProceduralGait {
  /** Cycle phase (0..1, left heel strike at 0). */
  phase = 0.28;
  style: GaitStyle = { vigor: 1 };
  /** Smoothed ground speed the cycle runs at (m/s). */
  speed = 0;
  /** Forward lean from acceleration (radians, smoothed). */
  private lean = 0;
  private lastSpeed = 0;
  private body: GaitBody | null = null;
  private legs: Leg[] = [];
  private readonly bone = new Map<string, Bone>();
  private base = new Map<string, Rest>();
  private readonly saved = new Map<string, Quaternion>();
  private headFlat = new Quaternion();
  private neckFlat = new Quaternion();
  /** Pelvis target for the foot-flat height, set at capture. */
  private ready = false;
  /** Feet that struck the ground in the last update (for footstep sounds). */
  readonly strikes: Array<0 | 1> = [];

  constructor(
    private readonly scene: Object3D,
    private readonly root: Group,
    private readonly model: Group,
    private readonly idle: AnimationClip | undefined,
  ) {
    for (const n of CONTROLLED) {
      const b = scene.getObjectByName(n) as Bone | undefined;
      if (b) this.bone.set(n, b);
    }
    for (const n of ['Bip01_L_Toe0', 'Bip01_R_Toe0']) {
      const b = scene.getObjectByName(n) as Bone | undefined;
      if (b) this.bone.set(n, b);
    }
  }

  /** Whether the body has the bones and an idle pose to build from. */
  get usable(): boolean {
    return !!this.idle && CONTROLLED.every((n) => this.bone.has(n));
  }

  /** The body's measures (after the first update). */
  get measures(): GaitBody | null {
    return this.body;
  }

  private b(n: string): Bone {
    return this.bone.get(n) as Bone;
  }

  /** Put every controlled bone in the idle pose. */
  private poseBase(): void {
    for (const n of CONTROLLED) {
      const r = this.base.get(n);
      if (r) this.b(n).quaternion.copy(r.q);
    }
  }

  private capture(): void {
    this.base = sampleClip(this.idle as AnimationClip, 0.3);
    this.model.position.set(0, 0, 0);
    this.poseBase();
    for (const n of CONTROLLED) this.b(n).updateWorldMatrix(false, false);
    this.root.updateMatrixWorld(true);
    const at = (n: string, out: Vector3): Vector3 => this.root.worldToLocal(this.b(n).getWorldPosition(out));
    const lt = at('Bip01_L_Thigh', new Vector3());
    const rt = at('Bip01_R_Thigh', new Vector3());
    const lc = at('Bip01_L_Calf', new Vector3());
    const lf = at('Bip01_L_Foot', new Vector3());
    const toe = this.bone.get('Bip01_L_Toe0');
    const toeP = toe ? at('Bip01_L_Toe0', new Vector3()) : lf.clone().add(new Vector3(0, -lf.y, -0.12));
    this.model.getWorldQuaternion(_qm);
    this.legs = ([['L', 1], ['R', -1]] as const).map(([s, side]) => {
      const foot = this.b(`Bip01_${s}_Foot`);
      foot.getWorldQuaternion(_qa);
      return {
        thigh: this.b(`Bip01_${s}_Thigh`),
        calf: this.b(`Bip01_${s}_Calf`),
        foot,
        toe: this.bone.get(`Bip01_${s}_Toe0`) ?? null,
        flat: _qa.clone().premultiply(_qm.clone().invert()),
        side,
      };
    });
    const head = this.b('Bip01_Head');
    head.getWorldQuaternion(_qa);
    this.headFlat.copy(_qa).premultiply(_qm.clone().invert());
    const neck = this.b('Bip01_Neck');
    neck.getWorldQuaternion(_qa);
    this.neckFlat.copy(_qa).premultiply(_qm.clone().invert());
    const ball = Math.max(0.08, Math.hypot(toeP.x - lf.x, toeP.z - lf.z));
    this.body = {
      legLength: lt.distanceTo(lc) + lc.distanceTo(lf),
      hipHeight: (lt.y + rt.y) / 2,
      ankleHeight: lf.y,
      heel: Math.min(0.07, ball * 0.45),
      ball,
      footLateral: Math.abs(lf.x),
      hipLateral: Math.abs(lt.x),
    };
    this.ready = true;
  }

  /**
   * Ankle (root frame: x right, y up, f forward) and pitch of the foot (toe up positive) at stance fraction `u`
   * (0..1), with the planted pivot fixed on the ground.
   */
  private stanceAnkle(shape: GaitShape, u: number, out: { f: number; y: number; pitch: number }): void {
    const body = this.body as GaitBody;
    const run = shape.run;
    const aHs = lerp(18, 8, run) * D;
    const aTo = lerp(36, 46, run) * D;
    const u1 = 0.13;
    const u2 = lerp(0.5, 0.42, run);
    const T = shape.period * shape.duty;
    const v = this.speed;
    const tt = u * T;
    const hx = body.heel; // ankle ahead of the heel
    const hy = body.ankleHeight;
    const bx = -(body.ball); // ankle behind the ball
    const heelF = shape.heelAhead - v * tt;
    if (u < u2) {
      const a = u < u1 ? aHs * (1 - smooth(0, 1, u / u1)) : 0;
      out.f = heelF + hx * Math.cos(a) - hy * Math.sin(a);
      out.y = hx * Math.sin(a) + hy * Math.cos(a);
      out.pitch = a;
    } else {
      const t2 = u2 * T;
      // the ball stays where it was when the heel left (the flat foot's ball)
      const ballF = shape.heelAhead - v * t2 + (hx + body.ball) - v * (tt - t2);
      const k = (u - u2) / (1 - u2);
      const a = -aTo * Math.pow(smooth(0, 1, k), 1.15);
      out.f = ballF + bx * Math.cos(a) - hy * Math.sin(a);
      out.y = bx * Math.sin(a) + hy * Math.cos(a);
      out.pitch = a;
    }
  }

  private readonly _s = { f: 0, y: 0, pitch: 0 };
  private readonly _a0 = { f: 0, y: 0, pitch: 0 };
  private readonly _a1 = { f: 0, y: 0, pitch: 0 };
  private readonly _e = { f: 0, y: 0, pitch: 0 };

  /** Ankle at foot phase `psi` (0..1): planted through `duty`, then the swing. */
  private ankleAt(shape: GaitShape, psi: number, out: { f: number; y: number; pitch: number }): void {
    const body = this.body as GaitBody;
    const duty = shape.duty;
    if (psi < duty) {
      this.stanceAnkle(shape, psi / duty, out);
      return;
    }
    const w = (psi - duty) / (1 - duty);
    const Tsw = shape.period * (1 - duty);
    const e = 0.01;
    const dtE = e * shape.period * duty;
    const a0 = this._a0;
    const a1 = this._a1;
    const ee = this._e;
    // toe-off and the next heel strike, with the planted foot's velocity at both
    this.stanceAnkle(shape, 1, a0);
    this.stanceAnkle(shape, 1 - e, ee);
    const m0f = (a0.f - ee.f) / dtE;
    const m0y = (a0.y - ee.y) / dtE;
    this.stanceAnkle(shape, 0, a1);
    this.stanceAnkle(shape, e, ee);
    const m1f = (ee.f - a1.f) / dtE;
    const m1y = (ee.y - a1.y) / dtE;
    const w2 = w * w;
    const w3 = w2 * w;
    const h00 = 2 * w3 - 3 * w2 + 1;
    const h10 = w3 - 2 * w2 + w;
    const h01 = -2 * w3 + 3 * w2;
    const h11 = w3 - w2;
    out.f = h00 * a0.f + h10 * Tsw * m0f + h01 * a1.f + h11 * Tsw * m1f;
    const clear = lerp(0.05, 0.13, shape.run) * (body.legLength / 0.86) * (0.7 + 0.3 * this.style.vigor);
    const bump = Math.pow(Math.sin(Math.PI * Math.pow(w, 0.85)), 1.2);
    out.y = h00 * a0.y + h10 * Tsw * m0y + h01 * a1.y + h11 * Tsw * m1y + clear * bump;
    // the toe-off pitch eases to a level foot mid swing; the toes lift for the strike
    out.pitch = a0.pitch * (1 - smooth(0, 0.5, w)) + a1.pitch * smooth(0.55, 1, w);
  }

  /**
   * Advance the cycle and pose the body. `speed` the ground speed (m/s), `weight` 0..1 how much of the gait replaces
   * the clip's pose, `arms` false leaves the arms to the clip (a held prop), `accel` the acceleration (m/s²) for the lean.
   */
  update(dt: number, speed: number, weight: number, arms: boolean, accel: number): void {
    this.strikes.length = 0;
    if (weight <= 0.002 || !this.usable) {
      if (weight <= 0.002) this.speed = speed;
      this.lean *= Math.exp(-dt / 0.15);
      return;
    }
    if (!this.ready) this.capture();
    const body = this.body as GaitBody;
    const vigor = this.style.vigor;
    // the pelvis' own speed through the cycle (a stop eases the stride down instead of freezing it)
    this.speed = speed;
    const shape = gaitShape(Math.max(0.15, speed), body, vigor);
    const prevPhase = this.phase;
    this.phase = frac(this.phase + dt / shape.period);
    if (this.phase < prevPhase) this.strikes.push(0);
    if (prevPhase < 0.5 && this.phase >= 0.5) this.strikes.push(1);
    const phi = this.phase;
    const run = shape.run;
    // lean into a start, back into a stop
    const leanWant = -Math.max(-0.12, Math.min(0.12, accel * 0.022));
    this.lean += (leanWant - this.lean) * (1 - Math.exp(-dt / 0.12));

    // save the clip's pose of the controlled bones, to blend back to
    for (const n of CONTROLLED) {
      const sv = this.saved.get(n) ?? new Quaternion();
      sv.copy(this.b(n).quaternion);
      this.saved.set(n, sv);
    }
    const savedModel = this.model.position.clone();

    this.poseBase();
    // --- the pelvis: shift over the planted foot, bob, turn
    const sway = lerp(0.022, 0.012, run) * (0.5 + 0.5 * vigor);
    const swayX = -sway * Math.cos(2 * Math.PI * (phi - 0.3));
    const lowAt = lerp(0.07, shape.duty / 2, run);
    const hump = (1 + Math.cos(4 * Math.PI * (phi - lowAt))) / 2;
    const kPass = lerp(0.985, 0.93, run);
    const hPass = body.ankleHeight + kPass * body.legLength * 0.998;
    const bob = lerp(0.034, 0.085, run) * (body.legLength / 0.86) * (0.5 + 0.5 * vigor);
    const hipY = Math.min(hPass - bob * hump, body.hipHeight + 0.002);
    this.model.position.set(swayX, hipY - body.hipHeight, 0);
    this.root.updateMatrixWorld(true);

    const yawP = -lerp(5.5, 4, run) * D * (0.6 + 0.4 * vigor) * Math.cos(2 * Math.PI * (phi - 0.04));
    const rollP = lerp(3, 2, run) * D * (0.5 + 0.5 * vigor) * Math.sin(2 * Math.PI * (phi - 0.05));
    const pitchTotal = lerp(2, 12, run) * D + this.lean;
    const pelvis = this.b('Bip01_Pelvis');
    turn(pelvis, this.model, Y, yawP);
    turn(pelvis, this.model, Z, rollP);
    turn(pelvis, this.model, X, pitchTotal * 0.3);
    // (the turn of the pelvis moves the hips: put them back at the height the bob asks for)
    {
      const lt = (this.legs[0] as Leg).thigh;
      const rt = (this.legs[1] as Leg).thigh;
      lt.updateWorldMatrix(true, false);
      rt.updateWorldMatrix(true, false);
      const y = (this.root.worldToLocal(lt.getWorldPosition(_va)).y + this.root.worldToLocal(rt.getWorldPosition(_vb)).y) / 2;
      this.model.position.y += hipY - y;
    }
    // counter-rotation up the spine
    const chestYaw = -yawP * 1.6;
    const chestRoll = -rollP * 0.9;
    for (const n of ['Bip01_Spine', 'Bip01_Spine1', 'Bip01_Spine2']) {
      const s = this.b(n);
      turn(s, this.model, Y, chestYaw / 3);
      turn(s, this.model, Z, chestRoll / 3);
      turn(s, this.model, X, (pitchTotal * 0.7) / 3);
    }

    // --- the legs: IK to the ankles
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i] as Leg;
      const psi = frac(phi - i * 0.5);
      this.ankleAt(shape, psi, this._s);
      const x = leg.side === 1 ? -Math.max(body.footLateral, 0.055) : Math.max(body.footLateral, 0.055);
      // root frame: x right (+), forward = -z; the feet stay where the ground holds them (the pelvis sways over them)
      _vt.set(x, this._s.y, -this._s.f);
      this.root.localToWorld(_vt);
      // the knee points where the body faces
      leg.calf.updateWorldMatrix(true, false);
      leg.calf.getWorldPosition(_vc);
      _vp.set(0, 0, -1).transformDirection(this.root.matrixWorld).multiplyScalar(0.6).add(_vc);
      solveTwoBone(leg.thigh, leg.calf, leg.foot, _vt, _vp, 1);
      // foot pitch: toe up positive about the model's lateral axis
      leg.calf.updateWorldMatrix(true, false);
      this.model.getWorldQuaternion(_qm);
      // target world = Qm · Rx(-pitch) · flat  (flat is in model space)
      _qb.setFromAxisAngle(X, -this._s.pitch).multiply(leg.flat).premultiply(_qm);
      leg.foot.parent?.getWorldQuaternion(_qp);
      leg.foot.quaternion.copy(_qp.invert().multiply(_qb));
      leg.foot.updateWorldMatrix(false, true);
    }

    // --- the arms: opposite the legs, elbows bent
    if (arms) {
      const swing = lerp(20, 48, run) * D * (0.6 + 0.4 * vigor) * Math.min(1, 0.45 + speed / 1.4);
      const lag = 0.05;
      const e0 = lerp(10, 82, run) * D;
      const eVar = lerp(14, 14, run) * D;
      for (const side of [1, -1] as const) {
        const s = side === 1 ? 'L' : 'R';
        // left arm forward as the left foot goes back
        const fwd = -side * swing * Math.cos(2 * Math.PI * (phi - lag));
        const up = this.b(`Bip01_${s}_UpperArm`);
        const lo = this.b(`Bip01_${s}_Forearm`);
        turn(up, this.model, X, -fwd);
        const open = (fwd / Math.max(1e-3, swing) + 1) / 2;
        turn(lo, this.model, X, -(e0 + eVar * open));
        // the hand follows the forearm a little (the wrist relaxes)
        turn(this.b(`Bip01_${s}_Hand`), this.model, X, -fwd * 0.15);
      }
    }

    // --- the head stays level and facing where the body goes
    this.model.getWorldQuaternion(_qm);
    for (const [n, flat, k] of [['Bip01_Neck', this.neckFlat, 0.45], ['Bip01_Head', this.headFlat, 0.85]] as const) {
      const bone = this.b(n);
      bone.parent?.updateWorldMatrix(true, false);
      bone.parent?.getWorldQuaternion(_qp);
      _qb.copy(flat).premultiply(_qm);
      bone.getWorldQuaternion(_qa);
      // the carried orientation, eased toward the level one
      _qa.slerp(_qb, k);
      bone.quaternion.copy(_qp.invert().multiply(_qa));
      bone.updateWorldMatrix(false, true);
    }

    // --- blend with the clip's pose by the weight
    if (weight < 0.999) {
      for (const n of CONTROLLED) {
        const bq = this.b(n);
        bq.quaternion.copy((this.saved.get(n) as Quaternion).clone().slerp(bq.quaternion, weight));
      }
      this.model.position.lerpVectors(savedModel, this.model.position, weight);
    }
  }
}
