/**
 * Edits on an existing world for the mock planner: add things, remove things
 * and change properties ("make the trees bigger", "paint the car red").
 */
import { BuiltinBehavior, slugify, type Json } from '@aether/core';
import { r2, type Builder } from './builder';
import type { Change, Edit, Intent } from './intent';
import { ALL_THEMES } from './intent';
import { COLORS, lookupAsset, singular } from './lexicon';
import type { EntityView, WorldView } from './world-view';
import type { ThemeCtx } from './decor';
import { findLibraryItems, libraryAsset, type MockLibraryItem } from './library';

const KNOWN_BEHAVIORS: ReadonlySet<string> = new Set([...BuiltinBehavior.options, 'script']);
const ADJECTIVES = new Set(['big', 'small', 'large', 'tiny', 'huge', 'giant', 'little', 'tall', 'short', 'old', 'new', 'wooden', 'stone', 'all', 'every', 'my', 'the', 'those', 'these', 'of']);
const MAX_TARGETS = 200;

/** Approximate footprint radius of an existing entity (for placing new things). */
function footprintOf(e: EntityView): number {
  if (e.tags.includes('backdrop') || e.shape === 'scatter' || e.depth > 0) return 0;
  const g = e.generator ?? '';
  if (/house|windmill|tower|castle/.test(g)) return 5 * e.scale;
  if (/mountain|island|terrain/.test(g)) return 0;
  if (/tree/.test(g)) return 1.8 * e.scale;
  if (e.shape === 'primitive' && e.height !== undefined && e.height < 0.3) return 0; // floors, paths, water
  return 1.2 * e.scale;
}

/** Reserve the footprints of the existing world so additions do not overlap it. */
export function reserveExisting(b: Builder, view: WorldView): void {
  for (const e of view.entities) {
    const r = footprintOf(e);
    if (r > 0 && r < 30) b.reserve(e.pos[0], e.pos[2], r);
  }
}

/** "the tower I just moved", "the one I changed", "the last one": the user means something they edited by hand. */
const RECENT_PHRASE = /\b(?:that\s+|which\s+)?(?:i|we)\s+(?:just\s+|recently\s+|have\s+|had\s+)?(?:moved|placed|put|edited|changed|added|made|rotated|scaled|dragged|painted|sculpted|selected|resized|built)\b(?:\s+(?:it|there|here))?|\bjust now\b|\b(?:last|latest|previous)\s+one\b|\bthe one\b/g;

/** Strip a recency phrase from a target; reports whether there was one. */
export function recencyOf(target: string): { rest: string; recent: boolean } {
  const rest = target.toLowerCase().replace(RECENT_PHRASE, ' ').replace(/\s+/g, ' ').trim();
  return { rest, recent: rest !== target.toLowerCase().replace(/\s+/g, ' ').trim() };
}

/** Recently hand-edited entities, newest first. */
function recentlyEdited(view: WorldView): EntityView[] {
  const byId = new Map(view.entities.map((e) => [e.id, e]));
  const ordered = view.recentEdits.map((id) => byId.get(id)).filter((e): e is EntityView => !!e);
  for (const e of view.entities) if (e.userEditedAge !== undefined && !ordered.includes(e)) ordered.push(e);
  return ordered;
}

/** Entities matching a free-text target. Children only match by exact id. Locked entities never match. */
export function resolveTargets(view: WorldView, rawTarget: string, all: boolean): EntityView[] {
  const { rest, recent } = recencyOf(rawTarget);
  if (recent) {
    const pool = recentlyEdited(view).filter((e) => !e.locked);
    if (pool.length === 0) return [];
    if (!rest || /^(it|that|this|thing|object|one)$/.test(rest)) return [pool[0] as EntityView];
    const matching = matchTargets({ ...view, entities: pool }, rest, true);
    return matching.length > 0 ? [matching[0] as EntityView] : [];
  }
  return matchTargets(view, rawTarget, all).filter((e) => !e.locked);
}

function matchTargets(view: WorldView, target: string, all: boolean): EntityView[] {
  const exact = view.entities.find((e) => e.id === slugify(target) || e.id === target);
  if (exact) return [exact];
  const words = target.toLowerCase().split(/\s+/).filter((w) => w && !ADJECTIVES.has(w) && !COLORS[w]);
  if (words.length === 0) return [];
  const noun = singular(words[words.length - 1] as string);
  const phrase = words.join(' ');
  const asset = lookupAsset(phrase);
  const synonym = asset ? slugify(asset.asset.label) : noun;
  const hits = view.entities.filter((e) => {
    if (e.depth > 0 || e.tags.includes('backdrop')) return false;
    const name = e.name.toLowerCase();
    return [noun, synonym].some((n) => n.length > 1 && (e.id === n || e.id.startsWith(`${n}-`) || name.includes(n) || e.tags.includes(n) || (e.generator ?? '').includes(n) || e.primitive === n || e.npc?.role === n || e.npc?.faction === n));
  });
  if (hits.length === 0) return [];
  if (all) return hits.slice(0, MAX_TARGETS);
  // When several match, an entity the user just worked on is the most likely meaning.
  const edited = hits.filter((e) => e.userEditedAge !== undefined);
  if (edited.length === 1) return edited;
  const closest = hits.reduce((best, e) => (Math.hypot(e.pos[0], e.pos[2]) < Math.hypot(best.pos[0], best.pos[2]) ? e : best));
  return [closest];
}

function behaviorsOf(e: EntityView): Array<{ type: string; params: Record<string, Json>; enabled: boolean }> {
  return e.behaviors.filter((x) => KNOWN_BEHAVIORS.has(x.type)).map((x) => ({ type: x.type, params: x.params, enabled: x.enabled }));
}

/** The `set` object of an update patch for one change, or null when it does not apply. */
function changeSet(b: Builder, e: EntityView, change: Change): Record<string, Json> | null {
  switch (change.kind) {
    case 'scale': {
      const s = Math.max(0.05, Math.min(50, r2(e.scale * change.factor)));
      if (change.axis === 'y') {
        // Taller / shorter: stretch only the height (the footprint stays where the user put it).
        const transform: Record<string, Json> = { scale: [r2(e.scale), s, r2(e.scale)] };
        if (e.shape === 'primitive' && e.height !== undefined) transform['position'] = [e.pos[0], r2(e.pos[1] + (e.height * (s - e.scale)) / 2), e.pos[2]];
        return { transform };
      }
      const transform: Record<string, Json> = { scale: [s, s, s] };
      // Primitives are centered: keep their bottom where it was so they stay on whatever supports them.
      if (e.shape === 'primitive' && e.height !== undefined) transform['position'] = [e.pos[0], r2(e.pos[1] + (e.height * (s - e.scale)) / 2), e.pos[2]];
      return { transform };
    }
    case 'color':
      if (e.shape === 'procedural') return { shape: { params: { color: change.color } } };
      if (e.shape === 'scatter' && e.generator) return { shape: { of: { params: { color: change.color } } } };
      return { material: { color: change.color } };
    case 'bouncy':
      return { physics: { restitution: 0.9, friction: 0.4, ...(e.body ? {} : { body: 'dynamic' }) } };
    case 'mass':
      return { physics: { mass: change.heavy ? Math.max(50, (e.mass ?? 5) * 5) : 0.3, ...(e.body ? {} : { body: 'dynamic' }) } };
    case 'glow':
      b.env({ bloom: 1.2 });
      return { material: { emissive: e.color ?? '#ffe08a', emissiveIntensity: 2.5 } };
    case 'behavior': {
      const list = behaviorsOf(e);
      if (list.some((x) => x.type === change.behavior)) return null;
      list.push(change.behavior === 'spin' ? { type: 'spin', params: { speed: 90 }, enabled: true } : { type: 'bob', params: { amplitude: 0.3, period: 2 }, enabled: true });
      const set: Record<string, Json> = { behaviors: list };
      if (e.body === 'dynamic') set['physics'] = { body: 'kinematic' };
      return set;
    }
    case 'body':
      return { physics: { body: change.body } };
    case 'visible':
      return { visible: change.visible };
    case 'speed': {
      const list = behaviorsOf(e);
      let changed = false;
      for (const x of list) {
        const sp = x.params['speed'];
        if (typeof sp === 'number') {
          x.params = { ...x.params, speed: r2(sp * change.factor) };
          changed = true;
        }
      }
      return changed ? { behaviors: list } : null;
    }
  }
}

function describeChange(change: Change): string {
  switch (change.kind) {
    case 'scale': return change.axis === 'y' ? (change.factor > 1 ? 'taller' : 'shorter') : change.factor > 1 ? 'bigger' : 'smaller';
    case 'color': return `recolored ${change.color}`;
    case 'bouncy': return 'bouncy';
    case 'mass': return change.heavy ? 'heavier' : 'lighter';
    case 'glow': return 'glowing';
    case 'behavior': return change.behavior === 'spin' ? 'spinning' : 'bobbing';
    case 'body': return change.body;
    case 'visible': return change.visible ? 'visible' : 'hidden';
    case 'speed': return change.factor > 1 ? 'faster' : 'slower';
  }
}

/** A free origin for a whole theme added to an existing world. */
function freeSlot(b: Builder, radius: number): [number, number] {
  for (let ring = 1; ring <= 4; ring++) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + ring * 0.4;
      const d = ring * (radius + 15);
      const x = r2(Math.cos(a) * d);
      const z = r2(Math.sin(a) * d);
      if (b.isFree(x, z, radius * 0.6)) return [x, z];
    }
  }
  return [0, r2(-(radius + 60))];
}

/** Built-in vocabulary first, then the generator library ("add a pagoda"). */
function findAsset(phrase: string, library: readonly MockLibraryItem[]): ReturnType<typeof lookupAsset> {
  const found = lookupAsset(phrase);
  if (found) return found;
  const hit = findLibraryItems(phrase, library)[0];
  if (!hit) return null;
  const color = Object.entries(COLORS).find(([name]) => new RegExp(`\\b${name}\\b`, 'i').test(phrase))?.[1];
  return { asset: libraryAsset(hit.item), noun: hit.keyword, ...(color ? { color } : {}) };
}

function addThings(b: Builder, edit: Extract<Edit, { kind: 'add' }>, view: WorldView, intent: Intent, library: readonly MockLibraryItem[]): string | null {
  const found = findAsset(edit.phrase, library);
  if (!found) {
    const theme = ALL_THEMES.find((t) => t.match.test(edit.phrase));
    if (!theme) return null;
    const [x, z] = freeSlot(b, theme.radius);
    const ctx: ThemeCtx = { b, x, z, clear: theme.kind === 'activity' ? theme.radius : 0, primary: false, ...(intent.count !== undefined ? { count: intent.count } : {}), ...(intent.seconds !== undefined ? { seconds: intent.seconds } : {}) };
    if (theme.kind === 'activity') b.reserve(x, z, theme.radius);
    theme.build(ctx);
    return `added ${theme.title.toLowerCase()} at (${x}, ${z})`;
  }
  const { asset, color } = found;
  const count = edit.count;
  if (count > 12 && asset.scatter) {
    const side = r2(Math.max(10, Math.sqrt(count) * asset.radius * 3));
    const p = b.spot(0, 0, side / 2 + 6, side / 2 + 40, side / 2, 30) ?? [0, r2(-side)];
    b.scatter(asset.label, asset.scatter.generator, color ? { color } : {}, Math.min(count, 5000), [side, side], [p[0], 0, p[1]], { minSpacing: asset.radius });
    return `scattered ${count} ${asset.label}${count === 1 ? '' : 's'}`;
  }
  let placed = 0;
  const n = Math.min(count, 60);
  for (let i = 0; i < n * 3 && placed < n; i++) {
    const p = b.spot(0, 0, 3, 10 + n * 1.2 + i * 0.2, Math.max(asset.radius, 0.4));
    if (!p) continue;
    asset.make(b, p[0], p[1], color);
    placed++;
  }
  if (asset.label === 'coin' && placed > 0 && !view.stateKeys.includes('score')) {
    b.state('score', 0);
    b.hud('score', 'Coins');
  }
  return placed > 0 ? `added ${placed} ${asset.label}${placed === 1 ? '' : 's'}` : null;
}

/** Apply edit commands; returns human descriptions of what changed. */
export function applyEdits(b: Builder, intent: Intent, view: WorldView, library: readonly MockLibraryItem[] = []): string[] {
  const done: string[] = [];
  for (const edit of intent.edits) {
    if (edit.kind === 'add') {
      const d = addThings(b, edit, view, intent, library);
      if (d) done.push(d);
      continue;
    }
    const targets = resolveTargets(view, edit.target, edit.all);
    if (targets.length === 0) {
      const locked = matchTargets(view, recencyOf(edit.target).rest || edit.target, edit.all).filter((e) => e.locked);
      done.push(locked.length > 0 ? `left ${(locked[0] as EntityView).id} alone because you locked it (unlock it to let me change it)` : `couldn't find "${edit.target}"`);
      continue;
    }
    if (edit.kind === 'remove') {
      for (const t of targets) b.patch({ op: 'remove', id: t.id });
      done.push(`removed ${targets.length === 1 ? (targets[0] as EntityView).id : `${targets.length} × ${edit.target}`}`);
      continue;
    }
    let changed = 0;
    for (const t of targets) {
      const set = changeSet(b, t, edit.change);
      if (set) {
        b.patch({ op: 'update', id: t.id, set });
        changed++;
      }
    }
    if (changed > 0) done.push(`made ${changed === 1 ? (targets[0] as EntityView).id : `${changed} × ${edit.target}`} ${describeChange(edit.change)}`);
  }
  return done;
}
