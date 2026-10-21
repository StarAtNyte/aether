/**
 * One animated person: a skinned cast member, its mixer, the state machine
 * that drives it from what the simulation published, head look-at, two-handed
 * carry IK, held props, footstep events and a first-person shadow-only mode.
 *
 * The rig is visual and audible only. It reads positions and hints; it never
 * writes to the simulation, so the playtest bot and the replay verifier see
 * exactly the same game with or without it.
 */
import { AnimationMixer, Group, LoopOnce, LoopRepeat, Material, MathUtils, Mesh, Object3D, Quaternion, Vector3, type AnimationAction, type AnimationClip, type Bone } from 'three';
import type { CharacterHold } from '@aether/core';
import { LocomotionMachine, type ActionName, type ActorInput, type ClipInfo, type Plan, type ResolvedLook } from '@aether/assets';
import { applyLook, LOOK_MAX_PITCH, LOOK_MAX_YAW, solveTwoBone, type LookState } from './ik';
import { buildProp, type Prop } from './props';

/** Foot of a footstep event. */
export type Foot = 'L' | 'R';

/** Construction options of {@link CharacterRig}. */
export interface RigOptions {
  /** A cloned skinned scene (own skeleton, possibly shared materials). */
  scene: Object3D;
  clips: readonly AnimationClip[];
  table: ReadonlyMap<string, ClipInfo>;
  look: ResolvedLook;
  /** +1 when the mesh faces +Z in the file, -1 for -Z. */
  faces: 1 | -1;
  /** Hip height of the body (m) and of the motion set's reference skeleton (m). */
  hip: number;
  motionHip: number;
  castShadow: boolean;
  /** Called when a foot lands (speed in m/s of the body, for volume). */
  onFootstep?: (foot: Foot, speed: number, rig: CharacterRig) => void;
  /** Called when the held prop changes (null: nothing held, or the rig was disposed); effects attach to `prop.flame`. */
  onProp?: (prop: Prop | null, rig: CharacterRig) => void;
}

const _v = new Vector3();
const _v2 = new Vector3();
const _q = new Quaternion();
const _target = new Vector3();
const _pole = new Vector3();

function boneOf(root: Object3D, name: string): Bone | null {
  return (root.getObjectByName(name) as Bone | undefined) ?? null;
}

/** An animated person. */
export class CharacterRig {
  /** Outer group: place it at the feet; forward is −Z. */
  readonly root = new Group();
  /** Inner group: the cast mesh, turned so its face looks along −Z. */
  readonly model = new Group();
  readonly look: ResolvedLook;
  /** The simulation-facing input; fields persist between frames. */
  readonly input: ActorInput = { speed: 0, vy: 0, grounded: true, crouching: false, sprinting: false, talking: false, sitting: false, mood: 'neutral' };
  /** When true the rig estimates speed from `tracked` motion (NPCs); the owner sets `input.speed` otherwise. */
  autoMotion = true;
  /** World point to look at, or null. */
  lookTarget: Vector3 | null = null;
  readonly machine: LocomotionMachine;
  private readonly mixer: AnimationMixer;
  private readonly actions = new Map<string, AnimationAction>();
  private readonly clips = new Map<string, AnimationClip>();
  private current: AnimationAction | null = null;
  private currentName = '';
  private plan: Plan | null = null;
  private tracked: Object3D | null = null;
  private readonly last = new Vector3();
  private primed = false;
  private smoothSpeed = 0;
  private timeScale = 1;
  private readonly lookState: LookState = { yaw: 0, pitch: 0 };
  private readonly bones: {
    root: Bone | null;
    spine: Bone | null;
    neck: Bone | null;
    head: Bone | null;
    lUpper: Bone | null;
    lLower: Bone | null;
    lHand: Bone | null;
    rUpper: Bone | null;
    rLower: Bone | null;
    rHand: Bone | null;
  };
  private prop: Prop | null = null;
  private propHold: CharacterHold = 'none';
  private readonly hipScale: number;
  private rootRestY = 0;
  /** Right arm rotations of the idle pose: a held long prop damps the arm swing toward them. */
  private readonly armRest: Array<{ bone: Bone; q: Quaternion }> = [];
  private footPhase = -1;
  private airBlend = 0;
  private strokeAmp = 0;
  private strokePhase = 0;
  private readonly meshes: Mesh[] = [];
  private shadowOnly = false;
  private swapped = new Map<Mesh, Material | Material[]>();
  private readonly shadowMaterials = new Map<Material, Material>();
  disposed = false;

  constructor(private readonly opts: RigOptions) {
    this.look = opts.look;
    this.model.add(opts.scene);
    this.model.rotation.y = opts.faces === 1 ? Math.PI : 0;
    this.root.add(this.model);
    this.root.name = `character-${opts.look.body.id}`;
    opts.scene.traverse((o) => {
      if (o instanceof Mesh) {
        o.frustumCulled = false;
        o.castShadow = opts.castShadow;
        o.receiveShadow = opts.castShadow;
        this.meshes.push(o);
      }
    });
    for (const c of opts.clips) this.clips.set(c.name, c);
    this.mixer = new AnimationMixer(opts.scene);
    this.machine = new LocomotionMachine(opts.table);
    this.hipScale = opts.motionHip > 0.1 ? opts.hip / opts.motionHip : 1;
    const s = opts.scene;
    this.bones = {
      root: boneOf(s, 'Bip01'),
      spine: boneOf(s, 'Bip01_Spine2'),
      neck: boneOf(s, 'Bip01_Neck'),
      head: boneOf(s, 'Bip01_Head'),
      lUpper: boneOf(s, 'Bip01_L_UpperArm'),
      lLower: boneOf(s, 'Bip01_L_Forearm'),
      lHand: boneOf(s, 'Bip01_L_Hand'),
      rUpper: boneOf(s, 'Bip01_R_UpperArm'),
      rLower: boneOf(s, 'Bip01_R_Forearm'),
      rHand: boneOf(s, 'Bip01_R_Hand'),
    };
    this.rootRestY = this.bones.root?.position.y ?? 0;
    this.input.mood = opts.look.mood;
    this.start();
    this.setHold(opts.look.hold);
    const sc = opts.look.scale;
    if (sc !== 1) this.root.scale.setScalar(sc);
  }

  private action(name: string): AnimationAction | null {
    let a = this.actions.get(name);
    if (a) return a;
    const clip = this.clips.get(name);
    if (!clip) return null;
    a = this.mixer.clipAction(clip);
    this.actions.set(name, a);
    return a;
  }

  private start(): void {
    const a = this.action('idle');
    if (!a) return;
    a.setLoop(LoopRepeat, Infinity).play();
    this.current = a;
    this.currentName = 'idle';
    this.mixer.update(0);
  }

  /** Follow `object`'s world motion to estimate speed (NPCs: the entity node). */
  track(object: Object3D | null): void {
    this.tracked = object;
    this.primed = false;
  }

  /** Request a one-shot action (wave, nod, pick up ...). Returns false when it cannot play now. */
  trigger(action: ActionName): boolean {
    return this.machine.trigger(action);
  }

  /** Name of the clip playing (diagnostics, tests). */
  get clipName(): string {
    return this.currentName;
  }

  /** The state machine's state (diagnostics, tests). */
  get state(): string {
    return this.machine.current;
  }

  /** Smoothed horizontal speed in m/s. */
  get speed(): number {
    return this.smoothSpeed;
  }

  /** Foot-space world position of a bone (head height for bubbles and cameras). */
  headWorld(out: Vector3): Vector3 {
    const h = this.bones.head;
    if (h) return h.getWorldPosition(out);
    return this.root.getWorldPosition(out).setY(out.y + 1.65);
  }

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  /** A pack on the spine: upright and centred on the shoulder blades in the rest pose, then carried by the torso. */
  private mountOnBack(prop: Prop): void {
    const spine = this.bones.spine;
    if (!spine) {
      prop.group.position.set(0, 1.2, 0.2);
      this.root.add(prop.group);
      return;
    }
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    const spineQ = spine.getWorldQuaternion(new Quaternion());
    const rootQ = this.root.getWorldQuaternion(new Quaternion());
    const anchor = new Object3D();
    anchor.quaternion.copy(spineQ.invert()).multiply(rootQ);
    anchor.position.copy(spine.worldToLocal(this.root.localToWorld(_v.set(0, 1.2, 0.2))));
    anchor.add(prop.group);
    spine.add(anchor);
  }

  /** Hold (or put down) a prop. */
  setHold(kind: CharacterHold): void {
    if (kind === this.propHold && (kind === 'none') === (this.prop === null)) return;
    this.mountHold(kind);
    this.opts.onProp?.(this.prop, this);
  }

  private mountHold(kind: CharacterHold): void {
    this.prop?.group.removeFromParent();
    this.prop?.dispose();
    this.prop = null;
    this.propHold = kind;
    const prop = buildProp(kind);
    if (!prop) return;
    this.prop = prop;
    for (const o of prop.group.children) if (o instanceof Mesh) o.castShadow = this.opts.castShadow;
    if (prop.twoHanded) {
      prop.group.position.set(0, 1.14, -0.4);
      this.root.add(prop.group);
      return;
    }
    if (prop.onBack) {
      this.mountOnBack(prop);
      return;
    }
    const hand = this.bones.rHand;
    if (!hand) return;
    // Grip frame: upright (and facing forward) in the idle pose, expressed in the hand bone's frame.
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    this.armRest.length = 0;
    for (const b of [this.bones.rUpper, this.bones.rLower, this.bones.rHand]) if (b) this.armRest.push({ bone: b, q: b.quaternion.clone() });
    const handQ = hand.getWorldQuaternion(new Quaternion());
    const rootQ = this.model.getWorldQuaternion(new Quaternion());
    const tilt = propTilt(this.propHold);
    const want = rootQ.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tilt));
    const anchor = new Object3D();
    anchor.quaternion.copy(handQ.invert()).multiply(want);
    const finger = boneOf(this.opts.scene, 'Bip01_R_Finger2');
    if (finger) anchor.position.copy(hand.worldToLocal(finger.getWorldPosition(_v)));
    anchor.add(prop.group);
    hand.add(anchor);
  }

  // ---------------------------------------------------------------------------
  // First-person: invisible body that still casts a shadow
  // ---------------------------------------------------------------------------

  /** Draw the body (false: only its shadow, e.g. in first person or with the camera inside it). */
  setVisibleBody(visible: boolean): void {
    const shadowOnly = !visible;
    if (shadowOnly === this.shadowOnly) return;
    this.shadowOnly = shadowOnly;
    for (const m of this.meshes) {
      if (shadowOnly) {
        this.swapped.set(m, m.material);
        const swap = (mat: Material): Material => {
          let s = this.shadowMaterials.get(mat);
          if (!s) {
            s = mat.clone();
            s.colorWrite = false;
            s.depthWrite = false;
            this.shadowMaterials.set(mat, s);
          }
          return s;
        };
        m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
      } else {
        const orig = this.swapped.get(m);
        if (orig) m.material = orig;
        this.swapped.delete(m);
      }
    }
    this.prop?.group.traverse((o) => {
      o.visible = !shadowOnly;
    });
  }

  /** True while only the shadow is drawn. */
  get shadowOnlyBody(): boolean {
    return this.shadowOnly;
  }

  // ---------------------------------------------------------------------------
  // Frame update
  // ---------------------------------------------------------------------------

  /**
   * Advance by `dt` seconds. `detail`: 2 = everything, 1 = skip look-at and
   * IK, 0 = mixer only (distant characters).
   */
  update(dt: number, detail: 0 | 1 | 2 = 2): void {
    if (this.disposed || !(dt > 0)) return;
    const step = Math.min(dt, 0.25);
    if (this.autoMotion && this.tracked) {
      this.tracked.getWorldPosition(_v);
      if (this.primed) {
        const dx = _v.x - this.last.x;
        const dz = _v.z - this.last.z;
        const raw = Math.min(30, Math.hypot(dx, dz) / step);
        // A jump larger than any gait is a teleport: do not read it as a sprint.
        const speed = raw > 12 ? 0 : raw;
        this.smoothSpeed += (speed - this.smoothSpeed) * Math.min(1, step * 9);
        this.input.speed = this.smoothSpeed < 0.04 ? 0 : this.smoothSpeed;
      }
      this.last.copy(_v);
      this.primed = true;
    } else this.smoothSpeed = this.input.speed;

    const plan = this.machine.update(step, this.input);
    this.plan = plan;
    if (plan.changed || !this.current) this.transition(plan);
    if (this.current) {
      this.timeScale += (plan.timeScale - this.timeScale) * Math.min(1, step * 10);
      this.current.timeScale = plan.loop && plan.state === 'loco' ? this.timeScale : plan.timeScale;
    }
    this.mixer.update(step);
    if (this.bones.root && this.hipScale !== 1) this.bones.root.position.y = this.bones.root.position.y * this.hipScale;
    this.checkFootsteps();
    this.dampHeldArm(plan.state);
    if (detail >= 1) this.relaxAirArms(plan.state, step);
    if (detail >= 1) this.paddleStroke(plan.state, step);
    if (detail >= 1) {
      this.updateLook(step, detail);
      if (detail >= 2) this.updateCarry();
    }
  }

  /**
   * A person carrying a spear, sword or torch does not swing that arm like a
   * free one: ease the arm toward its idle pose (fully while walking, a
   * little while gesturing) so the prop stays near upright.
   */
  private dampHeldArm(state: string): void {
    if (this.armRest.length === 0 || !this.prop || this.prop.twoHanded) return;
    const w = state === 'loco' || state === 'crouch' ? 0.9 : state === 'talk' || state === 'action' ? 0.35 : 0.6;
    for (const a of this.armRest) a.bone.quaternion.slerp(a.q, w);
  }

  /**
   * The authored jump and fall poses throw the arms out sideways (they read as a T-pose from a chase camera). While airborne
   * bring both upper arms in towards the body by up to 44 degrees, eased in and out, as a person jumping does.
   */
  private relaxAirArms(state: string, dt: number): void {
    const want = state === 'jump' || state === 'air' || state === 'fall' ? 1 : 0;
    this.airBlend += (want - this.airBlend) * Math.min(1, dt * 10);
    const lo = this.bones.lUpper;
    const ro = this.bones.rUpper;
    if (this.airBlend < 0.02 || !lo || !ro) return;
    const k = MathUtils.degToRad(state === 'fall' ? 44 : 32) * this.airBlend;
    this.root.updateWorldMatrix(true, true);
    this.model.getWorldQuaternion(_qm);
    for (const [bone, sign] of [[lo, -1], [ro, 1]] as const) {
      const parent = bone.parent;
      if (!parent) continue;
      parent.getWorldQuaternion(_qp);
      bone.quaternion.copy(armRelaxed(bone.quaternion, _qp, _qm, sign * k));
    }
  }

  /**
   * A seated person holding a paddle paddles while their boat moves: both upper arms swing together, fore and aft, at a pace that
   * rises with the speed (about one stroke every 1.2 s at a walk), and rest when the boat does.
   */
  private paddleStroke(state: string, dt: number): void {
    const paddling = this.propHold === 'paddle' && state === 'sit';
    const want = paddling ? Math.min(1, this.smoothSpeed / 2.2) : 0;
    this.strokeAmp += (want - this.strokeAmp) * Math.min(1, dt * 4);
    if (this.strokeAmp < 0.02) return;
    this.strokePhase += dt * Math.PI * 2 * (0.55 + 0.35 * this.strokeAmp);
    const ro = this.bones.rUpper;
    const lo = this.bones.lUpper;
    if (!ro || !lo) return;
    this.root.updateWorldMatrix(true, true);
    this.model.getWorldQuaternion(_qm);
    const swing = MathUtils.degToRad(26) * this.strokeAmp * Math.sin(this.strokePhase);
    for (const [bone, k] of [[ro, 1], [lo, 0.7]] as const) {
      const parent = bone.parent;
      if (!parent) continue;
      parent.getWorldQuaternion(_qp);
      bone.quaternion.copy(boneTurned(bone.quaternion, _qp, _qm, _xAxis, swing * k));
    }
  }

  private transition(plan: Plan): void {
    const next = this.action(plan.clip) ?? this.action('idle');
    if (!next) return;
    const prev = this.current;
    if (prev === next) return;
    next.reset();
    next.setLoop(plan.loop ? LoopRepeat : LoopOnce, plan.loop ? Infinity : 1);
    next.clampWhenFinished = !plan.loop;
    next.setEffectiveWeight(1);
    next.timeScale = plan.timeScale;
    // Gait to gait: continue from the same point of the cycle so feet stay in step.
    if (prev && plan.loop && prev.getClip().duration > 0) {
      const gait = (n: string): boolean => /^(walk|run|jog|sprint|stroll|crouch_walk)/.test(n);
      if (gait(prev.getClip().name) && gait(next.getClip().name)) next.time = ((prev.time % prev.getClip().duration) / prev.getClip().duration) * next.getClip().duration;
    }
    next.play();
    if (prev) prev.crossFadeTo(next, Math.max(0.04, plan.fade), false);
    this.current = next;
    this.currentName = next.getClip().name;
    this.footPhase = -1;
  }

  private checkFootsteps(): void {
    const cb = this.opts.onFootstep;
    const cur = this.current;
    if (!cb || !cur || !this.plan || !this.input.grounded) return;
    const name = this.currentName;
    if (!/^(walk|run|jog|sprint|stroll|crouch_walk)/.test(name) || this.smoothSpeed < 0.3) return;
    const info = this.opts.table.get(name);
    const contacts = info?.contacts;
    if (!contacts || contacts.length === 0) return;
    const dur = cur.getClip().duration;
    const phase = (cur.time % dur) / dur;
    const prev = this.footPhase;
    this.footPhase = phase;
    if (prev < 0) return;
    for (const c of contacts) {
      const at = c[0] as number;
      const crossed = prev <= phase ? prev < at && phase >= at : prev < at || phase >= at;
      if (crossed) cb(c[1] === 0 ? 'L' : 'R', this.smoothSpeed, this);
    }
  }

  private updateLook(dt: number, detail: number): void {
    const head = this.bones.head;
    const target = this.lookTarget;
    let wantYaw = 0;
    let wantPitch = 0;
    if (head && target && !this.machine.isDead) {
      this.root.updateWorldMatrix(true, false);
      const e = this.root.matrixWorld.elements;
      const bodyYaw = Math.atan2(e[8] as number, e[10] as number);
      head.getWorldPosition(_v2);
      const dx = target.x - _v2.x;
      const dz = target.z - _v2.z;
      const horiz = Math.hypot(dx, dz);
      if (horiz > 0.15) {
        const fx = -Math.sin(bodyYaw);
        const fz = -Math.cos(bodyYaw);
        const yaw = Math.atan2(fz * dx - fx * dz, fx * dx + fz * dz);
        if (Math.abs(yaw) < MathUtils.degToRad(120)) {
          wantYaw = MathUtils.clamp(yaw, -LOOK_MAX_YAW, LOOK_MAX_YAW);
          wantPitch = MathUtils.clamp(Math.atan2(target.y - _v2.y, horiz), -LOOK_MAX_PITCH, LOOK_MAX_PITCH);
        }
      }
      this.lookState.yaw += (wantYaw - this.lookState.yaw) * Math.min(1, dt * 6);
      this.lookState.pitch += (wantPitch - this.lookState.pitch) * Math.min(1, dt * 6);
      if (detail >= 1) applyLook(this.bones, this.lookState, bodyYaw);
      return;
    }
    this.lookState.yaw *= Math.max(0, 1 - dt * 6);
    this.lookState.pitch *= Math.max(0, 1 - dt * 6);
    if (Math.abs(this.lookState.yaw) > 1e-3 && head) {
      this.root.updateWorldMatrix(true, false);
      const e = this.root.matrixWorld.elements;
      applyLook(this.bones, this.lookState, Math.atan2(e[8] as number, e[10] as number));
    }
  }

  private updateCarry(): void {
    const prop = this.prop;
    if (!prop || !prop.twoHanded) return;
    const b = this.bones;
    if (!b.lUpper || !b.lLower || !b.lHand || !b.rUpper || !b.rLower || !b.rHand) return;
    this.root.updateWorldMatrix(true, true);
    const sc = this.root.scale.x;
    // Hands on the sides of the box, elbows out and down.
    for (const side of [1, -1] as const) {
      _target.set(side * 0.22 * sc, 1.14 * sc, -0.4 * sc);
      this.root.localToWorld(_target);
      _pole.set(side * 0.62 * sc, 0.85 * sc, -0.1 * sc);
      this.root.localToWorld(_pole);
      if (side === 1) solveTwoBone(b.lUpper, b.lLower, b.lHand, _target, _pole, 1);
      else solveTwoBone(b.rUpper, b.rLower, b.rHand, _target, _pole, 1);
    }
  }

  /** Release the mixer, the prop and the swapped materials. Geometry and textures belong to the model cache. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.opts.scene);
    if (this.prop) this.opts.onProp?.(null, this);
    this.prop?.group.removeFromParent();
    this.prop?.dispose();
    for (const m of this.shadowMaterials.values()) m.dispose();
    this.shadowMaterials.clear();
    this.root.removeFromParent();
  }
}

const _qm = new Quaternion();
const _qmi = new Quaternion();
const _qp = new Quaternion();
const _qpi = new Quaternion();
const _qd = new Quaternion();
const _zAxis = new Vector3(0, 0, 1);
const _xAxis = new Vector3(1, 0, 0);

/**
 * The local rotation of a bone after turning it by `angle` radians about the model-space `axis` (a unit vector in the model's
 * frame: +X the character's left, +Y up, +Z forward) as seen in world space: `local' = P^-1 * D * P * local`, with `P` the
 * parent's world rotation, `M` the model's world rotation and `D = M * R(axis, angle) * M^-1`. Returns a shared scratch
 * quaternion (copy it before the next call).
 */
export function boneTurned(local: Quaternion, parentWorld: Quaternion, modelWorld: Quaternion, axis: Vector3, angle: number): Quaternion {
  _qd.setFromAxisAngle(axis, angle).premultiply(modelWorld).multiply(_qmi.copy(modelWorld).invert());
  _qpi.copy(parentWorld).invert();
  return _qd.premultiply(_qpi).multiply(parentWorld).multiply(local);
}

/** {@link boneTurned} about the model's forward axis: an arm swung in towards (or out from) the body. */
export function armRelaxed(local: Quaternion, parentWorld: Quaternion, modelWorld: Quaternion, angle: number): Quaternion {
  return boneTurned(local, parentWorld, modelWorld, _zAxis, angle);
}

function propTilt(kind: CharacterHold): number {
  switch (kind) {
    case 'sword':
      return -0.5;
    case 'axe':
      return -0.3;
    case 'torch':
    case 'lantern':
      return -0.2;
    case 'book':
      return Math.PI / 2 - 0.4;
    case 'paddle':
      return -0.5;
    default:
      return 0;
  }
}
