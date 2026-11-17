/**
 * Realism pass on the architecture and lighting of the Rug Exhibition Hall template
 * (`apps/studio/public/templates/worlds/rug-exhibition-hall.json`). Idempotent: run it as often as you like; it only touches
 * the building shell (walls, floors, ceilings, columns, skirting, the lobby / hall opening, lobby windows), the lights, the
 * ceiling clutter and world-level light settings. Rugs, tables, plinths, stanchions, plaques, the sculpture, the guide and
 * the products are read (to aim the lights at them) but never changed.
 *
 *   npx tsx scripts/worlds/rug-hall-realism.ts [world.json] [--out <file>] [--dry]
 *
 * What it does:
 * - Lobby: a dropped ceiling at 3.5 m (it was the full 6.2 m storey: a 5 m deep slot that read as a canyon), so the visitor
 *   walks from a reception of human height into the full-height hall. The lobby windows lose 20 cm of head (3.3 m) to clear
 *   it; the lobby / hall opening grows from 2.1 m to 3.0 m (same width and place: the walkway and the guide's routes stay).
 * - Hall: keeps its ~6 m clear height (already above a 4.5-5 m gallery; lowering it would make the hall lower, the opposite
 *   of the complaint). The pilasters, which stopped at 3.2 m half way up the wall and made the room read low, now run to the
 *   ceiling; the low hanging baffles, the 12 sconces floating mid-air at 4.2 m, the gold strips and the high sconces go.
 * - Finishes (photographed library maps: oak, marble, plaster): honey oak floor in the hall, light marble in the lobby,
 *   matte warm plaster walls (navy panelling / red damask and the dark slat dado removed), a white plaster ceiling,
 *   15 cm painted skirting, plaster pilasters a shade lighter than the walls.
 * - Light: a 3000 K recessed adjustable spot in the ceiling for each wall rug (30 degrees off vertical, the museum rule),
 *   one over each rug display / table and one on the sculpture, all generated from where those pieces are when the script
 *   runs (ids `rh-spot-<target id>`); the ceiling's downlight trims sit where the spots are. A soft warm fill in the lobby,
 *   a brighter intent and ambient level, a warm ambient tint, and a muted lawn colour (the lawn is the lower half of the
 *   image light, and its saturated green tinted every ceiling indoors).
 *
 * The building plan on the `gallery` entity is kept in step (finishes, door height, windows), except the lobby's lower
 * ceiling: a plan has one storey height, so re-running the building compiler on the plan would lift the lobby back to 6.2 m.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eulerDegToQuat, rotateVec3, stableStringify, validateWorld, type Vec3, type WorldDoc } from '@aether/core';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const DEFAULT_FILE = join(REPO_ROOT, 'apps/studio/public/templates/worlds/rug-exhibition-hall.json');

const ARGS = process.argv.slice(2);
const flagValue = (n: string): string | undefined => {
  const i = ARGS.indexOf(n);
  return i >= 0 ? ARGS[i + 1] : undefined;
};
const FILE = ARGS.find((a, i) => !a.startsWith('--') && ARGS[i - 1] !== '--out') ?? DEFAULT_FILE;
const OUT = flagValue('--out') ?? FILE;
const DRY = ARGS.includes('--dry');

// ---------------------------------------------------------------------------------------------------------------------
// Design constants
// ---------------------------------------------------------------------------------------------------------------------

/** Level origin above the ground (the building's plinth). */
const LEVEL_Y = 0.15;
/** Hall: the storey's ceiling (level-relative), unchanged. */
const HALL_CEIL = 5.976;
/** Lobby: dropped ceiling, clear height above the floor (level-relative). */
const LOBBY_CEIL = 3.5;
/** Lobby / hall opening head height. */
const OPENING_H = 3.0;
/** Lobby windows: sill 1.0 m, head 3.3 m (clears the dropped ceiling). */
const LOBBY_WINDOW_H = 2.3;
/** Room split line (z): the hall is z < 15, the lobby z > 15. */
const SPLIT_Z = 15;

const WARM = '#ffcf9e'; // ~3000 K once the interior white balance has run
const FILL = '#ffe2c2';

const HALL_WALL = { finish: 'plaster', color: '#e7e0d4' } as const;
const LOBBY_WALL = { finish: 'plaster', color: '#d6c0a4' } as const;
const SKIRT = { finish: 'paint', color: '#d8cfc0' } as const;
const SKIRT_STYLE = { height: 0.15, depth: 0.02, profile: 'square' } as const;
const HALL_FLOOR = { finish: 'oak', color: '#d8b48a' } as const;
const LOBBY_FLOOR = { finish: 'marble', color: '#f3eee6' } as const;
const CEILING = { finish: 'plaster', color: '#f6f4f0' } as const;
const COLUMN = { finish: 'plaster', color: '#eee8de' } as const;

/** Old finishes, recognised wherever they appear (walls, plan): navy panelling = hall, red damask = lobby. */
const isHallFinish = (m: unknown): boolean => isObj(m) && m['finish'] === 'panelling';
const isLobbyFinish = (m: unknown): boolean => isObj(m) && m['finish'] === 'wallpaper-damask';
const isSlatDado = (d: unknown): boolean => isObj(d) && isObj(d['material']) && d['material']['finish'] === 'wood-slats';

/** Ceiling clutter and the old lights this pass replaces (deleted when present). */
const REMOVE = [
  'grid-of-sconce-1', // 12 wall sconces floating mid-air at 4.2 m in the middle of the hall
  'grid-of-ceiling-baffle-1', // felt fins hanging to ~5 m over the hall
  'along-of-ceiling-baffle-1', // lobby baffles (above the new lobby ceiling)
  'wall-of-acoustic-panel-1', // gold strips at 4 m on the north wall
  'wall-of-sconce-2', // sconces at 4.6 m on the north wall
  'sculpture-spot',
  ...range(1, 4).map((i) => `along-light-${i}`),
  ...range(1, 13).map((i) => `wall-light-${i}`), // "frame lights" 1 m off the floor pointing at the floor
  ...range(20, 23).map((i) => `wall-light-${i}`),
];
const GENERATED = 'rh-';

// ---------------------------------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;
type Ent = WorldDoc['entities'][string];

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** The shape params of a procedural entity (mutable). */
function params(e: Ent | undefined): Obj | null {
  const s = e?.shape as unknown;
  return isObj(s) && s['kind'] === 'procedural' && isObj(s['params']) ? s['params'] : null;
}

/** World position of an entity (walks the parent chain: translation, rotation, scale). */
function worldPos(ents: WorldDoc['entities'], id: string): Vec3 {
  let e = ents[id];
  let p: Vec3 = [0, 0, 0];
  for (let guard = 0; e && guard < 32; guard++) {
    const t = e.transform;
    const s: Vec3 = [p[0] * t.scale[0], p[1] * t.scale[1], p[2] * t.scale[2]];
    const q = rotateVec3(eulerDegToQuat(t.rotation as Vec3), s);
    p = [q[0] + t.position[0], q[1] + t.position[1], q[2] + t.position[2]];
    e = e.parent ? ents[e.parent] : undefined;
  }
  return p;
}

/** Euler rotation (degrees, XYZ) turning a spot's local −Y onto `d` (unit). */
function aimRotation(d: Vec3): Vec3 {
  const rz = Math.asin(Math.max(-1, Math.min(1, d[0])));
  const rx = Math.atan2(-d[2], -d[1]);
  const rot: Vec3 = [r3((rx * 180) / Math.PI), 0, r3((rz * 180) / Math.PI)];
  const got = rotateVec3(eulerDegToQuat(rot), [0, -1, 0]);
  if (Math.hypot(got[0] - d[0], got[1] - d[1], got[2] - d[2]) > 0.01) throw new Error(`aim solve failed for ${d.join(',')}`);
  return rot;
}

function lightEntity(id: string, name: string, pos: Vec3, rotation: Vec3, light: Obj, tags: string[]): Ent {
  return {
    id,
    name,
    parent: null,
    transform: { position: pos.map(r3) as Vec3, rotation, scale: [1, 1, 1] },
    shape: { kind: 'none' },
    light,
    tags,
    behaviors: [],
    state: {},
    visible: true,
    castShadow: false,
    receiveShadow: true,
    template: false,
  } as unknown as Ent;
}

// ---------------------------------------------------------------------------------------------------------------------

function apply(world: WorldDoc): string[] {
  const notes: string[] = [];
  const ents = world.entities;

  // 1. Remove the clutter and every light an earlier run generated.
  for (const id of [...REMOVE, ...Object.keys(ents).filter((k) => k.startsWith(GENERATED))]) {
    if (ents[id]) delete ents[id];
  }

  // 2. Walls: finishes, dados, skirting; lobby window and opening heights in the wall holes.
  for (const e of Object.values(ents)) {
    const a = e.arch as Obj | undefined;
    const p = params(e);
    if (!p || a?.['role'] !== 'wall') continue;
    for (const side of ['A', 'B'] as const) {
      const f = p[`finish${side}`];
      if (isHallFinish(f)) p[`finish${side}`] = { ...HALL_WALL };
      if (isLobbyFinish(f)) p[`finish${side}`] = { ...LOBBY_WALL };
      if (isSlatDado(p[`dado${side}`])) delete p[`dado${side}`];
    }
    if (p['skirting'] !== 'none') {
      p['skirtingMaterial'] = { ...SKIRT };
      p['skirtingStyle'] = { ...SKIRT_STYLE };
    }
    const openings = Array.isArray(p['openings']) ? (p['openings'] as Obj[]) : [];
    const wallZ = e.transform.position[2];
    const along = e.transform.rotation[1] === 0;
    for (const o of openings) {
      // The wide opening between lobby and hall (interior wall on z = 15).
      if (o['kind'] === 'opening' && along && Math.abs(wallZ - SPLIT_Z) < 0.01) o['height'] = OPENING_H;
      // The lobby's south windows (exterior wall on z = 20), sill 1 m.
      if (o['kind'] === 'window' && along && Math.abs(wallZ - 20) < 0.01 && o['sill'] === 1) o['height'] = LOBBY_WINDOW_H;
    }
  }

  // 3. Opening frame, lobby windows.
  for (const e of Object.values(ents)) {
    const a = e.arch as Obj | undefined;
    const p = params(e);
    if (!p) continue;
    if (a?.['role'] === 'opening' && a['kind'] === 'opening' && Math.abs(e.transform.position[2] - SPLIT_Z) < 0.01) p['height'] = OPENING_H;
    if (a?.['role'] === 'window' && a['room'] === 'gallery-l0-lobby' && e.transform.position[1] === 1) p['height'] = LOBBY_WINDOW_H;
  }

  // 4. Floors.
  for (const e of Object.values(ents)) {
    const a = e.arch as Obj | undefined;
    const p = params(e);
    if (!p || a?.['role'] !== 'room') continue;
    if (e.id === 'gallery-l0-gallery') p['finish'] = { ...HALL_FLOOR };
    if (e.id === 'gallery-l0-lobby') p['finish'] = { ...LOBBY_FLOOR };
  }

  // 5. Columns: the engaged pilasters run floor to ceiling.
  for (const e of Object.values(ents)) {
    const s = e.shape as unknown as Obj;
    const of = isObj(s['of']) ? s['of'] : null;
    if (s['kind'] !== 'scatter' || of?.['generator'] !== 'furn-column' || !isObj(of['params'])) continue;
    Object.assign(of['params'], { height: r3(HALL_CEIL - 0.006 + LEVEL_Y), finish: COLUMN.finish, color: COLUMN.color });
  }

  // 6. Lights aimed at what is on show now.
  const hallCeilY = LEVEL_Y + HALL_CEIL - 0.03;
  const lobbyCeilY = LEVEL_Y + LOBBY_CEIL - 0.03;
  const inLobby = (p: Vec3): boolean => p[2] > SPLIT_Z;
  /** Inside wall faces (world): x 0.14 .. 29.86, hall z 0.14 .. 14.94, lobby z 15.06 .. 19.86. */
  const wallNormal = (p: Vec3): { n: Vec3; d: number } => {
    const lobby = inLobby(p);
    const cands: Array<{ n: Vec3; d: number }> = [
      { n: [1, 0, 0], d: p[0] - 0.14 },
      { n: [-1, 0, 0], d: 29.86 - p[0] },
      { n: [0, 0, 1], d: p[2] - (lobby ? 15.06 : 0.14) },
      { n: [0, 0, -1], d: (lobby ? 19.86 : 14.94) - p[2] },
    ];
    return cands.reduce((m, c) => (c.d < m.d ? c : m));
  };
  const spots: Array<{ room: 'hall' | 'lobby'; at: Vec3 }> = [];
  const add = (id: string, name: string, pos: Vec3, target: Vec3, light: Obj, room: 'hall' | 'lobby'): void => {
    const d: Vec3 = [target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    ents[id] = lightEntity(id, name, pos, aimRotation([d[0] / l, d[1] / l, d[2] / l]), { ...light, range: r3(Math.max(8, l * 2.2)) }, ['light', 'gallery-light']);
    spots.push({ room, at: pos });
  };
  const shown = Object.values(ents)
    .filter((e) => e.tags.includes('rug') || e.tags.includes('exhibit'))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const e of shown) {
    const p = worldPos(ents, e.id);
    const lobby = inLobby(p);
    const ceil = lobby ? lobbyCeilY : hallCeilY;
    if (e.tags.includes('wall-rug')) {
      // Museum rule: the spot sits where a line 30 degrees off vertical through the piece's centre meets the ceiling.
      const target: Vec3 = [p[0], p[1], p[2]];
      const { n } = wallNormal(p);
      const off = Math.max(1.0, (ceil - target[1]) * Math.tan(Math.PI / 6));
      add(`${GENERATED}spot-${e.id}`, `Rug spot: ${e.name}`.slice(0, 80), [p[0] + n[0] * off, ceil, p[2] + n[2] * off], target, { type: 'spot', color: WARM, intensity: lobby ? 1.4 : 2.6, angle: 21, profile: 'wash', castShadow: false }, lobby ? 'lobby' : 'hall');
    } else {
      // A rug on a plinth or table: from the ceiling straight above, a little off to the visitor's side to rake the pile.
      const target: Vec3 = [p[0], p[1], p[2]];
      const pos: Vec3 = [p[0], ceil, p[2] + (lobby ? 0.4 : 0.8)];
      add(`${GENERATED}spot-${e.id}`, `Display spot: ${e.name}`.slice(0, 80), pos, target, { type: 'spot', color: WARM, intensity: lobby ? 1.2 : 2.2, angle: lobby ? 30 : 26, profile: 'wash', castShadow: false }, lobby ? 'lobby' : 'hall');
    }
  }
  if (shown.length === 0) notes.push('no entity tagged rug / exhibit: no display spots generated');
  // The sculpture (the hall's focus piece that is not a rug).
  for (const e of Object.values(ents)) {
    const s = e.shape as unknown as Obj;
    if (s['kind'] !== 'procedural' || s['generator'] !== 'furn-statue') continue;
    const p = worldPos(ents, e.id);
    const ceil = inLobby(p) ? lobbyCeilY : hallCeilY;
    const h = isObj(s['params']) && typeof s['params']['height'] === 'number' ? (s['params']['height'] as number) : 2;
    add(`${GENERATED}spot-${e.id}`, `Sculpture spot: ${e.name}`.slice(0, 80), [p[0], ceil, p[2] + 2.2], [p[0], p[1] + h * 0.6, p[2]], { type: 'spot', color: WARM, intensity: 3, angle: 22, profile: 'soft', castShadow: true }, inLobby(p) ? 'lobby' : 'hall');
  }
  // Lobby: a soft warm fill from the ceiling (the reception and the walk to the hall).
  for (const [i, x] of [6, 15, 24].entries()) {
    ents[`${GENERATED}lobby-fill-${i + 1}`] = lightEntity(`${GENERATED}lobby-fill-${i + 1}`, 'Lobby ceiling fill', [x, lobbyCeilY - 0.05, 17.5], [0, 0, 0], { type: 'point', color: FILL, intensity: 0.35, range: 7, angle: 60, castShadow: false }, ['light', 'gallery-light']);
  }

  // 7. Ceilings: white plaster; the lobby's dropped to its new height; the trims sit where the spots are.
  const trims = (room: 'hall' | 'lobby', fallback: unknown): unknown => {
    const pts = spots.filter((s) => s.room === room).map((s) => [r3(s.at[0]), r3(s.at[2])]);
    return pts.length > 0 ? pts.slice(0, 24) : fallback;
  };
  const hallCeil = ents['gallery-l0-gallery-ceil'];
  const lobbyCeil = ents['gallery-l0-lobby-ceil'];
  const hp = params(hallCeil);
  const lp = params(lobbyCeil);
  if (hp) Object.assign(hp, { finish: { ...CEILING }, downlights: trims('hall', hp['downlights']) });
  if (lp) Object.assign(lp, { finish: { ...CEILING }, downlights: [...(trims('lobby', []) as number[][]), [6, 17.5], [15, 17.5], [24, 17.5]].slice(0, 24) });
  if (lobbyCeil) lobbyCeil.transform.position = [lobbyCeil.transform.position[0], LOBBY_CEIL, lobbyCeil.transform.position[2]];
  if (!hp || !lp) notes.push('a ceiling entity is missing');

  // 8. The lobby sconce lights stay; clamp anything else in the lobby above the new ceiling.
  for (const e of Object.values(ents)) {
    if (!e.light || e.id.startsWith(GENERATED)) continue;
    const p = e.transform.position;
    if (e.parent === null && p[2] > SPLIT_Z + 0.1 && p[2] < 19.9 && p[0] > 0.1 && p[0] < 29.9 && p[1] > lobbyCeilY) {
      e.transform.position = [p[0], r3(lobbyCeilY - 0.1), p[2]];
      notes.push(`moved ${e.id} under the lobby ceiling`);
    }
  }

  // 9. The building plan, kept in step (finishes, opening and window heights).
  const plan = (ents['gallery']?.arch as Obj | undefined)?.['plan'] as Obj | undefined;
  const level = Array.isArray(plan?.['levels']) ? ((plan['levels'] as Obj[])[0] ?? null) : null;
  if (level) {
    for (const room of (level['rooms'] as Obj[]) ?? []) {
      if (room['id'] === 'gallery') Object.assign(room, { finish: { ...HALL_WALL }, floor: { ...HALL_FLOOR } });
      if (room['id'] === 'lobby') Object.assign(room, { finish: { ...LOBBY_WALL }, floor: { ...LOBBY_FLOOR } });
      if (room['id'] === 'gallery' || room['id'] === 'lobby') {
        delete room['dado'];
        room['ceiling'] = { style: 'flat', color: CEILING.color };
        room['skirting'] = { height: SKIRT_STYLE.height, depth: SKIRT_STYLE.depth, profile: SKIRT_STYLE.profile, color: SKIRT.color };
      }
    }
    for (const d of (level['doors'] as Obj[]) ?? []) if (d['kind'] === 'opening') d['height'] = OPENING_H;
    for (const w of (level['windows'] as Obj[]) ?? []) if (w['room'] === 'lobby') w['height'] = LOBBY_WINDOW_H;
  } else notes.push('no building plan found on `gallery`');

  // 10. World light settings: a soft fill, the gallery read as moderately bright, warm ambient against the lawn's green.
  const env = world.environment as unknown as Obj;
  env['ambientIntensity'] = 0.2;
  env['bloom'] = 0.25;
  const look = (isObj(env['look']) ? env['look'] : (env['look'] = {})) as Obj;
  look['lampStrength'] = 1;
  look['ambientTint'] = '#fff0e0';
  // The lawn round the building is the lower half of the image light: its saturated green dyed every ceiling indoors.
  // A muted, drier lawn keeps the outside green but the bounce near neutral.
  const ground = env['ground'];
  if (isObj(ground) && isObj(ground['material']) && ground['material']['preset'] === 'grass') ground['material'] = { preset: 'grass', color: '#7d8064' };
  look['intent'] = { key: 'moderate', text: 'warm rug gallery: each piece under a 3000 K spot, soft fill, white ceiling' };

  notes.push(`${spots.length} spots (${spots.filter((s) => s.room === 'hall').length} hall, ${spots.filter((s) => s.room === 'lobby').length} lobby), ${Object.values(ents).filter((e) => e.light).length} lights in all`);
  return notes;
}

// ---------------------------------------------------------------------------------------------------------------------

const text = readFileSync(FILE, 'utf8');
const raw = JSON.parse(text) as { format?: string; version?: number; world?: unknown };
if (raw.format !== 'aether-world') throw new Error(`${FILE}: not an aether-world file`);
const before = validateWorld(raw.world);
if (!before.ok) throw new Error(`invalid world before: ${before.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join('; ')}`);
const world = before.world;
const notes = apply(world);
const after = validateWorld(JSON.parse(JSON.stringify(world)));
if (!after.ok) throw new Error(`invalid world after: ${after.issues.slice(0, 5).map((i) => `${i.path}: ${i.message}`).join('; ')}`);
const out = `${stableStringify({ format: 'aether-world', version: 1, world: after.world })}\n`;
for (const n of notes) process.stdout.write(`- ${n}\n`);
if (out === text) process.stdout.write('unchanged\n');
else if (DRY) process.stdout.write(`would write ${out.length} bytes (was ${text.length})\n`);
else {
  writeFileSync(OUT, out);
  process.stdout.write(`wrote ${OUT} (${out.length} bytes, was ${text.length})\n`);
}
