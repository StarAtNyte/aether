/**
 * The renderer's game-feel layer: the particle effects (`vfx/`) and the
 * feel director (shake, hit-stop, FOV kick, pulses, squash) behind one
 * object the studio talks to (`WorldRenderer.fx`).
 *
 * Presentation only. The simulation never reads anything from here, and the
 * renderer applies the camera shake for the draw alone (see `director.ts`).
 */
import { resolveFeelCue, type EntityId, type FeelEvent, type ResolvedCue, type VfxPreset, type WorldDoc } from '@aether/core';
import type { Camera, Color, Object3D, PerspectiveCamera } from 'three';
import { mixSeed } from '../vfx/pool';
import { VfxSystem, type BurstOptions } from '../vfx/system';
import { FeelDirector } from './director';

/** One played cue as the studio sees it (for floating text, rumble and ducking, which live outside the renderer). */
export interface PlayedCue {
  cue: ResolvedCue;
  kind: FeelEvent | null;
  at: readonly [number, number, number] | null;
  amount: number | undefined;
}

/** Things the layer needs from its renderer. */
export interface FeelHost {
  /** The entity's scene object (emitters follow it), if mounted. */
  object(id: EntityId): Object3D | undefined;
}

const scratchSquash = { y: 1, xz: 1 };

/** Game feel of one renderer. */
export class GameFeel {
  readonly vfx: VfxSystem;
  readonly director = new FeelDirector();
  private feel: WorldDoc['feel'] = undefined;
  private worldSeed = 1;
  private emitterKey = '';
  private readonly keep = new Set<string>();
  /** True in play mode: camera shake and FOV kicks apply only then (entity emitters run in the editor too). */
  playing = false;
  /** Freeze the effects clock and the cues (tests, posed captures); {@link VfxSystem.update} can still be driven by hand. */
  paused = false;
  /** A preview in the editor shakes the camera like play mode until its cue has played out. */
  private previewing = false;

  constructor(parent: { add(o: Object3D): unknown }, tier: 'low' | 'medium' | 'high' | 'ultra', lowMemory: boolean, private readonly host: FeelHost) {
    this.vfx = new VfxSystem(parent, tier, lowMemory);
  }

  /** Track a world: its feel, its seed and the emitters of its entities. */
  setWorld(world: WorldDoc): void {
    this.feel = world.feel;
    if (world.seed !== this.worldSeed) {
      this.worldSeed = world.seed;
      this.vfx.setWorldSeed(world.seed);
      this.director.setSeed(world.seed);
    }
    this.syncEmitters(world);
  }

  /** (Re)attach the emitters of `world`'s entities to their scene objects (cheap when nothing changed). */
  syncEmitters(world: WorldDoc, extra?: Iterable<{ id: EntityId; vfx?: WorldDoc['entities'][string]['vfx'] }>): void {
    const keep = this.keep;
    keep.clear();
    let key = '';
    const visit = (id: EntityId, spec: WorldDoc['entities'][string]['vfx']): void => {
      if (!spec || !spec.enabled) return;
      const obj = this.host.object(id);
      if (!obj) return;
      keep.add(id);
      key += `${id}:${obj.uuid}:${spec.preset}:${spec.rate ?? ''}:${spec.color ?? ''}:${spec.scale ?? ''}:${spec.offset?.join(',') ?? ''};`;
      this.vfx.setEmitter(id, spec, obj);
    };
    for (const id in world.entities) {
      const e = world.entities[id];
      if (e && e.vfx && !e.template) visit(id, e.vfx);
    }
    if (extra) for (const e of extra) if (e.vfx) visit(e.id, e.vfx);
    // Flames of held props are not world entities: they stay until their rig says otherwise.
    for (const id of this.props) keep.add(id);
    if (key !== this.emitterKey || keep.size !== this.vfx.emitterCount) {
      this.emitterKey = key;
      this.vfx.retainEmitters(keep);
    }
  }

  /** Emitter ids of held props (torches in hands). */
  private readonly props = new Set<string>();

  /** A character's held prop changed: a flame gets a small fire that follows it (`null` removes it). */
  propEmitter(bodyId: string, flame: Object3D | null): void {
    const id = `prop:${bodyId}`;
    if (flame) {
      this.props.add(id);
      this.vfx.setEmitter(id, { preset: 'fire', scale: 0.42, rate: 34, enabled: true }, flame);
    } else {
      this.props.delete(id);
      this.vfx.setEmitter(id, null, null);
    }
  }

  /** The cue of `event` in the current world's feel. */
  cueOf(event: FeelEvent, intensity = 1): ResolvedCue {
    return resolveFeelCue(this.feel, event, intensity);
  }

  /** True when the world asks for footstep dust (default yes). */
  get footsteps(): boolean {
    return this.feel?.footsteps !== false && this.feel?.preset !== 'off';
  }

  /**
   * Play a feel event (and its burst) at a place. `vfx` overrides the cue's burst (the `effect` action); `seed`
   * makes the burst deterministic (the logic tick of the event).
   */
  trigger(kind: FeelEvent | null, at: readonly [number, number, number] | null, opts: { seed: number; vfx?: VfxPreset | 'none'; color?: string; scale?: number; intensity?: number; amount?: number; floorY?: number; stretch?: boolean; preview?: boolean } = { seed: 0 }): PlayedCue | null {
    if (opts.preview) this.previewing = true;
    const cue = kind ? this.cueOf(kind, opts.intensity ?? 1) : null;
    const preset = opts.vfx ?? cue?.vfx ?? 'none';
    if (at && preset !== 'none') {
      const b: BurstOptions = { seed: mixSeed(opts.seed, kind ? kind.length * 7919 : 1, Math.round(at[0] * 10), Math.round(at[2] * 10)) };
      const scale = opts.scale ?? cue?.vfxScale;
      if (scale !== undefined) b.scale = scale;
      const color = opts.color ?? cue?.vfxColor;
      if (color) b.color = color;
      if (opts.floorY !== undefined) b.floorY = opts.floorY;
      this.vfx.burst(preset, at[0], at[1], at[2], b);
    }
    if (!cue) return null;
    this.director.play(cue, { seed: opts.seed, stretch: opts.stretch === true });
    return { cue, kind, at, amount: opts.amount };
  }

  /** Light of the alpha-blended effects from the scene's sun and sky (call when the environment changes). */
  setLighting(sun: { color: Color; intensity: number }, hemi: { color: Color; intensity: number }): void {
    const s = Math.max(0, sun.intensity) * 0.22;
    const h = Math.max(0, hemi.intensity) * 0.55;
    const k = 0.12;
    const r = Math.min(1.4, k + sun.color.r * s + hemi.color.r * h);
    const g = Math.min(1.4, k + sun.color.g * s + hemi.color.g * h);
    const b = Math.min(1.4, k + sun.color.b * s + hemi.color.b * h);
    this.vfx.setLighting(r, g, b);
  }

  /** Advance one frame by `dt` real seconds; returns the scale of game time (hit-stop). */
  frame(dt: number, camera: Camera, avatar: Object3D | null): number {
    this.director.update(this.paused ? 0 : dt);
    if (this.previewing && !this.director.active) this.previewing = false;
    const scale = this.director.timeScale;
    this.vfx.update(this.paused ? 0 : dt * scale, camera);
    if (avatar) {
      const s = this.director.squash(scratchSquash);
      if (avatar.scale.y !== s.y || avatar.scale.x !== s.xz) avatar.scale.set(s.xz, s.y, s.xz);
    }
    return scale;
  }

  /** True while effects or cues still move (keep drawing). */
  get animating(): boolean {
    return this.vfx.animating || this.director.active;
  }

  /** Shake and FOV kick for the draw. */
  beforeDraw(camera: PerspectiveCamera): void {
    if (this.playing || this.previewing) this.director.apply(camera);
  }

  afterDraw(camera: PerspectiveCamera): void {
    this.director.restore(camera);
  }

  /** Stop every running cue and burst (session end). Entity emitters stay. */
  reset(): void {
    this.director.reset();
  }

  dispose(): void {
    this.vfx.dispose();
  }
}
