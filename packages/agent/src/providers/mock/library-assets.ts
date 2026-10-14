/**
 * The offline planner's bridge to the asset library: everyday nouns become
 * real library models ({kind:"asset"}) when the catalog is loaded, each with
 * a fallback generator or primitive so the world never shows an empty spot.
 * Nature, terrain and gameplay pieces stay procedural: they take part in
 * scatter fields, foliage wind and game mechanics the planner relies on.
 */
import type { EntityInput, Json } from '@aether/core';
import { getCatalog, searchAssets, type CatalogEntry } from '@aether/assets';
import { r2, type Builder, type PlaceOpts, type V3 } from './builder';
import type { Asset } from './lexicon';

/** Nouns that stay procedural even when the library has a model for them. */
export const PROCEDURAL_NOUNS: ReadonlySet<string> = new Set([
  'tree', 'oak', 'pine', 'pine tree', 'fir', 'palm', 'palm tree', 'rock', 'boulder', 'stone', 'bush', 'shrub', 'flower', 'mushroom', 'grass',
  'house', 'home', 'cottage', 'cabin', 'building', 'hut', 'tower', 'wall', 'bridge', 'stair', 'staircase', 'arch', 'ramp', 'mountain', 'cloud',
  'crystal', 'gem', 'portal', 'goal', 'finish', 'finish line', 'checkpoint', 'lava', 'lava pool', 'jump pad', 'trampoline', 'launcher', 'coin',
  'ball', 'beach ball', 'crate', 'box', 'cube', 'snowman', 'sheep', 'cactus', 'lamp', 'lamp post', 'lamppost', 'light', 'campfire', 'fire', 'bonfire',
]);

/** Minimum search score for the planner to trust a match (a direct name / tag / synonym hit). */
const MIN_SCORE = 18;

/** Strong library match for a noun (models only), or null when the catalog is not loaded or nothing fits. */
export function libraryEntry(noun: string): CatalogEntry | null {
  const catalog = getCatalog();
  if (!catalog || catalog.entries.length === 0) return null;
  const hit = searchAssets(catalog, { text: noun, kind: 'model', limit: 1 })[0];
  return hit && hit.score >= MIN_SCORE ? hit.entry : null;
}

/** Entities that should come alive: people talk, monsters chase, animals roam. */
function liveliness(entry: CatalogEntry, noun: string, b: Builder): Pick<PlaceOpts, 'behaviors' | 'physics' | 'tags' | 'name'> {
  if (entry.category === 'characters') {
    if (/zombie|skeleton|vampire|monster|enemy|goblin/.test(`${entry.id} ${noun}`)) {
      return {
        name: entry.name,
        behaviors: [{ type: 'follow', params: { target: 'player', distance: 0.6, speed: 2.2, range: 14 } }, { type: 'hazard', params: { mode: 'respawn', text: 'Caught!' } }],
        physics: { body: 'kinematic', collider: 'capsule' },
        tags: ['enemy', 'hazard', 'character'],
      };
    }
    if (entry.id === 'ghost') {
      return { name: 'Ghost', behaviors: [{ type: 'wander', params: { radius: 6, speed: 1.2 } }], tags: ['ghost', 'character'] };
    }
    const names = ['Ada', 'Bram', 'Cleo', 'Dorian', 'Esme', 'Finn', 'Gwen', 'Hugo'];
    const name = b.pick(names);
    return {
      name,
      behaviors: [{ type: 'npc', params: { name, lines: ['Hello there, traveler!', 'Lovely day, isn\'t it?', 'Watch your step out there.'] } }, { type: 'wander', params: { radius: 4, speed: 1.1, pause: 3 } }],
      tags: ['npc', 'character'],
    };
  }
  if (entry.category === 'animals') {
    return { name: entry.name, behaviors: [{ type: 'wander', params: { radius: 5, speed: entry.size[1] > 1 ? 1.2 : 0.9, pause: 2.5 } }], tags: ['animal'] };
  }
  return { physics: 'static' };
}

/** A lexicon-style asset backed by a library model, keeping `base` (if any) as its fallback. */
export function libraryAsset(entry: CatalogEntry, noun: string, base: Asset | null, fallback?: EntityInput['shape']): Asset {
  const radius = Math.max(0.4, Math.min(8, Math.max(entry.size[0], entry.size[2]) / 2 + 0.3));
  return {
    label: noun,
    radius,
    make: (b, x, z) => {
      const live = liveliness(entry, noun, b);
      return b.asset(noun.replace(/\s+/g, '-'), entry.id, [x, 0, z], {
        yaw: r2(b.rand(0, 360)),
        ...live,
        ...(fallback ? { fallback } : {}),
      });
    },
    ...(base?.scatter ? { scatter: base.scatter } : {}),
  };
}

/** Built-in generators that stand in when a library model is unavailable (fallback chain). */
const FALLBACK_GENERATORS: Readonly<Record<string, string>> = {
  chair: 'chair', table: 'table', bench: 'bench', barrel: 'barrel', car: 'car', truck: 'car', tent: 'tent', dock: 'dock', pier: 'dock',
  statue: 'statue', windmill: 'windmill', boat: 'boat',
};

/** Library-backed replacement for a lexicon noun (null keeps the lexicon asset). */
export function preferLibrary(noun: string, base: Asset | null): Asset | null {
  if (PROCEDURAL_NOUNS.has(noun)) return null;
  const entry = libraryEntry(noun);
  if (!entry) return null;
  const gen = FALLBACK_GENERATORS[noun];
  return libraryAsset(entry, noun, base, gen ? { kind: 'procedural', generator: gen, params: {} } : undefined);
}

/** Convenience for themes: place a library asset when available, else run `fallback`. */
export function placeLibrary(b: Builder, id: string, base: string, pos: V3, o: PlaceOpts & { fallback?: EntityInput['shape'] }, otherwise: () => string): string {
  const catalog = getCatalog();
  if (!catalog || !catalog.entries.some((e) => e.id === id)) return otherwise();
  return b.asset(base, id, pos, o);
}

/** Params helper (re-exported for themes). */
export type AssetParams = Record<string, Json>;
