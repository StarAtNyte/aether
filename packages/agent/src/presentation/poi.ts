/**
 * Points of interest of a world for its presentation (the short film, the review frames): the established views (the
 * opening view, the ranked hero views, the tour stops the renderer or the world holds), the hero shots, the landmark,
 * the people and the spawn. Pure: the host supplies the renderer's views (`PresentationViews`); without them the world's
 * own `opening` and `views` and the hero shots computed from the IR are used.
 */
import type { Entity, Vec3, WorldDoc } from '@aether/core';
import { heroShots, landmark } from '../hardcore';

/** A camera pose (world metres; vertical field of view in degrees). */
export interface PoseLike {
  position: Vec3;
  target: Vec3;
  fov?: number;
}

/** The renderer's established views of the current scene (see `AgentHost.presentationViews`). */
export interface PresentationViews {
  /** The view the world opens on (its own `opening`, else the computed one). */
  opening: PoseLike | null;
  /** The best computed opening views, best first (the grand-view scoring). */
  ranked: ReadonlyArray<PoseLike & { score?: number }>;
  /** Tour stops (the world's own `views`, else computed: rooms of a building, sections of a scene). */
  stops: ReadonlyArray<PoseLike & { name?: string }>;
}

export type PoiKind = 'opening' | 'view' | 'stop' | 'hero' | 'landmark' | 'character' | 'spawn';

/** One point of interest. */
export interface PointOfInterest {
  /** Stable id the story tool refers to ("opening", "view-2", "stop-1", "landmark", "char-kaho", "spawn"). */
  id: string;
  kind: PoiKind;
  label: string;
  /** What is looked at (the subject's middle). */
  at: Vec3;
  /** Rough size of the subject (m). */
  radius: number;
  /** An established camera for it (views, stops, hero shots); absent for subjects (landmark, people, spawn). */
  pose?: PoseLike;
  /** The entity it is (people, the landmark). */
  entity?: string;
  /** Whether the pose was checked by the renderer (views and stops are; hero shots are placed from bounds). */
  probed?: boolean;
}

const finite3 = (v: readonly number[] | undefined): v is Vec3 => !!v && v.length === 3 && v.every(Number.isFinite);

/** Rough half-size of an entity (m): its primitive's size times its scale, else its scale. */
export function entityRadius(e: Entity): number {
  const s = e.transform.scale;
  const shape = e.shape as { kind: string; size?: unknown };
  const size = shape.kind === 'primitive' && Array.isArray(shape.size) && shape.size.length === 3 ? (shape.size as number[]) : [1, 1, 1];
  const r = Math.max(Math.abs((size[0] ?? 1) * s[0]), Math.abs((size[1] ?? 1) * s[1]), Math.abs((size[2] ?? 1) * s[2])) / 2;
  return Number.isFinite(r) ? Math.max(0.3, Math.min(400, r)) : 1;
}

/** People of a world: characters and NPCs that are drawn (not templates), at most `max`. */
export function worldPeople(world: WorldDoc, max = 6): Entity[] {
  const out: Entity[] = [];
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (e.template || !e.visible) continue;
    if (e.character || e.npc) out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

function nameOf(e: Entity): string {
  return (e.name || e.npc?.role || e.id).slice(0, 40);
}

/** The points of interest of `world`, the established views first. */
export function pointsOfInterest(world: WorldDoc, views: PresentationViews | null): PointOfInterest[] {
  const out: PointOfInterest[] = [];
  const add = (p: PointOfInterest): void => {
    if (!finite3(p.at) || (p.pose && (!finite3(p.pose.position) || !finite3(p.pose.target)))) return;
    out.push(p);
  };
  const opening = views?.opening ?? world.opening ?? null;
  if (opening) add({ id: 'opening', kind: 'opening', label: 'the opening view', at: [...opening.target], radius: 8, pose: copyPose(opening), probed: true });
  (views?.ranked ?? []).slice(0, 6).forEach((v, i) => {
    if (opening && near(v.position, opening.position, 2)) return;
    add({ id: `view-${i + 1}`, kind: 'view', label: `hero view ${i + 1} (ranked)`, at: [...v.target], radius: 8, pose: copyPose(v), probed: true });
  });
  const stops = world.views ?? views?.stops ?? [];
  stops.slice(0, 10).forEach((v, i) => add({ id: `stop-${i + 1}`, kind: 'stop', label: v.name ? `tour stop "${v.name}"` : `tour stop ${i + 1}`, at: [...v.target], radius: 6, pose: copyPose(v), probed: true }));
  for (const s of heroShots(world)) add({ id: s.name, kind: 'hero', label: s.label, at: [...s.pose.target], radius: 12, pose: { position: [...s.pose.position], target: [...s.pose.target], fov: s.pose.fov } });
  const mark = landmark(world);
  if (mark) {
    const ent = landmarkEntity(world, mark);
    add({ id: 'landmark', kind: 'landmark', label: ent ? `the landmark, ${nameOf(ent)}` : 'the landmark', at: mark, radius: ent ? entityRadius(ent) : 6, ...(ent ? { entity: ent.id } : {}) });
  }
  for (const e of worldPeople(world)) {
    const p = e.transform.position;
    add({ id: `char-${e.id}`.slice(0, 64), kind: 'character', label: `a person, ${nameOf(e)}`, at: [p[0], p[1] + 0.6, p[2]], radius: 1, entity: e.id });
  }
  const s = world.player.spawn;
  add({ id: 'spawn', kind: 'spawn', label: 'where the visitor arrives (the play spawn)', at: [s[0], s[1] + 0.6, s[2]], radius: 2 });
  return out;
}

function landmarkEntity(world: WorldDoc, at: Vec3): Entity | null {
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    const p = e.transform.position;
    if (p[0] === at[0] && p[1] === at[1] && p[2] === at[2]) return e;
  }
  return null;
}

function copyPose(p: PoseLike): PoseLike {
  return { position: [...p.position], target: [...p.target], ...(p.fov !== undefined ? { fov: p.fov } : {}) };
}

function near(a: readonly number[], b: readonly number[], d: number): boolean {
  return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0)) < d;
}

/** One line per point of interest, for a model. */
export function poiText(pois: readonly PointOfInterest[]): string {
  const f = (v: readonly number[]): string => `[${v.map((x) => Math.round(x * 10) / 10).join(',')}]`;
  return pois.map((p) => `- ${p.id} (${p.kind}): ${p.label}; looks at ${f(p.at)}${p.pose ? `, camera ${f(p.pose.position)}` : ', no camera of its own (the tool frames it)'}`).join('\n');
}
