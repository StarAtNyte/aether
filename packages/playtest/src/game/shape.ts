/**
 * The game shape of a world, read from its data: is it a game (win/lose rules, waves, enemies of the player, a player
 * weapon), which state keys it keeps (health, ammunition, score, wave), how its waves are made (which rule spawns how
 * many of which template, followed through the events the wave rule emits), its hostile templates and the things the
 * player must keep alive. The game checks (flow and balance) measure against it and name real params in their fixes.
 */
import type { Entity, Json, Rule, WorldDoc } from '@aether/core';

/** One spawn of a wave: `count` of `template` from action `action` of rule `rule`. */
export interface WaveSpawn {
  rule: string;
  action: number;
  template: string;
  count: number;
  /** The `add` right after the spawn that counts what it spawned ("alive"), when there is one. */
  counter?: { action: number; key: string; amount: number };
}

export interface GameShape {
  /** It is a game: one of the reasons below holds. */
  isGame: boolean;
  reasons: string[];
  hasWeapon: boolean;
  /** State keys of the player's gun (null without one). */
  ammoKey: string | null;
  reserveKey: string | null;
  /** The key that counts waves (null: no waves). */
  waveKey: string | null;
  /** Number of waves (the largest wave number a rule tests for). */
  waves: number;
  /** Spawns of each wave (1-based), through the events the wave's rules emit. */
  waveSpawns: Map<number, WaveSpawn[]>;
  /** Templates and placed NPCs that attack the player. */
  hostiles: string[];
  /** Placed NPCs on the player's side that can be destroyed (a relay, a base, a friend to escort). */
  objectives: string[];
  /** Ways the game can be won / lost, as short labels (rule ids, behaviors, NPC attacks). */
  winPaths: string[];
  losePaths: string[];
  /** Pickups that restore health or ammunition: entity id, the key they add to and the amount. */
  pickups: Array<{ id: string; key: string; value: number; template: boolean }>;
  /** Highest player health (a cap rule's value, else the declared start health, else 100). */
  maxHealth: number;
}

type Action = Rule['then'][number];

const num = (v: Json | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Every action of a rule, with its index. */
function actions(rule: Rule): Array<[Action, number]> {
  return rule.then.map((a, i) => [a, i]);
}

/** A key that counts waves ("wave", "round", "level-wave"). */
function waveKeyOf(world: WorldDoc): string | null {
  const keys = new Set<string>([...Object.keys(world.state), ...world.rules.flatMap((r) => r.if.map((c) => c.key))]);
  for (const k of keys) if (/(^|[-_.])(wave|round)s?($|[-_.])/i.test(k)) return k;
  return null;
}

/** Wave number a rule belongs to (`wave == N` in its conditions or its state trigger), or null. */
function waveOfRule(rule: Rule, key: string): number | null {
  for (const c of rule.if) if (c.key === key && (c.op === '==' || c.op === '>=') && num(c.value) !== null) return c.op === '==' ? (num(c.value) as number) : null;
  const w = rule.when;
  if (w.on === 'state' && w.key === key && w.op === '==' && num(w.value) !== null) return num(w.value);
  return null;
}

function hostile(e: Entity): boolean {
  return !!e.npc && e.npc.enemies.includes('player') && !(e.npc.allies ?? []).includes('player');
}

function collectible(e: Entity): { key: string; value: number } | null {
  for (const b of e.behaviors) {
    if (b.type !== 'collectible' || b.enabled === false) continue;
    const p = b.params as Record<string, Json>;
    const key = typeof p['scoreKey'] === 'string' ? p['scoreKey'] : 'score';
    const value = num(p['value']) ?? 1;
    return { key, value };
  }
  return null;
}

/** Read the game shape of `world`. */
export function gameShape(world: WorldDoc): GameShape {
  const reasons: string[] = [];
  const weapon = world.player.weapon;
  const ammoKey = weapon ? (weapon.ammoKey ?? 'ammo') : null;
  const reserveKey = weapon ? (weapon.reserveKey ?? 'reserve') : null;
  if (weapon) reasons.push('the player has a weapon');
  const winPaths: string[] = [];
  const losePaths: string[] = [];
  for (const r of world.rules) {
    if (r.enabled === false) continue;
    for (const [a] of actions(r)) {
      if (a.do === 'win') winPaths.push(`rule ${r.id}`);
      if (a.do === 'lose') losePaths.push(`rule ${r.id}`);
    }
  }
  const entities = Object.values(world.entities);
  const hostiles: string[] = [];
  const objectives: string[] = [];
  const pickups: GameShape['pickups'] = [];
  for (const e of entities) {
    for (const b of e.behaviors) {
      if (b.enabled === false) continue;
      if (b.type === 'goal') winPaths.push(`goal ${e.id}`);
      if (b.type === 'hazard') {
        const mode = (b.params as Record<string, Json>)['mode'];
        if (mode === undefined || mode === 'lose') losePaths.push(`hazard ${e.id}`);
      }
    }
    if (hostile(e)) {
      hostiles.push(e.id);
      if ((e.npc?.attack?.damage ?? 12) > 0 && !losePaths.includes('npc attacks')) losePaths.push('npc attacks');
    }
    if (e.npc && !e.template && (e.npc.allies ?? []).includes('player') && (e.tags.some((t) => /objective|defend|protect|escort/i.test(t)) || world.rules.some((r) => r.when.on === 'event' && r.when.name === `${e.id}-died` && r.then.some((a) => a.do === 'lose')))) objectives.push(e.id);
    const c = collectible(e);
    if (c && (c.key === 'health' || c.key === ammoKey || c.key === reserveKey)) pickups.push({ id: e.id, key: c.key, value: c.value, template: e.template === true });
  }
  for (const s of Object.values(world.scripts ?? {})) {
    const src = typeof s === 'string' ? s : JSON.stringify(s);
    if (/\bwin\s*\(/.test(src)) winPaths.push('script');
    if (/\blose\s*\(/.test(src)) losePaths.push('script');
  }
  if (winPaths.length > 0 || losePaths.some((p) => p !== 'npc attacks')) reasons.push('it has win or lose rules');
  if (hostiles.length > 0) reasons.push('NPCs attack the player');
  const waveKey = waveKeyOf(world);
  const waveSpawns = new Map<number, WaveSpawn[]>();
  let waves = 0;
  if (waveKey) {
    const byEvent = new Map<string, Rule[]>();
    for (const r of world.rules) if (r.when.on === 'event') byEvent.set(r.when.name, [...(byEvent.get(r.when.name) ?? []), r]);
    for (const r of world.rules) {
      const n = waveOfRule(r, waveKey);
      if (n === null || n < 1 || n > 100) continue;
      waves = Math.max(waves, n);
      const list = waveSpawns.get(n) ?? [];
      // The wave rule and the rules it sets off through `emit` (groups that arrive later in the same wave).
      const seen = new Set<string>();
      const queue: Rule[] = [r];
      while (queue.length > 0) {
        const q = queue.shift() as Rule;
        if (seen.has(q.id)) continue;
        seen.add(q.id);
        for (const [a, i] of actions(q)) {
          if (a.do === 'spawn') {
            const next = q.then[i + 1];
            const counter = next && next.do === 'add' && next.amount > 0 ? { action: i + 1, key: next.key, amount: next.amount } : undefined;
            list.push({ rule: q.id, action: i, template: a.template, count: a.count ?? 1, ...(counter ? { counter } : {}) });
          }
          // Not the rule that starts the next wave (it moves the wave key).
          if (a.do === 'emit') for (const next of byEvent.get(a.event) ?? []) if (waveOfRule(next, waveKey) === null && !next.then.some((x) => (x.do === 'add' || x.do === 'set') && x.key === waveKey)) queue.push(next);
        }
      }
      waveSpawns.set(n, list);
    }
    if (waves > 0) reasons.push(`it has ${waves} waves`);
  }
  let maxHealth = num(world.state['health']) ?? 100;
  for (const r of world.rules) {
    const w = r.when;
    if (w.on === 'state' && w.key === 'health' && (w.op === '>' || w.op === '>=')) {
      for (const [a] of actions(r)) if (a.do === 'set' && a.key === 'health' && num(a.value) !== null) maxHealth = num(a.value) as number;
    }
  }
  if (maxHealth <= 0) maxHealth = 100;
  return { isGame: reasons.length > 0, reasons, hasWeapon: !!weapon, ammoKey, reserveKey, waveKey: waves > 0 ? waveKey : null, waves, waveSpawns, hostiles, objectives, winPaths: [...new Set(winPaths)], losePaths: [...new Set(losePaths)], pickups, maxHealth };
}

/** True when `world` is a game (win/lose rules, waves, NPC enemies or a player weapon). */
export function isGameWorld(world: WorldDoc): boolean {
  return gameShape(world).isGame;
}

/** The template a spawned id was made from (`raider-n-3` → `raider-n`), or the id itself. */
export function templateOf(world: WorldDoc, id: string): string {
  const m = /^(.*)-\d+$/.exec(id);
  if (m && m[1] && world.entities[m[1]]?.template) return m[1];
  return id;
}
