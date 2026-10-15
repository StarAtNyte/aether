/**
 * The offline mock planner: request + world summary → patches + message.
 *
 * New worlds: the first matching setting is placed at the origin (and owns
 * the environment), further layerable settings wrap around it, other settings
 * get their own free slot, activities sit at the origin inside a cleared
 * circle (further activities get free slots), and mood words (night, rain, fog, low gravity…) override last.
 * Existing worlds: edit commands (add/remove/modify) plus mood overrides; a
 * request that describes a whole themed scene replaces the world instead.
 */
import { realisticPlan } from './realistic';
import { hashString, type Json, type PatchInput } from '@aether/core';
import { Builder } from './builder';
import type { ThemeCtx } from './decor';
import { applyEdits, reserveExisting } from './edits';
import { parseIntent, type Intent } from './intent';
import { findLibraryItems, libraryAsset, libraryRadius, type LibraryHit, type MockLibraryItem } from './library';
import type { Theme } from './theme';
import { DEFAULT_SETTING } from './themes-nature';
import { parseWorldSummary, type WorldView } from './world-view';
import { planVoxel } from './voxel';
import { planArch } from './arch';
import { planPlacement } from './placement';
import { planShowcase } from './showcase/index';
import { addCharactersToScene, planNpc } from './npc';

/** Output of the mock planner. */
export interface MockPlan {
  /** Short plan text shown before the tool call. */
  plan: string;
  patches: PatchInput[];
  /** Finish message for the user (or the explanation when nothing was done). */
  message: string;
  /** Architecture ops sent with build_architecture after the patches (buildings and interiors). */
  arch?: { ops: unknown[]; message: string };
}

/** The pocket kept free behind the player spawn for the chase camera (center offset on +Z, radius; metres). */
export const CHASE_POCKET_OFFSET = 4;
export const CHASE_POCKET_RADIUS = 4.5;

/** Atmospheric settings whose environment wins when combined. */
const ATMOSPHERIC = new Set(['haunted', 'winter', 'space', 'volcano', 'desert']);

function slotFor(b: Builder, index: number, radius: number, primaryRadius: number): [number, number] {
  const a = -Math.PI / 2 + (index % 2 === 0 ? -1 : 1) * (0.6 + Math.floor(index / 2) * 0.7);
  const d = primaryRadius + radius * 0.6 + 10;
  const x = Math.round(Math.cos(a) * d);
  const z = Math.round(Math.sin(a) * d);
  b.reserve(x, z, 0);
  return [x, z];
}

/**
 * Library objects named in a scene description that no theme or explicit
 * "with/add" edit already covers ("a lighthouse on a rocky island").
 */
function sceneLibraryHits(intent: Intent, library: readonly MockLibraryItem[]): LibraryHit[] {
  const addPhrases = intent.edits.filter((e) => e.kind === 'add').map((e) => e.phrase);
  return findLibraryItems(intent.text, library).filter((h) => !addPhrases.some((p) => findLibraryItems(p, [h.item]).length > 0));
}

/** Place library hits: a bare scene's first hit becomes the centrepiece at the origin. */
function placeLibraryHits(b: Builder, hits: readonly LibraryHit[], heroAtOrigin: boolean): string[] {
  const done: string[] = [];
  hits.forEach((hit, i) => {
    const asset = libraryAsset(hit.item);
    let placed = 0;
    for (let k = 0; k < hit.count; k++) {
      if (i === 0 && k === 0 && heroAtOrigin) {
        b.gen(hit.item.id, hit.item.id, {}, [0, 0, 0], { physics: 'static', tags: ['library', 'focus'] });
        placed++;
        continue;
      }
      const p = b.spot(0, 0, asset.radius + 4, 14 + asset.radius * 2 + k * 2, asset.radius);
      if (!p) continue;
      asset.make(b, p[0], p[1]);
      placed++;
    }
    if (placed > 0) done.push(`${placed} ${hit.keyword}${placed === 1 ? '' : 's'}`);
  });
  return done;
}

function generate(intent: Intent, view: WorldView, wipe: boolean, library: readonly MockLibraryItem[]): MockPlan {
  const seed = hashString(intent.text);
  const existing = wipe ? [] : view.entities.map((e) => e.id);
  const b = new Builder(seed, existing, intent.mood, wipe ? [] : view.testIds, wipe ? [] : view.ruleIds);
  // An activity can absorb another one it renders itself (bowling at a crate pyramid).
  const activities = intent.activities.filter((a) => !intent.activities.some((o) => o !== a && o.absorbs?.includes(a.id)));
  const bare = intent.settings.length === 0 && (activities.length === 0 || activities.some((a) => a.wantsSetting));
  // A setting can absorb another it renders itself (the colossi canyon replaces the desert canyon).
  const named = intent.settings.filter((s) => !intent.settings.some((o) => o !== s && o.absorbs?.includes(s.id)));
  const settings: Theme[] = bare ? [DEFAULT_SETTING] : named;
  const primary = settings[0];
  const libHits = sceneLibraryHits(intent, library);
  // Without a recognized theme, a named library object is the scene's subject.
  const hero = intent.settings.length === 0 && activities.length === 0 ? libHits[0] : undefined;
  const clear = Math.max(activities.reduce((m, t) => Math.max(m, t.radius), 0), hero ? libraryRadius(hero.item) + 1.5 : 0);

  // Environment: the primary setting, then atmospheric secondaries (snow, night fog…)
  // override it; the primary keeps its player setup. Without a setting, the
  // first activity provides a studio environment.
  if (primary) {
    primary.env(b);
    const primaryPlayer = b.playerSnapshot();
    for (const s of settings.slice(1)) if (ATMOSPHERIC.has(s.id)) s.env(b);
    b.player(primaryPlayer);
  } else {
    activities[0]?.env(b);
  }
  for (const a of activities) a.player?.(b);
  const spawn = b.playerValue('spawn');
  if (Array.isArray(spawn) && typeof spawn[0] === 'number' && typeof spawn[2] === 'number') {
    b.reserve(spawn[0], spawn[2], 2.5);
    // Keep the chase camera's starting spot (behind the player, on +Z) free of props.
    b.reserve(spawn[0], spawn[2] + CHASE_POCKET_OFFSET, CHASE_POCKET_RADIUS);
  }
  if (clear > 0) b.reserve(0, 0, clear);

  const { count, seconds } = intent;
  const withIds = new Set(intent.activities.map((a) => a.id));
  const withCount = (ctx: ThemeCtx): ThemeCtx => ({ ...ctx, with: withIds, request: intent.text, ...(count !== undefined ? { count } : {}), ...(seconds !== undefined ? { seconds } : {}) });
  // A playable mechanic owns the camera: settings around it lose their focus tags.
  b.setPhase('setting', activities.length > 0 || hero !== undefined);
  if (primary) primary.build(withCount({ b, x: 0, z: 0, clear, primary: true }));
  let slot = 0;
  for (const s of settings.slice(1)) {
    if (s.layerable && primary) s.build(withCount({ b, x: 0, z: 0, clear: Math.max(clear, primary.radius * 0.55), primary: false }));
    else {
      const [x, z] = slotFor(b, slot++, s.radius, primary?.radius ?? 0);
      s.build(withCount({ b, x, z, clear: 0, primary: false }));
    }
  }
  // The first activity owns the cleared origin; further activities get their
  // own free slot so two set-pieces never interpenetrate.
  b.setPhase('activity');
  activities.forEach((a, i) => {
    if (i === 0) a.build(withCount({ b, x: 0, z: 0, clear, primary: !primary }));
    else {
      const [x, z] = slotFor(b, slot++, a.radius, Math.max(primary?.radius ?? 0, activities[0]?.radius ?? 0));
      a.build(withCount({ b, x, z, clear: 0, primary: false }));
    }
  });

  // Additions named alongside a theme ("a forest with 3 tents") and mood overrides.
  const extras = intent.edits.filter((e) => e.kind === 'add' && !settings.concat(intent.activities).some((t) => t.match.test(e.phrase)));
  const libraryDone = placeLibraryHits(b, libHits, hero !== undefined);
  const added = [...libraryDone, ...(extras.length > 0 ? applyEdits(b, { ...intent, edits: extras }, view, library) : [])];
  b.env(intent.env);
  const crowd = addCharactersToScene(b, intent.text, view, intent);
  if (crowd) added.push(crowd);
  const weather = b.envValue('weather');
  if (intent.mood.night && (weather === undefined || weather === 'clear')) b.env({ weather: 'fireflies' });
  b.test({ id: 'no-overlap', kind: 'noOverlap' });

  const titles = [...activities, ...settings].map((t) => t.title);
  const heroTitle = hero ? hero.keyword.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : undefined;
  const name = activities[0] && primary ? `${activities[0].title} — ${primary.title}` : heroTitle && primary ? `${heroTitle} — ${primary.title}` : (titles[0] ?? 'New World');
  b.meta(name, intent.text.slice(0, 200));

  // Objects the user locked survive a rebuild: remove the others one by one instead of clearing.
  const locked = view.entities.filter((e) => e.locked);
  const wipePatches: PatchInput[] = !wipe || view.entityCount === 0 ? [] : locked.length === 0 ? [{ op: 'clear', keepEnvironment: false }] : view.entities.filter((e) => e.depth === 0 && !e.locked).map((e): PatchInput => ({ op: 'remove', id: e.id, recursive: true }));
  const patches: PatchInput[] = [...wipePatches, ...b.build()];
  const blurbs = [...settings, ...activities].map((t) => t.blurb);
  const moodWords = Object.entries(intent.mood).filter(([, v]) => v).map(([k]) => k);
  return {
    plan: `Plan: ${[...settings.map((t) => `${t.id} setting`), ...activities.map((t) => `${t.id} activity`)].join(' + ')}${moodWords.length ? `; mood ${moodWords.join(', ')}` : ''}; ${b.entityCount} entities.`,
    patches,
    message: `Built ${name}: ${blurbs.join('; ')}${added.length ? ` (${added.join(', ')})` : ''}.`,
  };
}

function edit(intent: Intent, view: WorldView, library: readonly MockLibraryItem[]): MockPlan {
  const b = new Builder(hashString(`${intent.text}|${view.entityCount}`), view.entities.map((e) => e.id), intent.mood, view.testIds, view.ruleIds);
  b.keepHud(view.hud);
  reserveExisting(b, view);
  const done = applyEdits(b, intent, view, library);
  const envKeys = Object.keys(intent.env);
  if (envKeys.length > 0) {
    const env: Record<string, Json> = { ...intent.env };
    if (intent.mood.snow && view.hasGround) env['ground'] = { material: { preset: 'snow', color: '#f4f7fb' } };
    if (intent.mood.night && !('weather' in env) && (view.weather === undefined || view.weather === 'clear')) env['weather'] = 'fireflies';
    b.env(env);
    done.push(`environment: ${envKeys.map((k) => (k === 'gravity' ? 'gravity' : `${k}`)).join(', ')}`);
  }
  const patches = b.build();
  const lockedNotes = done.filter((d) => d.includes('because you locked it'));
  if (patches.length === 0 && lockedNotes.length > 0) {
    return { plan: '', patches: [], message: `I ${lockedNotes.join('; ')}.` };
  }
  if (patches.length === 0) {
    return {
      plan: '',
      patches: [],
      message: `I couldn't map "${intent.text.slice(0, 80)}" to a change in offline mode. Try e.g. "add 5 trees", "make it night", "make the car red", "remove the tent", or describe a new world like "a haunted castle at night".`,
    };
  }
  return { plan: `Plan: ${done.join('; ')}.`, patches, message: `Done — ${done.join('; ')}.` };
}

/** Wording that clearly asks for a different world rather than a change to this one. */
const NEW_WORLD = /\b(?:new (?:world|scene|level|map|game|project)|brand new|different (?:world|scene)|instead of (?:this|the current)|replace (?:the )?(?:whole|entire|current) (?:world|scene)|scrap (?:this|it)|throw (?:this|it) away|build me an? (?:entirely|completely) )\b/;

/**
 * A scene described in a world that already exists: atmospheric settings
 * (winter, haunted, space…) re-dress the environment; other themes are added
 * in a free spot. Nothing existing is removed or moved.
 */
function refineWithThemes(intent: Intent, view: WorldView, library: readonly MockLibraryItem[]): MockPlan {
  const b = new Builder(hashString(`${intent.text}|${view.entityCount}`), view.entities.map((e) => e.id), intent.mood, view.testIds, view.ruleIds);
  b.keepHud(view.hud);
  reserveExisting(b, view);
  const done: string[] = [];
  for (const s of intent.settings) {
    if (ATMOSPHERIC.has(s.id)) {
      const keep = b.playerSnapshot();
      s.env(b);
      b.player(keep);
      if (s.id === 'winter' && view.hasGround) b.env({ ground: { material: { preset: 'snow', color: '#f4f7fb' } } });
      done.push(`${s.title.toLowerCase()} atmosphere`);
    } else {
      const d = applyEdits(b, { ...intent, edits: [{ kind: 'add', phrase: intent.text, count: 1 }] }, view, library);
      done.push(...d);
      break;
    }
  }
  for (const a of intent.activities) {
    const d = applyEdits(b, { ...intent, edits: [{ kind: 'add', phrase: a.id, count: 1 }] }, view, library);
    done.push(...d);
  }
  b.env(intent.env);
  const patches = b.build();
  if (patches.length === 0) return { plan: '', patches: [], message: `I couldn't map "${intent.text.slice(0, 80)}" to a change. Name what to change, e.g. "make the car red" or "add a tent".` };
  return { plan: `Plan: ${done.join('; ') || 'adjust the mood'}.`, patches, message: `Done — ${done.join('; ') || 'adjusted the mood'}.` };
}

/**
 * Plan a response to `request` given the current world `summary`.
 * Deterministic. `library` lists generator-library objects it may place.
 */
export function planMock(request: string, summary: string, library: readonly MockLibraryItem[] = [], mode?: 'new' | 'refine'): MockPlan {
  return realisticPlan(request, planMockPlain(request, summary, library, mode));
}

function planMockPlain(request: string, summary: string, library: readonly MockLibraryItem[], mode: 'new' | 'refine' | undefined): MockPlan {
  // Flagship showcase worlds answer to their names.
  const showcase = planShowcase(request, summary);
  if (showcase) return showcase;
  // Characters: guards, shopkeepers, wolf packs and edits of them ("make the guard faster").
  const npc = planNpc(request, summary);
  if (npc) return npc;
  // Block worlds (voxel terrain) have their own planner.
  const voxel = planVoxel(request, summary);
  if (voxel) return voxel;
  // "Why is the curtain over the door": explain and fix wall pieces over openings.
  const placement = planPlacement(request, summary);
  if (placement) return placement;
  // Real-life buildings and interiors go through build_architecture.
  const arch = planArch(request, summary, mode);
  if (arch) return arch;
  const intent = parseIntent(request);
  const view = parseWorldSummary(summary);
  const hasThemes = intent.settings.length > 0 || intent.activities.length > 0;
  if (view.entityCount === 0) return generate(intent, view, false, library);
  // Messages refine the current world by default; it is replaced only on a clear "new world" request.
  if (mode === undefined) {
    // No edit mode on the turn (older hosts): a described scene replaces the world.
    if (intent.clear || (hasThemes && (intent.create || intent.describesScene))) return generate(intent, view, true, library);
    const legacy = edit(intent, view, library);
    if (legacy.patches.length === 0 && hasThemes) return generate(intent, view, true, library);
    return legacy;
  }
  const replace = mode === 'new' || intent.clear || (mode !== 'refine' && NEW_WORLD.test(intent.text)) || (mode === 'refine' && NEW_WORLD.test(intent.text));
  if (replace) return generate(intent, view, true, library);
  const result = edit(intent, view, library);
  if (result.patches.length === 0 && hasThemes) return refineWithThemes(intent, view, library);
  return result;
}
