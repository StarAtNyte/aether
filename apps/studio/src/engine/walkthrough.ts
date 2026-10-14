/**
 * Walkthrough interactions while playing a world with a building:
 *
 * - 1–4: time-of-day presets (morning, midday, golden hour, night), shown
 *   without touching the document;
 * - E at a light switch (or right next to a lamp): switch that room's lights
 *   (the key is consumed so the door next to the switch stays as it is;
 *   away from switches E still opens doors);
 * - L: all lights on / off;
 * - R: swap the finish of the piece in front of you (sofa, armchair, rug,
 *   bed: `arch.variants`);
 * - V: first / third person;
 * - P: photo mode (interface hidden, studio render).
 *
 * Light and finish changes are runtime overrides: Stop restores the
 * document. The decisions are pure functions (unit-tested); the controller
 * only reads positions and applies overrides.
 */
import { worldTransform, type EntityId, type Json, type Vec3, type WorldDoc } from '@aether/core';
import type { StoreApi } from 'zustand/vanilla';
import type { StudioState } from '../state/store';
import { skyForHour, TIME_PRESETS } from '../state/archUi';
import type { Simulation } from './Simulation';

/** Reach (metres) of E at a light switch. */
export const SWITCH_REACH = 1.7;
/** Reach (metres) of E at a lamp. */
export const LAMP_REACH = 1.3;
/** Reach (metres) of R at a piece of furniture. */
export const SWAP_REACH = 3.2;
/** Most interactive pieces indexed per world. */
const MAX_TARGETS = 600;

/** An interactive piece at a world position. */
export interface WalkTarget {
  id: EntityId;
  kind: string;
  /** Room entity the piece belongs to (lights, switches). */
  room: string | null;
  position: Vec3;
}

/** A light source with its document intensity. */
export interface WalkLight {
  id: EntityId;
  room: string | null;
  intensity: number;
  /** The fitting has a `lit` param (its diffuser glows when on). */
  glows: boolean;
}

/** Interactive pieces of a world. */
export interface WalkIndex {
  switches: WalkTarget[];
  lamps: WalkTarget[];
  lights: WalkLight[];
  swappable: Array<WalkTarget & { variants: Array<Record<string, Json>> }>;
}

const LAMP_KINDS: ReadonlySet<string> = new Set(['floor-lamp', 'table-lamp', 'sconce', 'pendant', 'ceiling-light']);

/** Index the switches, lamps, light sources and swappable pieces of a world (bounded). */
export function walkIndex(world: WorldDoc): WalkIndex {
  const out: WalkIndex = { switches: [], lamps: [], lights: [], swappable: [] };
  let n = 0;
  for (const id in world.entities) {
    const e = world.entities[id];
    const a = e?.arch;
    if (!e || !a || n >= MAX_TARGETS) continue;
    const relevant = a.role === 'switch' || a.role === 'light' || (a.variants !== undefined && a.variants.length > 0);
    if (!relevant) continue;
    const t = worldTransform(world, id);
    if (!t) continue;
    n++;
    const target: WalkTarget = { id, kind: a.kind ?? a.role, room: a.room ?? null, position: [t.position[0], t.position[1], t.position[2]] };
    if (a.role === 'switch') out.switches.push(target);
    if (a.role === 'light' && LAMP_KINDS.has(a.kind ?? '')) out.lamps.push(target);
    if (e.light) out.lights.push({ id, room: a.room ?? null, intensity: e.light.intensity, glows: e.shape.kind === 'procedural' && e.shape.generator.startsWith('furn-') });
    if (a.variants && a.variants.length > 0) out.swappable.push({ ...target, variants: a.variants });
  }
  return out;
}

/**
 * Nearest target within `reach` of `pos` (horizontal distance, at most 2 m
 * above or below) that lies ahead: its direction makes a dot product of at
 * least `minDot` with the horizontal `forward` (ignored when the target is
 * within 0.6 m).
 */
export function nearestTarget<T extends WalkTarget>(targets: readonly T[], pos: Readonly<Vec3>, forward: readonly [number, number], reach: number, minDot = 0.2): T | null {
  let best: T | null = null;
  let bestD = reach;
  const fl = Math.hypot(forward[0], forward[1]) || 1;
  const fx = forward[0] / fl;
  const fz = forward[1] / fl;
  for (const t of targets) {
    const dx = t.position[0] - pos[0];
    const dz = t.position[2] - pos[2];
    if (Math.abs(t.position[1] - pos[1]) > 2) continue;
    const d = Math.hypot(dx, dz);
    if (d > bestD) continue;
    if (d > 0.6 && (dx * fx + dz * fz) / d < minDot) continue;
    bestD = d;
    best = t;
  }
  return best;
}

/** Lights switched by toggling `room` (null: every light); `on` is the new state for all of them. */
export function roomToggle(lights: readonly WalkLight[], state: ReadonlyMap<EntityId, boolean>, room: string | null): { ids: EntityId[]; on: boolean } {
  const ids = lights.filter((l) => room === null || l.room === room).map((l) => l.id);
  const anyOn = ids.some((id) => state.get(id) !== false);
  return { ids, on: !anyOn };
}

/** Next variant index (cycles; -1 = the document look comes after the last variant). */
export function nextVariant(current: number, count: number): number {
  if (count <= 0) return -1;
  return current + 1 >= count ? -1 : current + 1;
}

/** The studio surface the walkthrough needs. */
export interface WalkHost {
  readonly store: StoreApi<StudioState>;
  readonly history: { readonly current: WorldDoc };
  setCameraView(view: 'orbit' | 'follow' | 'firstPerson'): void;
}

/** Keyboard interactions of a building walkthrough (attached while playing a world with a building). */
export class Walkthrough {
  private index: WalkIndex;
  private readonly lightOn = new Map<EntityId, boolean>();
  private readonly variant = new Map<EntityId, number>();
  private hour: number | null = null;

  constructor(
    private readonly host: WalkHost,
    private readonly sim: Simulation,
  ) {
    this.index = walkIndex(sim.syncedWorld ?? host.history.current);
    for (const l of this.index.lights) this.lightOn.set(l.id, true);
    window.addEventListener('keydown', this.onKey, true);
  }

  /** The world shows a building (the walkthrough applies). */
  static applies(world: WorldDoc): boolean {
    for (const id in world.entities) if (world.entities[id]?.arch?.role === 'building') return true;
    return false;
  }

  /** Player position: the walking capsule, else the camera. */
  private position(): Vec3 {
    const p = this.sim.playerPosition;
    if (p) return [p[0], p[1], p[2]];
    const c = this.sim.renderer.camera.position;
    return [c.x, c.y, c.z];
  }

  private forward(): [number, number] {
    const m = this.sim.renderer.camera.matrixWorld.elements;
    // Camera looks down its −Z axis.
    return [-(m[8] as number), -(m[10] as number)];
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const st = this.host.store.getState();
    if (st.mode !== 'play') return;
    const key = e.key.toLowerCase();
    const preset = TIME_PRESETS.find((p) => p.key === key);
    if (preset) {
      this.setHour(preset.hour, preset.label);
      return;
    }
    if (key === 'e') {
      if (this.switchNearby()) {
        // The door next to the switch must not swing as well.
        e.stopImmediatePropagation();
        e.preventDefault();
      }
      return;
    }
    if (key === 'l') this.toggleLights(null, 'All lights');
    else if (key === 'r') this.swapNearby();
    else if (key === 'v') {
      const next = st.cameraView === 'firstPerson' ? 'follow' : 'firstPerson';
      this.host.setCameraView(next);
      st.toast(next === 'firstPerson' ? 'First person' : 'Third person', 'game', 1.2);
    } else if (key === 'p') {
      const photo = !st.arch.photo;
      st.setArch({ photo });
      if (photo) st.toast('Photo mode: hold still for a clean render · P to leave', 'game', 2.5);
    }
  };

  private setHour(hour: number, label: string): void {
    this.hour = hour;
    const env = this.host.history.current.environment;
    const sky = skyForHour(hour);
    this.sim.renderer.setEnvironmentOverride({ ...env, sky: sky.sky, timeOfDay: sky.timeOfDay, bloom: sky.sky === 'night' ? Math.max(env.bloom, 0.9) : env.bloom });
    // Evening and night: lamps come on by themselves.
    if (sky.sky === 'night' || sky.sky === 'sunset') this.setLights(this.index.lights.map((l) => l.id), true);
    this.host.store.getState().toast(label, 'game', 1.4);
  }

  /** E at a switch or lamp: toggle; returns true when something was switched. */
  private switchNearby(): boolean {
    const pos = this.position();
    const fwd = this.forward();
    const sw = nearestTarget(this.index.switches, pos, fwd, SWITCH_REACH, 0);
    if (sw) {
      this.toggleLights(sw.room, 'Lights');
      return true;
    }
    const lamp = nearestTarget(this.index.lamps, pos, fwd, LAMP_REACH, 0.3);
    if (lamp && (lamp.kind === 'floor-lamp' || lamp.kind === 'table-lamp')) {
      const on = this.lightOn.get(lamp.id) === false;
      this.setLights([lamp.id], on);
      this.host.store.getState().toast(on ? 'Lamp on' : 'Lamp off', 'game', 1);
      return true;
    }
    return false;
  }

  private toggleLights(room: string | null, label: string): void {
    const { ids, on } = roomToggle(this.index.lights, this.lightOn, room);
    if (ids.length === 0) return;
    this.setLights(ids, on);
    this.host.store.getState().toast(`${label} ${on ? 'on' : 'off'}`, 'game', 1);
  }

  private setLights(ids: readonly EntityId[], on: boolean): void {
    const r = this.sim.renderer;
    for (const id of ids) {
      const l = this.index.lights.find((x) => x.id === id);
      if (!l || this.lightOn.get(id) === on) continue;
      this.lightOn.set(id, on);
      r.setEntityProperty(id, 'light.intensity', on ? l.intensity : 0);
      if (l.glows) r.setEntityProperty(id, 'shape.params.lit', on);
    }
  }

  private swapNearby(): void {
    const piece = nearestTarget(this.index.swappable, this.position(), this.forward(), SWAP_REACH, 0.35);
    const st = this.host.store.getState();
    if (!piece) {
      st.toast('Stand in front of a sofa, chair, rug or bed to change its finish', 'game', 1.6);
      return;
    }
    const next = nextVariant(this.variant.get(piece.id) ?? -1, piece.variants.length);
    this.variant.set(piece.id, next);
    const doc = this.host.history.current.entities[piece.id];
    const docParams = doc?.shape.kind === 'procedural' ? doc.shape.params : {};
    const look = next >= 0 ? (piece.variants[next] ?? {}) : null;
    const keys = new Set([...Object.keys(look ?? {}), ...piece.variants.flatMap((v) => Object.keys(v))]);
    for (const k of keys) {
      if (!/^[a-z][a-zA-Z0-9]{0,31}$/.test(k)) continue;
      const value = look && Object.hasOwn(look, k) ? look[k] : docParams[k];
      if (value !== undefined) this.sim.renderer.setEntityProperty(piece.id, `shape.params.${k}`, value as Json);
    }
    st.toast(next >= 0 ? `Finish ${next + 1} of ${piece.variants.length}` : 'Original finish', 'game', 1);
  }

  /** The sun hour chosen with 1–4 (null: the document's). */
  get timeOfDay(): number | null {
    return this.hour;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, true);
    if (this.hour !== null) this.sim.renderer.restoreEnvironment();
    this.hour = null;
  }
}
