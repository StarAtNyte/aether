/**
 * Flagship showcase worlds of the offline planner: complete, art-directed
 * games and scenes (title card, objective, HUD, verification tests) built
 * entirely from the framework's own parts. Each one answers to its name in
 * a request ("Sakura River Journey", "build the kart canyon race"), so the
 * same prompt that seeds a bundled default project rebuilds it in the
 * editor.
 */
import type { MockPlan } from '../planner';
import { duskLakeHouse, skylinePenthouse } from './architecture';
import { casaPatio } from './casa';
import { chainReaction } from './chain-reaction';
import { hollowGate } from './hollow-gate';
import { kestrelOutpost } from './kestrel-outpost';
import { highlandTrail } from './highland-trail';
import { kartCanyon } from './kart-canyon';
import { lanternIsles } from './lantern-isles';
import { kyotoTemple } from './kyoto-temple';
import { meadowTrain } from './meadow-train';
import { neonRainCity } from './neon-city';
import { orbitalLab } from './orbital-lab';
import { sakuraRiver } from './sakura';
import { seasonsGarden } from './seasons-garden';
import { planBlockfall } from '../voxel';

/** One flagship plan. */
export interface Flagship {
  /** Stable id (also the default-project slug). */
  id: string;
  /** Display title. */
  title: string;
  /** Matcher on the lowercased request: the flagship's name. */
  match: RegExp;
  /** Build the plan (deterministic). */
  plan(): MockPlan;
}

/** Every flagship, in showcase order. */
export const FLAGSHIPS: readonly Flagship[] = Object.freeze([
  { id: 'highland-trail', title: 'Highland Trail', match: /\bhighland trail\b/, plan: highlandTrail },
  { id: 'lantern-isles', title: 'Lantern Isles', match: /\blantern isles?\b/, plan: lanternIsles },
  { id: 'chain-reaction', title: 'Chain Reaction', match: /\bchain reaction\b(?=.*\b(machines?|rube|goldberg|five|puzzle)\b)|\bchain reaction machines?\b/, plan: chainReaction },
  { id: 'kart-canyon', title: 'Kart Canyon', match: /\bkart canyon\b/, plan: kartCanyon },
  { id: 'blockfall', title: 'Blockfall', match: /\bblockfall\b/, plan: planBlockfall },
  { id: 'neon-rain-city', title: 'Neon Rain City', match: /\bneon rain city\b|\bneon city\b(?=.*\brain)/, plan: neonRainCity },
  { id: 'kyoto-temple', title: 'Kyoto Temple Lanterns', match: /\bkyoto temple\b/, plan: kyotoTemple },
  { id: 'painterly-meadow', title: 'Painterly Meadow', match: /\bpainterly meadow\b/, plan: meadowTrain },
  { id: 'four-seasons-garden', title: 'Four-Seasons Garden', match: /\bfour[- ]seasons? garden\b/, plan: seasonsGarden },
  { id: 'orbital-lab', title: 'Orbital Lab', match: /\borbital lab\b/, plan: orbitalLab },
  { id: 'sakura-river', title: 'Sakura River Journey', match: /\bsakura river\b|\bcherry[- ]blossom river\b/, plan: sakuraRiver },
  { id: 'skyline-penthouse', title: 'Skyline Penthouse', match: /\bskyline penthouse\b/, plan: skylinePenthouse },
  { id: 'hollow-gate', title: 'The Hollow Gate', match: /\bhollow gate\b/, plan: hollowGate },
  { id: 'kestrel-outpost', title: 'Kestrel Outpost', match: /\bkestrel outpost\b/, plan: kestrelOutpost },
  { id: 'casa-patio', title: 'Casa del Patio', match: /\bcasa del patio\b|\bcourtyard house\b(?=.*\b(sintra|hills?|patio)\b)|\bsintra\b(?=.*\bhouse\b)/, plan: casaPatio },
  { id: 'dusk-lake-house', title: 'Dusk House by the Lake', match: /\bdusk house\b|\bhouse by the lake at dusk\b/, plan: duskLakeHouse },
]);

/** Verbs that ask for a new world (a flagship replaces a non-empty world only when asked to build). */
const BUILD = /\b(build|create|make|generate|open|load|start|play|give me|show me|new|another|instead)\b/;

/** World summaries list their entity count as `entities=N`. */
function summaryEntities(summary: string): number {
  const m = /\bentities=(\d+)/.exec(summary);
  return m ? Number(m[1]) : 0;
}

/**
 * The flagship a request names, or null. In a world that already has
 * content the request must also ask to build it, so "make the sakura river
 * journey snowy" stays an edit.
 */
export function findFlagship(request: string, summary = ''): Flagship | null {
  const t = request.toLowerCase();
  const hit = FLAGSHIPS.find((f) => f.match.test(t));
  if (!hit) return null;
  if (summaryEntities(summary) > 0 && !BUILD.test(t)) return null;
  return hit;
}

/** Plan a flagship request, or null when the request names none. */
export function planShowcase(request: string, summary = ''): MockPlan | null {
  return findFlagship(request, summary)?.plan() ?? null;
}
