/**
 * Art-directed material presets and pure resolution of a World IR
 * `MaterialSpec` into concrete, renderer-ready parameters. No three.js here,
 * so the logic is trivially unit-testable and the resolved object doubles as
 * the material cache key.
 */
import { FINISHES } from '@aether/arch';
import { stableStringify, type MaterialFinish, type MaterialPreset, type MaterialSpec } from '@aether/core';
import type { SurfaceKind } from './surface-textures';

/** Concrete parameters of one material (all fields resolved). */
export interface ResolvedMaterial {
  /** Base color, "#rrggbb" (sRGB). */
  color: string;
  roughness: number;
  metalness: number;
  /** Emissive color, "#rrggbb" (sRGB). "#000000" when not emissive. */
  emissive: string;
  emissiveIntensity: number;
  opacity: number;
  transparent: boolean;
  flatShading: boolean;
  vertexColors: boolean;
  doubleSided: boolean;
  /** Procedural surface detail (lava cracks, water ripples), null for plain materials. */
  surface: SurfaceKind | null;
  /** Physically based finish with procedural texture maps (architecture), null otherwise. */
  finish: MaterialFinish | null;
}

/** One entry of the preset table. */
export interface PresetDef {
  color: string;
  roughness: number;
  metalness: number;
  emissive?: string;
  emissiveIntensity?: number;
  /** When true, the emissive color follows the (possibly overridden) base color. */
  emissiveFollowsColor?: boolean;
  opacity?: number;
  flatShading?: boolean;
  /** Procedural surface detail applied by the renderer. */
  surface?: SurfaceKind;
}

/**
 * Preset table. Values are tuned for ACES filmic tone mapping at exposure 1
 * under the default day sky. Glass/water/ice are cheap alpha-blended
 * materials (no transmission pass) so they work on both backends. Lava and
 * water also get procedural surface detail (see `surface-textures.ts`).
 */
export const MATERIAL_PRESETS: Readonly<Record<MaterialPreset, PresetDef>> = Object.freeze({
  plastic: { color: '#d9d9d9', roughness: 0.42, metalness: 0 },
  wood: { color: '#8a5a33', roughness: 0.78, metalness: 0 },
  stone: { color: '#8b8984', roughness: 0.92, metalness: 0 },
  brick: { color: '#9c4a36', roughness: 0.9, metalness: 0 },
  concrete: { color: '#a5a29c', roughness: 0.95, metalness: 0 },
  metal: { color: '#b8bcc2', roughness: 0.32, metalness: 1 },
  gold: { color: '#e8b64c', roughness: 0.24, metalness: 1 },
  glass: { color: '#cfe8f2', roughness: 0.04, metalness: 0, opacity: 0.28 },
  water: { color: '#2a7fb8', roughness: 0.06, metalness: 0, opacity: 0.72, emissive: '#0a2a40', emissiveIntensity: 0.3, surface: 'water' },
  ice: { color: '#d6f0ff', roughness: 0.12, metalness: 0, opacity: 0.85, emissive: '#1c3a4a', emissiveIntensity: 0.15 },
  grass: { color: '#5d9a3c', roughness: 0.95, metalness: 0 },
  dirt: { color: '#6e4f33', roughness: 1, metalness: 0 },
  sand: { color: '#d9c08b', roughness: 0.97, metalness: 0 },
  snow: { color: '#f4f7fb', roughness: 0.85, metalness: 0 },
  lava: { color: '#3a0f05', roughness: 0.9, metalness: 0, emissive: '#ff4a12', emissiveIntensity: 2.2, surface: 'lava' },
  neon: { color: '#ff3df0', roughness: 0.4, metalness: 0, emissiveFollowsColor: true, emissiveIntensity: 3 },
  rubber: { color: '#2a2a2a', roughness: 0.95, metalness: 0 },
  fabric: { color: '#8a6fb0', roughness: 1, metalness: 0 },
  leaf: { color: '#4f8a2e', roughness: 0.85, metalness: 0 },
  bark: { color: '#5b3d26', roughness: 1, metalness: 0 },
  crystal: { color: '#a98bff', roughness: 0.1, metalness: 0.1, opacity: 0.85, emissiveFollowsColor: true, emissiveIntensity: 1.2, flatShading: true },
  emissive: { color: '#ffffff', roughness: 0.5, metalness: 0, emissiveFollowsColor: true, emissiveIntensity: 2 },
});

/** Defaults when a spec names no preset. */
const DEFAULT_PRESET: PresetDef = MATERIAL_PRESETS.plastic;
const HEX = /^#[0-9a-fA-F]{6}$/;
/** Below this opacity the material is alpha-blended. */
const OPAQUE_THRESHOLD = 0.999;

function hex(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : fallback;
}

function unit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function range(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return value < min ? min : value > max ? max : value;
}

function presetOf(spec: MaterialSpec | undefined): PresetDef {
  const id = spec?.preset;
  if (typeof id === 'string' && Object.hasOwn(MATERIAL_PRESETS, id)) return MATERIAL_PRESETS[id];
  return DEFAULT_PRESET;
}

/** Options that are not part of the World IR material but affect the GPU material. */
export interface ResolveOptions {
  /** The geometry carries per-vertex colors. Vertex colors are only enabled when true. */
  hasVertexColors?: boolean;
  /** Render both faces (planes, cards). */
  doubleSided?: boolean;
  /**
   * Procedural detail for presets that define none (the environment ground
   * plane passes `'ground'`). A preset's own surface (lava, water) wins.
   * Only geometry with metre UVs should ask for it.
   */
  surface?: SurfaceKind;
}

/**
 * Resolve a (possibly untrusted) material spec into concrete parameters:
 * preset defaults first, then explicit overrides. Invalid values fall back to
 * the preset (never throw). Vertex colors are enabled when the geometry has
 * colors and the spec does not explicitly disable them.
 */
export function resolveMaterial(spec: MaterialSpec | undefined, opts: ResolveOptions = {}): ResolvedMaterial {
  const fin = spec?.finish;
  if (typeof fin === 'string' && Object.hasOwn(FINISHES, fin)) return resolveFinish(spec as MaterialSpec, fin, opts);
  const p = presetOf(spec);
  const color = hex(spec?.color, p.color);
  const explicitEmissive = typeof spec?.emissive === 'string' && HEX.test(spec.emissive);
  const emissive = explicitEmissive ? hex(spec?.emissive, '#000000') : p.emissiveFollowsColor ? color : hex(p.emissive, '#000000');
  const defaultIntensity = p.emissiveIntensity ?? (explicitEmissive ? 1 : 0);
  const emissiveIntensity = emissive === '#000000' ? 0 : range(spec?.emissiveIntensity, 0, 50, defaultIntensity);
  const opacity = unit(spec?.opacity, p.opacity ?? 1);
  return {
    color,
    roughness: unit(spec?.roughness, p.roughness),
    metalness: unit(spec?.metalness, p.metalness),
    emissive: emissiveIntensity > 0 ? emissive : '#000000',
    emissiveIntensity,
    opacity,
    transparent: opacity < OPAQUE_THRESHOLD,
    flatShading: typeof spec?.flatShading === 'boolean' ? spec.flatShading : (p.flatShading ?? false),
    vertexColors: opts.hasVertexColors === true && spec?.vertexColors !== false,
    doubleSided: opts.doubleSided === true,
    surface: p.surface ?? opts.surface ?? null,
    finish: null,
  };
}

/**
 * Resolve a finish material: the finish's physically based defaults, then
 * the spec's explicit colour / roughness / metalness / opacity / emissive.
 * A finish wins over a preset named in the same spec.
 */
function resolveFinish(spec: MaterialSpec, id: MaterialFinish, opts: ResolveOptions): ResolvedMaterial {
  const d = FINISHES[id];
  const color = hex(spec.color, d.color);
  const explicitEmissive = typeof spec.emissive === 'string' && HEX.test(spec.emissive);
  const emissiveIntensity = explicitEmissive ? range(spec.emissiveIntensity, 0, 50, 1) : 0;
  const opacity = unit(spec.opacity, d.opacity ?? 1);
  return {
    color,
    roughness: unit(spec.roughness, d.roughness),
    metalness: unit(spec.metalness, d.metalness),
    emissive: emissiveIntensity > 0 ? hex(spec.emissive, '#000000') : '#000000',
    emissiveIntensity,
    opacity,
    transparent: opacity < OPAQUE_THRESHOLD,
    flatShading: false,
    vertexColors: opts.hasVertexColors === true && spec.vertexColors === true,
    doubleSided: opts.doubleSided === true,
    surface: null,
    finish: id,
  };
}

/** Rendering variant of a material (the ghost preview uses a translucent override). */
/** 'foliage' is 'standard' plus procedural wind sway (vegetation fields). */
/** 'proof' is the proof-replay ghost: like 'ghost', tinted with the accent and more opaque. */
export type MaterialVariant = 'standard' | 'ghost' | 'foliage' | 'proof';

/** Stable cache key of a resolved material + variant. Equivalent specs share one key. */
export function materialKey(resolved: ResolvedMaterial, variant: MaterialVariant = 'standard'): string {
  return `${variant}|${stableStringify(resolved)}`;
}

/**
 * Combine a generator part's material with the entity's material.
 *
 * - Single-part outputs (primitives, simple generators): the entity material
 *   wins field by field, so `material: { color }` recolors the object.
 * - Multi-part outputs (a tree's bark + leaves): the generator's art
 *   direction is preserved. A part with a preset or color keeps its whole
 *   look; a bare part takes the entity material for the fields it leaves
 *   unset. `opacity` and `flatShading` from the entity always apply (they
 *   are whole-object intents like "make it see-through").
 */
export function mergeMaterial(part: MaterialSpec | undefined, entity: MaterialSpec | undefined, partCount: number): MaterialSpec {
  if (!entity) return part ?? {};
  if (!part) return entity;
  if (partCount <= 1) return { ...part, ...entity };
  const styled = part.preset !== undefined || part.color !== undefined;
  const merged: MaterialSpec = styled ? { ...part } : { ...entity, ...part };
  if (entity.opacity !== undefined) merged.opacity = entity.opacity;
  if (entity.flatShading !== undefined) merged.flatShading = entity.flatShading;
  return merged;
}
