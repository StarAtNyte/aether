/**
 * Real furniture from the asset library for furnished rooms. When the asset
 * catalog is loaded, layouts place photographed (Poly Haven) models for the
 * kinds that have one, sized by the model's real dimensions; the parametric
 * `furn-*` generator stays as the shape's fallback (and drives the room
 * semantics: mount, wall placement, clearance). Every consumer that needs a
 * piece's footprint goes through {@link furnitureOfEntity}, so procedural
 * and asset furniture are checked the same way.
 */
import type { Entity, Json } from '@aether/core';
import { assetShapeSize, catalogEntry, getCatalog } from '@aether/assets';
import { furnitureById, furnitureByKind, furnitureSize, type FurnitureDef } from './index';

/** Library models per furniture kind, in order of preference (realistic, real-world sized). */
export const FURNITURE_ASSETS: Readonly<Record<string, readonly string[]>> = {
  sofa: ['sofa-classic'],
  armchair: ['armchair-classic'],
  'coffee-table': ['coffee-table-round'],
  nightstand: ['nightstand-classic'],
  pendant: ['pendant-lamp'],
};

/** The library model a layout should use for a kind, or null (catalog not loaded, or none fits). */
export function furnitureAsset(kind: string): { id: string; size: [number, number, number] } | null {
  if (!getCatalog()) return null;
  for (const id of FURNITURE_ASSETS[kind] ?? []) {
    const e = catalogEntry(id);
    if (e && e.kind === 'model') return { id, size: [e.size[0], e.size[1], e.size[2]] };
  }
  return null;
}

/** Furniture semantics of an entity: its definition (from the generator or the asset's fallback) and size. */
export function furnitureOfEntity(e: Entity): { def: FurnitureDef; size: [number, number, number]; params: Record<string, Json> } | null {
  const s = e.shape;
  if (s.kind === 'procedural') {
    const def = furnitureById(s.generator);
    return def ? { def, size: furnitureSize(def, s.params), params: s.params } : null;
  }
  if (s.kind === 'asset') {
    const fb = s.fallback?.kind === 'procedural' ? s.fallback : null;
    const def = (fb ? furnitureById(fb.generator) : undefined) ?? (e.arch?.kind ? furnitureByKind(e.arch.kind) : undefined);
    if (!def) return null;
    const size = assetShapeSize(s) ?? furnitureSize(def, fb?.params);
    return { def, size, params: fb?.params ?? {} };
  }
  return null;
}
