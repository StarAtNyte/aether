/**
 * Human-readable formatting of world rules and tests for the Logic panel
 * ("WHEN player enters coin → ADD score +1, DESTROY coin"). Pure functions.
 */
import type { Action, Condition, Json, Rule, Trigger, Vec3, WorldTest } from '@aether/core';

/** A rule rendered as readable phrases. */
export interface RuleCard {
  id: string;
  description: string | undefined;
  /** Trigger phrase, e.g. "player enters coin". */
  when: string;
  /** Condition phrases, e.g. "score ≥ 10". */
  conditions: string[];
  /** Action phrases, e.g. "ADD score +1". */
  actions: string[];
  once: boolean;
  enabled: boolean;
}

const OP_SYMBOL: Record<Condition['op'], string> = { '==': '=', '!=': '≠', '>': '>', '<': '<', '>=': '≥', '<=': '≤' };
const MAX_VALUE_CHARS = 48;

/** Compact, single-line rendering of any JSON value. */
export function formatValue(v: Json | undefined): string {
  if (v === undefined) return '∅';
  if (typeof v === 'string') return v.length > MAX_VALUE_CHARS ? `"${v.slice(0, MAX_VALUE_CHARS - 1)}…"` : `"${v}"`;
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean' || v === null) return String(v);
  let s: string;
  try {
    s = JSON.stringify(v);
  } catch {
    s = '…';
  }
  return s.length > MAX_VALUE_CHARS ? `${s.slice(0, MAX_VALUE_CHARS - 1)}…` : s;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

function formatVec(v: Vec3): string {
  return `(${v.map(formatNumber).join(', ')})`;
}

function formatPlace(p: Vec3 | string | undefined): string {
  if (p === undefined) return 'its origin';
  return typeof p === 'string' ? p : formatVec(p);
}

/** Readable selector: "#coin" → "any #coin", "*" → "anything". */
export function formatSelector(s: string): string {
  if (s === '*') return 'anything';
  if (s.startsWith('#')) return `any ${s}`;
  return s;
}

/** Trigger → phrase. */
export function formatTrigger(t: Trigger): string {
  switch (t.on) {
    case 'start':
      return 'game starts';
    case 'tick':
      return `every ${formatNumber(t.every)}s`;
    case 'timer':
      return `${formatNumber(t.at)}s have passed`;
    case 'collision':
      return `${formatSelector(t.a)} hits ${formatSelector(t.b)}${t.minImpulse > 0 ? ` (impulse ≥ ${formatNumber(t.minImpulse)})` : ''}`;
    case 'enter':
      return `${formatSelector(t.who)} enters ${formatSelector(t.zone)}`;
    case 'exit':
      return `${formatSelector(t.who)} leaves ${formatSelector(t.zone)}`;
    case 'key':
      return `key "${t.key}" pressed`;
    case 'click':
      return `${formatSelector(t.target)} is clicked`;
    case 'state':
      return `${t.key} ${OP_SYMBOL[t.op]} ${formatValue(t.value)}`;
    case 'event':
      return `event "${t.name}"`;
    case 'fallBelow':
      return `${formatSelector(t.target)} falls below y ${formatNumber(t.y)}`;
  }
}

/** Condition → phrase. */
export function formatCondition(c: Condition): string {
  return `${c.key} ${OP_SYMBOL[c.op]} ${formatValue(c.value)}`;
}

/** Action → phrase (verb in caps). */
export function formatAction(a: Action): string {
  switch (a.do) {
    case 'set':
      return `SET ${a.key} = ${formatValue(a.value)}`;
    case 'add':
      return `ADD ${a.key} ${a.amount >= 0 ? '+' : ''}${formatNumber(a.amount)}`;
    case 'spawn':
      return `SPAWN ${a.count > 1 ? `${a.count}× ` : ''}${a.template} at ${formatPlace(a.at)}`;
    case 'destroy':
      return `DESTROY ${formatSelector(a.target)}`;
    case 'impulse':
      return `PUSH ${formatSelector(a.target)} ${formatVec(a.vector)}`;
    case 'setVelocity':
      return `VELOCITY ${formatSelector(a.target)} ${formatVec(a.vector)}`;
    case 'teleport':
      return `TELEPORT ${formatSelector(a.target)} → ${formatPlace(a.to)}`;
    case 'setProperty':
      return `SET ${formatSelector(a.target)}.${a.path} = ${formatValue(a.value)}`;
    case 'enableBehavior':
      return `${a.enabled ? 'ENABLE' : 'DISABLE'} ${a.behavior} on ${formatSelector(a.target)}`;
    case 'explode':
      return `EXPLODE at ${formatPlace(a.at)} (force ${formatNumber(a.force)}, r ${formatNumber(a.radius)})`;
    case 'setGravity':
      return `GRAVITY ${formatVec(a.vector)}`;
    case 'emit':
      return `EMIT "${a.event}"${a.delay > 0 ? ` after ${formatNumber(a.delay)}s` : ''}`;
    case 'message':
      return `SAY "${a.text.length > MAX_VALUE_CHARS ? `${a.text.slice(0, MAX_VALUE_CHARS - 1)}…` : a.text}"`;
    case 'sound':
      return `SOUND ${a.sound}`;
    case 'win':
      return `WIN "${a.text}"`;
    case 'lose':
      return `LOSE "${a.text}"`;
    case 'reset':
      return 'RESET';
    case 'effect':
      return `EFFECT ${a.vfx}${a.feel ? ` (${a.feel})` : ''}${a.at !== undefined ? ` at ${formatPlace(a.at)}` : ''}`;
  }
}

/** Rule → card data. */
export function formatRule(rule: Rule): RuleCard {
  return {
    id: rule.id,
    description: rule.description,
    when: formatTrigger(rule.when),
    conditions: rule.if.map(formatCondition),
    actions: rule.then.map(formatAction),
    once: rule.once,
    enabled: rule.enabled,
  };
}

/** One-line rule sentence: "WHEN player enters coin → ADD score +1, DESTROY coin". */
export function ruleSentence(rule: Rule): string {
  const c = formatRule(rule);
  const cond = c.conditions.length > 0 ? ` IF ${c.conditions.join(' AND ')}` : '';
  return `WHEN ${c.when}${cond} → ${c.actions.join(', ')}`;
}

function zoneText(zone: string | { center: Vec3; radius: number }): string {
  return typeof zone === 'string' ? formatSelector(zone) : `${formatNumber(zone.radius)}m around ${formatVec(zone.center)}`;
}

/** Verification test → readable expectation. */
export function formatTest(t: WorldTest): string {
  switch (t.kind) {
    case 'stable':
      return `${formatSelector(t.target)} stays put for ${formatNumber(t.seconds)}s (drift ≤ ${formatNumber(t.maxDrift)}m)`;
    case 'noOverlap':
      return `${formatSelector(t.target)} starts without overlaps`;
    case 'reaches':
      return `${formatSelector(t.target)} reaches ${zoneText(t.zone)} within ${formatNumber(t.within)}s`;
    case 'eventually':
      return `${formatCondition(t.condition)} within ${formatNumber(t.within)}s`;
    case 'moves':
      return `${formatSelector(t.target)} moves ≥ ${formatNumber(t.distance)}m within ${formatNumber(t.within)}s`;
    case 'topples':
      return `${formatSelector(t.target)} tips over ${formatNumber(t.degrees)}° within ${formatNumber(t.within)}s`;
    case 'staysAbove':
      return `${formatSelector(t.target)} stays above y ${formatNumber(t.y)} for ${formatNumber(t.within)}s`;
    case 'navigable':
      return `${formatSelector(t.target)}: every room reachable on foot, doors open freely (walkways ≥ ${formatNumber(t.clearance)}m)`;
    case 'npcs':
      return `${formatSelector(t.target)}: characters stand on walkable floor, reach their patrol points and never get stuck (${formatNumber(t.seconds)}s)`;
  }
}
