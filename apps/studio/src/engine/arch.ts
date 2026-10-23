/**
 * Architecture controller: keeps the architecture UI state (`state/archUi`)
 * and the renderer in step — building view modes (cutaway, exploded levels,
 * x-ray, section), render quality (realtime / studio still), the daylight
 * study — and turns floor-plan drawing into `@aether/arch` ops committed as
 * ordinary undoable edits (the same validation, compilation and usability
 * checks as the agent's `build_architecture`).
 *
 * View modes are suspended while playing (the walkthrough needs every wall)
 * and come back on Stop.
 */
import type { StoreApi } from 'zustand/vanilla';
import type { History, Patch, WorldDoc } from '@aether/core';
import { applyArchOps, doorAtOp, drawRoomCandidates, floorPlan2d, listBuildings, listLevels, planOf, planToWorld, PlanError, windowAtOp, type P2 } from '@aether/arch';
import type { StudioState } from '../state/store';
import { skyForHour, type ArchUiState } from '../state/archUi';
import type { Simulation } from './Simulation';
import { Walkthrough } from './walkthrough';
import { createLogger } from '../lib/log';
import { REVEAL_SECONDS, cameraArc, cameraAt, revealPhase, sectionHeightFor, type CameraArc } from '../lib/reveal';

const log = createLogger('arch');

/** What the controller needs from the studio. */
export interface ArchHost {
  readonly store: StoreApi<StudioState>;
  readonly history: History;
  readonly simulation: Simulation | null;
  onSimulation(fn: (sim: Simulation | null) => void): () => void;
  commitUser(patches: Patch[] | unknown[], message: string): string | null;
  setCameraView(view: 'orbit' | 'follow' | 'firstPerson'): void;
}

/** Result of a plan edit: null on success, else the message shown to the user. */
export type ArchEditResult = string | null;

/** Building view state of a fresh building: single storeys open as a doll's house (cutaway). */
export function initialViewFor(levels: number): Pick<ArchUiState, 'walls' | 'levelMode' | 'xray' | 'section' | 'level'> {
  return { walls: levels <= 1 ? 'cutaway' : 'up', levelMode: 'stacked', xray: false, section: null, level: 0 };
}

/** Applies the architecture UI state to the renderer and edits buildings from the plan tools. */
export class ArchController {
  private readonly cleanups: Array<() => void> = [];
  private seen = new Set<string>();
  /** View saved when play started (restored on Stop). */
  private saved: Pick<ArchUiState, 'walls' | 'levelMode' | 'xray' | 'section' | 'plan'> | null = null;
  private lastEnv: WorldDoc['environment'] | null = null;
  /** Walkthrough interactions of the running play session (buildings only). */
  private walk: Walkthrough | null = null;
  /** The running plan reveal (animation frame, start time, camera path, the view to restore). */
  private revealing: { raf: number; t: number; last: number; seconds: number; arc: CameraArc; radius: number; total: number; saved: Pick<ArchUiState, 'walls' | 'levelMode' | 'xray' | 'section'>; lastSection: number | null } | null = null;

  constructor(private readonly host: ArchHost) {
    this.refreshBuildings(host.history.current, true);
    this.cleanups.push(
      host.history.subscribe((world) => {
        this.refreshBuildings(world, false);
        // A document environment change replaces the daylight-study override: re-apply it.
        if (world.environment !== this.lastEnv) {
          this.lastEnv = world.environment;
          if (host.store.getState().arch.sunHour !== null) this.applySun();
        }
      }),
      host.store.subscribe((s, prev) => {
        if (s.arch !== prev.arch) this.apply(s.arch, prev.arch);
        if (s.mode !== prev.mode) this.onMode(s.mode);
      }),
      host.onSimulation((sim) => {
        if (sim) {
          // Only a fallback (the studio pipeline failed on this device) is reported back to the UI;
          // studio quality asked for by photo mode is not the user's choice and must not stick.
          sim.renderer.onQualityChange = (q) => {
            const st = host.store.getState();
            if (q === 'realtime' && !sim.renderer.studioQualityAvailable) st.setArch({ quality: 'realtime', photo: false, studioAvailable: false });
          };
          this.applyAll();
        }
      }),
    );
    this.lastEnv = host.history.current.environment;
  }

  /** Update the building list / storeys; fresh buildings get their initial view. */
  private refreshBuildings(world: WorldDoc, initial: boolean): void {
    const st = this.host.store.getState();
    const buildings = listBuildings(world);
    if (buildings.length === 0) {
      this.seen.clear();
      if (st.arch.building !== null) st.setArch({ building: null, levels: [], walls: 'up', levelMode: 'stacked', xray: false, section: null, plan: false, level: 0 });
      return;
    }
    const fresh = buildings.find((b) => !this.seen.has(b.id));
    this.seen = new Set(buildings.map((b) => b.id));
    const current = buildings.find((b) => b.id === st.arch.building);
    const id = fresh && !initial ? fresh.id : (current?.id ?? (buildings[0] as { id: string }).id);
    const levels = listLevels(world, id).map((l) => ({ index: l.index, name: l.name, height: l.height }));
    const patch: Partial<ArchUiState> = { building: id, levels };
    if (fresh && (!initial || st.arch.building === null)) Object.assign(patch, initialViewFor(levels.length));
    st.setArch(patch);
  }

  private applyAll(): void {
    this.apply(this.host.store.getState().arch, null);
  }

  /** View modes are cosmetic: a renderer failure here is logged, never fatal to the studio. */
  private apply(a: ArchUiState, prev: ArchUiState | null): void {
    try {
      this.applyUnsafe(a, prev);
    } catch (e) {
      log.warn('architecture view update failed', e);
    }
  }

  private applyUnsafe(a: ArchUiState, prev: ArchUiState | null): void {
    const sim = this.host.simulation;
    if (!sim) return;
    const r = sim.renderer;
    if (!prev || a.walls !== prev.walls || a.levelMode !== prev.levelMode || a.level !== prev.level || a.xray !== prev.xray || a.section !== prev.section) {
      r.setArchView({ walls: a.walls, levels: a.levelMode, level: a.level, xray: a.xray, section: a.section });
    }
    if (!prev || a.quality !== prev.quality || a.photo !== prev.photo) {
      const want = a.quality === 'studio' || a.photo ? 'studio' : 'realtime';
      const got = r.setRenderQuality(want);
      const st = this.host.store.getState();
      if (want === 'studio' && got !== 'studio') {
        st.setArch({ quality: 'realtime', studioAvailable: false });
        // Studio is the default view: a device that cannot run it falls back silently; only a click on the button explains.
        if (prev) st.toast('Studio render is not available on this device (low memory mode or no post-processing). Showing the realtime view.', 'info', 5);
      } else if (st.arch.studioAvailable !== r.studioQualityAvailable) st.setArch({ studioAvailable: r.studioQualityAvailable });
    }
    if (!prev || a.sunHour !== prev.sunHour) this.applySun();
  }

  /** Daylight study: show the chosen sun hour without touching the document. */
  private applySun(): void {
    const sim = this.host.simulation;
    if (!sim) return;
    const hour = this.host.store.getState().arch.sunHour;
    if (hour === null) {
      sim.renderer.restoreEnvironment();
      return;
    }
    const env = this.host.history.current.environment;
    const sky = skyForHour(hour);
    sim.renderer.setEnvironmentOverride({ ...env, sky: sky.sky, timeOfDay: sky.timeOfDay, fog: env.fog, bloom: sky.sky === 'night' ? Math.max(env.bloom, 0.9) : env.bloom });
  }

  /** Play hides the view modes (the walkthrough needs walls and ceilings); Stop brings them back. */
  private onMode(mode: StudioState['mode']): void {
    const st = this.host.store.getState();
    this.cancelReveal();
    this.walk?.dispose();
    this.walk = null;
    if (mode === 'play') {
      const a = st.arch;
      this.saved = { walls: a.walls, levelMode: a.levelMode, xray: a.xray, section: a.section, plan: a.plan };
      st.setArch({ walls: 'up', levelMode: 'stacked', xray: false, section: null, plan: false });
      const sim = this.host.simulation;
      if (sim && Walkthrough.applies(this.host.history.current)) this.walk = new Walkthrough(this.host, sim);
    } else {
      const saved = this.saved;
      this.saved = null;
      st.setArch({ ...(saved ?? {}), photo: false });
    }
  }

  /** Apply architecture ops as one undoable user edit; returns an error message or null. */
  edit(ops: unknown[], message: string): ArchEditResult {
    const st = this.host.store.getState();
    if (st.mode === 'play') return 'Stop the walkthrough before editing the building.';
    const res = applyArchOps(this.host.history.current, ops);
    const first = res.errors[0];
    if (first) {
      const text = `${first.message}. ${first.hint}`;
      st.toast(text, 'error', 6);
      return text;
    }
    if (res.patches.length === 0) return null;
    const err = this.host.commitUser(res.patches, message);
    if (err) return err;
    const failing = res.reports.flatMap((r) => r.issues);
    if (failing[0]) st.toast(`${failing[0].message} — ${failing[0].hint}`, 'info', 6);
    return null;
  }

  private planFor(): { building: string; plan: ReturnType<typeof planOf>; level: number } | string {
    const a = this.host.store.getState().arch;
    if (!a.building) return 'There is no building to edit.';
    try {
      return { building: a.building, plan: planOf(this.host.history.current, a.building), level: a.level };
    } catch (e) {
      return e instanceof PlanError ? `${e.message}. ${e.hint}` : 'This building cannot be edited.';
    }
  }

  private guarded(fn: (p: { building: string; plan: ReturnType<typeof planOf>; level: number }) => { ops: unknown[]; message: string }): ArchEditResult {
    const target = this.planFor();
    const st = this.host.store.getState();
    if (typeof target === 'string') {
      st.toast(target, 'info', 4);
      return target;
    }
    try {
      const { ops, message } = fn(target);
      return this.edit(ops, message);
    } catch (e) {
      const text = e instanceof PlanError ? `${e.message}. ${e.hint}` : 'That edit could not be made.';
      st.toast(text, 'info', 5);
      return text;
    }
  }

  /**
   * Add a room drawn on the plan (outline in plan coordinates). Door
   * placements are tried in order (mid-wall, near either end, other
   * neighbours, an entrance) and the first that leaves every room reachable
   * is committed — furniture in the neighbouring room can block a door.
   */
  drawRoom(points: readonly P2[]): ArchEditResult {
    const type = this.host.store.getState().arch.roomType;
    return this.guarded(({ plan, level }) => {
      const candidates = drawRoomCandidates(plan, level, points, type);
      const world = this.host.history.current;
      for (const op of candidates) {
        const res = applyArchOps(world, [op]);
        if (res.errors.length === 0 && res.reports.every((r) => r.passed)) return { ops: [op], message: `Draw ${type} room` };
      }
      return { ops: [candidates[0] as Record<string, unknown>], message: `Draw ${type} room` };
    });
  }

  /** Add a door where the plan was clicked. */
  addDoor(p: P2): ArchEditResult {
    return this.guarded(({ plan, level }) => ({ ops: [doorAtOp(plan, level, p)], message: 'Add door' }));
  }

  /** Add a window where the plan was clicked. */
  addWindow(p: P2): ArchEditResult {
    return this.guarded(({ plan, level }) => ({ ops: [windowAtOp(plan, level, p)], message: 'Add window' }));
  }

  /** Remove a room by its plan id or room entity id. */
  removeRoom(room: string): ArchEditResult {
    return this.guarded(({ building }) => ({ ops: [{ op: 'remove_room', building, room }], message: 'Remove room' }));
  }

  /** Change the building's style / roof (ArchBar shortcuts). */
  restyle(op: Record<string, unknown>, message: string): ArchEditResult {
    return this.guarded(({ building }) => ({ ops: [{ ...op, building }], message }));
  }

  /**
   * Plan reveal: the floor plan is drawn in ink on paper (the overlay), then the
   * walls rise out of it (an animated section cut) while the camera comes down
   * from overhead to where the editor camera was. Any click, key or Stop skips to
   * the end; the previous view comes back. Returns false when there is nothing to
   * reveal (no building, playing, no renderer).
   */
  startReveal(seconds = REVEAL_SECONDS): boolean {
    if (!this.beginReveal(seconds)) return false;
    const tick = (): void => {
      const r = this.revealing;
      if (!r) return;
      // Frame time, clamped: a slow device plays the reveal slower instead of skipping the ink.
      const now = performance.now();
      r.t = Math.min(1, r.t + Math.min(0.06, (now - r.last) / 1000) / r.seconds);
      r.last = now;
      this.applyReveal(r.t);
      if (r.t >= 1) this.finishReveal();
      else r.raf = requestAnimationFrame(tick);
    };
    if (this.revealing) this.revealing.raf = requestAnimationFrame(tick);
    return true;
  }

  /**
   * Show one frame of the reveal and hold it (stills, tests, a scrubber): `t` in 0..1.
   * Starts the reveal if it is not running; {@link cancelReveal} ends it.
   */
  scrubReveal(t: number): boolean {
    if (!this.revealing && !this.beginReveal(REVEAL_SECONDS)) return false;
    const r = this.revealing;
    if (!r) return false;
    cancelAnimationFrame(r.raf);
    r.t = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
    this.applyReveal(r.t);
    return true;
  }

  private beginReveal(seconds: number): boolean {
    const st = this.host.store.getState();
    const sim = this.host.simulation;
    const id = st.arch.building;
    if (!sim || !id || st.mode !== 'edit') return false;
    const world = this.host.history.current;
    const building = world.entities[id];
    const plan = floorPlan2d(world, id, 0);
    if (!building || !plan) return false;
    this.cancelReveal();
    const total = listLevels(world, id).reduce((s, l) => s + l.height, 0) || 3;
    const [x0, z0, x1, z1] = plan.bounds;
    const c = planToWorld([building.transform.position[0], building.transform.position[2]], building.transform.rotation[1], [(x0 + x1) / 2, (z0 + z1) / 2]);
    const centre: [number, number, number] = [c[0], building.transform.position[1] + total * 0.4, c[1]];
    const cam = sim.renderer.camera.position;
    const arc = cameraArc(centre, [cam.x, cam.y, cam.z]);
    const radius = Math.hypot(x1 - x0, z1 - z0) / 2 + 3;
    const a = st.arch;
    const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return false;
    this.revealing = { raf: 0, t: 0, last: performance.now(), seconds: Math.max(1, Math.min(30, seconds)), arc, radius, total, saved: { walls: a.walls, levelMode: a.levelMode, xray: a.xray, section: a.section }, lastSection: null };
    st.setArch({ plan: false, walls: 'up', levelMode: 'stacked', xray: false, section: 0.12, reveal: 0 });
    return true;
  }

  private applyReveal(t: number): void {
    const r = this.revealing;
    if (!r) return;
    const phase = revealPhase(t);
    const section = sectionHeightFor(phase.rise, r.total);
    const patch: Partial<ArchUiState> = { reveal: t };
    if (section !== r.lastSection) {
      r.lastSection = section;
      patch.section = section;
    }
    this.host.store.getState().setArch(patch);
    const pose = cameraAt(r.arc, phase.cam);
    this.host.simulation?.renderer.setCameraPose(pose.position[0], pose.position[1], pose.position[2], pose.yaw, pose.pitch);
  }

  /** Skip the running reveal to its end (the walls stand, the previous view is back). */
  cancelReveal(): void {
    if (this.revealing) this.finishReveal();
  }

  private finishReveal(): void {
    const r = this.revealing;
    if (!r) return;
    this.revealing = null;
    cancelAnimationFrame(r.raf);
    const st = this.host.store.getState();
    const sim = this.host.simulation;
    st.setArch({ ...r.saved, reveal: null });
    if (sim) {
      // Back to the orbit camera at the pose the reveal ended on.
      const end = cameraAt(r.arc, 1);
      sim.renderer.setCameraMode('orbit');
      sim.renderer.frameSphere(r.arc.centre, r.radius, [end.position[0] - r.arc.centre[0], end.position[1] - r.arc.centre[1], end.position[2] - r.arc.centre[2]], 0);
    }
  }

  /** True while the plan reveal runs. */
  get isRevealing(): boolean {
    return this.revealing !== null;
  }

  /** The walkthrough of the running play session (tests, debug handle). */
  get walkthrough(): Walkthrough | null {
    return this.walk;
  }

  dispose(): void {
    this.cancelReveal();
    this.walk?.dispose();
    this.walk = null;
    for (const c of this.cleanups.splice(0)) c();
    const sim = this.host.simulation;
    if (sim) sim.renderer.onQualityChange = null;
  }
}
