/**
 * Locomotion animation for rigged / animated assets (characters, animals).
 *
 * The logic runtime and physics move entities; the animator watches each
 * animated entity's world position and picks idle / walk / run from its
 * horizontal speed, cross-fading between them and scaling the gait to the
 * speed so feet do not slide. A fixed clip (`shape.animation = "<clip>"`)
 * loops instead. The per-frame update allocates nothing.
 */
import { AnimationMixer, LoopRepeat, Vector3, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import type { CatalogAnims } from '@aether/assets';

/** Speeds (m/s) separating the gaits, and the speeds the clips were authored for. */
export const GAIT = { walkFrom: 0.25, runFrom: 3.2, walkRef: 1.6, runRef: 4.5 } as const;
/** Cross-fade duration between gaits (seconds). */
export const FADE_SECONDS = 0.25;

type Gait = 'idle' | 'walk' | 'run';

interface Animated {
  root: Object3D;
  /** Object whose world position defines the speed (the entity node). */
  tracked: Object3D;
  mixer: AnimationMixer;
  idle: AnimationAction | null;
  walk: AnimationAction | null;
  run: AnimationAction | null;
  fixed: AnimationAction | null;
  current: AnimationAction | null;
  gait: Gait;
  last: Vector3;
  speed: number;
  primed: boolean;
}

const _pos = new Vector3();

function clipNamed(clips: readonly AnimationClip[], name: string | undefined): AnimationClip | null {
  if (!name) return null;
  return clips.find((c) => c.name === name) ?? null;
}

/** Gait for a horizontal speed (m/s). */
export function gaitFor(speed: number): Gait {
  if (speed >= GAIT.runFrom) return 'run';
  if (speed >= GAIT.walkFrom) return 'walk';
  return 'idle';
}

/** Drives every animated asset of one scene. */
export class AssetAnimator {
  private readonly items = new Map<string, Animated>();
  /** Same items as an array: the frame loop iterates it by index (no iterator allocation). */
  private readonly list: Animated[] = [];

  /** Number of animated entities. */
  get size(): number {
    return this.items.size;
  }

  /**
   * Start animating `root` (an instantiated asset) for entity `id`, whose
   * movement is read from `tracked`. `mode`: "auto" / undefined (locomotion),
   * "none" (rest pose) or a clip name to loop.
   */
  add(id: string, root: Object3D, tracked: Object3D, roles: Pick<CatalogAnims, 'idle' | 'walk' | 'run'>, mode: string | undefined): void {
    this.remove(id);
    const clips = root.animations;
    if (clips.length === 0 || mode === 'none') return;
    const mixer = new AnimationMixer(root);
    const action = (c: AnimationClip | null): AnimationAction | null => {
      if (!c) return null;
      const a = mixer.clipAction(c);
      a.setLoop(LoopRepeat, Infinity);
      return a;
    };
    const fixedClip = mode && mode !== 'auto' ? (clipNamed(clips, mode) ?? clips.find((c) => c.name.toLowerCase().includes(mode.toLowerCase())) ?? null) : null;
    const item: Animated = {
      root,
      tracked,
      mixer,
      idle: action(clipNamed(clips, roles.idle) ?? (fixedClip ? null : (clips[0] ?? null))),
      walk: action(clipNamed(clips, roles.walk)),
      run: action(clipNamed(clips, roles.run)),
      fixed: action(fixedClip),
      current: null,
      gait: 'idle',
      last: new Vector3(),
      speed: 0,
      primed: false,
    };
    item.current = item.fixed ?? item.idle;
    item.current?.play();
    tracked.getWorldPosition(item.last);
    mixer.update(0);
    this.items.set(id, item);
    this.list.push(item);
  }

  /** Stop and forget one entity's animation. */
  remove(id: string): void {
    const it = this.items.get(id);
    if (!it) return;
    it.mixer.stopAllAction();
    it.mixer.uncacheRoot(it.root);
    this.items.delete(id);
    const i = this.list.indexOf(it);
    if (i >= 0) this.list.splice(i, 1);
  }

  /** Current gait of an entity (tests / HUD), or null when it is not animated. */
  gaitOf(id: string): Gait | null {
    return this.items.get(id)?.gait ?? null;
  }

  /** Advance every animation by `dt` seconds. Returns true when anything animated (a redraw is needed). */
  update(dt: number): boolean {
    const list = this.list;
    if (list.length === 0 || !(dt > 0)) return false;
    const k = Math.min(1, dt * 8);
    for (let i = 0; i < list.length; i++) {
      const it = list[i] as Animated;
      it.tracked.getWorldPosition(_pos);
      const dx = _pos.x - it.last.x;
      const dz = _pos.z - it.last.z;
      it.last.copy(_pos);
      // The first frame after a teleport / load would read as a sprint: skip it.
      const raw = it.primed ? Math.sqrt(dx * dx + dz * dz) / dt : 0;
      it.primed = true;
      it.speed += (Math.min(raw, 30) - it.speed) * k;
      if (!it.fixed) this.applyGait(it);
      it.mixer.update(dt);
    }
    return true;
  }

  private applyGait(it: Animated): void {
    let gait = gaitFor(it.speed);
    if (gait === 'run' && !it.run) gait = it.walk ? 'walk' : 'idle';
    if (gait === 'walk' && !it.walk) gait = it.run ? 'run' : 'idle';
    const next = gait === 'run' ? it.run : gait === 'walk' ? it.walk : it.idle;
    if (next && gait !== 'idle') next.timeScale = Math.min(1.8, Math.max(0.6, it.speed / (gait === 'run' ? GAIT.runRef : GAIT.walkRef)));
    if (gait === it.gait || !next) return;
    const prev = it.current;
    next.reset().play();
    if (prev && prev !== next) prev.crossFadeTo(next, FADE_SECONDS, false);
    it.current = next;
    it.gait = gait;
  }

  /** Stop everything. */
  clear(): void {
    for (const id of [...this.items.keys()]) this.remove(id);
  }
}
