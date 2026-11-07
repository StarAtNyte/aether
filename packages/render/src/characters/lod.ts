/**
 * Far level of detail of a character body: a reduced mesh built by the character pipeline (`<id>.lod1.glb`: the same
 * skeleton, clips, springs and toon extras, no morphs) bound to the body's own skeleton and drawn with the body's own
 * materials, so it costs no new program and animates for free.
 *
 * - The level is picked by the body's height on screen, with hysteresis: the far mesh takes over under
 *   {@link LOD_FAR_PX} and gives way again over {@link LOD_NEAR_PX}.
 * - A switch cross-fades over {@link LOD_FADE_S}: both meshes are drawn, each discarding the pixels of the other
 *   through the same screen-space noise (complementary dither), so the swap never pops. Toon materials read the fade
 *   from a per-object uniform ({@link lodDitherMask}); bodies drawn with other materials switch at the threshold.
 * - The shadow follows the level: a far body casts its far mesh into the sun's map, on {@link FIELD_SHADOW_LAYER} (the
 *   scatter fields' stand-in path: the near mesh is skipped there), and so it does from the first frame of a fade to
 *   it. A near body casts its full mesh: the far one would shadow the full surface it does not quite match, speckling
 *   the hair and face with self-shadow.
 */
import { Skeleton, type Bone, type Material, type Mesh, type Object3D, type SkinnedMesh } from 'three';
import { float, interleavedGradientNoise, screenCoordinate, select, step, uniform } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { addShadowStandIn, FIELD_SHADOW_LAYER, removeShadowStandIn } from '../virtual/scatter-field';

/** Body height on screen (CSS px) under which the far level takes over. */
export const LOD_FAR_PX = 140;
/** Body height on screen (CSS px) over which the near level comes back. */
export const LOD_NEAR_PX = 175;
/** Cross-fade time of a switch (s, simulation time). */
export const LOD_FADE_S = 0.3;
/** Marks a far mesh bound to a skeleton of its own (userData key): disposed with the body. */
export const OWN_SKELETON_KEY = 'lodOwnSkeleton';
/** Marks a mesh of the far level (userData key). */
export const FAR_LEVEL_KEY = 'lodLevel';
/** Per-object dither of a level mesh (userData key): 0 none; t > 0 drops the pixels with noise < t; −t drops those ≥ t. */
export const LOD_DITHER_KEY = 'lodDither';

/**
 * The mask of a material that cross-fades levels: true where the pixel stays. One node, shared by every material that
 * uses it (one program per material as before; the value is a per-object uniform).
 */
let mask: Node | null = null;
export function lodDitherMask(): Node {
  if (mask) return mask;
  const d = uniform(0).onObjectUpdate(({ object }) => (object?.userData[LOD_DITHER_KEY] as number | undefined) ?? 0);
  const n = interleavedGradientNoise(screenCoordinate.xy);
  mask = select(d.greaterThanEqual(0), step(d, n), float(1).sub(step(d.negate(), n))) as unknown as Node;
  return mask;
}

/** True when `pixel` (in [0, 1)) is kept by the dither `d` (the shader's rule, for tests). */
export function ditherKeeps(d: number, pixel: number): boolean {
  return d >= 0 ? pixel >= d : pixel < -d;
}

function meshesOf(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
}

function sameInverses(a: Skeleton, b: Skeleton): boolean {
  if (a.bones.length !== b.bones.length) return false;
  for (let i = 0; i < a.bones.length; i++) {
    if ((a.bones[i] as Bone).name !== (b.bones[i] as Bone).name) return false;
    const x = (a.boneInverses[i] as { elements: number[] }).elements;
    const y = (b.boneInverses[i] as { elements: number[] }).elements;
    for (let k = 0; k < 16; k++) if (Math.abs((x[k] as number) - (y[k] as number)) > 1e-5) return false;
  }
  return true;
}

/**
 * Move the meshes of a cloned far level (`lod`) into a cloned body (`body`): each under the body's node of its parent's
 * name, bound to the body's bones (the body's own skeleton when the bind matches, sharing its palette), with the body's
 * material of the same name (or of the same toon kind). Returns the moved meshes, or null when the files do not match
 * (then nothing is moved).
 */
export function attachFarLevel(body: Object3D, lod: Object3D): Mesh[] | null {
  const bodyMeshes = meshesOf(body);
  const byName = new Map<string, Material>();
  const byKind = new Map<string, Material>();
  let bodySkeleton: Skeleton | null = null;
  for (const m of bodyMeshes) {
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (!byName.has(mat.name)) byName.set(mat.name, mat);
      const kind = (mat.userData as { toon?: string }).toon;
      if (kind && !byKind.has(kind)) byKind.set(kind, mat);
    }
    if (!bodySkeleton && (m as SkinnedMesh).isSkinnedMesh) bodySkeleton = (m as SkinnedMesh).skeleton;
  }
  const bones = new Map<string, Bone>();
  body.traverse((o) => {
    if ((o as Bone).isBone) bones.set(o.name, o as Bone);
  });
  const far = meshesOf(lod);
  if (far.length === 0) return null;
  const plan: Array<{ mesh: Mesh; parent: Object3D; skeleton: Skeleton | null; material: Material | Material[] }> = [];
  for (const mesh of far) {
    const parent = mesh.parent && mesh.parent !== lod ? body.getObjectByName(mesh.parent.name) : body;
    if (!parent) return null;
    const swap = (mat: Material): Material | null => byName.get(mat.name) ?? byKind.get((mat.userData as { toon?: string }).toon ?? '') ?? null;
    const mats = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    if (mats === null || (Array.isArray(mats) && mats.some((m) => m === null))) return null;
    let skeleton: Skeleton | null = null;
    const sk = mesh as SkinnedMesh;
    if (sk.isSkinnedMesh && sk.skeleton) {
      if (bodySkeleton && sameInverses(sk.skeleton, bodySkeleton)) skeleton = bodySkeleton;
      else {
        const mapped = sk.skeleton.bones.map((b) => bones.get(b.name));
        if (mapped.some((b) => !b)) return null;
        skeleton = new Skeleton(mapped as Bone[], sk.skeleton.boneInverses.map((m) => m.clone()));
      }
    }
    plan.push({ mesh, parent, skeleton, material: mats as Material | Material[] });
  }
  for (const p of plan) {
    p.mesh.material = p.material;
    if (p.skeleton) {
      (p.mesh as SkinnedMesh).bind(p.skeleton, (p.mesh as SkinnedMesh).bindMatrix);
      if (p.skeleton !== bodySkeleton) p.mesh.userData[OWN_SKELETON_KEY] = true;
    }
    p.mesh.name = `${p.mesh.name}:lod1`;
    p.mesh.userData[FAR_LEVEL_KEY] = 1;
    p.parent.add(p.mesh);
  }
  return plan.map((p) => p.mesh);
}

/** Whether a mesh belongs to a far level attached by {@link attachFarLevel}. */
export function isFarLevel(o: Object3D): boolean {
  return o.userData[FAR_LEVEL_KEY] === 1;
}

/** The two levels of one body and the switch between them. */
export class BodyLevels {
  /** 0 = near, 1 = far: the level the view settles on. */
  level: 0 | 1 = 0;
  /** Progress of the cross-fade toward {@link level} (1 = settled). */
  private fade = 1;
  private outlinesShown = true;
  /** False: the near level only, as if the body had one (diagnostics, A/B measurements). */
  private enabled = true;
  /** Shadow-casting meshes of the near level (skipped by the sun's map, which draws the far one). */
  private readonly nearBodies: Mesh[];
  private readonly nearOutlines: Mesh[];
  private readonly farBodies: Mesh[];
  private readonly farOutlines: Mesh[];

  /** `dither`: the materials read {@link lodDitherMask} (else a switch is immediate: both drawn whole would overlap). */
  constructor(near: readonly Mesh[], far: readonly Mesh[], isOutline: (m: Mesh) => boolean, private readonly dither = true) {
    this.nearBodies = near.filter((m) => !isOutline(m));
    this.nearOutlines = near.filter(isOutline);
    this.farBodies = far.filter((m) => !isOutline(m));
    this.farOutlines = far.filter(isOutline);
    this.apply();
  }

  /** Whether the outline hulls show (false far away: the rig's detail 0). */
  setOutlines(shown: boolean): void {
    if (shown === this.outlinesShown) return;
    this.outlinesShown = shown;
    this.apply();
  }

  /**
   * Feed the body's height on screen (CSS px; Infinity = up close or unknown) and the step; true when what is drawn
   * changed (a switch started, a fade stepped or ended).
   */
  update(px: number, dt: number): boolean {
    if (!this.enabled) return false;
    const want: 0 | 1 = this.level === 0 ? (px < LOD_FAR_PX ? 1 : 0) : px > LOD_NEAR_PX ? 0 : 1;
    let changed = false;
    if (want !== this.level) {
      this.level = want;
      // Reversing a fade midway continues from where it is.
      this.fade = !this.dither ? 1 : this.fade < 1 ? 1 - this.fade : 0;
      changed = true;
    }
    if (this.fade < 1) {
      this.fade = dt > 0 ? Math.min(1, this.fade + dt / LOD_FADE_S) : this.fade;
      changed = true;
    }
    if (changed) this.apply();
    return changed;
  }

  /** Use the far level (true, the default) or draw the near one only, in the view and the shadow map. */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) {
      this.level = 0;
      this.fade = 1;
    }
    this.apply();
  }

  /** Snap to a level with no fade (a cut, a teleport). */
  snap(level: 0 | 1): void {
    if (!this.enabled) return;
    this.level = level;
    this.fade = 1;
    this.apply();
  }

  /** True while both levels are drawn. */
  get fading(): boolean {
    return this.fade < 1;
  }

  private apply(): void {
    const fading = this.fade < 1;
    const nearOn = this.level === 0 || fading;
    const farOn = this.level === 1 || fading;
    // The level faded in keeps the pixels with noise < fade, the one faded out the rest.
    // Never exactly 0: −0 would read as "no dither" and draw the incoming level whole.
    const t = Math.max(this.fade, 1e-4);
    const nearD = !fading ? 0 : this.level === 0 ? -t : t;
    const farD = !fading ? 0 : this.level === 1 ? -t : t;
    // The shadow follows the level the view settles on: a body casting its far level onto its near one would speckle
    // itself (the decimated surface lies a little in and out of the full one).
    const farCasts = this.level === 1 && this.enabled;
    for (const m of this.nearBodies) {
      (farCasts ? addShadowStandIn : removeShadowStandIn)(m);
      m.visible = nearOn && m.userData['gearHidden'] !== true;
      m.userData[LOD_DITHER_KEY] = nearD;
    }
    for (const m of this.nearOutlines) {
      m.visible = nearOn && this.outlinesShown;
      m.userData[LOD_DITHER_KEY] = nearD;
    }
    for (const m of this.farBodies) {
      // The view draws it on layer 0; the sun's map (with the stand-in layer) through its layer, in place of the near one.
      m.visible = this.enabled && (farOn || farCasts) && m.userData['gearHidden'] !== true;
      m.layers.set(farOn ? 0 : FIELD_SHADOW_LAYER);
      if (farCasts) m.layers.enable(FIELD_SHADOW_LAYER);
      m.userData[LOD_DITHER_KEY] = farD;
    }
    for (const m of this.farOutlines) {
      m.visible = farOn && this.outlinesShown;
      m.userData[LOD_DITHER_KEY] = farD;
    }
  }
}
