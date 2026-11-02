/**
 * Game feel by prompt, without a model: "make hits feel punchy", "add sparks
 * when coins are collected", "dust when landing", "less screen shake", "no
 * flashes", "make the torches burn", "remove the smoke from the chimney".
 *
 * The parser is conservative: it answers only clauses that name a feel word
 * (punchy, shake, hit-stop, flash, rumble, particles, sparks …) together with
 * a game event or a target, so "add dust" stays the weather and "add a
 * campfire" stays an added object. The op writes `world.feel` and entity
 * `vfx` on the draft; both are presentation only, so the edit is cosmetic
 * (no re-verification).
 */
import { FEEL_EVENTS, resolveFeelCue, type FeelEvent, type FeelTier, type VfxPreset, type WorldDoc } from '@aether/core';
import type { Command, Ref } from './command';
import { mergeFeel } from '../feel-edit';
import { parseRef } from './parse-ref';
import { resolveRef } from './resolve';
import { ask, describeTargets, failed, outcome, type OpEnv, type OpOutcome } from './ops-types';

/** The feel command (see {@link parseFeel}). */
export type FeelCommand = Extract<Command, { op: 'feel' }>;

/** Feel cue fields a clause can turn up, down or off. */
export type FeelKnob = 'shake' | 'hitStop' | 'flash' | 'rumble' | 'text' | 'fovKick' | 'vignette';

const EVENT_WORDS: ReadonlyArray<[RegExp, readonly FeelEvent[]]> = [
  [/\b(?:coins?|gems?|pickups?|pick(?:ing)?\s*(?:ups?|things up)|collect(?:ed|ing|ion|ibles?|s)?|loot|grab(?:bing)?|treasures?|items?)\b/, ['pickup']],
  [/\b(?:damage[ds]?|hurts?|hurting|get(?:ting)?\s+hit|taking\s+hits?|wounded|health\s+loss)\b/, ['damage']],
  [/\b(?:hits?|hitting|punch(?:es|ing)?|strikes?|attacks?|combat|impacts?|melee|fights?|fighting)\b/, ['hit', 'damage']],
  [/\b(?:death|deaths|die|dies|dying|losing|lose|game\s*over|defeat)\b/, ['death']],
  [/\b(?:win|wins|winning|victory|finish(?:ing)?\s+line|reaching\s+the\s+goal)\b/, ['win']],
  [/\b(?:checkpoints?|save\s*points?)\b/, ['checkpoint']],
  [/\b(?:land|lands|landing|landings|touch\s*down|falls?)\b/, ['land']],
  [/\b(?:jump|jumps|jumping)\b/, ['jump']],
  [/\b(?:explosions?|explodes?|exploding|blasts?|barrels?|bombs?|detonat\w*)\b/, ['explosion']],
  [/\b(?:launch(?:es|ers?|ing)?|jump\s*pads?|bounce\s*pads?|boost(?:s|ers?)?\s*pads?|springs?)\b/, ['launch']],
];

const VFX_WORDS: ReadonlyArray<[RegExp, VfxPreset]> = [
  [/\bfireworks?\b/, 'fireworks'],
  [/\blevel[\s-]*ups?\b/, 'levelup'],
  [/\bsmoke\s*bombs?\b/, 'smokebomb'],
  [/\bcoin\s*(?:bursts?|showers?|fountains?|explosions?)\b|\bloot\s+bursts?\b/, 'coins'],
  [/\bblood\b|\bgore\b/, 'blood'],
  [/\bdebris\b|\brubble\b/, 'debris'],
  [/\bshatter\w*\b/, 'glass'],
  [/\belectric\w*\b|\bzaps?\b|\bsparking\s+wires?\b/, 'electric'],
  [/\bheal(?:s|ing)?\b/, 'heal'],
  [/\bpoison\w*\b|\btoxic\b/, 'poison'],
  [/\bfrost\w*\b|\bfreez\w*\b/, 'frost'],
  [/\bportals?\b/, 'portal'],
  [/\bteleport\w*\b/, 'teleport'],
  [/\bauras?\b/, 'aura'],
  [/\bhearts?\b/, 'hearts'],
  [/\bconfetti\b/, 'confetti'],
  [/\bshock\s*waves?\b/, 'shockwave'],
  [/\bsparkl(?:e|es|y|ing)\b|\bglitter\b|\btwinkl\w*\b|\bstars?\b/, 'sparkle'],
  [/\bsparks?\b/, 'sparks'],
  [/\bembers?\b/, 'embers'],
  [/\bsmoke\b|\bsmoking\b|\bsmoky\b/, 'smoke'],
  [/\bfire\b|\bflames?\b|\bburn(?:s|ing)?\b|\bablaze\b/, 'fire'],
  [/\bsplash(?:es)?\b|\bspray\b/, 'splash'],
  [/\bmuzzle\s*flash\b/, 'muzzle'],
  [/\bmagic(?:al)?\b|\barcane\b/, 'magic'],
  [/\bexplosion\s+(?:effect|burst|particles?)\b|\bfireballs?\b/, 'explosion'],
  [/\bdust\b|\bdusty\b|\bpuffs?\b/, 'dust'],
];

/** Words that make a clause about feel at all. */
const FEEL_WORD = /\b(?:feel|feels|feeling|punchy|punchier|juicy|juicier|juice|snappy|snappier|impactful|weighty|crunchy|crunchier|satisfying|shake|shakes|shaking|screen\s*shake|camera\s*shake|hit[\s-]*stops?|hit[\s-]*pause|freeze[\s-]*frames?|flash(?:es|ing)?|rumble|vibrat\w*|haptics?|particles?|vfx|effects?|feedback|sparks?|sparkl\w*|confetti|embers?|smoke|fire|flames?|burn\w*|splash(?:es)?|shock\s*waves?|magic|dust|puffs?|fireworks?|level[\s-]*ups?|smoke\s*bombs?|blood|gore|debris|shatter\w*|electric\w*|zaps?|heal(?:s|ing)?|poison\w*|frost\w*|portals?|teleport\w*|auras?|hearts?|floating\s+(?:text|numbers?|score)|damage\s+numbers?)\b/;

const PUNCHY = /\b(?:punchy|punchier|juicy|juicier|snappy|snappier|impactful|weighty|crunchy|crunchier|more\s+(?:impact|juice|intense|dramatic|satisfying)|stronger|harder|meatier|beefier|more\s+feedback)\b/;
const SUBTLE = /\b(?:subtle|subtler|softer|calmer|gentler|milder|less\s+(?:intense|punchy|juicy|dramatic|impact|feedback)|tone(?:d)?\s+(?:it\s+)?down|calm\s+(?:it\s+)?down)\b/;
const OFF = /\b(?:turn\s+off|disable|remove|no|without|kill|stop|get\s+rid\s+of)\b/;
const MORE = /\b(?:more|stronger|bigger|harder|extra|heavier|longer|increase|boost)\b/;
const LESS = /\b(?:less|weaker|smaller|softer|lighter|shorter|reduce|lower|tone\s+down|toned\s+down|gentler|subtler)\b/;
const ON = /\b(?:turn\s+on|enable|add|bring\s+back|restore|show)\b/;

const KNOBS: ReadonlyArray<[RegExp, FeelKnob]> = [
  [/\b(?:screen\s*|camera\s*)?shak(?:e|es|ing|y)\b/, 'shake'],
  [/\bhit[\s-]*stops?\b|\bhit[\s-]*pause\b|\bfreeze[\s-]*frames?\b|\bslow[\s-]*mo(?:tion)?\b/, 'hitStop'],
  [/\b(?:screen\s+)?flash(?:es|ing)?\b/, 'flash'],
  [/\brumble\b|\bvibrat\w*\b|\bhaptics?\b/, 'rumble'],
  [/\bfloating\s+(?:text|numbers?|scores?)\b|\bdamage\s+numbers?\b|\bscore\s+(?:popups?|numbers?)\b|\bpopups?\b/, 'text'],
  [/\b(?:fov|field\s+of\s+view)\s*(?:kicks?|punch|zoom)?\b|\bzoom\s*kicks?\b/, 'fovKick'],
  [/\bvignettes?\b|\bred\s+edges?\b/, 'vignette'],
];

function eventsIn(t: string): FeelEvent[] {
  const out = new Set<FeelEvent>();
  for (const [re, evs] of EVENT_WORDS) if (re.test(t)) for (const e of evs) out.add(e);
  // "the game", "everything", "the whole game": every event.
  return FEEL_EVENTS.filter((e) => out.has(e));
}

function vfxIn(t: string): VfxPreset | null {
  for (const [re, v] of VFX_WORDS) if (re.test(t)) return v;
  return null;
}

/**
 * Parse a feel clause. Returns null for anything that is not clearly about game feel or effects, so the other parsers
 * (weather, add, paint) still get "add dust", "add a campfire" or "make the fire red".
 */
export function parseFeel(c: string): FeelCommand | null {
  if (!FEEL_WORD.test(c)) return null;
  // Footstep dust.
  if (/\bfoot\s*steps?\b|\bfootstep\s+dust\b/.test(c) && /\b(?:dust|puffs?|particles?|effects?|splash(?:es)?)\b/.test(c)) {
    return { op: 'feel', events: [], footsteps: !OFF.test(c) };
  }
  // Emitters on things: "add fire to the torches", "make the chimney smoke", "set the barrels on fire", "remove the smoke from the chimney".
  const vfx = vfxIn(c);
  if (vfx) {
    const attach = /^(?:add|put|give|attach|place|spawn)\s+(?:some\s+|a\s+|an\s+)?(?:\w+\s+)?(?:effects?\s+|particles?\s+)?(?:to|on|onto|over|above|at)\s+(.+)$/.exec(c.replace(/\b(?:fire|flames?|smoke|embers?|sparkles?|sparks?|magic|dust|splash(?:es)?)\b/, '').replace(/\s+/g, ' ').trim());
    const burn = /^(?:make|let|have)\s+(.+?)\s+(?:burn|smoke|smoulder|smolder|spark|sparkle|glitter|steam|emit\s+\w+)$/.exec(c);
    const ablaze = /^(?:set|light)\s+(.+?)\s+(?:on\s+fire|ablaze|alight)$/.exec(c);
    const strip = /^(?:remove|delete|stop|turn\s+off|put\s+out|extinguish|kill)\s+(?:the\s+)?(?:\w+\s+)?(?:effects?\s+|particles?\s+)?(?:from|on|of)\s+(.+)$/.exec(c.replace(/\b(?:fire|flames?|smoke|embers?|sparkles?|sparks?|magic|dust)\b/, '').replace(/\s+/g, ' ').trim());
    const target = attach?.[1] ?? burn?.[1] ?? ablaze?.[1] ?? strip?.[1];
    const evs = eventsIn(c);
    if (target && evs.length === 0 && !/\b(?:when|whenever|every\s+time|each\s+time)\b/.test(c)) {
      const ref: Ref = parseRef(target);
      if (ref.noun || ref.pronoun) return { op: 'feel', events: [], attach: { ref, vfx: strip ? 'none' : vfx } };
    }
    if (evs.length > 0) return { op: 'feel', events: evs, vfx: OFF.test(c) && !ON.test(c) ? 'none' : vfx };
  }
  // Knobs: "less screen shake", "no flashes", "more hit-stop on hits", "turn off the rumble".
  for (const [re, knob] of KNOBS) {
    if (!re.test(c)) continue;
    const mode = OFF.test(c) && !MORE.test(c) ? 'off' : LESS.test(c) ? 'less' : MORE.test(c) ? 'more' : ON.test(c) ? 'on' : null;
    if (!mode) continue;
    return { op: 'feel', events: eventsIn(c), tweak: { knob, mode } };
  }
  // The whole feel off or back on.
  if (/\b(?:effects?|feedback|juice|game\s*feel|feel|particles?|vfx)\b/.test(c) && /^(?:turn\s+off|disable|remove|no|kill|get\s+rid\s+of)\b/.test(c)) return { op: 'feel', events: [], tier: 'off' };
  if (/^(?:turn\s+on|enable|bring\s+back|restore)\b/.test(c) && /\b(?:effects?|feedback|juice|game\s*feel|feel)\b/.test(c)) return { op: 'feel', events: [], tier: 'normal' };
  // Tiers: "make hits feel punchy", "make the game juicier", "tone down the effects".
  const tier: FeelTier | null = PUNCHY.test(c) ? 'punchy' : SUBTLE.test(c) ? 'subtle' : /\bnormal\b/.test(c) && /\bfeel\b/.test(c) ? 'normal' : null;
  if (tier) return { op: 'feel', events: eventsIn(c), tier };
  return null;
}

const KNOB_LABEL: Readonly<Record<FeelKnob, string>> = { shake: 'camera shake', hitStop: 'hit-stop', flash: 'screen flashes', rumble: 'controller rumble', text: 'floating score text', fovKick: 'field-of-view kicks', vignette: 'vignette pulses' };

function eventList(evs: readonly FeelEvent[]): string {
  if (evs.length === 0 || evs.length === FEEL_EVENTS.length) return 'every event';
  const names = evs.map((e) => (e === 'pickup' ? 'pickups' : e === 'hit' ? 'hits' : e === 'land' ? 'landings' : e === 'jump' ? 'jumps' : e === 'checkpoint' ? 'checkpoints' : e === 'explosion' ? 'explosions' : e === 'launch' ? 'launches' : e));
  return names.length === 1 ? (names[0] as string) : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] as string}`;
}

/** Apply a feel command to the draft. */
export function planFeel(env: OpEnv, cmd: FeelCommand): OpOutcome {
  const world = env.draft.world;
  if (cmd.attach) {
    const res = resolveRef(env.index, cmd.attach.ref, env.ctx);
    if (res.ambiguous && res.ambiguous.length > 0) return ask(res.reason ?? 'Which one?', res.ambiguous);
    if (res.items.length === 0) return failed(res.reason ?? `I can't find "${cmd.attach.ref.text}"`);
    const vfx = cmd.attach.vfx;
    for (const it of res.items) {
      const ent = env.draft.entity(it.id);
      if (vfx === 'none') {
        delete ent.vfx;
        continue;
      }
      const h = ent.shape.kind === 'primitive' ? ent.shape.size[1] : 1;
      // Flames and smoke start at the top of the thing; magic and sparkles around its middle.
      const top = vfx === 'fire' || vfx === 'smoke' || vfx === 'embers' ? h * 0.5 : 0;
      ent.vfx = { preset: vfx, enabled: true, ...(top > 0 ? { offset: [0, Math.round(top * 100) / 100, 0] as [number, number, number] } : {}) };
    }
    return outcome({ summary: vfx === 'none' ? `removed the effect from ${describeTargets(res.items, cmd.attach.ref)}` : `added ${vfx} to ${describeTargets(res.items, cmd.attach.ref)}`, targets: res.items.map((i) => i.id), cosmetic: true });
  }
  const events = cmd.events.length > 0 ? cmd.events : [...FEEL_EVENTS];
  let next: WorldDoc['feel'];
  let summary: string;
  if (cmd.footsteps !== undefined) {
    next = mergeFeel(world.feel, { footsteps: cmd.footsteps });
    summary = cmd.footsteps ? 'turned footstep dust on' : 'turned footstep dust off';
  } else if (cmd.tier && cmd.events.length === 0) {
    next = cmd.tier === 'normal' && world.feel && Object.keys(world.feel.events).length === 0 ? undefined : mergeFeel(world.feel, { preset: cmd.tier });
    summary = cmd.tier === 'off' ? 'turned the game feel off (no shake, flashes or bursts)' : `made the game feel ${cmd.tier}`;
  } else if (cmd.tier) {
    next = mergeFeel(world.feel, { events: Object.fromEntries(events.map((e) => [e, { tier: cmd.tier }])) });
    summary = `made ${eventList(events)} feel ${cmd.tier}`;
  } else if (cmd.vfx) {
    next = mergeFeel(world.feel, { events: Object.fromEntries(events.map((e) => [e, { vfx: cmd.vfx }])) });
    summary = cmd.vfx === 'none' ? `removed the bursts from ${eventList(events)}` : `added ${cmd.vfx} to ${eventList(events)}`;
  } else if (cmd.tweak) {
    const { knob, mode } = cmd.tweak;
    const changes: Record<string, Record<string, number | boolean>> = {};
    for (const e of events) {
      const cur = resolveFeelCue(world.feel, e);
      if (knob === 'text') {
        changes[e] = { text: mode !== 'off' && mode !== 'less' };
        continue;
      }
      const v = cur[knob];
      const max = knob === 'hitStop' ? 0.25 : knob === 'fovKick' ? 20 : 1;
      const base = v === 0 && (mode === 'more' || mode === 'on') ? resolveFeelCue(undefined, e)[knob] : v;
      const scaled = mode === 'off' ? 0 : mode === 'less' ? base * 0.5 : mode === 'more' ? base * 1.6 : base;
      const clamped = knob === 'fovKick' ? Math.max(-max, Math.min(max, scaled)) : Math.max(0, Math.min(max, scaled));
      changes[e] = { [knob]: Math.round(clamped * 1000) / 1000 };
    }
    next = mergeFeel(world.feel, { events: changes });
    const verb = mode === 'off' ? 'turned off' : mode === 'less' ? 'halved' : mode === 'more' ? 'strengthened' : 'turned on';
    summary = `${verb} the ${KNOB_LABEL[knob]} on ${eventList(events)}`;
  } else return failed('I did not understand which part of the game feel to change');
  env.draft.world = { ...world, ...(next ? { feel: next } : {}) };
  if (!next) delete env.draft.world.feel;
  return outcome({ summary, cosmetic: true, notes: ['Game feel changes the picture, the camera and the sound only; the game plays and verifies exactly as before.'] });
}
