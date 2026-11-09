/**
 * The world-quality pass: the checks every world gets after the AI builds or edits it and again at publish (docs/WORLD-
 * QUALITY.md). Each check is a detector with, where one exists, a fix through the world's own fields; the visual checks
 * are judged by the AI from renders (`reviewShots`, whose checklist carries them).
 *
 * The data detectors here need no renderer: opening and hero views (eye height, the sunlit side, the near zone at the
 * walk lens, top-down or horizon-less aerials), playability (spawn on the ground, colliders on static meshes), scale
 * (doors, stairs, rails, people), lighting (backlit views), story and tour grammar (repeated framings, filler shots,
 * people named in captions but never on screen), characters (people drawn as primitives) and the performance budget.
 * The host supplies what only it can measure (`QualityHost`): the sun, the frame statistics, the ground under the spawn,
 * what floats or sinks, and the engine's playability check when it has one.
 */
import type { Entity, Patch, Story, Vec3, WorldDoc } from '@aether/core';
import type { LevelToolRunner, Provider } from '../types';
import { presentationSignals } from './kind';
import { settleFindings } from '../settle';
import type { PoseLike, PresentationViews } from './poi';
import { projectInFrame } from './story';
import { reviewShots, type PresentHost, type ShotReview } from './director';

export const QUALITY_CHECKS = ['opening', 'aerial', 'playability', 'texture', 'missing-geometry', 'scale', 'interpenetration', 'lighting', 'sky', 'story', 'characters', 'performance'] as const;
export type QualityCheck = (typeof QUALITY_CHECKS)[number];

/** A fix a finding carries. */
export type WorldQualityFix =
  | { kind: 'patches'; patches: Patch[]; label: string }
  | { kind: 'repick-opening'; label: string }
  | { kind: 'route'; to: 'character-pipeline' | 'user'; label: string };

export interface QualityFinding {
  check: QualityCheck;
  severity: 'error' | 'warn' | 'info';
  note: string;
  subject?: string;
  fix?: WorldQualityFix;
  by: 'data' | 'host' | 'model' | 'measured' | 'probe';
}

/** What only the host can measure (all optional: a check without its measurement is reported as not measured). */
export interface QualityHost extends PresentHost {
  /** The sun now: direction toward it and its elevation (degrees). */
  sunState?(): { direction: Vec3; elevation: number } | null;
  /** Triangles drawn by the last frame, the render tier, and programs linked so far. */
  renderStats?(): { triangles: number; tier: string; programs: number | null } | null;
  /** The level tools (ground under a point, what floats or sinks). */
  levelTools?: LevelToolRunner;
  /** The engine's playability check (packages/physics playability), when the host has it. */
  playability?(world: WorldDoc): Promise<Array<{ note: string; severity?: 'error' | 'warn'; patches?: Patch[] }>>;
  /** Baked-light atlas texel density per part (fraction of the atlas a part covers), when the renderer reports it. */
  bakeDensity?(): Array<{ id: string; texelsPerMetre: number }> | null;
}

/** Eye height of a standing visitor's view of a building (m above the floor). */
export const STANDING_EYE_MAX = 2.2;
/** Nothing nearer the lens than this in an opening view (m). */
export const OPENING_CLEAR = 3;
/** The walk lens the player uses at eye level (vertical degrees). */
export const WALK_LENS = 70;
/** Drawn-triangle budget per render tier. */
export const TRIANGLE_BUDGET: Readonly<Record<string, number>> = { low: 1_500_000, medium: 4_000_000, high: 8_000_000, ultra: 16_000_000 };
/** Plausible sizes (m). */
export const SCALE_RANGES = { door: [1.9, 2.5], riser: [0.15, 0.19], rail: [0.8, 1.1], person: [1.5, 1.9] } as const;

const deg = (r: number): number => (r * 180) / Math.PI;

/** Pitch of a pose (degrees, negative looking down). */
export function pitchOf(p: PoseLike): number {
  const dx = p.target[0] - p.position[0];
  const dy = p.target[1] - p.position[1];
  const dz = p.target[2] - p.position[2];
  return deg(Math.atan2(dy, Math.hypot(dx, dz)));
}

/** The floor a building view stands on: the lowest building level, else the spawn's height. */
function floorY(world: WorldDoc): number {
  let y = Infinity;
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (e.arch?.role === 'level' && (e.arch.level ?? 0) === 0) y = Math.min(y, e.transform.position[1]);
  }
  return Number.isFinite(y) ? y : world.player.spawn[1] - 1;
}

/** All the established poses of a world: the opening, the tour stops and the film's shots. */
function poses(world: WorldDoc, views: PresentationViews | null): Array<{ name: string; pose: PoseLike; kind: 'opening' | 'stop' | 'shot'; index: number }> {
  const out: Array<{ name: string; pose: PoseLike; kind: 'opening' | 'stop' | 'shot'; index: number }> = [];
  const opening = world.opening ?? views?.opening;
  if (opening) out.push({ name: 'opening view', pose: opening, kind: 'opening', index: 0 });
  (world.views ?? []).forEach((v, i) => out.push({ name: `tour stop ${i + 1}`, pose: v, kind: 'stop', index: i }));
  (world.story?.shots ?? []).forEach((s, i) => out.push({ name: `film shot ${i + 1}`, pose: s.camera, kind: 'shot', index: i }));
  return out;
}

function aimed(p: PoseLike, pitch: number): PoseLike {
  const dx = p.target[0] - p.position[0];
  const dz = p.target[2] - p.position[2];
  const flat = Math.max(1, Math.hypot(dx, dz));
  return { ...p, target: [p.target[0], p.position[1] + Math.tan((pitch * Math.PI) / 180) * flat, p.target[2]] };
}

function setPose(world: WorldDoc, which: { kind: 'opening' | 'stop' | 'shot'; index: number }, next: PoseLike): Patch | null {
  if (which.kind === 'opening') return { op: 'setMeta', opening: { position: [...next.position], target: [...next.target], ...(next.fov !== undefined ? { fov: next.fov } : {}) } };
  if (which.kind === 'stop' && world.views) {
    const views = world.views.map((v, i) => (i === which.index ? { ...v, position: [...next.position] as Vec3, target: [...next.target] as Vec3 } : v));
    return { op: 'setMeta', views };
  }
  if (which.kind === 'shot' && world.story) {
    const story: Story = structuredClone(world.story);
    const s = story.shots[which.index];
    if (!s) return null;
    const dy = next.target[1] - s.camera.target[1];
    s.camera = { ...s.camera, target: [...next.target] };
    if (s.cameraTo) s.cameraTo = { ...s.cameraTo, target: [s.cameraTo.target[0], s.cameraTo.target[1] + dy, s.cameraTo.target[2]] };
    return { op: 'setMeta', story };
  }
  return null;
}

/** 1. Opening and hero view; 2. aerial and title views. */
async function viewChecks(world: WorldDoc, views: PresentationViews | null, host: QualityHost | null, out: QualityFinding[]): Promise<void> {
  const sig = presentationSignals(world);
  const building = sig.buildings > 0 || sig.rooms > 0;
  const opening = world.opening ?? views?.opening ?? null;
  const sun = host?.sunState?.() ?? null;
  if (opening) {
    const authored = world.opening !== undefined;
    if (building) {
      const eye = opening.position[1] - floorY(world);
      if (eye > STANDING_EYE_MAX + 0.3 && eye < 12) {
        const drop = eye - 1.65;
        const next: PoseLike = { position: [opening.position[0], opening.position[1] - drop, opening.position[2]], target: [opening.target[0], opening.target[1] - drop * 0.6, opening.target[2]], ...(opening.fov !== undefined ? { fov: opening.fov } : {}) };
        out.push({ check: 'opening', severity: 'warn', note: `the opening view of a building is ${eye.toFixed(1)} m above the floor; a visitor stands at about 1.65 m`, fix: { kind: 'patches', patches: [{ op: 'setMeta', opening: { position: next.position, target: next.target, ...(next.fov !== undefined ? { fov: next.fov } : {}) } }], label: 'opening view lowered to standing eye height' }, by: 'data' });
      }
    }
    if (sun && sun.elevation > 2) {
      // The face a camera sees is lit when the camera is on the sun's side of what it looks at.
      const cx = opening.position[0] - opening.target[0];
      const cz = opening.position[2] - opening.target[2];
      const l = Math.hypot(cx, cz) || 1;
      const sl = Math.hypot(sun.direction[0], sun.direction[2]) || 1;
      const lit = (cx * sun.direction[0] + cz * sun.direction[2]) / (l * sl);
      if (lit < -0.35) out.push({ check: building ? 'opening' : 'lighting', severity: 'warn', note: `the opening view looks into the sun at the ${building ? "building's" : "place's"} shaded side (backlit, ${Math.round(deg(Math.acos(Math.max(-1, Math.min(1, lit)))))} degrees from the sun)`, fix: { kind: 'repick-opening', label: 'a sunlit opening view' }, by: 'data' });
    }
    if (host?.probeView) {
      const lens = building ? WALK_LENS : opening.fov ?? 55;
      const pr = await host.probeView({ position: opening.position, target: opening.target, up: [0, 1, 0], fov: lens }).catch(() => null);
      if (pr && pr.near < OPENING_CLEAR) out.push({ check: 'opening', severity: 'warn', note: `at the ${lens} degree lens the player uses, something is ${pr.near.toFixed(1)} m from the lens (a trunk, a branch, a wall edge)${authored ? ' in the hand-set opening view' : ''}`, fix: { kind: 'repick-opening', label: 'an opening view clear of near things' }, by: 'probe' });
    }
  }
  for (const p of poses(world, views)) {
    const pitch = pitchOf(p.pose);
    const half = (p.pose.fov ?? 55) / 2;
    if (pitch < -60) {
      const n = setPose(world, p, aimed(p.pose, -half * 0.6));
      out.push({ check: 'aerial', severity: 'warn', note: `the ${p.name} looks straight down (${Math.round(pitch)} degrees): never top-down`, ...(n ? { fix: { kind: 'patches' as const, patches: [n], label: `${p.name} tilted up to keep the horizon` } } : {}), by: 'data' });
    } else if (-pitch > half * 1.05 && p.pose.position[1] - floorY(world) > 6) {
      const n = setPose(world, p, aimed(p.pose, -half * 0.6));
      out.push({ check: 'aerial', severity: 'warn', note: `the ${p.name} is an aerial with the horizon out of frame (pitch ${Math.round(pitch)}, half lens ${Math.round(half)})`, ...(n ? { fix: { kind: 'patches' as const, patches: [n], label: `${p.name} tilted up to bring the horizon in` } } : {}), by: 'data' });
    }
  }
}

/** 3. Playability: the spawn on the ground, colliders on static meshes, and the engine's own check. */
async function playChecks(world: WorldDoc, host: QualityHost | null, out: QualityFinding[]): Promise<void> {
  const s = world.player.spawn;
  if (host?.levelTools && !world.voxel) {
    const r = await host.levelTools(world, 'query_level', { op: 'ground', points: [{ x: s[0], z: s[2], below: s[1] + 0.5 }] }).catch(() => null);
    const m = r ? /top surface y=(-?[\d.]+)/.exec(r.text) : null;
    if (r && /nothing below/.test(r.text)) out.push({ check: 'playability', severity: 'error', note: `nothing is under the play spawn (${s.map((v) => v.toFixed(1)).join(', ')}): the character falls`, fix: { kind: 'route', to: 'user', label: 'move the spawn onto the ground in the editor' }, by: 'host' });
    else if (m) {
      const y = Number(m[1]);
      // Measured below the spawn (a pergola or a roof over it is not its ground): only a spawn high above it is wrong.
      if (s[1] - y > 3) out.push({ check: 'playability', severity: 'error', note: `the play spawn is ${(s[1] - y).toFixed(1)} m above the ground under it`, fix: { kind: 'patches', patches: [{ op: 'setPlayer', set: { spawn: [s[0], Math.round((y + 1) * 100) / 100, s[2]] } }], label: 'spawn set on the ground' }, by: 'host' });
    }
  }
  const bare: string[] = [];
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (e.template || !e.visible || e.physics || e.arch || e.character || e.npc) continue;
    if (!(e.shape.kind === 'mesh' || e.shape.kind === 'model' || e.shape.kind === 'asset')) continue;
    if (e.tags.some((t) => /^(decor|foliage|scatter|sky|backdrop|floating|vfx|no-collide|grass|flowers?)$/.test(t))) continue;
    if (e.parent && world.entities[e.parent]?.physics) continue;
    bare.push(id);
  }
  // Only a world whose meshes have no colliders at all (a baked town brought in whole) gets them derived: a world that
  // already gives some of its meshes colliders chose which ones the visitor walks on.
  let solidMeshes = 0;
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (!e.template && e.physics && !e.physics.sensor && (e.shape.kind === 'mesh' || e.shape.kind === 'model' || e.shape.kind === 'asset')) solidMeshes++;
  }
  if (bare.length >= 1 && solidMeshes === 0) {
    out.push({
      check: 'playability',
      severity: bare.length > 8 ? 'error' : 'warn',
      note: `${bare.length} static mesh${bare.length === 1 ? '' : 'es'} with no collider (the character walks through ${bare.length === 1 ? 'it' : 'them'}): ${bare.slice(0, 6).join(', ')}${bare.length > 6 ? ', …' : ''}`,
      fix: { kind: 'patches', patches: bare.slice(0, 200).map((id) => ({ op: 'update', id, set: { physics: { body: 'static', collider: 'trimesh' } } }) as Patch), label: `static colliders derived for ${bare.length} meshes` },
      by: 'data',
    });
  }
  if (host?.playability) {
    for (const f of await host.playability(world).catch(() => [])) out.push({ check: 'playability', severity: f.severity ?? 'warn', note: f.note, ...(f.patches && f.patches.length > 0 ? { fix: { kind: 'patches' as const, patches: f.patches, label: 'playability fix' } } : {}), by: 'host' });
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 6. Scale sanity: doors, stair risers, rails, people. */
function scaleChecks(world: WorldDoc, out: QualityFinding[]): void {
  const bad: Record<string, string[]> = { door: [], riser: [], rail: [], person: [] };
  const fixes: Patch[] = [];
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (e.template) continue;
    const params = e.shape.kind === 'procedural' ? (e.shape.params as Record<string, unknown>) : {};
    const sy = Math.abs(e.transform.scale[1]);
    if (e.arch?.role === 'door' && e.arch.kind !== 'garage') {
      const h = num(params['height']);
      if (h !== null && (h * sy < SCALE_RANGES.door[0] || h * sy > SCALE_RANGES.door[1] + 0.6)) bad['door']?.push(`${id} ${(h * sy).toFixed(2)} m`);
    }
    if (e.arch?.role === 'stair') {
      // `riser` is one step; `rise` and `height` are the whole flight (divided by its steps when it says how many).
      const total = num(params['rise']) ?? num(params['height']);
      const steps = num(params['steps']) ?? num(params['treads']);
      const r = num(params['riser']) ?? (total !== null && steps ? total / steps : null);
      if (r !== null && (r < SCALE_RANGES.riser[0] - 0.01 || r > SCALE_RANGES.riser[1] + 0.01)) bad['riser']?.push(`${id} ${(r * 100).toFixed(0)} cm`);
    }
    if (e.arch?.role === 'railing') {
      const h = num(params['height']);
      if (h !== null && (h * sy < SCALE_RANGES.rail[0] || h * sy > SCALE_RANGES.rail[1])) bad['rail']?.push(`${id} ${(h * sy).toFixed(2)} m`);
    }
    if (e.character) {
      const h = 1.75 * (e.character.scale ?? 1) * sy;
      if (h < SCALE_RANGES.person[0] || h > SCALE_RANGES.person[1]) {
        bad['person']?.push(`${id} ${h.toFixed(2)} m`);
        fixes.push({ op: 'update', id, set: { transform: { ...e.transform, scale: [1, 1, 1] } } });
      }
    }
  }
  const label: Record<string, string> = { door: 'doors outside 1.9 to 3.1 m', riser: 'stair risers outside 15 to 19 cm', rail: 'handrails outside 0.8 to 1.1 m', person: 'people outside 1.5 to 1.9 m' };
  for (const [k, list] of Object.entries(bad)) {
    if (list.length === 0) continue;
    out.push({ check: 'scale', severity: 'warn', note: `${label[k]}: ${list.slice(0, 5).join(', ')}${list.length > 5 ? ', …' : ''}`, ...(k === 'person' && fixes.length > 0 ? { fix: { kind: 'patches' as const, patches: fixes, label: `${fixes.length} people set to human scale` } } : {}), by: 'data' });
  }
}

/** 7. Interpenetration: what floats or sinks (the level tools' grounding measurement). */
async function groundingChecks(world: WorldDoc, host: QualityHost | null, out: QualityFinding[]): Promise<void> {
  if (!host?.levelTools || world.voxel) return;
  const r = await host.levelTools(world, 'query_level', { op: 'grounding' }).catch(() => null);
  if (!r) return;
  const lines = r.text.split('\n').filter((l) => /hover|float|buried|sunk|below the surface|above the surface/i.test(l));
  if (lines.length > 0) out.push({ check: 'interpenetration', severity: 'warn', note: `${lines.length} object${lines.length === 1 ? '' : 's'} floating or sunk: ${lines.slice(0, 4).map((l) => l.trim().slice(0, 120)).join('; ')}`, fix: { kind: 'route', to: 'user', label: 'set them down with place_level_items (the agent does in its review)' }, by: 'host' });
}

/** 7b. Interpenetration: a building sunk into the terrain on its high side or hanging over a drop on its low side: raised to the highest ground of its footprint on a plinth (a measurement, then the fix). */
function settleChecks(world: WorldDoc, out: QualityFinding[]): void {
  if (world.voxel) return;
  let fixes;
  try {
    fixes = settleFindings(world);
  } catch {
    return;
  }
  for (const f of fixes) {
    const what = f.kind === 'sunk' ? `sunk ${f.depth.toFixed(1)} m into the terrain on its high side` : `hanging ${f.depth.toFixed(1)} m over the ground on its low side`;
    out.push({ check: 'interpenetration', severity: 'error', subject: f.id, note: `"${f.id}" is ${what}`, fix: { kind: 'patches', patches: f.patches as Patch[], label: `${f.id} set on the terrain (base on the highest ground, plinth under it)` }, by: 'data' });
  }
}

const WORD = /\b[A-Z][a-z]{2,}\b/g;
const COMMON = new Set(['The', 'This', 'That', 'There', 'Then', 'When', 'Where', 'And', 'But', 'Her', 'His', 'She', 'They', 'Its', 'Our', 'Your', 'Press', 'Tab', 'Play', 'Explore']);

/** 10. Story and tours: repeated framings, filler shots, grammar variety, people named but never on screen. */
function storyChecks(world: WorldDoc, out: QualityFinding[]): void {
  const story = world.story;
  const stops = world.views ?? [];
  const same = (a: PoseLike, b: PoseLike): boolean => {
    const d = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]);
    const fa = [a.target[0] - a.position[0], a.target[2] - a.position[2]];
    const fb = [b.target[0] - b.position[0], b.target[2] - b.position[2]];
    const cos = ((fa[0] as number) * (fb[0] as number) + (fa[1] as number) * (fb[1] as number)) / ((Math.hypot(fa[0] as number, fa[1] as number) || 1) * (Math.hypot(fb[0] as number, fb[1] as number) || 1));
    return d < 2 && cos > 0.97;
  };
  for (let i = 0; i < stops.length; i++) for (let j = i + 1; j < stops.length; j++) if (same(stops[i] as PoseLike, stops[j] as PoseLike)) out.push({ check: 'story', severity: 'warn', note: `tour stops ${i + 1} and ${j + 1} frame the same view`, fix: { kind: 'patches', patches: [{ op: 'setMeta', views: stops.filter((_, k) => k !== j) }], label: `repeated tour stop ${j + 1} dropped` }, by: 'data' });
  if (!story) return;
  const shots = story.shots;
  const dup: number[] = [];
  for (let i = 0; i < shots.length; i++) for (let j = i + 1; j < shots.length; j++) if (j - i > 0 && j !== shots.length - 1 && same(shots[i]!.camera, shots[j]!.camera) && !shots[j]!.caption && !shots[j]!.title) dup.push(j);
  if (dup.length > 0 && shots.length - dup.length >= 3) {
    const keep = shots.filter((_, k) => !dup.includes(k));
    out.push({ check: 'story', severity: 'warn', note: `film shots ${[...new Set(dup)].map((d) => d + 1).join(', ')} repeat an earlier framing with nothing new (filler)`, fix: { kind: 'patches', patches: [{ op: 'setMeta', story: { ...story, shots: keep } }], label: `${new Set(dup).size} repeated film shots dropped` }, by: 'data' });
  }
  const moves = new Set(shots.map((s) => (!s.cameraTo ? 'hold' : Math.hypot(s.cameraTo.position[0] - s.camera.position[0], s.cameraTo.position[2] - s.camera.position[2]) < 0.3 ? 'pan' : 'move')));
  if (shots.length >= 4 && moves.size < 2) out.push({ check: 'story', severity: 'warn', note: 'every film shot moves the same way: vary the grammar (a hold, a pan, a dolly)', fix: { kind: 'route', to: 'user', label: 'rewrite the film (the director varies its moves)' }, by: 'data' });
  // People named in captions must be on screen in that shot.
  const people = Object.values(world.entities).filter((e) => !e.template && (e.character || e.npc));
  const known = new Set<string>([...people.flatMap((e) => (e.name || '').split(/\s+/)), ...world.name.split(/\s+/), ...Object.values(world.entities).flatMap((e) => (e.name || '').split(/\s+/))]);
  shots.forEach((s, i) => {
    const text = `${s.caption ?? ''}`;
    for (const p of people) {
      const first = (p.name || '').split(/\s+/)[0];
      if (!first || first.length < 3 || !text.includes(first)) continue;
      const at = projectInFrame(s.camera, [p.transform.position[0], p.transform.position[1] + 1, p.transform.position[2]]);
      const tracked = s.track === p.id || s.moves.some((m) => m.entity === p.id);
      if (!tracked && (!at || Math.abs(at.x) > 1 || Math.abs(at.y) > 1)) out.push({ check: 'story', severity: 'warn', note: `film shot ${i + 1} names ${first} in its caption but ${first} is not on screen`, fix: { kind: 'patches', patches: [{ op: 'setMeta', story: { ...structuredClone(story), shots: shots.map((x, k) => (k === i ? { ...x, track: p.id, trackOffset: [0, 0.35, 0] as Vec3 } : x)) } }], label: `film shot ${i + 1} keeps ${first} in frame` }, by: 'data' });
    }
    // A capitalised word after the first that names nobody and nothing in the world: a person the film never shows.
    const words = (text.match(WORD) ?? []).filter((w) => text.indexOf(w) > 0 && !COMMON.has(w) && !known.has(w));
    for (const w of new Set(words)) out.push({ check: 'story', severity: 'warn', note: `film shot ${i + 1} names "${w}" in its caption, and nothing called ${w} is in the world`, fix: { kind: 'route', to: 'user', label: `add ${w} to the world or rewrite the caption` }, by: 'data' });
  });
}

/** 11. Characters: people must be rigged, animated humans; a primitive body is routed to the character pipeline. */
function characterChecks(world: WorldDoc, out: QualityFinding[]): void {
  const blocky: string[] = [];
  const fix: Patch[] = [];
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (e.template || e.character) continue;
    const person = !!e.npc || e.tags.some((t) => /^(person|people|human|villager|resident|npc|character)$/.test(t)) || /\b(man|woman|girl|boy|fisherman|villager|person|child|guard|merchant)\b/i.test(e.name);
    if (!person || e.arch) continue;
    if (e.shape.kind === 'primitive' || e.shape.kind === 'none' || e.shape.kind === 'procedural') {
      blocky.push(id);
      fix.push({ op: 'update', id, set: { character: {} } });
    }
  }
  if (blocky.length > 0) out.push({ check: 'characters', severity: 'error', note: `${blocky.length} ${blocky.length === 1 ? 'person is' : 'people are'} drawn as blocks, not rigged humans: ${blocky.slice(0, 5).join(', ')}`, fix: { kind: 'patches', patches: fix, label: `${blocky.length} people given a rigged, animated human body from the cast` }, by: 'data' });
  if (blocky.length > 0) out.push({ check: 'characters', severity: 'info', note: 'for a bespoke look (a hero with a model sheet) the character pipeline builds one in Blender (/api/local/blender/*, the local app only; a hosted studio keeps the cast body)', fix: { kind: 'route', to: 'character-pipeline', label: 'bespoke character in the Blender pipeline' }, by: 'data' });
}

/** 8 (data part). Backlit film shots and stops when the sun is low. */
function lightingChecks(world: WorldDoc, host: QualityHost | null, out: QualityFinding[]): void {
  const sun = host?.sunState?.() ?? null;
  if (!sun || sun.elevation < 2 || sun.elevation > 35) return;
  const hour = world.environment.timeOfDay;
  (world.story?.shots ?? []).forEach((s, i) => {
    const fx = s.camera.target[0] - s.camera.position[0];
    const fz = s.camera.target[2] - s.camera.position[2];
    const cos = (fx * sun.direction[0] + fz * sun.direction[2]) / ((Math.hypot(fx, fz) || 1) * (Math.hypot(sun.direction[0], sun.direction[2]) || 1));
    if (cos > 0.85 && !s.title) {
      const h = s.hour ?? hour;
      const next = h === undefined ? undefined : Math.round(Math.max(8, Math.min(17, h < 12 ? h + 3 : h - 3)) * 10) / 10;
      // A suggestion, never applied on its own: moving a shot's hour changes the film's colour script (and backlight can be
      // the intent of a shot).
      out.push({ check: 'lighting', severity: 'info', note: `film shot ${i + 1} looks into a low sun: the subject is backlit${next !== undefined ? ` (try ${next} h, or turn the camera)` : ''}`, fix: { kind: 'route', to: 'user', label: 'change the shot\'s hour or turn the camera' }, by: 'data' });
    }
  });
}

/** 12. Performance: drawn triangles against the tier's budget, and programs. */
function performanceChecks(host: QualityHost | null, out: QualityFinding[]): void {
  const st = host?.renderStats?.() ?? null;
  if (!st) {
    out.push({ check: 'performance', severity: 'info', note: 'not measured here (no renderer)', by: 'host' });
    return;
  }
  const budget = TRIANGLE_BUDGET[st.tier] ?? TRIANGLE_BUDGET['high'] ?? 8_000_000;
  if (st.triangles > budget) out.push({ check: 'performance', severity: 'warn', note: `${(st.triangles / 1e6).toFixed(1)} M triangles drawn, over the ${st.tier} tier's ${(budget / 1e6).toFixed(1)} M budget`, fix: { kind: 'route', to: 'user', label: 'thin the scatter or bake pieces to meshes' }, by: 'host' });
}

/** 4. Bake and texture density. */
function bakeChecks(host: QualityHost | null, out: QualityFinding[]): void {
  const d = host?.bakeDensity?.() ?? null;
  if (!d) return;
  const thin = d.filter((p) => p.texelsPerMetre < 1);
  if (thin.length > 0) out.push({ check: 'texture', severity: 'warn', note: `${thin.length} baked parts get under one lightmap texel per metre (they bake dark): ${thin.slice(0, 4).map((p) => p.id).join(', ')}`, fix: { kind: 'route', to: 'user', label: 'rebake: the atlas packs as boxes and sub-texel parts take per-vertex shading' }, by: 'host' });
}

/** The data checks of the pass (no renders, no model). */
export async function qualityChecks(world: WorldDoc, views: PresentationViews | null, host: QualityHost | null): Promise<QualityFinding[]> {
  const out: QualityFinding[] = [];
  await viewChecks(world, views, host, out);
  await playChecks(world, host, out);
  scaleChecks(world, out);
  await groundingChecks(world, host, out);
  settleChecks(world, out);
  lightingChecks(world, host, out);
  storyChecks(world, out);
  characterChecks(world, out);
  bakeChecks(host, out);
  performanceChecks(host, out);
  return out;
}

/** The outcome of the pass. */
export interface WorldQualityReport {
  findings: QualityFinding[];
  fixed: string[];
  remaining: QualityFinding[];
  /** The visual review (renders judged by the AI), when it ran. */
  review: ShotReview | null;
}

/**
 * The world-quality pass: the data checks and their fixes, then (when `visual`) the shot review of the frames a visitor
 * meets, judged by the AI with the full checklist, and the data checks again on the fixed world.
 */
export async function runQualityPass(host: QualityHost, provider: Provider | null, opts: { visual?: boolean; signal?: AbortSignal; onStatus?: (t: string) => void } = {}): Promise<WorldQualityReport> {
  const status = opts.onStatus ?? (() => undefined);
  const views = host.presentationViews ? await host.presentationViews(opts.signal ? { signal: opts.signal } : {}).catch(() => null) : null;
  status('Checking the world (views, playability, scale, story, characters)…');
  const first = await qualityChecks(host.getWorld(), views, host);
  const fixed: string[] = [];
  let repick = false;
  for (const f of first) {
    if (f.fix?.kind === 'patches') {
      const r = host.applyPatches(f.fix.patches, `Quality: ${f.fix.label}`);
      if (r.applied.length > 0) fixed.push(f.fix.label);
    } else if (f.fix?.kind === 'repick-opening') repick = true;
  }
  let review: ShotReview | null = null;
  if (opts.visual !== false) {
    review = await reviewShots(host, provider, { ...(opts.signal ? { signal: opts.signal } : {}), onStatus: status, ...(repick ? { forceRepick: true } : {}) });
    fixed.push(...review.fixed);
  }
  const after = await qualityChecks(host.getWorld(), views, host);
  // What is left: findings of the last look that no fix answered, and the visual review's remaining ones.
  const remaining = after.filter((f) => !(f.check === 'performance' && f.by === 'host' && /not measured/.test(f.note)));
  const map: Record<string, QualityCheck> = { framing: 'opening', occluder: 'opening', exposure: 'lighting', spawn: 'playability', 'missing-geometry': 'missing-geometry', lighting: 'lighting', sky: 'sky', interpenetration: 'interpenetration', characters: 'characters', scale: 'scale', aerial: 'aerial', other: 'opening' };
  // The judge's high-severity findings are problems; medium ones warnings; low ones suggestions.
  for (const r of review?.remaining ?? []) remaining.push({ check: map[r.check] ?? 'opening', severity: r.severity === 'high' ? 'error' : r.severity === 'low' ? 'info' : 'warn', note: `${r.frame}: ${r.note}`, by: r.by === 'model' ? 'model' : r.by === 'probe' ? 'probe' : 'measured' });
  // Worst first: problems, then warnings, then suggestions.
  const order: Record<string, number> = { error: 0, warn: 1, info: 2 };
  remaining.sort((a, b) => (order[a.severity] ?? 1) - (order[b.severity] ?? 1));
  return { findings: first, fixed, remaining, review };
}

/** One-line summary of a report. */
export function qualitySummary(r: WorldQualityReport): string {
  const errors = r.remaining.filter((f) => f.severity === 'error').length;
  return `${r.fixed.length} fixed, ${r.remaining.length} left${errors ? ` (${errors} serious)` : ''}.`;
}

