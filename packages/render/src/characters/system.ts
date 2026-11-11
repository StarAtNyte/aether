/**
 * All the people of one scene (NPCs, the player's body, bystanders): loading
 * (lazy, shared per body and per motion set through the model cache),
 * variant materials, per-frame update with level-of-detail, and footstep events.
 *
 * Budget policy (50 animated characters at 60 fps on the software-GPU path):
 * near characters get everything (look-at, IK, shadows); mid-range ones skip
 * look-at and IK; far ones step their mixer at a quarter of the frames and
 * stop casting shadows; the number of full-detail characters is capped. Skinned
 * meshes are frustum culled with a fixed generous bounding sphere (the
 * bind-pose sphere would be wrong once animated).
 */
import { Box3, Mesh, Sphere, Vector3, type Camera, type PerspectiveCamera, type SkinnedMesh, type Material, type MeshStandardMaterial, type Object3D, type Texture } from 'three';
import { castById, characterUrl, clipTable, farLevelOf, getCatalog, loadCatalog, motionSet, type CastMember, type ResolvedLook } from '@aether/assets';
import { cloneModel, COMPRESSED_SOURCE_KEY, disposeModelInstance, type ModelCache } from '../geometry/model-loader';
import { fieldShadowSkipped } from '../virtual/scatter-field';
import { attachFarLevel, LOD_FAR_PX, LOD_NEAR_PX, OWN_SKELETON_KEY } from './lod';
import { CharacterRig, type Foot } from './rig';
import { DEFAULT_REFS, decodeMasks, hasTint, materialsOf, originalBaseColours, partOf, tintedMaterialAsync, tintKey, type Tint, type TintMasks, type TintRefs } from './tint';
import type { Prop } from './props';
import { isToonScene, ToonShading } from './toon';
import type { ColliderDef, SpringChainDef } from './springs';

/** Distances (m) at which detail steps down. */
export const LOD_NEAR = 16;
export const LOD_MID = 42;
export const LOD_FAR = 90;
/**
 * The lens the distances above are meant for (vertical fov, degrees: the player's camera). Through a longer lens a body
 * is as large on screen as one proportionally nearer, and it is posed as such (a long-lens shot of a runner 45 m away
 * fills the frame: on the mixer alone her feet slid and her skirt stood still).
 */
export const LOD_REF_FOV = 55;

/**
 * How much nearer than its distance a body looks through a camera of vertical fov `fov` (degrees) and `zoom`, against
 * {@link LOD_REF_FOV}: 1 for that lens or a wider one, about 0.13 for an 8-degree long lens. The distance a body's pose
 * detail is chosen by is its distance times this.
 */
export function lensDetailScale(fov: number, zoom = 1): number {
  const t = Math.tan(((fov * Math.PI) / 180) * 0.5) / Math.max(1e-3, zoom);
  const ref = Math.tan(((LOD_REF_FOV * Math.PI) / 180) * 0.5);
  return Number.isFinite(t) && t > 0 ? Math.min(1, t / ref) : 1;
}

/** Most characters updated at full detail per frame. */
export const MAX_FULL_DETAIL = 10;
/** Most characters in a scene; later ones are not mounted (a hostile world cannot ask for thousands). */
export const MAX_CHARACTERS = 160;
/** Toon bodies pose on twos: the skeleton steps at this rate (the body still moves smoothly with its entity). */
export const TOON_POSE_FPS = 12;

/**
 * Time to hand a body's rig this frame, or 0 to hold its pose: a body posing at `fps` keeps accumulating until a pose
 * step is due (a frame that is more than due steps once with all the time gathered). `fps` 0 steps every frame.
 */
export function poseStep(accumulated: number, fps: number): number {
  if (!(fps > 0)) return accumulated;
  return accumulated >= 1 / fps - 1e-4 ? accumulated : 0;
}

/** Options of {@link CharacterSystem}. */
export interface CharacterSystemOptions {
  models: ModelCache;
  /** Footstep callback: body id, foot, speed (m/s), world position of the foot, owner entity id. */
  onFootstep?: (id: string, foot: Foot, speed: number, position: Vector3) => void;
  /** Draw shadows (false for the ghost and proof variants). */
  shadows?: boolean;
  /** The held prop of a body changed (body id; null when it holds nothing or is removed). */
  onProp?: (id: string, prop: Prop | null) => void;
}

interface Entry {
  id: string;
  rig: CharacterRig;
  key: string;
  bodyUrl: string;
  motionUrl: string;
  body: CastMember;
  accumulated: number;
  frame: number;
  shadowsOn: boolean;
  dist: number;
  tintKey: string | null;
  /** Pose rate (0: every frame; toon bodies pose on twos). */
  poseFps: number;
  /** The far level's file (released with the body) and its cloned scene (its meshes live in the body's), or null. */
  lodUrl: string | null;
  lodScene: Object3D | null;
  /** Height on screen (CSS px) at the last update (0: not yet). */
  lastPx: number;
}

/** Recoloured materials of one variant (shared by every person wearing it). */
interface TintSet {
  materials: Map<Material, Material>;
  textures: Texture[];
  users: number;
  ready: Promise<void>;
}

const _pos = new Vector3();
const _foot = new Vector3();

/** The tint a look asks for. */
function tintOf(look: ResolvedLook): Tint {
  const t: Tint = {};
  if (look.top) t.top = look.top;
  if (look.bottom) t.bottom = look.bottom;
  if (look.hair) t.hair = look.hair;
  return t;
}

/** Manages every character of a scene. */
export class CharacterSystem {
  private readonly entries = new Map<string, Entry>();
  private readonly list: Entry[] = [];
  private readonly pending = new Map<string, number>();
  private readonly tinted = new Map<string, TintSet>();
  private readonly maskCache = new Map<string, Promise<TintMasks | null>>();
  private camera: Camera | null = null;
  private disposed = false;
  private frameNo = 0;
  /** Characters mounted over the lifetime (diagnostics). */
  mounted = 0;
  /**
   * The last {@link update} moved a character that is shown and casts into the sun's shadow map: only then does the cached
   * sun map need its soft refresh. A person loaded ahead and hidden until play, or one too far to cast, animates without
   * changing a shadow (redrawing every caster for it cost an integrated GPU a full shadow pass every few frames).
   */
  castersMoved = false;
  private readonly sorted: Entry[] = [];
  /** Shared cel materials of the toon bodies. */
  readonly toon = new ToonShading();

  constructor(private readonly opts: CharacterSystemOptions) {}

  /** The light toon bodies are banded by: `dir` toward the sun (world), its linear colour; null = a soft default. */
  setToonLight(dir: Vector3 | null, color: import('three').Color | null): void {
    this.toon.setLight(dir, color);
  }

  /** Number of live characters. */
  get size(): number {
    return this.entries.size;
  }

  /** The rig of a character, or null. */
  rig(id: string): CharacterRig | null {
    return this.entries.get(id)?.rig ?? null;
  }

  /** Camera used to rank characters by distance. */
  setCamera(camera: Camera | null): void {
    this.camera = camera;
  }

  /**
   * Mount a character under `parent` (it is placed at the parent's origin;
   * `footOffset` moves the feet relative to it, negative = down). Resolves to
   * the rig, or null when it could not be mounted (unknown body, load failure,
   * replaced meanwhile, over the cap). Mounting again with the same id and
   * look keeps the existing rig.
   */
  async add(id: string, look: ResolvedLook, parent: Object3D, opts: { footOffset?: number; track?: Object3D | null; castShadow?: boolean; autoMotion?: boolean } = {}): Promise<CharacterRig | null> {
    if (this.disposed) return null;
    const key = `${look.body.id}|${tintKey(look)}|${look.scale}|${look.hold}|${look.mood}|${(look.gear ?? []).join(',')}|${look.wardrobe ?? ''}`;
    const existing = this.entries.get(id);
    if (existing && existing.key === key && existing.rig.root.parent === parent) return existing.rig;
    if (existing) this.remove(id);
    if (this.entries.size + this.pending.size >= MAX_CHARACTERS) return null;
    const ticket = (this.pending.get(id) ?? 0) + 1;
    this.pending.set(id, ticket);
    try {
      await loadCatalog();
      const set = motionSet(look.body.gender);
      if (!set) return null;
      const base = getCatalog()?.base;
      const bodyUrl = characterUrl(look.body.file, base);
      const motionUrl = characterUrl(set.file, base);
      const far = farLevelOf(look.body);
      let lodUrl = far ? characterUrl(far.file, base) : null;
      const [bodySrc, motionSrc, lodSrc] = await Promise.all([
        this.opts.models.acquire(bodyUrl),
        this.opts.models.acquire(motionUrl),
        // A far level that fails to load leaves the body with its one level.
        lodUrl ? this.opts.models.acquire(lodUrl).catch(() => null) : Promise.resolve(null),
      ]);
      if (lodUrl && !lodSrc) lodUrl = null;
      const releaseLod = (): void => {
        if (lodUrl) this.opts.models.release(lodUrl);
        lodUrl = null;
      };
      if (this.disposed || this.pending.get(id) !== ticket) {
        this.opts.models.release(bodyUrl);
        this.opts.models.release(motionUrl);
        releaseLod();
        return null;
      }
      const tint = tintOf(look);
      let tintKeyStr: string | null = null;
      const toon = isToonScene(bodySrc);
      // Toon bodies keep their painted colours (no outfit masks).
      if (hasTint(tint) && !toon) {
        tintKeyStr = `${look.body.id}|${tintKey(tint)}`;
        const set = this.acquireTint(tintKeyStr, look.body, bodySrc, tint, base);
        await set.ready;
        if (this.disposed || this.pending.get(id) !== ticket) {
          this.releaseTintKey(tintKeyStr);
          this.opts.models.release(bodyUrl);
          this.opts.models.release(motionUrl);
          releaseLod();
          return null;
        }
      }
      const scene = cloneModel(bodySrc);
      this.fixBounds(scene);
      // The far level joins the body before its materials are swapped: it takes the body's own, so the tint and the
      // toon pair (and their programs) are shared.
      let lodScene: Object3D | null = null;
      if (lodSrc) {
        lodScene = cloneModel(lodSrc);
        this.fixBounds(lodScene);
        if (!attachFarLevel(scene, lodScene)) {
          disposeModelInstance(lodScene);
          lodScene = null;
          releaseLod();
        }
      }
      if (tintKeyStr) this.applyTint(scene, tintKeyStr);
      if (toon) this.toon.apply(scene);
      const toonData = toon ? (scene.userData['toon'] as { springs?: SpringChainDef[]; colliders?: ColliderDef[] }) : null;
      const castShadow = (opts.castShadow ?? true) && this.opts.shadows !== false;
      const rig = new CharacterRig({
        scene,
        // The motion set, plus clips a body file carries of its own (a built character's extra beats: look_up,
        // hand_to_chest, two_fingers…); a body clip of the same name as a shared one replaces it.
        clips: bodySrc.animations && bodySrc.animations.length > 0 ? [...motionSrc.animations.filter((c) => !bodySrc.animations.some((b) => b.name === c.name)), ...bodySrc.animations] : motionSrc.animations,
        table: clipTable(look.body.gender),
        look,
        faces: look.body.faces,
        hip: look.body.hip,
        motionHip: set.hip,
        castShadow,
        ditherLevels: toon,
        ...(toonData ? { toon: { springs: toonData.springs ?? [], colliders: toonData.colliders ?? [] } } : {}),
        onFootstep: this.opts.onFootstep
          ? (foot, speed, r) => {
              const bone = r.root.getObjectByName(foot === 'L' ? 'Bip01_L_Foot' : 'Bip01_R_Foot');
              if (bone) bone.getWorldPosition(_foot);
              else r.root.getWorldPosition(_foot);
              this.opts.onFootstep?.(id, foot, speed, _foot);
            }
          : undefined,
        ...(this.opts.onProp ? { onProp: (prop: Prop | null) => this.opts.onProp?.(id, prop) } : {}),
      });
      rig.root.position.y = opts.footOffset ?? 0;
      rig.autoMotion = opts.autoMotion ?? true;
      if (opts.track !== undefined) rig.track(opts.track ?? null);
      parent.add(rig.root);
      const entry: Entry = { id, rig, key, bodyUrl, motionUrl, body: look.body, accumulated: 0, frame: 0, shadowsOn: castShadow, dist: 0, tintKey: tintKeyStr, poseFps: toon ? TOON_POSE_FPS : 0, lodUrl, lodScene, lastPx: 0 };
      if (!this.farLevels) rig.levels?.setEnabled(false);
      this.entries.set(id, entry);
      this.list.push(entry);
      this.mounted++;
      return rig;
    } catch {
      return null;
    } finally {
      if (this.pending.get(id) === ticket) this.pending.delete(id);
    }
  }

  /** Remove one character. */
  remove(id: string): void {
    this.pending.set(id, (this.pending.get(id) ?? 0) + 1);
    this.pending.delete(id);
    const e = this.entries.get(id);
    if (!e) return;
    this.entries.delete(id);
    const i = this.list.indexOf(e);
    if (i >= 0) this.list.splice(i, 1);
    const own: SkinnedMesh[] = [];
    e.lodScene?.traverse((o) => {
      if (o.userData[OWN_SKELETON_KEY] === true) own.push(o as SkinnedMesh);
    });
    e.rig.root.traverse((o) => {
      if (o.userData[OWN_SKELETON_KEY] === true) own.push(o as SkinnedMesh);
    });
    e.rig.dispose();
    if (e.lodScene) disposeModelInstance(e.lodScene);
    for (const m of new Set(own)) m.skeleton?.dispose();
    this.releaseTintKey(e.tintKey);
    this.opts.models.release(e.bodyUrl);
    this.opts.models.release(e.motionUrl);
    if (e.lodUrl) this.opts.models.release(e.lodUrl);
  }

  private fixBounds(scene: Object3D): void {
    scene.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const g = o.geometry;
      if (!g.boundingSphere || g.boundingSphere.radius < 1.4) g.boundingSphere = new Sphere(new Vector3(0, 0.95, 0), 1.6);
      if (!g.boundingBox) g.boundingBox = new Box3(new Vector3(-1.6, -0.2, -1.6), new Vector3(1.6, 2.2, 1.6));
      o.frustumCulled = true;
    });
  }

  /** The masks of a body (fetched once; null when the file is missing or cannot be decoded). */
  private masksOf(body: CastMember, base: string | undefined): Promise<TintMasks | null> {
    if (!body.masks) return Promise.resolve(null);
    const url = characterUrl(body.masks, base);
    let p = this.maskCache.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`masks ${r.status}`))))
        .then(decodeMasks)
        .catch(() => null);
      this.maskCache.set(url, p);
    }
    return p;
  }

  /** Take (and, the first time, build) the recoloured materials of a variant. */
  private acquireTint(key: string, body: CastMember, source: Object3D, tint: Tint, base: string | undefined): TintSet {
    const existing = this.tinted.get(key);
    if (existing) {
      existing.users++;
      return existing;
    }
    const refs: TintRefs = { top: body.tintTop ?? DEFAULT_REFS.top, bottom: body.tintBottom ?? DEFAULT_REFS.bottom, hair: body.tintHair ?? DEFAULT_REFS.hair };
    const set: TintSet = { materials: new Map(), textures: [], users: 1, ready: Promise.resolve() };
    // A body loaded from its KTX2 twin has compressed base colour maps: the tint is baked from the original file's images.
    const original = source.userData[COMPRESSED_SOURCE_KEY] as unknown;
    const compressed = typeof original === 'string' && materialsOf(source).some((m) => ((m as MeshStandardMaterial).map as { isCompressedTexture?: boolean } | null)?.isCompressedTexture === true);
    set.ready = Promise.all([this.masksOf(body, base), compressed ? originalBaseColours(original) : Promise.resolve(null)])
      .then(async ([masks, images]) => {
        try {
          for (const m of materialsOf(source)) {
            if (this.disposed || this.tinted.get(key) !== set || set.users <= 0) break;
            const { material, texture } = await tintedMaterialAsync(m as MeshStandardMaterial, partOf(m), tint, refs, masks, images?.get(m.name) ?? null);
            if (this.disposed || this.tinted.get(key) !== set || set.users <= 0) { material.dispose(); texture?.dispose(); break; }
            set.materials.set(m, material);
            if (texture) set.textures.push(texture);
          }
        } finally {
          if (images) for (const b of images.values()) b.close();
        }
      })
      .catch(() => undefined);
    this.tinted.set(key, set);
    return set;
  }

  private applyTint(scene: Object3D, key: string): void {
    const set = this.tinted.get(key);
    if (!set) return;
    scene.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const swap = (m: Material): Material => set.materials.get(m) ?? m;
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
  }

  private releaseTintKey(key: string | null): void {
    if (!key) return;
    const set = this.tinted.get(key);
    if (!set) return;
    if (--set.users > 0) return;
    for (const m of set.materials.values()) m.dispose();
    for (const t of set.textures) t.dispose();
    this.tinted.delete(key);
  }

  private viewHeight = 0;
  private farLevels = true;

  /** Use the bodies' far levels of detail (default) or only their full meshes (diagnostics, A/B measurements). */
  setFarLevels(on: boolean): void {
    this.farLevels = on;
    for (const e of this.list) {
      e.rig.levels?.setEnabled(on);
      e.lastPx = 0;
    }
  }

  /** Height of the view in CSS pixels: bodies with a far level switch by their height on screen (0: never switch). */
  setViewHeight(px: number): void {
    this.viewHeight = px > 0 ? px : 0;
  }

  /** Triangles of the bodies' levels as drawn now (diagnostics): the view's and the sun shadow map's. */
  drawnTriangles(): { view: number; shadow: number } {
    let view = 0;
    let shadow = 0;
    for (const e of this.list) {
      if (!shown(e.rig.root)) continue;
      e.rig.root.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh || !m.visible) return;
        const g = m.geometry;
        const tris = (g.index ? g.index.count : (g.attributes['position']?.count ?? 0)) / 3;
        if (m.layers.isEnabled(0)) view += tris;
        if (m.castShadow && m.userData['toonOutline'] !== true && !fieldShadowSkipped(m)) shadow += tris;
      });
    }
    return { view, shadow };
  }

  private lensFactor(): number {
    const cam = this.camera as PerspectiveCamera | null;
    if (!cam || !(cam as { isPerspectiveCamera?: boolean }).isPerspectiveCamera) return 1;
    return lensDetailScale(cam.fov, cam.zoom);
  }

  /** A body's height on screen (CSS px), Infinity when unknown or not a perspective view. */
  private screenHeight(e: Entry): number {
    const cam = this.camera as PerspectiveCamera | null;
    if (!cam || !(cam as { isPerspectiveCamera?: boolean }).isPerspectiveCamera || this.viewHeight <= 0) return Number.POSITIVE_INFINITY;
    const m = e.rig.root.matrixWorld.elements;
    const scale = Math.hypot(m[4] as number, m[5] as number, m[6] as number);
    const h = e.body.height * scale;
    const d = Math.max(0.05, e.dist - h * 0.25);
    const t = Math.tan(((cam.fov * Math.PI) / 180) * 0.5) / Math.max(1e-3, cam.zoom);
    return (h / (2 * d * t)) * this.viewHeight;
  }

  private shadowBudget = Number.POSITIVE_INFINITY;
  private shadowRange = LOD_FAR;

  /** Limit which characters cast into the sun's shadow map: at most `budget` of them, none farther than `range` metres. */
  setShadowLimits(budget: number, range: number = LOD_FAR): void {
    this.shadowBudget = budget;
    this.shadowRange = range;
  }

  /**
   * Advance every character by `dt`. Returns true when anything animated
   * (the caller needs a redraw).
   */
  update(dt: number): boolean {
    const list = this.list;
    this.castersMoved = false;
    if (list.length === 0 || !(dt > 0)) return false;
    this.frameNo++;
    const cam = this.camera;
    const sorted = this.sorted;
    sorted.length = 0;
    for (const e of list) sorted.push(e);
    if (cam) {
      cam.getWorldPosition(_pos);
      for (const e of list) {
        const m = e.rig.root.matrixWorld.elements;
        const dx = (m[12] as number) - _pos.x;
        const dy = (m[13] as number) - _pos.y;
        const dz = (m[14] as number) - _pos.z;
        e.dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      if (list.length > MAX_FULL_DETAIL || this.shadowBudget < list.length) sorted.sort((a, b) => a.dist - b.dist);
    } else {
      for (const e of list) e.dist = 0;
    }
    let full = 0;
    let casting = 0;
    const lens = this.lensFactor();
    for (const e of sorted) {
      const d = e.dist;
      // (the distance the pose's detail is chosen by: as near as the lens makes the body look, never farther)
      const dl = d * lens;
      const levels = e.rig.levels;
      if (levels) {
        const px = this.screenHeight(e);
        // A cut (or the first frame) jumps to the right level at once; a body walking away fades.
        const jump = e.lastPx <= 0 || px > e.lastPx * 1.5 || px < e.lastPx / 1.5;
        if (jump) levels.snap(px < (LOD_FAR_PX + LOD_NEAR_PX) / 2 ? 1 : 0);
        else levels.update(px, dt);
        e.lastPx = Number.isFinite(px) ? px : 1e6;
      }
      let detail: 0 | 1 | 2 = dl < LOD_NEAR && full < MAX_FULL_DETAIL ? 2 : dl < LOD_MID ? 1 : 0;
      if (detail === 2) full++;
      if (dl >= LOD_MID && list.length > MAX_FULL_DETAIL) detail = 0;
      // Only the nearest few cast into the sun's shadow map: every part of every character is a draw call there.
      const shadows = d < this.shadowRange && casting < this.shadowBudget && this.opts.shadows !== false;
      if (shadows) casting++;
      if (shadows !== e.shadowsOn && !e.rig.shadowOnlyBody) {
        // A shadow joins or leaves the sun map.
        if (shown(e.rig.root)) this.castersMoved = true;
        e.shadowsOn = shadows;
        e.rig.root.traverse((o) => {
          if (o instanceof Mesh && o.userData['toonOutline'] !== true) o.castShadow = shadows;
        });
      }
      // Far characters step their mixer less often (accumulated time keeps their clips in step).
      const every = dl < LOD_MID ? 1 : dl < LOD_FAR ? 2 : 4;
      e.accumulated += dt;
      e.frame++;
      if (every > 1 && (e.frame + (e.id.length & 3)) % every !== 0) continue;
      const step = poseStep(e.accumulated, e.poseFps > 0 && !e.rig.mayPoseOnTwos ? 0 : e.poseFps);
      if (step <= 0) continue;
      e.rig.update(step, detail);
      e.accumulated = 0;
      if (!this.castersMoved && (e.shadowsOn || e.rig.shadowOnlyBody) && shown(e.rig.root)) this.castersMoved = true;
    }
    return true;
  }

  /** Look up the body of a cast id (re-exported for callers that only hold ids). */
  static body(id: string): CastMember | undefined {
    return castById(id);
  }

  /** Release every character. */
  dispose(): void {
    this.disposed = true;
    for (const id of [...this.entries.keys()]) this.remove(id);
    this.pending.clear();
    this.toon.dispose();
  }
}

/** Whether an object and every parent up to the root are visible (a hidden ancestor hides it from every pass). */
function shown(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
