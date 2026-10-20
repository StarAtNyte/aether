/**
 * Interior style palettes: floors per room type, wall paint, woods, fabrics,
 * metals and accents. Curated so that any combination the layouts produce
 * reads as a coherent, real-world interior (limited palette, one accent,
 * natural materials) rather than random colours.
 */
import type { MaterialSpec } from '@aether/core';
import type { ArchStyle, RoomType } from './plan';

/** One style's palette. */
export interface StylePalette {
  /** Main wood for furniture (`furn-*` wood options). */
  wood: 'oak' | 'walnut' | 'ash';
  /** Metal for legs, frames, fittings. */
  metal: 'black-metal' | 'brass' | 'chrome' | 'brushed-metal';
  /** Upholstery material and colours. */
  upholstery: 'fabric' | 'velvet' | 'leather';
  sofa: string;
  armchair: string;
  accent: string;
  rug: string;
  rugBorder: string;
  linen: string;
  throw: string;
  curtain: string;
  /** Interior wall paint. */
  wall: string;
  /** Feature wall colour (living / bedroom headboard wall), or null. */
  feature: string | null;
  floors: { living: MaterialSpec; wet: MaterialSpec; bedroom: MaterialSpec; kitchen: MaterialSpec; hall: MaterialSpec; commercial: MaterialSpec };
  kitchenFronts: 'paint' | 'oak' | 'walnut' | 'ash';
  kitchenColor: string;
  worktop: 'marble' | 'terrazzo' | 'concrete' | 'oak' | 'walnut';
  door: 'panel' | 'flush' | 'glass' | 'slab';
  doorColor: string;
  windowFrame: MaterialSpec;
  pendant: 'globe' | 'dome' | 'cone' | 'linear';
  pendantFinish: 'black-metal' | 'brass' | 'paint' | 'frosted-glass';
  artPalette: number;
  /** Exterior facade finish for houses in this style. */
  facade: MaterialSpec;
  roof: MaterialSpec;
}

const PALETTES: Readonly<Record<ArchStyle, StylePalette>> = Object.freeze({
  modern: {
    wood: 'walnut',
    metal: 'black-metal',
    upholstery: 'fabric',
    sofa: '#9a958d',
    armchair: '#c2b4a0',
    accent: '#b9764a',
    rug: '#cfc7ba',
    rugBorder: '#8f877b',
    linen: '#f0eee9',
    throw: '#6f7d74',
    curtain: '#e4ded3',
    wall: '#eeece7',
    feature: '#cfc8bd',
    floors: { living: { finish: 'oak', color: '#e2d3bf' }, wet: { finish: 'tile', color: '#d9d6d0' }, bedroom: { finish: 'oak', color: '#e2d3bf' }, kitchen: { finish: 'oak', color: '#e2d3bf' }, hall: { finish: 'terrazzo' }, commercial: { finish: 'concrete', color: '#bdb8b0' } },
    kitchenFronts: 'paint',
    kitchenColor: '#d8d3ca',
    worktop: 'marble',
    door: 'flush',
    doorColor: '#f1efea',
    windowFrame: { finish: 'black-metal' },
    pendant: 'dome',
    pendantFinish: 'black-metal',
    artPalette: 0,
    facade: { finish: 'plaster', color: '#eceae5' },
    roof: { finish: 'metal-roof', color: '#3a3e43' },
  },
  scandinavian: {
    wood: 'ash',
    metal: 'black-metal',
    upholstery: 'fabric',
    sofa: '#d9d3c7',
    armchair: '#9fae9b',
    accent: '#d7a77a',
    rug: '#ece6db',
    rugBorder: '#c9bfae',
    linen: '#f4f2ee',
    throw: '#c9a27b',
    curtain: '#f1ede5',
    wall: '#f3f1ec',
    feature: null,
    floors: { living: { finish: 'ash' }, wet: { finish: 'tile', color: '#e8e5df' }, bedroom: { finish: 'ash' }, kitchen: { finish: 'ash' }, hall: { finish: 'ash' }, commercial: { finish: 'ash' } },
    kitchenFronts: 'paint',
    kitchenColor: '#f0eee9',
    worktop: 'oak',
    door: 'panel',
    doorColor: '#f4f2ee',
    windowFrame: { finish: 'paint', color: '#f2f0eb' },
    pendant: 'globe',
    pendantFinish: 'frosted-glass',
    artPalette: 1,
    facade: { finish: 'paint', color: '#7c2f2a' },
    roof: { finish: 'roof-tile', color: '#3f3836' },
  },
  industrial: {
    wood: 'walnut',
    metal: 'black-metal',
    upholstery: 'leather',
    sofa: '#7a4a2c',
    armchair: '#5b3a24',
    accent: '#c4622d',
    rug: '#8f7f6c',
    rugBorder: '#4e453b',
    linen: '#e7e3dc',
    throw: '#3f4a52',
    curtain: '#b9b3a8',
    wall: '#dedad3',
    feature: null,
    floors: { living: { finish: 'concrete', color: '#a9a49c' }, wet: { finish: 'concrete', color: '#8d8982' }, bedroom: { finish: 'walnut' }, kitchen: { finish: 'concrete', color: '#a9a49c' }, hall: { finish: 'concrete', color: '#a9a49c' }, commercial: { finish: 'concrete', color: '#9c978f' } },
    kitchenFronts: 'walnut',
    kitchenColor: '#3a3c3f',
    worktop: 'concrete',
    door: 'slab',
    doorColor: '#3b3d40',
    windowFrame: { finish: 'black-metal' },
    pendant: 'cone',
    pendantFinish: 'black-metal',
    artPalette: 2,
    facade: { finish: 'brick' },
    roof: { finish: 'metal-roof', color: '#2f3236' },
  },
  japandi: {
    wood: 'oak',
    metal: 'black-metal',
    upholstery: 'fabric',
    sofa: '#cdbfa9',
    armchair: '#8b8070',
    accent: '#6f7a5a',
    rug: '#d8ccb8',
    rugBorder: '#a8987f',
    linen: '#ece6dc',
    throw: '#7d6a55',
    curtain: '#e6dccb',
    wall: '#ebe5da',
    feature: '#d5cab8',
    floors: { living: { finish: 'oak', color: '#d9c4a5' }, wet: { finish: 'stone', color: '#c8c0b2' }, bedroom: { finish: 'oak', color: '#d9c4a5' }, kitchen: { finish: 'oak', color: '#d9c4a5' }, hall: { finish: 'stone', color: '#c8c0b2' }, commercial: { finish: 'oak', color: '#d9c4a5' } },
    kitchenFronts: 'oak',
    kitchenColor: '#cfc2ae',
    worktop: 'concrete',
    door: 'slab',
    doorColor: '#d8c8b0',
    windowFrame: { finish: 'oak' },
    pendant: 'dome',
    pendantFinish: 'paint',
    artPalette: 1,
    facade: { finish: 'plaster', color: '#e3dccf' },
    roof: { finish: 'roof-tile', color: '#3b3a38' },
  },
  // Limewashed walls, terracotta tile, oak and wrought iron, linen and olive green: a courtyard house in the hills.
  mediterranean: {
    wood: 'oak',
    metal: 'black-metal',
    upholstery: 'fabric',
    sofa: '#dcd2bf',
    armchair: '#b9a07f',
    accent: '#b5654a',
    rug: '#d9cbb0',
    rugBorder: '#a3512f',
    linen: '#f3eee4',
    throw: '#8a9a6b',
    curtain: '#f1eadb',
    wall: '#f3eee3',
    feature: '#dccdb2',
    floors: { living: { finish: 'tile', color: '#c98f68' }, wet: { finish: 'tile', color: '#e4dccd' }, bedroom: { finish: 'oak', color: '#cdb18a' }, kitchen: { finish: 'tile', color: '#c98f68' }, hall: { finish: 'stone', color: '#d8cfbd' }, commercial: { finish: 'tile', color: '#c98f68' } },
    kitchenFronts: 'oak',
    kitchenColor: '#d9ccb4',
    worktop: 'marble',
    door: 'panel',
    doorColor: '#5d6f55',
    windowFrame: { finish: 'black-metal' },
    pendant: 'dome',
    pendantFinish: 'black-metal',
    artPalette: 2,
    facade: { finish: 'plaster', color: '#f2ede2' },
    roof: { finish: 'roof-tile', color: '#a8553a' },
  },
  classic: {
    wood: 'walnut',
    metal: 'brass',
    upholstery: 'velvet',
    sofa: '#3f5a52',
    armchair: '#8a5a44',
    accent: '#b08a3e',
    rug: '#8c3f36',
    rugBorder: '#3f2a26',
    linen: '#f3efe6',
    throw: '#7a3b3b',
    curtain: '#d9cbb1',
    wall: '#ece5d8',
    feature: '#c9d1c4',
    floors: { living: { finish: 'herringbone' }, wet: { finish: 'marble' }, bedroom: { finish: 'herringbone' }, kitchen: { finish: 'marble' }, hall: { finish: 'marble' }, commercial: { finish: 'herringbone' } },
    kitchenFronts: 'paint',
    kitchenColor: '#c9cfc4',
    worktop: 'marble',
    door: 'panel',
    doorColor: '#f2eee5',
    windowFrame: { finish: 'paint', color: '#f2eee5' },
    pendant: 'globe',
    pendantFinish: 'brass',
    artPalette: 3,
    facade: { finish: 'stone', color: '#d9cfbd' },
    roof: { finish: 'roof-tile', color: '#4a3f3a' },
  },
});

/** Palette of a style. */
export function palette(style: ArchStyle): StylePalette {
  return PALETTES[style];
}

/** How a style articulates a house's outside (used when the plan does not choose the facade itself). */
export interface ExteriorPalette {
  /** Ground-floor facade (null: the style's `facade`). */
  ground: MaterialSpec | null;
  /** Upper storeys (a clad storey over a rendered base), or null for the ground floor's facade. */
  upper: MaterialSpec | null;
  /** Plinth / base course along the foot of the ground-floor walls. */
  plinth: MaterialSpec;
  /** Fascia, roof edge, coping and entrance canopy. */
  trim: MaterialSpec;
  /** Gutters and downpipes. */
  rainwater: MaterialSpec;
  /** Window surround on the outdoor face (`box` only round large windows), or null. */
  surround: 'box' | 'board' | 'stone' | null;
  surroundMaterial: MaterialSpec;
  /** A cantilevered canopy over the front door. */
  canopy: boolean;
}

const EXTERIORS: Readonly<Record<ArchStyle, ExteriorPalette>> = Object.freeze({
  // White render over a concrete plinth, a timber-clad upper storey, dark metal fascia and window boxes.
  modern: { ground: { finish: 'plaster', color: '#eceae4' }, upper: { finish: 'cladding', color: '#9a7652' }, plinth: { finish: 'concrete', color: '#8f8b84' }, trim: { finish: 'black-metal', color: '#2c2e31' }, rainwater: { finish: 'black-metal', color: '#2c2e31' }, surround: 'box', surroundMaterial: { finish: 'black-metal', color: '#26282b' }, canopy: true },
  // Falu-red board cladding, white trim boards round the windows, a dark stone plinth.
  scandinavian: { ground: { finish: 'cladding', color: '#7c2f2a' }, upper: null, plinth: { finish: 'stone', color: '#6f6b66' }, trim: { finish: 'paint', color: '#f2f0eb' }, rainwater: { finish: 'black-metal', color: '#2f3134' }, surround: 'board', surroundMaterial: { finish: 'paint', color: '#f2f0eb' }, canopy: false },
  industrial: { ground: { finish: 'brick' }, upper: null, plinth: { finish: 'concrete', color: '#85817a' }, trim: { finish: 'black-metal', color: '#2b2c2e' }, rainwater: { finish: 'black-metal', color: '#2b2c2e' }, surround: 'box', surroundMaterial: { finish: 'black-metal', color: '#2b2c2e' }, canopy: true },
  // Warm lime plaster, a charred-timber upper storey, dark stone at the foot.
  japandi: { ground: { finish: 'plaster', color: '#e3dccf' }, upper: { finish: 'cladding', color: '#4c3b2c' }, plinth: { finish: 'stone', color: '#5f5a54' }, trim: { finish: 'black-metal', color: '#2e2b28' }, rainwater: { finish: 'black-metal', color: '#2e2b28' }, surround: null, surroundMaterial: { finish: 'oak' }, canopy: true },
  // Limewash with limestone surrounds and sills, a rough stone plinth, terracotta-toned rainwater goods.
  mediterranean: { ground: null, upper: null, plinth: { finish: 'limestone', color: '#c9bba1' }, trim: { finish: 'plaster', color: '#efe8db' }, rainwater: { finish: 'brushed-metal', color: '#8a6a52' }, surround: 'stone', surroundMaterial: { finish: 'limestone', color: '#ddd2bd' }, canopy: false },
  // Dressed stone, rusticated base, painted white trim and stone window surrounds.
  classic: { ground: null, upper: null, plinth: { finish: 'limestone', color: '#b9ad98' }, trim: { finish: 'paint', color: '#f1ede4' }, rainwater: { finish: 'black-metal', color: '#2f3134' }, surround: 'stone', surroundMaterial: { finish: 'limestone', color: '#e6dccb' }, canopy: false },
});

/** Exterior articulation of a style. */
export function exteriorPalette(style: ArchStyle): ExteriorPalette {
  return EXTERIORS[style];
}

/** Default floor of a room type in a style. */
export function floorFor(style: ArchStyle, type: RoomType): MaterialSpec {
  const f = palette(style).floors;
  switch (type) {
    case 'bathroom':
    case 'laundry':
      return f.wet;
    case 'bedroom':
    case 'kids':
    case 'studio':
      return f.bedroom;
    case 'kitchen':
      return f.kitchen;
    case 'hall':
    case 'entry':
    case 'lobby':
      return f.hall;
    case 'cafe':
    case 'open-office':
    case 'meeting':
    case 'garage':
    case 'storage':
      return f.commercial;
    case 'terrace':
      return { finish: 'decking' };
    default:
      return f.living;
  }
}

/** True for rooms people live or work in (they get windows, lights and furniture). */
export function habitable(type: RoomType): boolean {
  return type !== 'storage' && type !== 'garage' && type !== 'terrace';
}
