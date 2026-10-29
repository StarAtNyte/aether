/**
 * The per-model front and mounting decided by the vision check (`front-fix.ts`), checked in as `simready-fronts.json`.
 * `rot` is the build's absolute turn about Y (degrees, multiple of 90) that puts the model's front on +Z; `mounting` the
 * kind of surface it hangs on or stands on. Read by the bulk converter and by the library build; the file is small text.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Mounting = 'floor' | 'wall' | 'ceiling' | 'table';

export interface FrontOverride {
  rot: number;
  mounting: Mounting;
  confidence: number;
  reason: string;
  model: string;
}

export const FRONTS_FILE = join(import.meta.dirname, 'simready-fronts.json');

export function loadFrontOverrides(file = FRONTS_FILE): Record<string, FrontOverride> {
  if (!existsSync(file)) return {};
  const j = JSON.parse(readFileSync(file, 'utf8')) as { fronts?: Record<string, FrontOverride> };
  return j.fronts ?? {};
}

/** The catalog's placement for a mounting. */
export const placeOf = (m: Mounting): 'floor' | 'wall' | 'ceiling' | 'surface' => (m === 'table' ? 'surface' : m);

/**
 * Where a wall or ceiling model's pivot goes. A wall model's pivot is its back-centre point at `anchor` (a share of the
 * model's height from its bottom) and `y` is the height above the floor that point is mounted at, so wall snapping puts the
 * model right; a ceiling model's pivot is its top-centre (`y` 0: the ceiling).
 */
export interface MountSpec {
  kind: 'wall' | 'ceiling';
  anchor: number;
  y: number;
}

const WALL_MOUNTS: ReadonlyArray<readonly [RegExp, number, number]> = [
  [/sink|washbasin|basin/, 0.85, 0.85],
  [/urinal/, 0, 0.55],
  [/toilet|\bwc\b/, 0, 0.1],
  [/socket|outlet|switch/, 0.5, 0.3],
  [/handdryer|dryer/, 0.5, 1.2],
  [/\btv\b|television|screen|monitor/, 0.5, 1.2],
  [/mirror/, 0.5, 1.5],
  [/sign|board|poster|painting|frame/, 0.5, 1.5],
  [/lamp|light|sconce/, 0.5, 1.8],
  [/beam/, 0.5, 2.4],
  [/shelf|shelves|rack|holder|cabinet|binder|aidcabinet/, 0.5, 1.4],
];

/** The pivot rule for a model mounted on a wall or ceiling (null for floor and table models). */
export function mountSpec(id: string, type: string, mounting: Mounting): MountSpec | null {
  if (mounting === 'ceiling') return { kind: 'ceiling', anchor: 1, y: 0 };
  if (mounting !== 'wall') return null;
  const hay = `${id} ${type}`.toLowerCase();
  const hit = WALL_MOUNTS.find(([re]) => re.test(hay));
  return { kind: 'wall', anchor: hit?.[1] ?? 0.5, y: hit?.[2] ?? 1.4 };
}
