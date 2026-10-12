/**
 * Incremental change detection between two world versions. Thanks to
 * structural sharing in `applyPatches`, unchanged entities are usually
 * reference-equal, so a diff is close to O(number of entities) pointer checks.
 */
import type { EntityId, WorldDoc } from './schema';
import { deepEqual, hasOwn } from './json';

/** What changed between two worlds. */
export interface WorldDiff {
  added: EntityId[];
  removed: EntityId[];
  changed: EntityId[];
  environmentChanged: boolean;
  playerChanged: boolean;
  rulesChanged: boolean;
  /** Custom generator ids added, removed or redefined. */
  generatorsChanged: string[];
  /** Custom script ids added, removed or redefined. */
  scriptsChanged: string[];
  stateChanged: boolean;
  hudChanged: boolean;
  testsChanged: boolean;
  /** name, description or seed changed. */
  metaChanged: boolean;
}

/** True when the diff contains no change at all. */
export function isEmptyDiff(d: WorldDiff): boolean {
  return (
    d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0 && !d.environmentChanged && !d.playerChanged &&
    !d.rulesChanged && d.generatorsChanged.length === 0 && d.scriptsChanged.length === 0 && !d.stateChanged && !d.hudChanged &&
    !d.testsChanged && !d.metaChanged
  );
}

function changed(a: unknown, b: unknown): boolean {
  return a !== b && !deepEqual(a, b);
}

function changedKeys(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): string[] {
  if (a === b) return [];
  const out: string[] = [];
  for (const k of Object.keys(a)) if (!hasOwn(b, k) || changed(a[k], b[k])) out.push(k);
  for (const k of Object.keys(b)) if (!hasOwn(a, k)) out.push(k);
  return out;
}

/** Compute the diff from `a` to `b` (reference-equality fast paths, then deep compare). */
export function diffWorlds(a: WorldDoc, b: WorldDoc): WorldDiff {
  const diff: WorldDiff = {
    added: [], removed: [], changed: [], environmentChanged: false, playerChanged: false, rulesChanged: false,
    generatorsChanged: [], scriptsChanged: [], stateChanged: false, hudChanged: false, testsChanged: false, metaChanged: false,
  };
  if (a === b) return diff;
  const ea = a.entities;
  const eb = b.entities;
  if (ea !== eb) {
    for (const id of Object.keys(eb)) {
      if (!hasOwn(ea, id)) diff.added.push(id);
      else if (changed(ea[id], eb[id])) diff.changed.push(id);
    }
    for (const id of Object.keys(ea)) if (!hasOwn(eb, id)) diff.removed.push(id);
  }
  diff.environmentChanged = changed(a.environment, b.environment);
  diff.playerChanged = changed(a.player, b.player);
  diff.rulesChanged = changed(a.rules, b.rules);
  diff.generatorsChanged = changedKeys(a.generators, b.generators);
  diff.scriptsChanged = changedKeys(a.scripts, b.scripts);
  diff.stateChanged = changed(a.state, b.state);
  diff.hudChanged = changed(a.hud, b.hud);
  diff.testsChanged = changed(a.tests, b.tests);
  diff.metaChanged = a.name !== b.name || a.description !== b.description || a.seed !== b.seed;
  return diff;
}
