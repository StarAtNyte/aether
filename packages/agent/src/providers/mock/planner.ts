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
import { hashString, type Json, type PatchInput } from '@aether/core';
import { Builder } from './builder';
import type { ThemeCtx } from './decor';
import { applyEdits, reserveExisting } from './edits';
import { parseIntent, type Intent } from './intent';
import type { Theme } from './theme';
import { DEFAULT_SETTING } from './themes-nature';
import { parseWorldSummary, type WorldView } from './world-view';

/** Output of the mock planner. */
export interface MockPlan {
  /** Short plan text shown before the tool call. */
  plan: string;
  patches: PatchInput[];
  /** Finish message for the user (or the explanation when nothing was done). */
  message: string;
}

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

function generate(intent: Intent, view: WorldView, wipe: boolean): MockPlan {
  const seed = hashString(intent.text);
  const existing = wipe ? [] : view.entities.map((e) => e.id);
  const b = new Builder(seed, existing, intent.mood, wipe ? [] : view.testIds, wipe ? [] : view.ruleIds);
  const bare = intent.settings.length === 0 && (intent.activities.length === 0 || intent.activities.some((a) => a.wantsSetting));
  const settings: Theme[] = bare ? [DEFAULT_SETTING] : intent.settings;
  const activities = intent.activities;
  const primary = settings[0];
  const clear = activities.reduce((m, t) => Math.max(m, t.radius), 0);

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
  if (Array.isArray(spawn) && typeof spawn[0] === 'number' && typeof spawn[2] === 'number') b.reserve(spawn[0], spawn[2], 2.5);
  if (clear > 0) b.reserve(0, 0, clear);

  const { count, seconds } = intent;
  const withCount = (ctx: ThemeCtx): ThemeCtx => ({ ...ctx, ...(count !== undefined ? { count } : {}), ...(seconds !== undefined ? { seconds } : {}) });
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
  activities.forEach((a, i) => {
    if (i === 0) a.build(withCount({ b, x: 0, z: 0, clear, primary: !primary }));
    else {
      const [x, z] = slotFor(b, slot++, a.radius, Math.max(primary?.radius ?? 0, activities[0]?.radius ?? 0));
      a.build(withCount({ b, x, z, clear: 0, primary: false }));
    }
  });

  // Additions named alongside a theme ("a forest with 3 tents") and mood overrides.
  const extras = intent.edits.filter((e) => e.kind === 'add' && !settings.concat(activities).some((t) => t.match.test(e.phrase)));
  const added = extras.length > 0 ? applyEdits(b, { ...intent, edits: extras }, view) : [];
  b.env(intent.env);
  const weather = b.envValue('weather');
  if (intent.mood.night && (weather === undefined || weather === 'clear')) b.env({ weather: 'fireflies' });
  b.test({ id: 'no-overlap', kind: 'noOverlap' });

  const titles = [...activities, ...settings].map((t) => t.title);
  const name = activities[0] && primary ? `${activities[0].title} — ${primary.title}` : (titles[0] ?? 'New World');
  b.meta(name, intent.text.slice(0, 200));

  const patches: PatchInput[] = wipe && view.entityCount > 0 ? [{ op: 'clear', keepEnvironment: false }, ...b.build()] : b.build();
  const blurbs = [...settings, ...activities].map((t) => t.blurb);
  const moodWords = Object.entries(intent.mood).filter(([, v]) => v).map(([k]) => k);
  return {
    plan: `Plan: ${[...settings.map((t) => `${t.id} setting`), ...activities.map((t) => `${t.id} activity`)].join(' + ')}${moodWords.length ? `; mood ${moodWords.join(', ')}` : ''}; ${b.entityCount} entities.`,
    patches,
    message: `Built ${name}: ${blurbs.join('; ')}${added.length ? ` (${added.join(', ')})` : ''}.`,
  };
}

function edit(intent: Intent, view: WorldView): MockPlan {
  const b = new Builder(hashString(`${intent.text}|${view.entityCount}`), view.entities.map((e) => e.id), intent.mood, view.testIds, view.ruleIds);
  b.keepHud(view.hud);
  reserveExisting(b, view);
  const done = applyEdits(b, intent, view);
  const envKeys = Object.keys(intent.env);
  if (envKeys.length > 0) {
    const env: Record<string, Json> = { ...intent.env };
    if (intent.mood.snow && view.hasGround) env['ground'] = { material: { preset: 'snow', color: '#f4f7fb' } };
    if (intent.mood.night && !('weather' in env) && (view.weather === undefined || view.weather === 'clear')) env['weather'] = 'fireflies';
    b.env(env);
    done.push(`environment: ${envKeys.map((k) => (k === 'gravity' ? 'gravity' : `${k}`)).join(', ')}`);
  }
  const patches = b.build();
  if (patches.length === 0) {
    return {
      plan: '',
      patches: [],
      message: `I couldn't map "${intent.text.slice(0, 80)}" to a change in offline mode. Try e.g. "add 5 trees", "make it night", "make the car red", "remove the tent", or describe a new world like "a haunted castle at night".`,
    };
  }
  return { plan: `Plan: ${done.join('; ')}.`, patches, message: `Done — ${done.join('; ')}.` };
}

/** Plan a response to `request` given the current world `summary`. Deterministic. */
export function planMock(request: string, summary: string): MockPlan {
  const intent = parseIntent(request);
  const view = parseWorldSummary(summary);
  const hasThemes = intent.settings.length > 0 || intent.activities.length > 0;
  if (view.entityCount === 0) return generate(intent, view, false);
  if (intent.clear || (hasThemes && (intent.create || intent.describesScene))) return generate(intent, view, true);
  const result = edit(intent, view);
  if (result.patches.length === 0 && hasThemes) return generate(intent, view, true);
  return result;
}
