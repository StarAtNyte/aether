/**
 * Named material slots of every furniture generator: the stable vocabulary a
 * prompt uses to target one surface of a piece ("dark green velvet sofa" →
 * `sofa.upholstery`, "brass legs" → `sofa.legs`, "marble worktop" →
 * `kitchen.worktop`). A slot maps to the generator parameter that carries its
 * finish and, when the material is tintable, the parameter that carries its
 * colour. The table is pure data; `slotPatch` turns a slot edit into the
 * minimal param override.
 */
import type { Json, MaterialSpec } from '@aether/core';
import { furnitureByKind, resolveSpec } from './index';

/** Where one slot's material lives in the generator params. */
export interface SlotDef {
  /** Param holding the finish (enum of finishes), if the slot has a choice of finish. */
  finish?: string;
  /** Param holding the colour, if the slot is tintable. */
  color?: string;
  /** Other names prompts use for the slot. */
  aliases: readonly string[];
}

const s = (finish: string | undefined, color: string | undefined, ...aliases: string[]): SlotDef => ({
  ...(finish ? { finish } : {}),
  ...(color ? { color } : {}),
  aliases,
});

/** Slots by furniture kind. Every kind with a material parameter has at least one slot. */
export const FURNITURE_SLOTS: Readonly<Record<string, Readonly<Record<string, SlotDef>>>> = Object.freeze({
  sofa: { upholstery: s('upholstery', 'color', 'fabric', 'cover', 'body', 'seat'), cushions: s(undefined, 'accent', 'pillows', 'accent cushions', 'throw pillows'), legs: s('legs', undefined, 'feet', 'base') },
  armchair: { upholstery: s('upholstery', 'color', 'fabric', 'cover', 'seat'), legs: s('legs', undefined, 'feet', 'base') },
  chair: { frame: s('wood', undefined, 'wood', 'legs', 'back'), seat: s('seat', 'color', 'cushion', 'upholstery') },
  'office-chair': { upholstery: s(undefined, 'color', 'seat', 'fabric', 'back'), base: s('base', undefined, 'legs', 'wheels') },
  'bar-stool': { seat: s('seat', 'color', 'cushion'), legs: s('legs', undefined, 'frame', 'base') },
  'dining-table': { top: s('top', undefined, 'tabletop', 'surface'), legs: s('legs', undefined, 'base', 'frame') },
  'coffee-table': { top: s('top', undefined, 'tabletop', 'surface'), legs: s('legs', undefined, 'base', 'frame') },
  desk: { top: s('top', undefined, 'tabletop', 'surface'), base: s('base', undefined, 'legs', 'frame') },
  cornice: { paint: s(undefined, 'color', 'colour', 'moulding', 'trim') },
  'tv-set': { shell: s(undefined, 'shell', 'casing', 'body', 'frame') },
  sideboard: { body: s('body', 'color', 'carcass', 'doors', 'fronts'), legs: s('legs', undefined, 'base', 'feet') },
  nightstand: { body: s('body', 'color', 'frame', 'drawer', 'wood') },
  bed: { frame: s('frame', undefined, 'wood', 'base'), headboard: s(undefined, 'headboard', 'head'), linen: s(undefined, 'linen', 'sheets', 'duvet', 'bedding', 'cover'), throw: s(undefined, 'throw', 'blanket', 'runner') },
  wardrobe: { fronts: s('finish', 'color', 'doors', 'body', 'wood', 'paint') },
  bookshelf: { frame: s('finish', undefined, 'wood', 'body', 'shelves') },
  kitchen: { worktop: s('worktop', undefined, 'countertop', 'counter', 'top'), fronts: s('fronts', 'color', 'cabinets', 'cabinet doors', 'doors', 'units'), splashback: s('splashback', undefined, 'backsplash', 'tiles') },
  island: { worktop: s('worktop', undefined, 'countertop', 'counter', 'top'), fronts: s('fronts', 'color', 'cabinets', 'doors', 'units') },
  fridge: { doors: s('finish', undefined, 'finish', 'body', 'steel') },
  toilet: { ceramic: s(undefined, 'color', 'body', 'bowl') },
  vanity: { body: s('body', undefined, 'cabinet', 'doors', 'unit'), top: s('top', undefined, 'countertop', 'worktop') },
  bathtub: { ceramic: s(undefined, 'color', 'body', 'tub') },
  rug: { field: s(undefined, 'color', 'main', 'body'), border: s(undefined, 'border', 'edge', 'trim') },
  curtain: { fabric: s('sheer', 'color', 'drape', 'drapes', 'curtains') },
  blind: { fabric: s(undefined, 'color', 'slats', 'shade', 'louvres', 'shutters', 'blinds') },
  plant: { pot: s('pot', 'potColor', 'planter', 'vase') },
  art: { frame: s('frame', undefined, 'border') },
  mirror: { frame: s('frame', undefined, 'border') },
  fireplace: { surround: s('stone', undefined, 'stone', 'mantel', 'hearth') },
  'cafe-counter': { front: s('front', undefined, 'base', 'body', 'panel'), top: s('top', undefined, 'worktop', 'counter') },
  pendant: { fitting: s('finish', 'color', 'shade', 'metal', 'body') },
  'floor-lamp': { fitting: s('finish', undefined, 'metal', 'stand', 'base'), shade: s(undefined, 'shade', 'lampshade') },
  'table-lamp': { base: s(undefined, 'base', 'stand'), shade: s(undefined, 'shade', 'lampshade') },
  sconce: { fitting: s('finish', undefined, 'metal', 'body') },
  tree: { foliage: s(undefined, 'leaf', 'leaves', 'crown', 'canopy') },
  mug: { glaze: s(undefined, 'color', 'cup', 'body', 'ceramic') },
  book: { cover: s(undefined, 'color', 'jacket', 'binding') },
  lounger: { frame: s('frame', undefined, 'legs', 'base'), mattress: s(undefined, 'color', 'cushion', 'pad', 'fabric') },
  accent: { body: s(undefined, 'color', 'vase', 'bowl', 'glaze', 'towel'), accent: s(undefined, 'accent', 'stems', 'fruit', 'leaves') },
  switch: { plate: s('finish', undefined, 'cover', 'finish') },
});

/** Slot names of a furniture kind (empty for kinds without a material choice, e.g. a tv). */
export function slotNames(kind: string): string[] {
  return Object.keys(FURNITURE_SLOTS[kind] ?? {});
}

/** Resolve a word ("legs", "cover", "countertop") to a slot name of the kind, or undefined. */
export function findSlot(kind: string, word: string): string | undefined {
  const table = FURNITURE_SLOTS[kind];
  if (!table) return undefined;
  const w = word.trim().toLowerCase();
  if (Object.hasOwn(table, w)) return w;
  for (const [name, def] of Object.entries(table)) if (def.aliases.includes(w)) return name;
  return undefined;
}

/**
 * The generator-param override that gives `slot` of a `kind` the material
 * (finish and / or colour). Returns `{}` for an unknown slot; a finish the
 * slot cannot take (the param is an enum without it) is dropped and reported
 * in `dropped`, so the caller can say what it could not do.
 */
export function slotPatch(kind: string, slot: string, material: Pick<MaterialSpec, 'finish' | 'color'>): { params: Record<string, Json>; dropped: string[] } {
  const def = FURNITURE_SLOTS[kind]?.[slot];
  const furn = furnitureByKind(kind);
  const params: Record<string, Json> = {};
  const dropped: string[] = [];
  if (!def || !furn) return { params, dropped };
  if (material.finish) {
    if (def.finish) {
      const resolved = resolveSpec({ [def.finish]: furn.params[def.finish]! }, { [def.finish]: material.finish });
      if (resolved[def.finish] === material.finish) params[def.finish] = material.finish;
      else dropped.push(`${slot} cannot be ${material.finish}`);
    } else dropped.push(`${slot} has no finish choice`);
  }
  if (material.color) {
    if (def.color) params[def.color] = material.color;
    else dropped.push(`${slot} cannot be recoloured`);
  }
  return { params, dropped };
}
