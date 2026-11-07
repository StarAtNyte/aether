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
import { applyLook, LookController, solveTwoBone, type LookState } from './ik';
import { disposeModelInstance } from '../geometry/model-loader';
import { buildProp, type Prop } from './props';
import { buildGear, disposeGear, fitBody, type GearPiece } from './gear';
import { contactShadow } from './surface';
import { SpringSystem, type ColliderDef, type SpringChainDef } from './springs';
import { BodyLevels, isFarLevel } from './lod';
import { airPoseOf, ArmSpring, jumpArmTarget, jumpClipPhase, landKeep, PELVIS_ABOVE_SEAT, seatBlendOf } from './motion';

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
  /** A toon body: its spring chains (hair, skirt) and their colliders, from the body file. */
  toon?: { springs: readonly SpringChainDef[]; colliders: readonly ColliderDef[] };
  /** The far level's meshes are dithered in and out (their materials read `lodDitherMask`); else they switch at once. */
  ditherLevels?: boolean;
}

/** A toon body's arms out from the clip's (radians, about 6 degrees): the hands clear the pleated skirt. */
const TOON_ARM_CLEARANCE = 0.11;
/** How far a standing toon body's head returns to rest from the idle clip's glances. */
const TOON_HEAD_STEADY = 0.8;
const _v = new Vector3();
const _v2 = new Vector3();
const _q = new Quaternion();
const _target = new Vector3();
const _pole = new Vector3();
const _target2 = new Vector3();

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
  /**
   * The walkable height under a point (world x, z; `y` a hint of the height near it), or null where nothing is known:
   * when set, the feet are placed on it (stair treads, slopes) with the pelvis lowered so the lower foot reaches, and the
   * swing of each foot kept above its own ground. Absent: the feet stay where the clip puts them.
   */
  ground: ((x: number, z: number, y: number) => number | null) | null = null;
  /** Facial expressions (morph targets by name): eased current and target weights. */
  private readonly expressions = new Map<string, { cur: number; want: number }>();
  /** Meshes of the body that carry morph targets. */
  private morphMeshes: Mesh[] | null = null;

  /**
   * Ease a facial expression (a morph target of the body by name: `smile`, `sad`, `teary`…) to `weight` over about a
   * fifth of a second. A body without that morph ignores it.
   */
  setExpression(name: string, weight: number): void {
    const e = this.expressions.get(name) ?? { cur: 0, want: 0 };
    e.want = Math.max(0, Math.min(1, weight));
    this.expressions.set(name, e);
  }

  private updateExpressions(dt: number): void {
    if (this.expressions.size === 0) return;
    if (!this.morphMeshes) {
      this.morphMeshes = [];
      this.opts.scene.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh && m.morphTargetDictionary && m.morphTargetInfluences) this.morphMeshes!.push(m);
      });
    }
    const k = 1 - Math.exp(-Math.max(0, dt) / 0.07);
    for (const [name, e] of this.expressions) {
      e.cur += (e.want - e.cur) * k;
      const meshes: Mesh[] = this.morphMeshes;
      for (const mesh of meshes) {
        const slot: number | undefined = mesh.morphTargetDictionary?.[name];
        const inf: number[] | undefined = mesh.morphTargetInfluences;
        if (slot !== undefined && inf) inf[slot] = e.cur;
      }
    }
  }

  /** A toon body's arms hang this far (radians) out from the clip's, so the hands clear a flared skirt. */
  armClearance = 0;
  /** 0..1: how far a toon body's head and neck are eased back to their rest while standing (the clip's glances). */
  headSteady = 0;
  /**
   * Hips turned away from the chest (radians, about up) toward where the body walks while the facing is imposed (a player
   * strafing with a gun): the legs step that way, the chest and the gun stay on the aim. 0 for everyone else.
   */
  hipYaw = 0;
  /** Walking backwards with the facing imposed: the gait plays in reverse. */
  backward = false;
  /** Aim pitch (radians, positive up) of a shouldered gun: the chest bends and the gun pitches with it. */
  aimPitch = 0;
  /** The trigger is held: a crouched body raises a shouldered gun from low ready to the aim. */
  aiming = false;
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
  /** Smoothed, limited gaze (see {@link LookController}). */
  readonly gaze = new LookController();
  private readonly bones: {
    root: Bone | null;
    spine: Bone | null;
    spine1: Bone | null;
    neck: Bone | null;
    head: Bone | null;
    lUpper: Bone | null;
    lLower: Bone | null;
    lHand: Bone | null;
    rUpper: Bone | null;
    rLower: Bone | null;
    rHand: Bone | null;
    lThigh: Bone | null;
    lCalf: Bone | null;
    lFoot: Bone | null;
    rThigh: Bone | null;
    rCalf: Bone | null;
    rFoot: Bone | null;
    pelvis: Bone | null;
  };
  /** Every bone with the pose the mixer last left it in (before any correction): see {@link restoreClean}. */
  private readonly allBones: Object3D[] = [];
  /** Every bone's bind rotation (the order of {@link allBones}). */
  private restQ = new Float32Array(0);
  private cleanQ: Float32Array = new Float32Array(0);
  private cleanP: Float32Array = new Float32Array(0);
  private cleanS: Float32Array = new Float32Array(0);
  private cleanReady = false;
  private prop: Prop | null = null;
  private propHold: CharacterHold = 'none';
  private readonly hipScale: number;
  private rootRestY = 0;
  /** Right arm rotations of the idle pose: a held long prop damps the arm swing toward them. */
  private readonly armRest: Array<{ bone: Bone; q: Quaternion }> = [];
  /** Height of the ankle joint above the sole in the rest pose (m, scaled). */
  private ankleRest = 0.1;
  /** Top of the seat above the rig's feet (m) while the person sits, or null: the pelvis settles onto it. */
  seatTop: number | null = null;
  /** World point under the pelvis on the seat surface (y = the surface): placed bodies that are not at the seat's origin (NPCs). Overrides `seatTop`. */
  seatAnchor: Vector3 | null = null;
  private seatBlend = 0;
  private wasGrounded = true;
  private airT = 0;
  private peakUp = 0;
  private minVy = 0;
  private lastVy = 0;
  private kick = 0;
  private launchY = 0;
  private impact = 0;
  private landSide = 1;
  private footPhase = -1;
  private airBlend = 0;
  private readonly armSpring = new ArmSpring();
  private clipPhase = 0;
  private strokeAmp = 0;
  private strokePhase = 0;
  private readonly meshes: Mesh[] = [];
  /** Toon outline hulls (hidden far away). */
  private readonly outlines: Mesh[] = [];
  /** The body's two levels of detail (null: the body has only one; see `lod.ts`). */
  readonly levels: BodyLevels | null = null;
  /** Hair and skirt springs of a toon body. */
  readonly springs: SpringSystem | null = null;
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
        // A toon outline hull never casts or takes a shadow.
        const hull = o.userData['toonOutline'] === true;
        o.castShadow = opts.castShadow && !hull;
        o.receiveShadow = opts.castShadow && !hull;
        if (hull) this.outlines.push(o);
        this.meshes.push(o);
      }
    });
    const far = this.meshes.filter(isFarLevel);
    if (far.length > 0) {
      const near = this.meshes.filter((m) => !isFarLevel(m));
      this.levels = new BodyLevels(near, far, (m) => m.userData['toonOutline'] === true, opts.ditherLevels ?? false);
      // Expressions are morphs of the near level only.
    }
    if (opts.toon && opts.toon.springs.length > 0) this.springs = new SpringSystem(opts.scene, opts.toon.springs, opts.toon.colliders);
    if (opts.toon) {
      this.armClearance = TOON_ARM_CLEARANCE;
      this.headSteady = TOON_HEAD_STEADY;
    }
    this.blob = contactShadow();
    this.root.add(this.blob);
    for (const c of opts.clips) this.clips.set(c.name, c);
    this.mixer = new AnimationMixer(opts.scene);
    this.machine = new LocomotionMachine(opts.table);
    this.hipScale = opts.motionHip > 0.1 ? opts.hip / opts.motionHip : 1;
    const s = opts.scene;
    this.bones = {
      root: boneOf(s, 'Bip01'),
      spine: boneOf(s, 'Bip01_Spine2'),
      spine1: boneOf(s, 'Bip01_Spine1'),
      neck: boneOf(s, 'Bip01_Neck'),
      head: boneOf(s, 'Bip01_Head'),
      lUpper: boneOf(s, 'Bip01_L_UpperArm'),
      lLower: boneOf(s, 'Bip01_L_Forearm'),
      lHand: boneOf(s, 'Bip01_L_Hand'),
      rUpper: boneOf(s, 'Bip01_R_UpperArm'),
      rLower: boneOf(s, 'Bip01_R_Forearm'),
      rHand: boneOf(s, 'Bip01_R_Hand'),
      lThigh: boneOf(s, 'Bip01_L_Thigh'),
      lCalf: boneOf(s, 'Bip01_L_Calf'),
      lFoot: boneOf(s, 'Bip01_L_Foot'),
      rThigh: boneOf(s, 'Bip01_R_Thigh'),
      rCalf: boneOf(s, 'Bip01_R_Calf'),
      rFoot: boneOf(s, 'Bip01_R_Foot'),
      pelvis: boneOf(s, 'Bip01_Pelvis'),
    };
    this.rootRestY = this.bones.root?.position.y ?? 0;
    s.traverse((o) => {
      // Bones and the plain nodes above them (the skeleton's root node is animated and hip-scaled too).
      if (o !== s && !(o as Mesh).isMesh) this.allBones.push(o as Bone);
    });
    this.cleanQ = new Float32Array(this.allBones.length * 4);
    this.restQ = new Float32Array(this.allBones.length * 4);
    for (let i = 0; i < this.allBones.length; i++) (this.allBones[i] as Object3D).quaternion.toArray(this.restQ, i * 4);
    this.cleanP = new Float32Array(this.allBones.length * 3);
    this.cleanS = new Float32Array(this.allBones.length * 3);
    this.input.mood = opts.look.mood;
    this.start();
    this.setHold(opts.look.hold);
    this.mountGear();
    const sc = opts.look.scale;
    if (sc !== 1) this.root.scale.setScalar(sc);
    this.root.updateMatrixWorld(true);
    this.pelvisRestY = this.bones.pelvis ? this.root.worldToLocal(this.bones.pelvis.getWorldPosition(_v)).y / Math.max(0.01, sc) : 0;
    const foot = this.bones.lFoot;
    if (foot) this.ankleRest = foot.getWorldPosition(_v).y - this.root.getWorldPosition(_v2).y;
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

  /** Worn gear pieces (helmet, vest ...), each under the bone that carries it. */
  private gear: GearPiece[] = [];
  /** The contact shadow under the feet. */
  private blob: Object3D | null = null;
  /** Detail the small pieces were last shown at (-1: not yet). */
  private shownDetail = -1;

  /** Far away (detail 0) the small pieces go: shoulder and groin plates and the contact shadow; head and torso gear stay. */
  private showDetail(detail: number): void {
    const near = detail > 0;
    if ((this.shownDetail > 0) === near && this.shownDetail >= 0) return;
    this.shownDetail = detail;
    if (this.blob) this.blob.visible = near;
    if (this.levels) this.levels.setOutlines(near);
    else for (const o of this.outlines) o.visible = near;
    if (this.shadowOnly) return;
    for (const g of this.gear) if (g.bone !== 'head' && g.bone !== 'spine') g.group.visible = near;
  }

  /** Fit the look's gear to this body in its rest pose and hang each piece on its bone (see `gear.ts`). */
  private mountGear(): void {
    const gear = this.opts.look.gear ?? [];
    if (gear.length === 0 || !this.bones.spine) return;
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    const spineY = this.root.worldToLocal(this.bones.spine.getWorldPosition(new Vector3())).y;
    const fit = fitBody(this.opts.scene, this.root, spineY);
    if (!fit) return;
    const rootQ = this.root.getWorldQuaternion(new Quaternion());
    const rootS = this.root.getWorldScale(new Vector3());
    for (const piece of buildGear(gear, fit, this.opts.look.wardrobe ?? 'casual')) {
      const bone = this.bones[piece.bone];
      if (!bone) {
        disposeGear([piece]);
        continue;
      }
      const anchor = new Object3D();
      anchor.name = `anchor-${piece.group.name}`;
      anchor.quaternion.copy(bone.getWorldQuaternion(new Quaternion()).invert()).multiply(rootQ);
      anchor.scale.copy(rootS).divide(bone.getWorldScale(new Vector3()));
      anchor.position.copy(bone.worldToLocal(this.root.localToWorld(new Vector3(0, 0, 0))));
      for (const o of piece.group.children) if (o instanceof Mesh) o.castShadow = o.receiveShadow = this.opts.castShadow;
      anchor.add(piece.group);
      bone.add(anchor);
      this.gear.push(piece);
    }
    // Hair cards would poke through a close head cover: hide them under a helmet or a beanie.
    if (gear.includes('helmet') || gear.includes('beanie')) {
      for (const m of this.meshes) {
        const name = (Array.isArray(m.material) ? m.material[0]?.name : m.material.name) ?? '';
        if (/hair/i.test(name)) {
          m.visible = false;
          m.userData['gearHidden'] = true;
        }
      }
    }
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
    for (const o of prop.group.children) if (o instanceof Mesh) o.castShadow = o.receiveShadow = this.opts.castShadow;
    if (prop.twoHanded) {
      prop.group.position.set(0, 1.14, -0.4);
      this.root.add(prop.group);
      return;
    }
    if (prop.onBack) {
      this.mountOnBack(prop);
      return;
    }
    if (prop.shouldered) {
      // At the ready: the grip in front of the right shoulder, the muzzle forward and a little down.
      this.mixer.update(0);
      this.root.updateMatrixWorld(true);
      const hand = this.bones.rHand;
      const side = hand ? Math.sign(this.root.worldToLocal(hand.getWorldPosition(new Vector3())).x) || 1 : 1;
      prop.group.position.set(side * GUN_AT[0], GUN_AT[1], GUN_AT[2]);
      prop.group.rotation.set(GUN_TILT, 0, 0);
      this.neckRef = null;
      this.root.add(prop.group);
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
    // Worn gear goes with the body (a helmet would otherwise sit in front of a first-person camera).
    for (const g of this.gear) g.group.visible = !shadowOnly && (this.shownDetail !== 0 || g.bone === 'head' || g.bone === 'spine');
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
    this.showDetail(detail);
    if (this.disposed || !(dt > 0)) return;
    const step = Math.min(dt, 0.25);
    this.lastStep = step;
    if (this.autoMotion && this.tracked) {
      this.tracked.getWorldPosition(_v);
      if (this.primed) {
        const dx = _v.x - this.last.x;
        const dz = _v.z - this.last.z;
        const raw = Math.min(30, Math.hypot(dx, dz) / step);
        // A jump larger than any gait is a teleport: do not read it as a sprint.
        const speed = raw > 12 ? 0 : raw;
        // About a 0.2 s time constant whatever the step (a body posing on twos steps at 12 Hz).
        this.smoothSpeed += (speed - this.smoothSpeed) * (1 - Math.exp(-step / 0.2));
        this.input.speed = this.smoothSpeed < 0.04 ? 0 : this.smoothSpeed;
      }
      this.last.copy(_v);
      this.primed = true;
    } else this.smoothSpeed = this.input.speed;

    const plan = this.machine.update(step, this.input);
    this.plan = plan;
    if (this.forced) {
      // A clip played by name holds until it is stopped.
    } else if (plan.changed || !this.current || this.forceReplan) {
      this.forceReplan = false;
      this.transition(plan);
    }
    if (this.current && !this.forced) {
      this.timeScale += (plan.timeScale - this.timeScale) * Math.min(1, step * 10);
      this.current.timeScale = plan.loop && plan.state === 'loco' ? this.timeScale : plan.timeScale;
      // Backing off with the facing imposed: the gait runs backwards (the clip's own stride, the other way).
      if (this.backward && plan.loop && GAIT.test(this.currentName)) this.current.timeScale = -Math.abs(this.current.timeScale);
      // The jump clip plays once through the arc (take-off, apex, touch-down) at the pace of the physics, not wall time.
      if (this.currentName === 'jump_air' && !this.input.grounded && (plan.state === 'jump' || plan.state === 'air')) {
        this.clipPhase = jumpClipPhase(this.input.vy, this.peakUp, this.clipPhase);
        this.current.timeScale = 0;
        this.current.time = Math.min(0.999, this.clipPhase) * this.current.getClip().duration;
      }
    }
    this.restoreClean();
    this.mixer.update(step);
    this.saveClean();
    if (this.bones.root && this.hipScale !== 1) this.bones.root.position.y = this.bones.root.position.y * this.hipScale;
    this.checkFootsteps();
    this.dampHeldArm(plan.state);
    if (detail >= 1) this.turnHipsAndChest(plan.state, step);
    this.model.position.set(0, 0, 0);
    this.airArms = 0;
    this.trackAir(step);
    if (detail >= 1) this.applyBodyPose(plan.state, step);
    if (detail >= 1) this.relaxAirArms(plan.state, step);
    if (detail >= 1) this.paddleStroke(plan.state, step);
    if (detail >= 1) this.toonPose(plan.state);
    if (detail >= 1) this.updateExpressions(step);
    if (detail >= 2 && this.ground) this.groundFeet(plan.state, step);
    else this.feetPrimed = false;
    if (detail >= 1) {
      this.updateLook(step, detail);
      if (detail >= 2) this.updateCarry();
    }
    if (this.springs) {
      if (detail >= 1) {
        this.root.updateMatrixWorld(true);
        this.springs.update(step);
      } else this.springs.reset();
    }
  }

  /**
   * Play a named clip of the motion set now (`wave`, `jump_start`, `sit`, `idle_look` ...): one-shot actions known to the
   * state machine go through it and return to locomotion; any other clip is played directly, once or looping, until
   * {@link stopClip}. Returns false when the clip does not exist.
   */
  playClip(name: string, opts: { loop?: boolean; fade?: number; timeScale?: number } = {}): boolean {
    if (this.machine.trigger(name as ActionName)) return true;
    const a = this.action(name);
    if (!a) return false;
    const fade = opts.fade ?? 0.25;
    a.reset();
    a.setLoop(opts.loop ? LoopRepeat : LoopOnce, opts.loop ? Infinity : 1);
    a.clampWhenFinished = !opts.loop;
    a.timeScale = opts.timeScale ?? 1;
    a.enabled = true;
    a.setEffectiveWeight(1);
    a.play();
    if (this.current && this.current !== a) this.current.crossFadeTo(a, fade, false);
    this.forced = a;
    this.current = a;
    this.currentName = name;
    return true;
  }

  /** End a clip started with {@link playClip}: locomotion takes over again. */
  stopClip(): void {
    this.forced = null;
    this.plan = null;
    this.forceReplan = true;
  }

  private forced: AnimationAction | null = null;
  private forceReplan = false;

  /**
   * The mixer only writes a bone when the animated value changed since its last write (a static pose such as the
   * jump or fall pose is written once). Corrections made after the mixer (look-at, arm relax, hip scale) would then
   * pile up on the bone every frame: the head turns on and on and the body scales away. So the bones are put back
   * to the clean animated pose before the mixer runs, and the clean pose is saved right after it.
   */
  private restoreClean(): void {
    if (!this.cleanReady) return;
    const b = this.allBones;
    for (let i = 0; i < b.length; i++) {
      const bone = b[i] as Object3D;
      bone.quaternion.set(this.cleanQ[i * 4] as number, this.cleanQ[i * 4 + 1] as number, this.cleanQ[i * 4 + 2] as number, this.cleanQ[i * 4 + 3] as number);
      bone.position.set(this.cleanP[i * 3] as number, this.cleanP[i * 3 + 1] as number, this.cleanP[i * 3 + 2] as number);
      bone.scale.set(this.cleanS[i * 3] as number, this.cleanS[i * 3 + 1] as number, this.cleanS[i * 3 + 2] as number);
    }
  }

  private saveClean(): void {
    const b = this.allBones;
    for (let i = 0; i < b.length; i++) {
      const bone = b[i] as Object3D;
      bone.quaternion.toArray(this.cleanQ, i * 4);
      bone.position.toArray(this.cleanP, i * 3);
      bone.scale.toArray(this.cleanS, i * 3);
    }
    this.cleanReady = true;
  }

  /** Air bookkeeping from what the simulation published: take-off point, peak climb, impact speed, a second jump. */
  private trackAir(dt: number): void {
    const inp = this.input;
    if (!inp.grounded) {
      if (this.wasGrounded) {
        this.airT = 0;
        this.clipPhase = 0;
        this.peakUp = 0;
        this.minVy = 0;
        this.kick = 0;
        this.launchY = this.root.getWorldPosition(_v).y;
      }
      this.airT += dt;
      // A fresh upward burst in mid-air is a second jump.
      if (!this.wasGrounded && inp.vy > this.lastVy + 2.2 && inp.vy > 2 && this.airT > 0.12) {
        this.kick = 1;
        this.peakUp = inp.vy;
        this.airT = 0.14;
      }
      this.peakUp = Math.max(this.peakUp, inp.vy);
      this.minVy = Math.min(this.minVy, inp.vy);
      this.kick = Math.max(0, this.kick - dt * 2.4);
    } else if (!this.wasGrounded) {
      this.impact = Math.max(0, -this.minVy);
      this.landSide = -this.landSide;
    }
    this.lastVy = inp.vy;
    this.wasGrounded = inp.grounded;
  }

  /**
   * The body shaping that sits on top of the captured clips and follows physics and furniture: seat placement, feet on
   * the floor, hands on the lap, the push-off, tuck and landing of a jump. Idempotent per frame (see {@link restoreClean}).
   */
  private applyBodyPose(state: string, dt: number): void {
    const b = this.bones;
    const sc = this.root.scale.x;
    // Seat.
    const rawSeat = this.seatTop === null && this.seatAnchor === null ? 0 : seatBlendOf(state, this.current?.time ?? 0);
    this.seatBlend += (rawSeat - this.seatBlend) * Math.min(1, dt * 14);
    if (this.seatBlend < 0.002) this.seatBlend = 0;
    const airborne = state === 'jump' || state === 'air' || state === 'fall';
    const landing = state === 'land';
    const pose = airborne ? airPoseOf(this.input.vy, this.peakUp, this.airT, this.kick) : null;
    // Everything eases in and out so crossfades between clips never meet a popping correction.
    const ease = Math.min(1, dt * (airborne ? 22 : 14));
    this.hipS += ((pose?.hipFlex ?? 0) - this.hipS) * ease;
    this.kneeS += ((pose?.kneeFlex ?? 0) - this.kneeS) * ease;
    this.plantS += ((pose ? pose.plant : landing ? 1 : 0) - this.plantS) * Math.min(1, dt * 18);
    this.landS += ((landing ? 1 : 0) - this.landS) * Math.min(1, dt * 16);
    // The crouch eases in and out over about 0.4 s (smoothstep of a linear ramp: no lurch at either end).
    const crouchWant = state === 'crouch' && this.input.crouching && this.input.grounded ? 1 : 0;
    this.crouchT = Math.max(0, Math.min(1, this.crouchT + (crouchWant ? 1 : -1) * dt / CROUCH_TIME));
    const crouch = this.crouchT * this.crouchT * (3 - 2 * this.crouchT);
    if (this.hipS < 0.002) this.hipS = 0;
    if (this.kneeS < 0.002) this.kneeS = 0;
    if (this.plantS < 0.01) this.plantS = 0;
    if (this.landS < 0.01) this.landS = 0;
    if (this.seatBlend === 0 && this.hipS === 0 && this.kneeS === 0 && this.plantS === 0 && this.landS === 0 && crouch === 0) return;
    this.root.updateWorldMatrix(true, true);
    const rootY = this.root.getWorldPosition(_v).y;
    if (this.seatBlend > 0 && (this.seatTop !== null || this.seatAnchor !== null) && b.pelvis) {
      b.pelvis.getWorldPosition(_v2);
      this.root.worldToLocal(_v2);
      // Where the pelvis should end up, in the rig's own frame.
      let tx = 0;
      let tz = 0;
      let top = this.seatTop ?? 0;
      if (this.seatAnchor) {
        _target2.copy(this.seatAnchor);
        this.root.worldToLocal(_target2);
        tx = _target2.x;
        tz = _target2.z;
        top = this.seatAnchor.y - rootY;
      }
      const target = top + PELVIS_ABOVE_SEAT * sc;
      this.model.position.set(this.seatBlend * (tx - _v2.x), this.seatBlend * (target - _v2.y), this.seatBlend * (tz - _v2.z));
      this.root.updateWorldMatrix(false, true);
      this.plantFeet(rootY, this.seatBlend);
      if (!this.prop && this.seatBlend > 0.4) this.handsOnLap(this.seatBlend * 0.9);
    }
    if (crouch > 0 && this.seatBlend === 0) this.crouchLayer(crouch, sc);
    if (this.landS > 0 && b.pelvis) {
      // The captured landing crouch is deep: a hop keeps a share of it, a drop all of it; the planted feet bend the knees the rest.
      const rest = this.pelvisRest(sc);
      b.pelvis.getWorldPosition(_v2);
      this.root.worldToLocal(_v2);
      const deficit = Math.max(0, rest - _v2.y);
      const keep = landKeep(this.impact);
      this.model.position.x += this.landS * 0.14 * deficit * this.landSide * (1 - keep * 0.5);
      this.model.position.y += this.landS * (1 - keep) * deficit;
      this.root.updateWorldMatrix(false, true);
    }
    if (this.hipS > 0 || this.kneeS > 0) this.legPose(this.hipS, this.kneeS);
    if (pose) this.airArms = pose.armSwing;
    if (this.plantS > 0) {
      this.root.updateWorldMatrix(false, true);
      this.plantFeet(airborne ? this.launchY : rootY, airborne ? this.plantS : this.plantS * (1 - landKeep(this.impact) * 0.4));
    }
  }

  private crouchT = 0;

  /**
   * A crouch laid over the standing idle or walk: the hips sink and go back a little, the knees bend so each foot stays where
   * the clip put it (a walk keeps its steps and lifts, a stand keeps its soles flat), the back leans forward and the neck
   * comes back up so the eyes stay level. Standing still the feet also part into a fighting stance (the left a step forward,
   * the right back on its toes) so the crouch reads as a kneel-ready soldier, not a squat; a step lifts each foot on the way.
   * `w` is the eased crouch amount (0..1).
   */
  private crouchLayer(w: number, sc: number): void {
    const b = this.bones;
    const legs = [[b.lThigh, b.lCalf, b.lFoot], [b.rThigh, b.rCalf, b.rFoot]] as const;
    this.root.updateWorldMatrix(true, true);
    let i = 0;
    for (const [, , foot] of legs) {
      if (!foot) continue;
      foot.getWorldPosition(_feet[i] as Vector3);
      foot.getWorldQuaternion(_feetQ[i] as Quaternion);
      i++;
    }
    this.model.position.y -= CROUCH_DROP * sc * w;
    this.model.position.z += CROUCH_BACK * sc * w;
    this.root.updateWorldMatrix(false, true);
    this.model.getWorldQuaternion(_qm);
    for (const [bone, angle] of [[b.spine1, CROUCH_LEAN * 0.6], [b.spine, CROUCH_LEAN * 0.4], [b.neck, -CROUCH_LEAN * 0.8]] as const) {
      if (!bone) continue;
      bone.parent?.getWorldQuaternion(_qp);
      bone.quaternion.copy(boneTurned(bone.quaternion, _qp, _qm, _xAxis, angle * w));
      bone.updateWorldMatrix(false, true);
    }
    const e = this.root.matrixWorld.elements;
    const yaw = Math.atan2(e[8] as number, e[10] as number) + this.hipYaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    // The stance opens only at rest (a walk keeps the clip's steps), eased with the crouch and with the speed.
    const still = Math.max(0, Math.min(1, 1 - this.smoothSpeed / 0.6));
    const target = w * still;
    this.stanceS += (target - this.stanceS) * Math.min(1, this.lastStep * 9);
    const st = this.stanceS;
    // Lift of a foot that is moving to its stance place (0 at both ends of the move).
    const lift = Math.abs(target - st) > 0.01 ? Math.sin(Math.PI * st) * 0.07 * sc : 0;
    i = 0;
    for (const [thigh, calf, foot] of legs) {
      if (!foot) continue;
      const at = _feet[i] as Vector3;
      const q = _feetQ[i] as Quaternion;
      const lead = i === 0;
      i++;
      if (!thigh || !calf) continue;
      if (st > 0) {
        const d = (lead ? STANCE_FORWARD : -STANCE_BACK) * sc * st;
        at.x += fx * d;
        at.z += fz * d;
        // The rear foot stands on its toes: the ankle rises.
        at.y += (lead ? lift : lift + STANCE_HEEL * sc * st);
      }
      calf.getWorldPosition(_pole);
      _pole.x += fx * 0.6;
      _pole.z += fz * 0.6;
      solveTwoBone(thigh, calf, foot, at, _pole, 1);
      // The sole keeps the angle the clip gave it (the rear foot pitched onto its toes).
      calf.updateWorldMatrix(true, false);
      calf.getWorldQuaternion(_qp);
      foot.quaternion.copy(_qp.invert().multiply(q));
      if (!lead && st > 0) {
        foot.updateWorldMatrix(false, false);
        foot.parent?.getWorldQuaternion(_qp);
        foot.quaternion.copy(boneTurned(foot.quaternion, _qp, _qm, _xAxis, STANCE_TOES * st));
      }
      foot.updateWorldMatrix(false, true);
    }
  }

  private stanceS = 0;
  private lowReady = 0;

  private hipS = 0;
  private kneeS = 0;
  private plantS = 0;
  private landS = 0;

  private airArms = 0;
  private pelvisRestY = 0;

  /**
   * A toon body's corrections after the clip: the arms a little out from the body (the motion set was made for a slimmer
   * silhouette than a pleated skirt), and, standing, the head and neck eased toward their rest so an idle clip's glances
   * do not turn the head on its own in a held close-up (the look-at still turns it, within its limits).
   */
  private toonPose(state: string): void {
    const b = this.bones;
    const standing = state === 'loco' && this.smoothSpeed < 0.05;
    if (this.armClearance > 0 && !this.forced && state !== 'sit' && state !== 'sit_down' && state !== 'stand_up') {
      this.root.updateWorldMatrix(true, true);
      this.model.getWorldQuaternion(_qm);
      for (const [bone, sign] of [[b.lUpper, 1], [b.rUpper, -1]] as const) {
        const parent = bone?.parent;
        if (!bone || !parent) continue;
        parent.getWorldQuaternion(_qp);
        bone.quaternion.copy(armRelaxed(bone.quaternion, _qp, _qm, sign * this.armClearance));
      }
    }
    if (this.headSteady > 0 && standing && !this.forced) {
      for (const [bone, k] of [[b.neck, 0.7], [b.head, 1]] as const) {
        if (!bone) continue;
        const i = this.allBones.indexOf(bone as Bone);
        if (i < 0) continue;
        _q.fromArray(this.restQ, i * 4);
        bone.quaternion.slerp(_q, this.headSteady * k);
      }
    }
  }

  /** Feet placement state: the eased height offset of each foot and the pelvis drop (m). */
  private readonly feetOff = [0, 0];
  private feetDrop = 0;
  private feetPrimed = false;

  /**
   * Feet on uneven ground ({@link ground}): each ankle is moved by the height of the ground under it relative to the
   * ground under the body, the pelvis drops by the lower foot's share, and two-bone IK bends each leg to reach. The swing
   * height the clip gives a foot is kept, so a step clears the tread's nosing.
   */
  private groundFeet(state: string, dt: number): void {
    const b = this.bones;
    const ground = this.ground;
    if (!ground || (state !== 'loco' && state !== 'land')) {
      this.feetPrimed = false;
      return;
    }
    this.root.updateWorldMatrix(true, true);
    this.root.getWorldPosition(_v2);
    const baseY = _v2.y;
    const e = this.root.matrixWorld.elements;
    const yaw = Math.atan2(e[8] as number, e[10] as number);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const k = this.feetPrimed ? 1 - Math.exp(-dt / 0.05) : 1;
    const legs = [[b.lThigh, b.lCalf, b.lFoot], [b.rThigh, b.rCalf, b.rFoot]] as const;
    let low = 0;
    for (let i = 0; i < 2; i++) {
      const foot = legs[i]?.[2];
      if (!foot) continue;
      foot.getWorldPosition(_v);
      // Under the ball of the foot as well as the heel: a foot over a tread's edge stands on the higher of the two.
      const g0 = ground(_v.x, _v.z, baseY);
      const g1 = ground(_v.x + fx * 0.09, _v.z + fz * 0.09, baseY);
      const g = g0 === null ? g1 : g1 === null ? g0 : Math.max(g0, g1);
      const want = g === null ? 0 : MathUtils.clamp(g - baseY, -0.32, 0.32);
      this.feetOff[i] = (this.feetOff[i] as number) + (want - (this.feetOff[i] as number)) * k;
      low = Math.min(low, this.feetOff[i] as number);
    }
    this.feetDrop += (low - this.feetDrop) * k;
    this.feetPrimed = true;
    if (Math.abs(this.feetDrop) < 1e-4 && Math.abs(this.feetOff[0] as number) < 1e-4 && Math.abs(this.feetOff[1] as number) < 1e-4) return;
    // Ankle targets before the pelvis moves.
    const targets = [_feet[0] as Vector3, _feet[1] as Vector3];
    for (let i = 0; i < 2; i++) {
      const foot = legs[i]?.[2];
      if (!foot) continue;
      foot.getWorldPosition(targets[i] as Vector3);
      (targets[i] as Vector3).y += this.feetOff[i] as number;
    }
    const parentScale = this.model.parent ? this.model.parent.getWorldScale(_v).y : 1;
    this.model.position.y += this.feetDrop / (parentScale || 1);
    this.model.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) {
      const [thigh, calf, foot] = legs[i] as readonly [Bone | null, Bone | null, Bone | null];
      if (!thigh || !calf || !foot) continue;
      thigh.getWorldPosition(_pole);
      _pole.x -= fx * 0.6;
      _pole.z -= fz * 0.6;
      solveTwoBone(thigh, calf, foot, targets[i] as Vector3, _pole, 1);
    }
  }

  /** Standing pelvis height above the feet (m), measured once from the idle pose. */
  private pelvisRest(sc: number): number {
    if (this.pelvisRestY > 0) return this.pelvisRestY * sc;
    return (this.bones.root?.position.y ?? 0.9) * this.hipScale * sc;
  }

  /** Both legs flexed: thighs forward by `hip`, calves back by `knee` (radians, staggered a little left to right). */
  private legPose(hip: number, knee: number): void {
    const b = this.bones;
    this.model.getWorldQuaternion(_qm);
    for (const [thigh, calf, k] of [[b.lThigh, b.lCalf, 1.18], [b.rThigh, b.rCalf, 0.82]] as const) {
      if (!thigh || !calf) continue;
      thigh.parent?.updateWorldMatrix(true, false);
      thigh.parent?.getWorldQuaternion(_qp);
      thigh.quaternion.copy(boneTurned(thigh.quaternion, _qp, _qm, _xAxis, -hip * k));
      thigh.updateWorldMatrix(true, false);
      thigh.getWorldQuaternion(_qp);
      calf.quaternion.copy(boneTurned(calf.quaternion, _qp, _qm, _xAxis, knee * k));
    }
  }

  /** Put both soles on the floor plane `groundY` (world) with the knees pointing the way the body faces. */
  private plantFeet(groundY: number, weight: number): void {
    const b = this.bones;
    const e = this.root.matrixWorld.elements;
    const fx = -Math.sin(Math.atan2(e[8] as number, e[10] as number));
    const fz = -Math.cos(Math.atan2(e[8] as number, e[10] as number));
    for (const [thigh, calf, foot] of [[b.lThigh, b.lCalf, b.lFoot], [b.rThigh, b.rCalf, b.rFoot]] as const) {
      if (!thigh || !calf || !foot) continue;
      foot.updateWorldMatrix(true, false);
      foot.getWorldPosition(_target);
      _target.y = groundY + this.ankleRest;
      thigh.getWorldPosition(_pole);
      _pole.x += fx * 0.6;
      _pole.z += fz * 0.6;
      solveTwoBone(thigh, calf, foot, _target, _pole, weight);
    }
  }

  /** Both hands resting on the thighs (a seated person with free hands), elbows out a little. */
  private handsOnLap(weight: number): void {
    const b = this.bones;
    const pelvis = b.pelvis;
    if (!pelvis) return;
    const pairs = [[b.lUpper, b.lLower, b.lHand, b.lThigh, b.lCalf], [b.rUpper, b.rLower, b.rHand, b.rThigh, b.rCalf]] as const;
    for (const [upper, lower, hand, thigh, calf] of pairs) {
      if (!upper || !lower || !hand || !thigh || !calf) continue;
      thigh.updateWorldMatrix(true, false);
      calf.updateWorldMatrix(true, false);
      thigh.getWorldPosition(_target);
      calf.getWorldPosition(_v2);
      _target.lerp(_v2, 0.55);
      _target.y += 0.09 * this.root.scale.x;
      upper.getWorldPosition(_pole);
      pelvis.getWorldPosition(_v2);
      _v2.set(_pole.x - _v2.x, 0, _pole.z - _v2.z).normalize();
      _pole.addScaledVector(_v2, 0.3).y -= 0.12;
      solveTwoBone(upper, lower, hand, _target, _pole, weight);
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
    const air = state === 'jump' || state === 'air' || state === 'fall';
    const lo = this.bones.lUpper;
    const ro = this.bones.rUpper;
    // One spring follows the lively jump pose (and its way back down on landing): no pose is ever switched, only chased.
    const o = this.armSpring.step(jumpArmTarget(air, this.input.vy, this.peakUp, this.airT), dt, air ? 13 : 9);
    this.airBlend = Math.max(Math.abs(o.tuck), Math.abs(o.swing)) > 1e-3 ? 1 : 0;
    if (this.airBlend === 0 || !lo || !ro) return;
    this.root.updateWorldMatrix(true, true);
    this.model.getWorldQuaternion(_qm);
    for (const [bone, sign] of [[lo, -1], [ro, 1]] as const) {
      const parent = bone.parent;
      if (!parent) continue;
      parent.getWorldQuaternion(_qp);
      bone.quaternion.copy(armRelaxed(bone.quaternion, _qp, _qm, sign * o.tuck));
      bone.updateWorldMatrix(false, false);
      parent.getWorldQuaternion(_qp);
      bone.quaternion.copy(boneTurned(bone.quaternion, _qp, _qm, _xAxis, -o.swing));
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
      const gait = (n: string): boolean => GAIT.test(n);
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
    if (!GAIT.test(name) || this.smoothSpeed < 0.3) return;
    const info = this.opts.table.get(name);
    const contacts = info?.contacts;
    if (!contacts || contacts.length === 0) return;
    const dur = cur.getClip().duration;
    const phase = (cur.time % dur) / dur;
    const last = this.footPhase;
    this.footPhase = phase;
    if (last < 0) return;
    // A gait played backwards crosses its contacts the other way round.
    const rev = cur.timeScale < 0;
    const prev = rev ? 1 - last : last;
    const now = rev ? 1 - phase : phase;
    for (const c of contacts) {
      const at = rev ? 1 - (c[0] as number) : (c[0] as number);
      const crossed = prev <= now ? prev < at && now >= at : prev < at || now >= at;
      if (crossed) cb(c[1] === 0 ? 'L' : 'R', this.smoothSpeed, this);
    }
  }

  private updateLook(dt: number, detail: number): void {
    const head = this.bones.head;
    if (!head) return;
    const target = this.lookTarget;
    const state = this.plan?.state ?? 'loco';
    // The head leaves the body alone while it jumps, lands, is hit, turns or changes between standing and sitting.
    const allow = !this.machine.isDead && state !== 'jump' && state !== 'air' && state !== 'fall' && state !== 'land' && state !== 'hit' && state !== 'attack' && state !== 'sit_down' && state !== 'stand_up';
    let want: { yaw: number; pitch: number } | null = null;
    this.root.updateWorldMatrix(true, false);
    const e = this.root.matrixWorld.elements;
    const bodyYaw = Math.atan2(e[8] as number, e[10] as number);
    if (target) {
      head.getWorldPosition(_v2);
      const dx = target.x - _v2.x;
      const dz = target.z - _v2.z;
      const horiz = Math.hypot(dx, dz);
      if (horiz > 0.15) {
        const fx = -Math.sin(bodyYaw);
        const fz = -Math.cos(bodyYaw);
        want = { yaw: Math.atan2(fz * dx - fx * dz, fx * dx + fz * dz), pitch: Math.atan2(target.y - _v2.y, horiz) };
      }
    }
    this.gaze.update(dt, want, allow);
    const g = this.gaze;
    if (g.weight < 0.01 || (Math.abs(g.yaw) < 1e-4 && Math.abs(g.pitch) < 1e-4)) return;
    this.lookState.yaw = g.yaw * g.weight;
    this.lookState.pitch = g.pitch * g.weight;
    if (detail >= 1) applyLook(this.bones, this.lookState, bodyYaw);
  }

  private lastStep = 0;
  private chestPitch = 0;
  private sprintLower = 0;
  /** Neck height and depth (rig frame) the shouldered gun was placed against, and the eased offset from it. */
  private neckRef: Vector3 | null = null;
  private readonly neckOff = new Vector3();

  /**
   * Strafing with a gun: the pelvis (and with it the legs) turns by {@link hipYaw}, the upper spine turns back so the chest
   * keeps facing the aim. Aiming up or down bends the upper spine a little with the pitch (the gun pivots at the shoulder
   * for the rest). Runs after the mixer, before the look and the hand IK.
   */
  private turnHipsAndChest(state: string, dt: number): void {
    const b = this.bones;
    const pitchWant = this.prop?.shouldered && state !== 'sit' && state !== 'sit_down' && state !== 'stand_up' && state !== 'dead' ? MathUtils.clamp(this.aimPitch, -0.9, 0.9) : 0;
    this.chestPitch += (pitchWant - this.chestPitch) * Math.min(1, dt * 14);
    const yaw = this.hipYaw;
    if (Math.abs(yaw) < 1e-3 && Math.abs(this.chestPitch) < 1e-3) return;
    const pelvis = b.pelvis;
    const s1 = b.spine1;
    const s2 = b.spine;
    if (!pelvis || !s1 || !s2) return;
    this.root.updateWorldMatrix(true, true);
    this.model.getWorldQuaternion(_qm);
    if (Math.abs(yaw) >= 1e-3) {
      pelvis.parent?.getWorldQuaternion(_qp);
      pelvis.quaternion.copy(boneTurned(pelvis.quaternion, _qp, _qm, _yAxis, yaw));
      pelvis.updateWorldMatrix(false, true);
    }
    // The counter-turn and the bend are shared by the two upper spine bones, so neither kinks.
    for (const [bone, k] of [[s1, 0.55], [s2, 0.45]] as const) {
      bone.parent?.getWorldQuaternion(_qp);
      if (Math.abs(yaw) >= 1e-3) {
        bone.quaternion.copy(boneTurned(bone.quaternion, _qp, _qm, _yAxis, -yaw * k));
        bone.updateWorldMatrix(false, false);
      }
      if (Math.abs(this.chestPitch) >= 1e-3) {
        bone.parent?.getWorldQuaternion(_qp);
        bone.quaternion.copy(boneTurned(bone.quaternion, _qp, _qm, _xAxis, -this.chestPitch * 0.3 * k));
      }
      bone.updateWorldMatrix(false, true);
    }
  }

  private updateCarry(): void {
    const prop = this.prop;
    if (prop?.shouldered) {
      this.updateShouldered(prop.shouldered, prop.group);
      return;
    }
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

  /** Both hands on a long gun: the right on the grip, the left under the handguard, elbows down and out. */
  private updateShouldered(at: NonNullable<Prop['shouldered']>, gun: Object3D): void {
    const b = this.bones;
    if (!b.lUpper || !b.lLower || !b.lHand || !b.rUpper || !b.rLower || !b.rHand) return;
    this.root.updateWorldMatrix(true, true);
    const side = Math.sign(gun.position.x) || 1;
    // The gun rides on the chest: it sinks with a crouch or a landing and leans with the body (eased, so a gait's bob is
    // softened as arms soften it), pitches about the shoulder with the aim, and is lowered across the body in a sprint.
    const sc = this.root.scale.x || 1;
    if (b.neck) {
      b.neck.getWorldPosition(_v2);
      this.root.worldToLocal(_v2);
      if (!this.neckRef) this.neckRef = _v2.clone();
      const k = Math.min(1, this.lastStep * 12);
      this.neckOff.x += (0 - this.neckOff.x) * k;
      this.neckOff.y += (_v2.y - this.neckRef.y - this.neckOff.y) * k;
      this.neckOff.z += (_v2.z - this.neckRef.z - this.neckOff.z) * k;
    }
    const sprint = this.input.sprinting && this.plan?.state === 'loco' && this.smoothSpeed > 2.5 ? 1 : 0;
    this.sprintLower += (sprint - this.sprintLower) * Math.min(1, this.lastStep * 8);
    // Crouched and not firing: low ready, the muzzle down and the gun drawn in; the trigger brings it up to the aim.
    const low = this.crouchT > 0 && !this.aiming && this.plan?.state === 'crouch' ? this.crouchT : 0;
    this.lowReady += (low - this.lowReady) * Math.min(1, this.lastStep * (this.aiming ? 16 : 6));
    const lr = this.lowReady * (1 - this.sprintLower);
    const a = this.chestPitch * (1 - this.sprintLower) * (1 - lr) - LOW_READY_PITCH * lr;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // Shoulder pivot and the gun's offset from it at rest (rig frame, metres before scale).
    const oy = GUN_AT[1] - SHOULDER_PIVOT[1];
    const oz = GUN_AT[2] - SHOULDER_PIVOT[2];
    gun.position.set(
      side * GUN_AT[0] * sc + this.sprintLower * -side * 0.08 * sc,
      (SHOULDER_PIVOT[1] + oy * ca - oz * sa - this.sprintLower * 0.12) * sc + this.neckOff.y,
      (SHOULDER_PIVOT[2] + oy * sa + oz * ca + this.sprintLower * 0.1 + lr * 0.06) * sc + this.neckOff.z,
    );
    gun.rotation.set(GUN_TILT + a - this.sprintLower * 0.75, this.sprintLower * side * 0.5, 0);
    gun.updateMatrixWorld(true);
    _target.set(at.grip[0], at.grip[1], at.grip[2]);
    gun.localToWorld(_target);
    // Elbow poles sink with the chest, so a crouched body keeps its elbows down instead of reaching.
    _pole.set(side * 0.55, 0.75 + this.neckOff.y / sc, 0.15);
    this.root.localToWorld(_pole);
    solveTwoBone(b.rUpper, b.rLower, b.rHand, _target, _pole, 1);
    _target.set(at.fore[0], at.fore[1], at.fore[2]);
    gun.localToWorld(_target);
    _pole.set(-side * 0.35, 0.7 + this.neckOff.y / sc, -0.1);
    this.root.localToWorld(_pole);
    solveTwoBone(b.lUpper, b.lLower, b.lHand, _target, _pole, 1);
  }

  /** Release mixer, instance GPU state, prop and swapped materials. Source geometry/textures stay cached. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.opts.scene);
    disposeModelInstance(this.opts.scene);
    if (this.prop) this.opts.onProp?.(null, this);
    this.prop?.group.removeFromParent();
    this.prop?.dispose();
    disposeGear(this.gear);
    this.gear = [];
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
const _yAxis = new Vector3(0, 1, 0);
const _feet = [new Vector3(), new Vector3()];
const _feetQ = [new Quaternion(), new Quaternion()];
/** Crouch: hip drop and the hips' move back (m, before scale), forward lean of the back (radians), seconds to sink or rise. */
const CROUCH_DROP = 0.32;
/** Crouched stance at rest: the left foot this far forward, the right this far back with the ankle up and toes down (m, radians). */
const STANCE_FORWARD = 0.2;
const STANCE_BACK = 0.16;
const STANCE_HEEL = 0.07;
const STANCE_TOES = 0.55;
/** Muzzle-down angle of a shouldered gun at low ready (radians). */
const LOW_READY_PITCH = 0.5;
const CROUCH_BACK = 0.06;
const CROUCH_LEAN = 0.45;
const CROUCH_TIME = 0.38;
/** Gait clips (they keep their phase across crossfades, step, and run backwards when backing off). */
const GAIT = /^(walk|run|jog|sprint|stroll|crouch_walk)/;
/** A shouldered gun at the ready (rig frame, m; x is to the gun side), its tilt (radians), and the shoulder it pivots on. */
const GUN_AT = [0.13, 1.22, -0.3] as const;
const GUN_TILT = -0.06;
const SHOULDER_PIVOT = [0.13, 1.42, -0.05] as const;
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
