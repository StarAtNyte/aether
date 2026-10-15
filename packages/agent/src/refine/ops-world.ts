/**
 * World-level and behaviour edits: sky, time, weather, fog, gravity, lights,
 * speeds, doors, dialogue, names, visibility, physics feel, game numbers.
 */
import type { Entity, EntityId, Json, Rule } from '@aether/core';
import { adjustColor } from './adjust';
import type { Command, EnvIntent } from './command';
import { setPath } from './draft';
import { colorName, hexToRgb, rgbToHex } from './lexicon';
import { resolveRef } from './resolve';
import type { SceneItem } from './scene';
import { ask, describeTargets, failed, outcome, refused, type OpEnv, type OpOutcome } from './ops-types';

const r2 = (n: number): number => Math.round(n * 100) / 100;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/** Sky and base light levels for an hour of the day. */
export function skyForHour(h: number): { sky: 'night' | 'dawn' | 'day' | 'sunset'; sun: number; ambient: number; bloom: number } {
  const t = ((h % 24) + 24) % 24;
  if (t < 4.5 || t >= 20) return { sky: 'night', sun: 0.5, ambient: 0.25, bloom: 1.2 };
  if (t < 8) return { sky: 'dawn', sun: 2.2, ambient: 0.4, bloom: 0.7 };
  if (t < 16.5) return { sky: 'day', sun: 2.8, ambient: 0.45, bloom: 0.5 };
  if (t < 20) return { sky: 'sunset', sun: 2.4, ambient: 0.4, bloom: 0.9 };
  return { sky: 'night', sun: 0.5, ambient: 0.25, bloom: 1.2 };
}

const SKY_PRESETS: Readonly<Record<string, { sun: number; ambient: number; bloom: number }>> = {
  night: { sun: 0.5, ambient: 0.25, bloom: 1.2 },
  sunset: { sun: 2.4, ambient: 0.4, bloom: 0.9 },
  dawn: { sun: 2.2, ambient: 0.4, bloom: 0.7 },
  day: { sun: 2.8, ambient: 0.45, bloom: 0.5 },
  overcast: { sun: 1.4, ambient: 0.55, bloom: 0.3 },
  space: { sun: 2.0, ambient: 0.2, bloom: 0.8 },
  studio: { sun: 1.6, ambient: 0.6, bloom: 0.3 },
};

const FOG_COLOR: Readonly<Record<string, string>> = { night: '#1b2030', sunset: '#e7b98f', dawn: '#e8c9b0', day: '#c9d8e6', overcast: '#b9c1ca', space: '#0b0f1a', studio: '#d9d9d9' };

function describeEnv(i: EnvIntent): string {
  const parts: string[] = [];
  if (i.sky) parts.push(`the sky to ${i.sky === 'dawn' ? 'sunrise' : i.sky === 'day' ? 'daytime' : i.sky}`);
  if (i.timeOfDay !== undefined && !i.sky) parts.push(`${String(Math.floor(i.timeOfDay)).padStart(2, '0')}:${String(Math.round((i.timeOfDay % 1) * 60)).padStart(2, '0')}`);
  if (i.timeShift) parts.push(`${i.timeShift > 0 ? 'later' : 'earlier'} by ${Math.abs(i.timeShift)} h`);
  if (i.weather) parts.push(i.weather === 'clear' ? 'the weather to clear' : `the weather to ${i.weather}`);
  if (i.fog) parts.push(i.fog === 'none' ? 'no fog' : i.fog === 'less' ? 'less fog' : 'more fog');
  if (i.gravity) parts.push(`${i.gravity} gravity`);
  if (i.season) parts.push(`${i.season} look`);
  if (i.sunFactor) parts.push(i.sunFactor > 1 ? 'brighter light' : 'dimmer light');
  if (i.groundMaterial) parts.push('ground');
  if (i.groundNone) parts.push('no ground');
  if (i.bloomFactor) parts.push(i.bloomFactor > 1 ? 'more glow' : 'less glow');
  return parts.join(', ') || 'the environment';
}

/** Environment edits. */
export function planEnv(env: OpEnv, cmd: Extract<Command, { op: 'env' }>): OpOutcome {
  const i = cmd.set;
  const targets: EntityId[] = [];
  const notes: string[] = [];
  env.draft.env((e) => {
    const cur = e as Record<string, unknown>;
    let sky = i.sky;
    let hour = i.timeOfDay;
    if (i.timeShift !== undefined) {
      const base = typeof cur['timeOfDay'] === 'number' ? (cur['timeOfDay'] as number) : 12;
      hour = (((base + i.timeShift) % 24) + 24) % 24;
    }
    if (hour !== undefined && !sky) sky = skyForHour(hour).sky;
    if (sky) {
      cur['sky'] = sky;
      const p = SKY_PRESETS[sky];
      if (p) {
        cur['sunIntensity'] = p.sun;
        cur['ambientIntensity'] = p.ambient;
        cur['bloom'] = p.bloom;
      }
      if (hour === undefined) hour = sky === 'night' ? 22 : sky === 'sunset' ? 17.8 : sky === 'dawn' ? 6.5 : sky === 'day' ? 12.5 : undefined;
      // The sky changes the haze colour with it, if there is haze.
      const fog = cur['fog'] as { color: string; density: number } | null | undefined;
      if (fog && i.fog === undefined) cur['fog'] = { ...fog, color: FOG_COLOR[sky] ?? fog.color };
    }
    if (hour !== undefined) cur['timeOfDay'] = r2(hour);
    if (i.weather) cur['weather'] = i.weather;
    if (i.fog) {
      const fog = cur['fog'] as { color: string; density: number } | null | undefined;
      const color = FOG_COLOR[(cur['sky'] as string | undefined) ?? 'day'] ?? '#c9d8e6';
      if (i.fog === 'none') cur['fog'] = null;
      else if (i.fog === 'on') cur['fog'] = { color, density: fog ? Math.max(fog.density, 0.02) : 0.025 };
      else if (i.fog === 'more') cur['fog'] = { color: fog?.color ?? color, density: clamp((fog?.density ?? 0.01) * 1.8, 0.001, 0.2) };
      else if (fog) cur['fog'] = fog.density * 0.5 < 0.0015 ? null : { color: fog.color, density: r2(fog.density * 0.5 * 10000) / 10000 };
    }
    if (i.sunFactor) cur['sunIntensity'] = r2(clamp((cur['sunIntensity'] as number) * i.sunFactor, 0, 12));
    if (i.ambientFactor) cur['ambientIntensity'] = r2(clamp((cur['ambientIntensity'] as number) * i.ambientFactor, 0, 4));
    if (i.bloomFactor) cur['bloom'] = r2(clamp((cur['bloom'] as number) * i.bloomFactor, 0, 3));
    if (i.exposureFactor) cur['exposure'] = r2(clamp((cur['exposure'] as number) * i.exposureFactor, 0.1, 4));
    if (i.gravity) cur['gravity'] = i.gravity === 'zero' ? [0, 0, 0] : i.gravity === 'low' ? [0, -1.62, 0] : i.gravity === 'high' ? [0, -20, 0] : [0, -9.81, 0];
    if (i.groundNone) cur['ground'] = null;
    if (i.groundMaterial) {
      const ground = (cur['ground'] as { material: Record<string, unknown>; size: number } | null) ?? { material: {}, size: 400 };
      const m: Record<string, unknown> = { ...ground.material };
      const mw = i.groundMaterial;
      if (mw.material) {
        const map: Record<string, { preset?: string; finish?: string }> = { snow: { preset: 'snow' }, sand: { preset: 'sand' }, dirt: { preset: 'dirt' }, grass: { preset: 'grass' }, gravel: { finish: 'gravel' }, stone: { finish: 'stone' }, water: { preset: 'water' }, lava: { preset: 'lava' }, ice: { preset: 'ice' } };
        const sel = map[mw.material];
        if (sel?.preset) {
          m['preset'] = sel.preset;
          delete m['finish'];
        } else if (sel?.finish) {
          m['finish'] = sel.finish;
          delete m['preset'];
        }
        const defaults: Record<string, string> = { snow: '#f4f7fb', sand: '#e0cf9c', dirt: '#6b4f33', grass: '#5e8a3c', water: '#3d8fb0' };
        if (!mw.color && defaults[mw.material]) m['color'] = defaults[mw.material];
      }
      if (mw.color) m['color'] = mw.color;
      cur['ground'] = { ...ground, material: m };
    }
    if (i.season) {
      if (i.season === 'winter') {
        cur['weather'] = 'snow';
        cur['sky'] = 'overcast';
        cur['sunIntensity'] = 1.6;
        cur['ambientIntensity'] = 0.55;
        cur['fog'] = { color: '#dfe7ef', density: 0.012 };
        const ground = cur['ground'] as { material: Record<string, unknown>; size: number } | null;
        if (ground) cur['ground'] = { ...ground, material: { preset: 'snow', color: '#f4f7fb' } };
      } else if (i.season === 'autumn') {
        cur['weather'] = 'leaves';
        cur['sky'] = 'sunset';
        cur['timeOfDay'] = 16.5;
        cur['sunIntensity'] = 2.4;
        const ground = cur['ground'] as { material: Record<string, unknown>; size: number } | null;
        if (ground) cur['ground'] = { ...ground, material: { preset: 'grass', color: '#8a7a3a' } };
      } else if (i.season === 'spring') {
        cur['weather'] = 'petals';
        cur['sky'] = 'day';
        cur['timeOfDay'] = 11;
        cur['sunIntensity'] = 2.8;
      } else {
        cur['weather'] = 'clear';
        cur['sky'] = 'day';
        cur['timeOfDay'] = 13;
        cur['sunIntensity'] = 3;
        cur['fog'] = null;
      }
    }
  });
  // Autumn recolours foliage (leaf parameters of tree generators).
  if (i.season === 'autumn') {
    const autumn = ['#c8641e', '#b8481c', '#d19a2a', '#9c3a1a'];
    let n = 0;
    for (const it of env.index.items) {
      const sh = it.entity.shape;
      if (sh.kind !== 'procedural' || !/^tree-(oak|maple|birch)/.test(sh.generator)) continue;
      const spec = env.params(sh.generator);
      if (!spec?.['color']) continue;
      const ent = env.draft.entity(it.id);
      if (ent.shape.kind === 'procedural') ent.shape.params = { ...ent.shape.params, color: autumn[n++ % autumn.length] as string };
      targets.push(it.id);
    }
  }
  return outcome({ summary: `changed ${describeEnv(i)}`, targets, cosmetic: i.gravity === undefined, notes });
}

// ---------------------------------------------------------------------------
// Lights
// ---------------------------------------------------------------------------

function lightTargets(env: OpEnv, cmd: Extract<Command, { op: 'light' }>): { items: SceneItem[]; res?: ReturnType<typeof resolveRef>; world: boolean } {
  const ref = cmd.ref;
  if (!ref || (ref.pronoun && !ref.noun && env.ctx.selection.length === 0 && env.ctx.focus.length === 0)) return { items: [], world: true };
  const res = resolveRef(env.index, ref.noun === 'light' || ref.noun === 'lamp' ? { ...ref, all: ref.all ?? (ref.text.toLowerCase().includes('lights') || ref.text.toLowerCase().includes('lamps')) } : ref, env.ctx);
  return { items: res.items, res, world: false };
}

/** Light edits (intensity, warmth, on/off). */
export function planLight(env: OpEnv, cmd: Extract<Command, { op: 'light' }>): OpOutcome {
  const t = lightTargets(env, cmd);
  if (t.world) {
    // "make it brighter" with nothing selected: the scene lighting.
    if (cmd.factor) return planEnv(env, { op: 'env', set: { sunFactor: cmd.factor, ambientFactor: cmd.factor } });
    return failed('Select a light first, or say which one');
  }
  if (t.res?.ambiguous && t.res.ambiguous.length > 0) return ask(t.res.reason ?? 'Which light?', t.res.ambiguous);
  if (t.items.length === 0) return failed(t.res?.reason ?? 'I can’t find that light');
  // An object that holds a light: use its children if the object itself has none.
  const lights: SceneItem[] = [];
  for (const it of t.items) {
    if (it.entity.light) lights.push(it);
    else for (const id of env.index.subtree(it.id).slice(1)) {
      const c = env.index.get(id);
      if (c?.entity.light) lights.push(c);
    }
  }
  if (lights.length === 0) return refused(`${describeTargets(t.items).replace(/^the /, 'The ')} is decorative: it has no light source I can change.`);
  for (const it of lights) {
    const ent = env.draft.entity(it.id);
    const l = ent.light as NonNullable<Entity['light']>;
    if (cmd.factor) ent.light = { ...l, intensity: r2(clamp(l.intensity * cmd.factor, 0, 200)) };
    if (cmd.warmth) ent.light = { ...(ent.light ?? l), color: adjustColor((ent.light ?? l).color, cmd.warmth, 0.5) };
    if (cmd.color) ent.light = { ...(ent.light ?? l), color: cmd.color };
    if (cmd.on === false && l.intensity > 0) {
      ent.state = { ...ent.state, lightOffFrom: l.intensity };
      ent.light = { ...l, intensity: 0 };
    }
    if (cmd.on === true && l.intensity === 0) {
      const prev = ent.state['lightOffFrom'];
      ent.light = { ...l, intensity: typeof prev === 'number' ? prev : 1 };
      const { lightOffFrom: _gone, ...rest } = ent.state;
      ent.state = rest;
    }
  }
  const what = cmd.on === false ? 'turned off' : cmd.on === true ? 'turned on' : cmd.warmth ? `made warmer/cooler` : cmd.factor && cmd.factor > 1 ? 'brightened' : 'dimmed';
  return outcome({ summary: `${what} ${lights.length === 1 ? `the ${(lights[0] as SceneItem).label.toLowerCase()}` : `${lights.length} lights`}`, targets: lights.map((l) => l.id), cosmetic: true });
}

// ---------------------------------------------------------------------------
// Speeds
// ---------------------------------------------------------------------------

/** Behaviour → the numeric param that is its speed, with the built-in default. */
export const SPEED_PARAM: Readonly<Record<string, { key: string; default: number }>> = {
  spin: { key: 'speed', default: 90 },
  orbit: { key: 'speed', default: 30 },
  patrol: { key: 'speed', default: 2 },
  follow: { key: 'speed', default: 3 },
  wander: { key: 'speed', default: 1.5 },
  flee: { key: 'speed', default: 4 },
  playerController: { key: 'speed', default: 6 },
  vehicle: { key: 'maxSpeed', default: 20 },
  npc: { key: 'speed', default: 1 },
  conveyor: { key: 'speed', default: 2 },
};

const PLAYER_WORDS = /^(player|hero|avatar|character|me|protagonist|you)$/;

/** Speed edits ("make the enemy slower", "make the coins spin faster"). */
export function planSpeed(env: OpEnv, cmd: Extract<Command, { op: 'speed' }>): OpOutcome {
  const world = env.base;
  if (PLAYER_WORDS.test(cmd.ref.noun)) {
    const cur = world.player.moveSpeed;
    const next = r2(clamp(cmd.value ?? cur * (cmd.factor ?? 1), 0.5, 60));
    env.draft.player((p) => {
      p['moveSpeed'] = next;
    });
    const ctl = world.player.controls ? env.index.get(world.player.controls) : undefined;
    const targets: EntityId[] = [];
    if (ctl) {
      const ent = env.draft.entity(ctl.id);
      ent.behaviors = ent.behaviors.map((b) => {
        const sp = SPEED_PARAM[b.type];
        if (!sp || (b.type !== 'playerController' && b.type !== 'vehicle')) return b;
        const old = typeof b.params[sp.key] === 'number' ? (b.params[sp.key] as number) : sp.default;
        return { ...b, params: { ...b.params, [sp.key]: r2(clamp(cmd.value ?? old * (cmd.factor ?? 1), 0.5, 200)) } };
      });
      targets.push(ctl.id);
    }
    return outcome({ summary: `set the player's speed to ${next} m/s`, targets, cosmetic: false });
  }
  const res = resolveRef(env.index, cmd.ref, env.ctx);
  if (res.ambiguous && res.ambiguous.length > 0) return ask(res.reason ?? 'Which one?', res.ambiguous);
  if (res.items.length === 0) return failed(res.reason ?? `I can't find "${cmd.ref.text}"`);
  const only = cmd.what;
  const changed: SceneItem[] = [];
  for (const it of res.items) {
    const probe = it.entity.behaviors.some((b) => SPEED_PARAM[b.type] && (!only || b.type === only));
    const kids = probe ? [] : env.index.subtree(it.id).slice(1).map((c) => env.index.get(c)).filter((c): c is SceneItem => !!c && c.entity.behaviors.some((b) => SPEED_PARAM[b.type] && (!only || b.type === only)));
    for (const target of probe ? [it] : kids) {
      const ent = env.draft.entity(target.id);
      ent.behaviors = ent.behaviors.map((b) => {
        const sp = SPEED_PARAM[b.type];
        if (!sp || (only && b.type !== only)) return b;
        const old = typeof b.params[sp.key] === 'number' ? (b.params[sp.key] as number) : sp.default;
        const next = cmd.value !== undefined ? cmd.value : old * (cmd.factor ?? 1);
        return { ...b, params: { ...b.params, [sp.key]: r2(Math.abs(next) < 0.01 ? 0.01 : next) } };
      });
      changed.push(target);
    }
    // Bobbing is paced by its period: faster means a shorter period.
    if (!probe && kids.length === 0 && (!only || only === 'bob') && it.entity.behaviors.some((b) => b.type === 'bob') && cmd.factor) {
      const ent = env.draft.entity(it.id);
      ent.behaviors = ent.behaviors.map((b) => (b.type === 'bob' ? { ...b, params: { ...b.params, period: r2((typeof b.params['period'] === 'number' ? (b.params['period'] as number) : 2) / cmd.factor!) } } : b));
      changed.push(it);
    }
  }
  if (changed.length === 0) return refused(`${describeTargets(res.items, cmd.ref).replace(/^the /, 'The ')} doesn't move on its own, so there is no speed to change. Ask me to make it spin or move first.`);
  const faster = (cmd.factor ?? 1) >= 1 && (cmd.value === undefined || cmd.value > 0);
  return outcome({ summary: `made ${describeTargets(res.items, cmd.ref)} ${only === 'spin' ? 'spin ' : ''}${cmd.value !== undefined ? `go ${cmd.value}` : faster ? 'faster' : 'slower'}`, targets: changed.map((c) => c.id), cosmetic: false });
}

/** Turn spin / bob on or off. */
export function planBehavior(env: OpEnv, cmd: Extract<Command, { op: 'behavior' }>): OpOutcome {
  const res = resolveRef(env.index, cmd.ref, env.ctx);
  if (res.ambiguous && res.ambiguous.length > 0) return ask(res.reason ?? 'Which one?', res.ambiguous);
  if (res.items.length === 0) return failed(res.reason ?? `I can't find "${cmd.ref.text}"`);
  for (const it of res.items) {
    const ent = env.draft.entity(it.id);
    const has = ent.behaviors.some((b) => b.type === cmd.behavior);
    if (cmd.enabled) {
      if (has) ent.behaviors = ent.behaviors.map((b) => (b.type === cmd.behavior ? { ...b, enabled: true } : b));
      else {
        ent.behaviors = [...ent.behaviors, cmd.behavior === 'spin' ? { type: 'spin', params: { speed: 90 }, enabled: true } : { type: 'bob', params: { amplitude: 0.3, period: 2 }, enabled: true }];
        if (ent.physics?.body === 'dynamic') ent.physics = { ...ent.physics, body: 'kinematic' };
      }
    } else if (has) ent.behaviors = ent.behaviors.map((b) => (b.type === cmd.behavior ? { ...b, enabled: false } : b));
  }
  return outcome({ summary: `${cmd.enabled ? 'made' : 'stopped'} ${describeTargets(res.items, cmd.ref)} ${cmd.enabled ? (cmd.behavior === 'spin' ? 'spin' : 'float') : cmd.behavior === 'spin' ? 'spinning' : 'floating'}`, targets: res.items.map((i) => i.id), cosmetic: false });
}

// ---------------------------------------------------------------------------
// Doors, dialogue, names, visibility, physics
// ---------------------------------------------------------------------------

/** Door edits (swing direction, hinge side, initial state). */
export function planDoor(env: OpEnv, cmd: Extract<Command, { op: 'door' }>): OpOutcome {
  // Only the door itself opens (a generated door is a frame plus a leaf that carries the behaviour).
  const opens = (i: SceneItem): boolean => i.entity.behaviors.some((b) => b.type === 'door');
  const res = resolveRef(env.index, { ...cmd.ref, noun: cmd.ref.noun || 'door' }, { ...env.ctx, only: (i) => opens(i) || env.index.subtree(i.id).slice(1).some((c) => env.index.get(c)?.entity.behaviors.some((b) => b.type === 'door')) });
  if (res.ambiguous && res.ambiguous.length > 0) return ask(res.reason ?? 'Which door?', res.ambiguous);
  if (res.items.length === 0) return failed(res.reason ?? 'I can’t find that door');
  let changed = 0;
  for (const it of res.items) {
    const hasDoor = it.entity.behaviors.some((b) => b.type === 'door');
    const holder = hasDoor ? it : env.index.subtree(it.id).slice(1).map((c) => env.index.get(c)).find((c): c is SceneItem => !!c && c.entity.behaviors.some((b) => b.type === 'door'));
    if (!holder) continue;
    const ent = env.draft.entity(holder.id);
    ent.behaviors = ent.behaviors.map((b) => {
      if (b.type !== 'door') return b;
      const p: Record<string, Json> = { ...b.params };
      if (cmd.outwards !== undefined) {
        const cur = typeof p['swingAngle'] === 'number' ? (p['swingAngle'] as number) : 90;
        // The swing direction is the sign of the angle: flip it to open the other way.
        const wantNegative = cmd.outwards;
        const isNegative = cur < 0;
        if (wantNegative !== isNegative && !(it.entity.arch && false)) p['swingAngle'] = -cur;
        p['motion'] = 'swing';
      }
      if (cmd.hinge) p['hinge'] = cmd.hinge;
      if (cmd.open !== undefined) p['startOpen'] = cmd.open;
      return { ...b, params: p };
    });
    changed++;
  }
  if (changed === 0) return failed('That door has no opening behaviour to change');
  const what = cmd.outwards !== undefined ? `open ${cmd.outwards ? 'outwards' : 'inwards'}` : cmd.hinge ? `hinge on the ${cmd.hinge}` : cmd.open ? 'start open' : 'start closed';
  return outcome({ summary: `made ${describeTargets(res.items, cmd.ref)} ${what}`, targets: res.items.map((i) => i.id), cosmetic: false });
}

/** Dialogue edits for NPCs. */
export function planDialogue(env: OpEnv, cmd: Extract<Command, { op: 'dialogue' }>): OpOutcome {
  const res = resolveRef(env.index, cmd.ref, env.ctx);
  if (res.ambiguous && res.ambiguous.length > 0) return ask(res.reason ?? 'Who?', res.ambiguous);
  if (res.items.length === 0) return failed(res.reason ?? `I can't find "${cmd.ref.text}"`);
  const it = res.items[0] as SceneItem;
  const holder = it.entity.behaviors.some((b) => b.type === 'npc') ? it : env.index.subtree(it.id).slice(1).map((c) => env.index.get(c)).find((c): c is SceneItem => !!c && c.entity.behaviors.some((b) => b.type === 'npc'));
  if (!holder) return failed(`${it.label} doesn't talk. I can make it a character who greets visitors if you like`);
  const ent = env.draft.entity(holder.id);
  const text = cmd.text.replace(/^["']|["']$/g, '').trim();
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  ent.behaviors = ent.behaviors.map((b) => (b.type === 'npc' ? { ...b, params: { ...b.params, lines: [sentence] } } : b));
  return outcome({ summary: `${holder.label} now says “${sentence.slice(0, 60)}”`, targets: [holder.id], cosmetic: true });
}

/** Rename. */
export function planRename(env: OpEnv, cmd: Extract<Command, { op: 'rename' }>): OpOutcome {
  const res = resolveRef(env.index, cmd.ref, env.ctx);
  if (res.ambiguous && res.ambiguous.length > 0) return ask(res.reason ?? 'Which one?', res.ambiguous);
  const it = res.items[0];
  if (!it) return failed(res.reason ?? `I can't find "${cmd.ref.text}"`);
  const name = cmd.name.replace(/\s+/g, ' ').trim();
  const pretty = name.replace(/\b[a-z]/g, (c) => c.toUpperCase()).slice(0, 60);
  const ent = env.draft.entity(it.id);
  ent.name = pretty;
  ent.behaviors = ent.behaviors.map((b) => (b.type === 'npc' ? { ...b, params: { ...b.params, name: pretty } } : b));
  return outcome({ summary: `renamed ${it.label} to ${pretty}`, targets: [it.id], cosmetic: true });
}

/** Show / hide. */
export function planVisibility(env: OpEnv, cmd: Extract<Command, { op: 'visibility' }>): OpOutcome {
  const res = resolveRef(env.index, cmd.ref, env.ctx);
  if (res.ambiguous && res.ambiguous.length > 0) return ask(res.reason ?? 'Which one?', res.ambiguous);
  if (res.items.length === 0) return failed(res.reason ?? `I can't find "${cmd.ref.text}"`);
  for (const it of res.items) env.draft.entity(it.id).visible = cmd.visible;
  return outcome({ summary: `${cmd.visible ? 'showed' : 'hid'} ${describeTargets(res.items, cmd.ref)}`, targets: res.items.map((i) => i.id), cosmetic: !cmd.visible ? false : true });
}

/** Physical feel (bouncy, heavy…). */
export function planPhysics(env: OpEnv, cmd: Extract<Command, { op: 'physics' }>): OpOutcome {
  const res = resolveRef(env.index, cmd.ref, env.ctx);
  if (res.ambiguous && res.ambiguous.length > 0) return ask(res.reason ?? 'Which one?', res.ambiguous);
  if (res.items.length === 0) return failed(res.reason ?? `I can't find "${cmd.ref.text}"`);
  for (const it of res.items) {
    const ent = env.draft.entity(it.id);
    const p = ent.physics ?? { body: 'static' as const, collider: 'auto' as const, friction: 0.6, restitution: 0.1, sensor: false, linearDamping: 0, angularDamping: 0.05, gravityScale: 1, lockRotation: false, ccd: false };
    switch (cmd.what) {
      case 'bouncy':
        ent.physics = { ...p, restitution: 0.9, friction: 0.4, ...(p.body === 'static' ? { body: 'dynamic' as const } : {}) };
        break;
      case 'heavy':
        ent.physics = { ...p, mass: Math.max(50, (p.mass ?? 5) * 5), ...(p.body === 'static' ? { body: 'dynamic' as const } : {}) };
        break;
      case 'light':
        ent.physics = { ...p, mass: 0.3, ...(p.body === 'static' ? { body: 'dynamic' as const } : {}) };
        break;
      case 'static':
        ent.physics = { ...p, body: 'static' };
        break;
      case 'dynamic':
        ent.physics = { ...p, body: 'dynamic' };
        break;
      case 'slippery':
        ent.physics = { ...p, friction: 0.05 };
        break;
      case 'sticky':
        ent.physics = { ...p, friction: 2.5 };
        break;
    }
  }
  return outcome({ summary: `made ${describeTargets(res.items, cmd.ref)} ${cmd.what}`, targets: res.items.map((i) => i.id), cosmetic: false });
}

// ---------------------------------------------------------------------------
// Game numbers
// ---------------------------------------------------------------------------

const TIME_KEY = /^(timeleft|time_left|timer|time|countdown|clock|seconds|secondsleft|time-left)$/i;

function timeKeys(env: OpEnv): string[] {
  return Object.keys(env.base.state).filter((k) => TIME_KEY.test(k) && typeof env.base.state[k] === 'number');
}

function replaceNumberInText(text: string, from: number, to: number): string {
  return text.replace(new RegExp(`(?<![\\d.])${from}(?![\\d.])`, 'g'), String(to));
}

/** A count in prose ("collect all 10 coins"), not a duration. */
function replaceCount(text: string, from: number, to: number): string {
  return text.replace(new RegExp(`(?<![\\d.])${from}(?![\\d.])(?!\\s*(?:s\\b|sec|min))`, 'g'), String(to));
}

/** A duration in prose ("in 60 seconds"). */
function replaceDuration(text: string, from: number, to: number): string {
  return text.replace(new RegExp(`(?<![\\d.])${from}(?![\\d.])(?=\\s*(?:s\\b|sec|seconds))`, 'g'), String(to));
}

/** Change the starting value of a countdown and everything that quotes it. */
function retime(env: OpEnv, key: string, old: number, next: number): void {
  const w = env.draft.world;
  w.state = { ...w.state, [key]: next };
  w.rules = w.rules.map((r) => ({ ...r, then: r.then.map((a) => (a.do === 'set' && a.key === key && a.value === old ? { ...a, value: next } : a.do === 'message' ? { ...a, text: replaceDuration(a.text, old, next) } : a)) })) as Rule[];
  w.hud = w.hud.map((h) => (h.key === key ? { ...h, label: replaceDuration(h.label, old, next) } : h));
  // "the timer runs" tests quote the starting value.
  w.tests = w.tests.map((t) => (t.kind === 'eventually' && t.condition.key === key && typeof t.condition.value === 'number' && t.condition.value > 0 && t.condition.value < old ? { ...t, condition: { ...t.condition, value: Math.max(1, t.condition.value + (next - old)) } } : t));
  if (w.intro?.objective) w.intro = { ...w.intro, objective: replaceDuration(w.intro.objective, old, next) };
}

/** Hostile movers: enemies, rivals, hazards that chase or patrol. */
function hostile(it: SceneItem): boolean {
  return it.entity.behaviors.some((b) => SPEED_PARAM[b.type] && (b.type === 'follow' || b.type === 'patrol' || b.type === 'wander' || b.type === 'flee')) && (it.tokens.has('enemy') || it.tokens.has('rival') || it.tokens.has('hazard') || it.tokens.has('guard') || it.entity.tags.some((t) => /enemy|rival|hazard|guard|monster|zombie/.test(t)) || it.entity.behaviors.some((b) => b.type === 'follow'));
}

/** Game-rule numbers: time limit, target score, jump, difficulty, camera. */
export function planGame(env: OpEnv, cmd: Extract<Command, { op: 'game' }>): OpOutcome {
  const world = env.base;
  switch (cmd.key) {
    case 'timeLimit': {
      const keys = timeKeys(env);
      const key = keys[0];
      if (!key) return failed('This world has no time limit to change');
      const old = world.state[key] as number;
      const next = Math.max(5, Math.round(cmd.value ?? old * (cmd.factor ?? 1)));
      retime(env, key, old, next);
      return outcome({ summary: `set the time limit to ${next} seconds (was ${old})`, cosmetic: false });
    }
    case 'targetScore': {
      const value = Math.max(1, Math.round(cmd.value ?? 0));
      // Pickups feed a state key; rules fire on that key reaching a number. The biggest number is the finish line.
      const pickups = env.index.items.filter((i) => i.entity.behaviors.some((b) => b.type === 'collectible') && !i.entity.template);
      const keys = new Set(pickups.flatMap((i) => i.entity.behaviors.filter((b) => b.type === 'collectible').map((b) => String(b.params['scoreKey'] ?? 'score'))));
      const goalRules = world.rules.filter((r) => r.when.on === 'state' && (r.when.op === '>=' || r.when.op === '==') && typeof r.when.value === 'number' && (keys.size === 0 ? !TIME_KEY.test(r.when.key) : keys.has(r.when.key)));
      goalRules.sort((a, b) => ((b.when as { value: number }).value - (a.when as { value: number }).value) || (b.then.some((x) => x.do === 'win') ? 1 : 0) - (a.then.some((x) => x.do === 'win') ? 1 : 0));
      const rule = goalRules[0];
      if (!rule || rule.when.on !== 'state') return failed('I can’t tell which number wins this game');
      const old = rule.when.value as number;
      const key = rule.when.key;
      const scale = (n: number): number => Math.max(1, Math.round((n * value) / old));
      env.draft.world.rules = env.draft.world.rules.map((r) => {
        if (r.when.on !== 'state' || r.when.key !== key || typeof r.when.value !== 'number' || r.when.value > old || r.when.value <= 0) return r;
        const to = r.id === rule.id ? value : scale(r.when.value);
        const from = r.when.value;
        return { ...r, when: { ...r.when, value: to }, then: r.then.map((a) => (a.do === 'message' ? { ...a, text: replaceCount(a.text, from, to) } : a)), if: r.if.map((c) => (c.key === key && c.value === from ? { ...c, value: to } : c)) };
      }) as Rule[];
      env.draft.world.rules = env.draft.world.rules.map((r) => ({ ...r, then: r.then.map((a) => (a.do === 'message' ? { ...a, text: replaceCount(a.text, old, value) } : a)), if: r.if.map((c) => (c.key === key && c.value === old ? { ...c, value } : c)) })) as Rule[];
      env.draft.world.hud = env.draft.world.hud.map((h) => (h.key === key ? { ...h, label: replaceCount(h.label, old, value) } : h));
      env.draft.world.tests = env.draft.world.tests.map((t) => (t.kind === 'eventually' && t.condition.key === key && t.condition.value === old ? { ...t, condition: { ...t.condition, value } } : t));
      if (world.intro?.objective) env.draft.world.intro = { ...world.intro, objective: replaceCount(world.intro.objective, old, value) };
      const added: EntityId[] = [];
      const notes: string[] = [];
      const own = pickups.filter((i) => i.entity.behaviors.some((b) => b.type === 'collectible' && String(b.params['scoreKey'] ?? 'score') === key));
      if (own.length > 0 && own.length < value) {
        const need = value - own.length;
        const last = own[own.length - 1] as SceneItem;
        for (let k = 0; k < need && k < 60; k++) {
          const a = (k / Math.max(need, 1)) * Math.PI * 2 + k * 0.7;
          const ring = 3 + (k % 5) * 1.6;
          const id = uniqueEntityId(env, last.id.replace(/-?\d+$/, '') || 'pickup', added);
          const e = structuredClone(last.entity) as Entity;
          e.id = id;
          e.transform = { ...e.transform, position: [r2(last.pos[0] + Math.cos(a) * ring), e.transform.position[1], r2(last.pos[2] + Math.sin(a) * ring)] };
          env.draft.add(e);
          added.push(id);
        }
        notes.push(`added ${added.length} more ${last.kind}${added.length === 1 ? '' : 's'} so ${value} can be collected`);
      }
      return outcome({ summary: `set the goal to ${value} (was ${old})`, cosmetic: false, added, notes, targets: [] });
    }
    case 'jumpHeight': {
      const f = cmd.factor ?? 1.4;
      env.draft.player((p) => {
        p['jumpSpeed'] = r2(clamp((p['jumpSpeed'] as number) * f, 1, 30));
      });
      const ctl = world.player.controls ? env.index.get(world.player.controls) : undefined;
      if (ctl) {
        const ent = env.draft.entity(ctl.id);
        ent.behaviors = ent.behaviors.map((b) => (b.type === 'playerController' ? { ...b, params: { ...b.params, jump: r2(clamp((typeof b.params['jump'] === 'number' ? (b.params['jump'] as number) : 6) * f, 1, 40)) } } : b));
      }
      return outcome({ summary: `${f >= 1 ? 'raised' : 'lowered'} the jump`, targets: ctl ? [ctl.id] : [], cosmetic: false });
    }
    case 'playerSpeed': {
      return planSpeed(env, { op: 'speed', ref: { text: 'player', noun: 'player', adjectives: [] }, factor: cmd.factor ?? 1.4 });
    }
    case 'cameraMode': {
      const mode = cmd.label === 'first-person' ? 'firstPerson' : cmd.label === 'third-person' ? 'thirdPerson' : (cmd.label ?? 'orbit');
      env.draft.player((p) => {
        p['mode'] = mode;
      });
      return outcome({ summary: `switched to ${cmd.label ?? mode} view`, cosmetic: true });
    }
    case 'difficulty': {
      const f = cmd.factor ?? 1.35;
      const targets: EntityId[] = [];
      for (const it of env.index.items) {
        if (!hostile(it)) continue;
        const ent = env.draft.entity(it.id);
        ent.behaviors = ent.behaviors.map((b) => {
          const sp = SPEED_PARAM[b.type];
          if (!sp || b.type === 'playerController') return b;
          const old = typeof b.params[sp.key] === 'number' ? (b.params[sp.key] as number) : sp.default;
          return { ...b, params: { ...b.params, [sp.key]: r2(old * f) } };
        });
        targets.push(it.id);
      }
      const keys = timeKeys(env);
      for (const k of keys) {
        const old = world.state[k] as number;
        const next = Math.max(5, Math.round(old / f));
        retime(env, k, old, next);
      }
      if (targets.length === 0 && keys.length === 0) return failed('There is nothing here I can make harder: no enemies or time limit');
      return outcome({ summary: `${f >= 1 ? 'made the game harder' : 'made the game easier'}: ${targets.length} opponent${targets.length === 1 ? '' : 's'} ${f >= 1 ? 'faster' : 'slower'}${keys.length ? `, time limit ${f >= 1 ? 'shorter' : 'longer'}` : ''}`, targets, cosmetic: false });
    }
    case 'lives':
    case 'cameraFov':
      return failed('That setting does not exist in this world yet');
  }
}

/** A unique id derived from a base. */
export function uniqueEntityId(env: OpEnv, base: string, pending: readonly EntityId[] = []): EntityId {
  const slug = base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52) || 'item';
  const taken = (id: string): boolean => Object.hasOwn(env.draft.world.entities, id) || pending.includes(id);
  // A family that is already numbered ("tent-1", "tent-2") continues its numbering.
  const family = new RegExp(`^${slug.replace(/[^a-z0-9_-]/g, '')}-(\\d+)$`);
  let top = 0;
  for (const id of [...Object.keys(env.draft.world.entities), ...pending]) {
    const m = family.exec(id);
    if (m) top = Math.max(top, Number(m[1]));
  }
  if (top > 0) return `${slug}-${top + 1}`;
  if (!taken(slug)) return slug;
  for (let n = 2; n < 10_000; n++) {
    const id = `${slug}-${n}`;
    if (!taken(id)) return id;
  }
  return `${slug}-${Date.now() % 100000}`;
}

export { colorName, hexToRgb, rgbToHex, setPath };
