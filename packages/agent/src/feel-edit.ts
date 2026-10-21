/**
 * Game feel and effects as edits: the `tune_feel` tool, the merge rules the
 * local edit engine shares with it, and the defaults the offline planner gives
 * generated games.
 *
 * Everything here produces ordinary patches (`setMeta.feel`, entity `vfx`
 * updates), so a feel change is one undo step with a diff like any other, and
 * none of it touches the simulation (feel is presentation only; see
 * `@aether/core` `feel-schema.ts`).
 */
import { z } from 'zod';
import {
  describeFeel,
  EntityVfx,
  FEEL_EVENTS,
  FeelCue,
  FeelEvent,
  FeelSpec,
  FeelTier,
  hasOwn,
  isValidSelector,
  resolveSelector,
  VfxPreset,
  type Entity,
  type FeelSpecInput,
  type Patch,
  type WorldDoc,
} from '@aether/core';

/** Most entities one emitter entry may reach (a "#torch" tag on a big world). */
export const MAX_FEEL_TARGETS = 64;

/** One emitter change of `tune_feel`. */
export const FeelEmitterInput = z.object({
  /** Entity id or selector ("#torch", "*" is refused). */
  target: z.string().min(1).max(80),
  /** The effect, or "none" to remove the emitter. */
  vfx: z.union([VfxPreset, z.literal('none')]),
  rate: z.number().min(0).max(400).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  scale: z.number().min(0.2).max(4).optional(),
  offset: z.tuple([z.number().min(-50).max(50), z.number().min(-50).max(50), z.number().min(-50).max(50)]).optional(),
});
export type FeelEmitterInput = z.infer<typeof FeelEmitterInput>;

/** Input of the `tune_feel` tool. */
export const TuneFeelInput = z.object({
  /** Tier of the whole game. */
  preset: FeelTier.optional(),
  /** Per-event cue changes merged into the current ones; `null` drops an event's cue (back to the tier). */
  events: z.partialRecord(FeelEvent, FeelCue.nullable()).optional(),
  /** Footstep dust and splashes under walking people. */
  footsteps: z.boolean().optional(),
  /** Continuous emitters on entities (fire on torches, smoke from chimneys). */
  emitters: z.array(FeelEmitterInput).max(24).optional(),
  /** Remove `world.feel` entirely (the normal tier again). */
  reset: z.boolean().optional(),
  /** Attach the obvious emitters: fire on torches, campfires and braziers, smoke on chimneys, embers on forges, magic on portals. */
  autoEmitters: z.boolean().optional(),
  message: z.string().max(200).optional(),
});
export type TuneFeelInput = z.infer<typeof TuneFeelInput>;

/** Result of {@link feelPatches}. */
export interface FeelEditResult {
  patches: Patch[];
  /** What changed, in words, for the model or the chat. */
  summary: string;
  /** Emitter targets that matched nothing or were refused, with the reason. */
  refused: string[];
}

/** The world's feel with `input`'s changes merged in (undefined = no feel, i.e. the normal tier). */
export function mergeFeel(current: WorldDoc['feel'], input: Pick<TuneFeelInput, 'preset' | 'events' | 'footsteps' | 'reset'>): WorldDoc['feel'] {
  if (input.reset) return undefined;
  const base: FeelSpecInput = current ? { preset: current.preset, events: { ...current.events }, ...(current.footsteps !== undefined ? { footsteps: current.footsteps } : {}) } : { preset: 'normal', events: {} };
  if (input.preset) base.preset = input.preset;
  if (input.footsteps !== undefined) base.footsteps = input.footsteps;
  const events = { ...(base.events ?? {}) } as Record<string, unknown>;
  if (input.events) {
    for (const ev of FEEL_EVENTS) {
      if (!hasOwn(input.events, ev)) continue;
      const change = input.events[ev];
      if (change === null) {
        delete events[ev];
        continue;
      }
      if (!change) continue;
      const prev = (events[ev] ?? {}) as Record<string, unknown>;
      events[ev] = { ...prev, ...change };
    }
  }
  base.events = events;
  return FeelSpec.parse(base);
}

/** Patches and words for a `tune_feel` call. Never throws; untrusted input is assumed validated by {@link TuneFeelInput}. */
export function feelPatches(world: WorldDoc, input: TuneFeelInput): FeelEditResult {
  const patches: Patch[] = [];
  const refused: string[] = [];
  const notes: string[] = [];
  const touchesFeel = input.reset === true || input.preset !== undefined || input.events !== undefined || input.footsteps !== undefined;
  if (touchesFeel) {
    let next: WorldDoc['feel'];
    try {
      next = mergeFeel(world.feel, input);
    } catch (e) {
      refused.push(`feel: ${e instanceof Error ? e.message.slice(0, 200) : 'invalid'}`);
      next = world.feel;
    }
    if (JSON.stringify(next ?? null) !== JSON.stringify(world.feel ?? null)) {
      patches.push({ op: 'setMeta', feel: next ?? null });
      notes.push(next ? describeFeel(next) : 'feel reset to the normal tier');
    }
  }
  if (input.autoEmitters) {
    const auto = defaultEmitterPatches(world);
    if (auto.length > 0) {
      patches.push(...auto);
      const ids = auto.map((p) => (p.op === 'update' ? p.id : '')).filter(Boolean);
      notes.push(`effects on ${ids.length <= 4 ? ids.join(', ') : `${ids.slice(0, 4).join(', ')} +${ids.length - 4} more`}`);
    }
  }
  for (const em of input.emitters ?? []) {
    const ids = emitterTargets(world, em.target);
    if (typeof ids === 'string') {
      refused.push(`${em.target}: ${ids}`);
      continue;
    }
    const done: string[] = [];
    for (const id of ids) {
      const e = world.entities[id] as Entity;
      if (e.locked) {
        refused.push(`${id}: locked by the user`);
        continue;
      }
      if (em.vfx === 'none') {
        if (!e.vfx) continue;
        patches.push({ op: 'update', id, set: { vfx: null } });
        done.push(id);
        continue;
      }
      const spec = EntityVfx.parse({
        preset: em.vfx,
        ...(em.rate !== undefined ? { rate: em.rate } : {}),
        ...(em.color ? { color: em.color } : {}),
        ...(em.scale !== undefined ? { scale: em.scale } : {}),
        ...(em.offset ? { offset: em.offset } : {}),
      });
      if (JSON.stringify(e.vfx ?? null) === JSON.stringify(spec)) continue;
      // Replace the whole emitter: an update merges objects, so clear the old one first.
      if (e.vfx) patches.push({ op: 'update', id, set: { vfx: null } });
      patches.push({ op: 'update', id, set: { vfx: spec as unknown as Record<string, never> } });
      done.push(id);
    }
    if (done.length > 0) notes.push(`${em.vfx === 'none' ? 'removed the effect from' : `${em.vfx} on`} ${done.length <= 4 ? done.join(', ') : `${done.slice(0, 4).join(', ')} +${done.length - 4} more`}`);
  }
  const summary = patches.length === 0 ? 'Nothing to change: the game already feels that way.' : `Feel: ${notes.join('; ')}.`;
  return { patches, summary, refused };
}

/** Entities an emitter entry addresses, or why none. */
function emitterTargets(world: WorldDoc, target: string): string[] | string {
  if (target === '*' || !isValidSelector(target)) return 'name an entity id or a #tag';
  if (hasOwn(world.entities, target)) return [target];
  const ids = resolveSelector(world, target).filter((id) => {
    const e = world.entities[id];
    return e !== undefined && !e.template;
  });
  if (ids.length === 0) return 'matches nothing in the world';
  if (ids.length > MAX_FEEL_TARGETS) return `matches ${ids.length} entities (at most ${MAX_FEEL_TARGETS}); use a narrower tag`;
  return ids;
}

// ---------------------------------------------------------------------------
// Defaults for generated games
// ---------------------------------------------------------------------------

/** Words that make a game an action game (punchy) or a calm one (subtle). */
const PUNCHY = /\b(?:arena|combat|fight|fighting|battle|shooter|shoot|brawl|boss|explosive|explosions?|demolition|smash|action|arcade|kart|race|racing|platformer|zombies?|monsters?|enemies|wolves|punchy|juicy)\b/;
const SUBTLE = /\b(?:cozy|cosy|calm|relax|relaxing|peaceful|zen|meditative|walk(?:ing)?\s*sim|walkthrough|exploration|explore|story|stroll|garden|museum|gallery|apartment|house|villa|interior|tour)\b/;

/** The feel tier a request suggests (`normal` when nothing points either way). */
export function feelTierFor(request: string): FeelTier {
  const t = request.toLowerCase();
  if (PUNCHY.test(t)) return 'punchy';
  if (SUBTLE.test(t)) return 'subtle';
  return 'normal';
}

/** Emitters that belong on entities by what they are (a torch burns, a chimney smokes). */
const EMITTER_RULES: ReadonlyArray<{ pattern: RegExp; vfx: VfxPreset; offset?: number; rate?: number; scale?: number }> = [
  { pattern: /\b(?:campfire|camp\s*fire|bonfire|fire\s*pit|firepit|brazier|fire\s*bowl)\b/, vfx: 'fire', offset: 0.25, scale: 1.1 },
  { pattern: /\b(?:torch|torches|fire\s*basket)\b/, vfx: 'fire', offset: 0.55, scale: 0.7 },
  { pattern: /\b(?:chimney|smokestack)\b/, vfx: 'smoke', offset: 0.6, rate: 5 },
  { pattern: /\b(?:forge|furnace|kiln|lava)\b/, vfx: 'embers' },
  { pattern: /\b(?:portal|rift|crystal\s*core|magic\s*circle)\b/, vfx: 'magic', rate: 14 },
];

/** Entity text the emitter rules look at (id, name and tags; not descriptions, which mention neighbours). */
function entityText(e: Entity): string {
  return `${e.id} ${e.name} ${e.tags.join(' ')}`.toLowerCase().replace(/[-_]/g, ' ');
}

/** Emitter patches for entities that should obviously carry one and have none yet (bounded). */
export function defaultEmitterPatches(world: WorldDoc, max = 24): Patch[] {
  const out: Patch[] = [];
  for (const id of Object.keys(world.entities).sort()) {
    if (out.length >= max) break;
    const e = world.entities[id] as Entity;
    if (e.vfx || e.template || e.locked || e.arch?.role === 'building') continue;
    const text = entityText(e);
    const rule = EMITTER_RULES.find((r) => r.pattern.test(text));
    if (!rule) continue;
    // A light or a flame child of the same object already carries the effect: only the root gets it.
    const parent = e.parent !== null ? world.entities[e.parent] : undefined;
    // A torch marker under a person who holds a torch: the renderer lights the torch in the hand itself.
    if (parent?.character?.hold === 'torch' || e.character?.hold === 'torch') continue;
    if (parent && EMITTER_RULES.some((r) => r.pattern.test(entityText(parent)))) continue;
    const height = shapeHeight(e);
    const spec = EntityVfx.parse({ preset: rule.vfx, ...(rule.rate !== undefined ? { rate: rule.rate } : {}), ...(rule.scale !== undefined ? { scale: rule.scale } : {}), offset: [0, Math.round((height * (rule.offset ?? 0.5)) * 100) / 100, 0] });
    out.push({ op: 'update', id, set: { vfx: spec as unknown as Record<string, never> } });
  }
  return out;
}

/** Rough height of an entity's own shape in its local frame (metres; 1 when unknown). */
function shapeHeight(e: Entity): number {
  const s = e.shape;
  return s.kind === 'primitive' ? s.size[1] : 1;
}

/** Whether added entities or rules in `patches` make a game (collectibles, goals, hazards, checkpoints, win or lose). */
export function patchesMakeGame(patches: readonly unknown[]): boolean {
  const GAME = new Set(['collectible', 'goal', 'hazard', 'checkpoint']);
  for (const p of patches) {
    if (typeof p !== 'object' || p === null) continue;
    const o = p as { op?: unknown; entity?: { behaviors?: unknown }; rule?: { then?: unknown } };
    if (o.op === 'add' && Array.isArray(o.entity?.behaviors) && o.entity.behaviors.some((b) => typeof b === 'object' && b !== null && GAME.has(String((b as { type?: unknown }).type)))) return true;
    if (o.op === 'addRule' && Array.isArray(o.rule?.then) && o.rule.then.some((a) => typeof a === 'object' && a !== null && ((a as { do?: unknown }).do === 'win' || (a as { do?: unknown }).do === 'lose'))) return true;
  }
  return false;
}

/** Whether a world is a game (something to win, collect or survive) and so worth default feel. */
export function isGameWorld(world: WorldDoc): boolean {
  if (world.rules.some((r) => r.then.some((a) => a.do === 'win' || a.do === 'lose'))) return true;
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (e.behaviors.some((b) => b.type === 'collectible' || b.type === 'goal' || b.type === 'hazard' || b.type === 'checkpoint')) return true;
    if (e.npc && (e.npc.archetype === 'predator' || e.npc.archetype === 'guard' || e.npc.enemies.length > 0)) return true;
  }
  return false;
}
