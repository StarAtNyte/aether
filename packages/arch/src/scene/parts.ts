/**
 * The parts library of the design tools: every furniture, decor, lighting and
 * fixture generator of this package as a catalogue entry (kind, how it is
 * mounted, default size, parameters with bounds), parameter resolution that
 * says what it changed, sensible default heights for wall pieces, and the
 * instantiation of a part as a World IR entity.
 *
 * The AI chooses which part, where and with which parameters; this module
 * only knows what a part is.
 */
import type { EntityInput, Json, LightSpec, ParamSpec } from '@aether/core';
import { placedEntity } from '../compile';
import { FURNITURE, furnitureByKind, furnitureSize, resolveSpec, type FurnitureDef } from '../furniture/index';
import type { Placed } from '../layout';
import type { EntityId } from '@aether/core';
import type { ItemMount } from './types';

/** One parameter of a part, for prompts and validation. */
export interface PartParam {
  name: string;
  type: ParamSpec['type'];
  default: Json;
  min?: number;
  max?: number;
  options?: string[];
  description?: string;
}

/** Catalogue entry of a part. */
export interface PartInfo {
  kind: string;
  generator: string;
  mount: ItemMount;
  description: string;
  /** Width × height × depth with default parameters. */
  size: [number, number, number];
  /** Clear floor wanted in front (metres). */
  frontClearance: number;
  /** Usually stands with its back against a wall. */
  againstWall: boolean;
  params: PartParam[];
}

/** Catalogue entry of a kind, or undefined. */
export function partInfo(kind: string): PartInfo | undefined {
  const def = furnitureByKind(kind);
  return def ? infoOf(def) : undefined;
}

function infoOf(def: FurnitureDef): PartInfo {
  const params: PartParam[] = Object.entries(def.params).map(([name, s]) => ({
    name,
    type: s.type,
    default: s.default,
    ...(s.min !== undefined ? { min: s.min } : {}),
    ...(s.max !== undefined ? { max: s.max } : {}),
    ...(s.options ? { options: s.options } : {}),
    ...(s.description ? { description: s.description } : {}),
  }));
  return { kind: def.kind, generator: def.id, mount: def.mount, description: def.description, size: furnitureSize(def), frontClearance: def.frontClearance, againstWall: def.againstWall, params };
}

/** Every kind of part, in catalogue order. */
export function listParts(): PartInfo[] {
  return FURNITURE.map(infoOf);
}

/** All kinds of part. */
export function partKinds(): string[] {
  return FURNITURE.map((f) => f.kind);
}

/**
 * Compact catalogue text for prompts: one line per kind with its mount, default
 * size and parameters (`name=default (min..max)` or `{options}`).
 */
export function describeParts(): string {
  return listParts().map(describePartLine).join('\n');
}

/** One catalogue line of a part: kind, mount, default size, clearance and parameters. */
export function describePartLine(p: PartInfo): string {
  const ps = p.params
    .map((q) => {
      const range = q.options ? `{${q.options.join('|')}}` : q.min !== undefined && q.max !== undefined ? `(${q.min}..${q.max})` : '';
      return `${q.name}=${typeof q.default === 'string' ? q.default : JSON.stringify(q.default)}${range}`;
    })
    .join(' ');
  return `- ${p.kind} [${p.mount}${p.againstWall ? ', usually against a wall' : ''}] ${p.size.map((v) => Math.round(v * 100) / 100).join('×')} m, front clearance ${p.frontClearance} m: ${ps}`;
}

/** Parameters of a part after defaults and clamping, plus a note for everything that was changed. */
export function resolvePartParams(def: FurnitureDef, given: Record<string, Json> | undefined): { params: Record<string, Json>; notes: string[] } {
  const notes: string[] = [];
  const g = given ?? {};
  const known = new Set(Object.keys(def.params));
  const unknown = Object.keys(g).filter((k) => !known.has(k));
  if (unknown.length > 0) notes.push(`ignored unknown parameter${unknown.length > 1 ? 's' : ''} ${unknown.slice(0, 6).join(', ')} (${def.kind} has: ${[...known].join(', ')})`);
  const params = resolveSpec(def.params, g);
  for (const k of Object.keys(g)) {
    if (!known.has(k)) continue;
    const spec = def.params[k] as ParamSpec;
    const want = g[k];
    if (spec.type === 'number' || spec.type === 'int') {
      const n = typeof want === 'number' ? want : Number.NaN;
      if (!Number.isFinite(n)) notes.push(`${k}: ${JSON.stringify(want)} is not a number; used ${JSON.stringify(params[k])}`);
      else if (params[k] !== n) notes.push(`${k}: ${n} is outside ${spec.min}..${spec.max}; used ${JSON.stringify(params[k])}`);
    } else if (spec.type === 'enum' && params[k] !== want && String(want).toLowerCase() !== String(params[k]).toLowerCase()) {
      notes.push(`${k}: "${String(want).slice(0, 30)}" is not one of {${(spec.options ?? []).join('|')}}; used "${String(params[k])}"`);
    } else if (spec.type === 'color' && params[k] !== String(want).toLowerCase()) {
      notes.push(`${k}: ${JSON.stringify(want).slice(0, 30)} is not a #rrggbb colour; used ${JSON.stringify(params[k])}`);
    }
  }
  return { params, notes };
}

/** Wall pieces: where the bottom of a piece of height `h` hangs by default (centre of art at eye height). */
export function defaultWallBottom(kind: string, h: number, ceiling: number): number {
  switch (kind) {
    case 'art':
      return Math.max(0.9, Math.min(ceiling - h - 0.25, 1.55 - h / 2));
    case 'mirror':
      return Math.max(0.2, Math.min(ceiling - h - 0.25, 1.5 - h / 2));
    case 'tv':
      return 1.05;
    case 'sconce':
      return 1.7;
    case 'switch':
      return 1.1;
    case 'whiteboard':
    case 'blackboard':
      return 0.9;
    case 'cinema-screen':
      return 0.9;
    case 'acoustic-panel':
      return 0.6;
    case 'booth-port':
      return 2.6;
    case 'step-light':
      return 0.12;
    case 'curtain':
    case 'blind':
      return 0;
    case 'pelmet':
      return Math.max(0, ceiling - h);
    case 'cornice':
      return Math.max(0, ceiling - h);
    default:
      return Math.max(0, Math.min(1.2, ceiling - h - 0.2));
  }
}

/** Plausible height range (bottom of the piece above the floor) of wall pieces, for sanity checks. */
export function wallBottomRange(kind: string, h: number, ceiling: number): [number, number] {
  switch (kind) {
    case 'art':
      return [0.6, Math.max(0.7, ceiling - h - 0.1)];
    case 'mirror':
      return [0, Math.max(0.1, ceiling - h - 0.1)];
    case 'tv':
      return [0.5, 1.7];
    case 'sconce':
      return [1.3, 2.2];
    case 'switch':
      return [0.9, 1.4];
    case 'whiteboard':
      return [0.4, 1.5];
    case 'curtain':
    case 'blind':
      return [0, 2.2];
    case 'pelmet':
      return [Math.max(0, ceiling - h - 1.2), Math.max(0, ceiling - h + 0.05)];
    case 'cornice':
      return [Math.max(0, ceiling - h - 0.05), Math.max(0, ceiling - h + 0.02)];
    default:
      return [0, Math.max(0.1, ceiling - h)];
  }
}

/** Plausible size range of each kind (width, depth, height in metres): beyond it a piece reads as a mistake. */
export const KIND_SIZE_LIMITS: Readonly<Record<string, { w?: [number, number]; d?: [number, number]; h?: [number, number] }>> = Object.freeze({
  sofa: { w: [1.0, 3.8], d: [0.65, 1.3], h: [0.55, 1.1] },
  armchair: { w: [0.55, 1.2], d: [0.6, 1.2], h: [0.6, 1.2] },
  bed: { w: [0.7, 2.3], d: [1.7, 2.4], h: [0.3, 1.8] },
  nightstand: { w: [0.3, 0.8], d: [0.3, 0.6], h: [0.35, 0.8] },
  wardrobe: { w: [0.6, 3.5], d: [0.4, 0.8], h: [1.6, 2.7] },
  desk: { w: [0.8, 2.4], d: [0.45, 1.0], h: [0.65, 0.85] },
  'dining-table': { w: [0.7, 3.4], d: [0.7, 1.4], h: [0.7, 0.8] },
  'coffee-table': { w: [0.4, 1.6], d: [0.4, 1.0], h: [0.3, 0.55] },
  chair: { w: [0.35, 0.6], d: [0.35, 0.65], h: [0.75, 1.1] },
  bookshelf: { w: [0.4, 3.0], d: [0.2, 0.55], h: [0.8, 2.7] },
  tv: { w: [0.5, 2.2], d: [0.02, 0.15], h: [0.3, 1.3] },
  art: { w: [0.15, 2.8], d: [0, 0.12], h: [0.15, 2.4] },
  mirror: { w: [0.2, 2.2], d: [0, 0.12], h: [0.2, 2.4] },
  plant: { h: [0.2, 2.6] },
});

/** Warm interior light of a ceiling fitting (same calibration as the room recipes). */
export function fittingLight(range: number, intensity = 1.2): Partial<LightSpec> {
  return { type: 'point', color: '#ffd7a6', intensity: Math.round(intensity * 0.45 * 100) / 100, range: Math.max(4, Math.min(24, range)), castShadow: false };
}

/** What {@link itemEntity} needs. */
export interface ItemSpec {
  id: EntityId;
  def: FurnitureDef;
  params: Record<string, Json>;
  /** Entity origin: plan x, height, plan z (wall pieces: bottom centre on the wall face). */
  pos: [number, number, number];
  yaw: number;
  name?: string;
  room: EntityId;
  levelId: EntityId;
  level: number;
  /** Real light source (ceiling fittings). */
  light?: Partial<LightSpec>;
  /** Library model shown instead of the generator (`size` is then its real size). */
  asset?: { id: string; size: [number, number, number]; fitSize?: number; /** Pivot is the mount point (`CatalogEntry.mountY`): `pos[1]` is then the pivot height. */ mountY?: number; /** Recolour of the model's paint material (#rrggbb). */ tint?: string };
}

/** Turn an {@link ItemSpec} into an `add`-ready entity tagged `placed`. */
export function itemEntity(spec: ItemSpec): EntityInput {
  const def = spec.def;
  const size = spec.asset ? spec.asset.size : furnitureSize(def, spec.params);
  const placed: Placed = {
    kind: def.kind,
    generator: def.id,
    params: spec.params,
    x: spec.pos[0],
    y: spec.pos[1],
    z: spec.pos[2],
    yaw: spec.yaw,
    size,
    def,
    footprint: [],
    name: spec.name ?? titleCase(def.kind),
    ...(spec.light ? { light: spec.light } : {}),
    ...(spec.asset ? { asset: spec.asset.id, ...(spec.asset.fitSize !== undefined ? { assetFit: spec.asset.fitSize } : {}), ...(spec.asset.mountY !== undefined ? { assetMountY: spec.asset.mountY } : {}) } : {}),
  };
  const e = placedEntity(placed, spec.id, spec.levelId, spec.room, spec.level, true);
  e.tags = [...new Set([...(e.tags ?? []), 'placed'])];
  if (spec.asset?.tint) e.material = { ...(e.material ?? {}), color: spec.asset.tint };
  return e;
}

function titleCase(kind: string): string {
  const s = kind.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
