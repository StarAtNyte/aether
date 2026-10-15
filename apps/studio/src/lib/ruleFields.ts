/**
 * Field descriptors that drive the visual WHEN / IF / THEN rule editor and
 * the world-test editor: which inputs each trigger, action and test kind
 * has, sensible defaults when switching kinds, and parsing of typed values.
 * Pure (unit-tested); every edited rule / test is validated with the World
 * IR schema before it is committed.
 */
import { Action, Rule, Trigger, WorldTest, type Json } from '@aether/core';

/** Input kinds of the editor. */
export type FieldKind = 'number' | 'string' | 'selector' | 'entity' | 'vec3' | 'place' | 'value' | 'op' | 'bool' | 'enum';

/** One input of a trigger / action / test. */
export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  options?: readonly string[];
  optional?: boolean;
}

/** Trigger kinds with their fields. */
export const TRIGGER_FIELDS: Readonly<Record<Trigger['on'], readonly FieldDef[]>> = {
  start: [],
  tick: [{ key: 'every', label: 'Every (s)', kind: 'number' }],
  timer: [{ key: 'at', label: 'At (s)', kind: 'number' }],
  collision: [
    { key: 'a', label: 'Object', kind: 'selector' },
    { key: 'b', label: 'Touches', kind: 'selector' },
    { key: 'minImpulse', label: 'Min. impulse', kind: 'number' },
  ],
  enter: [
    { key: 'who', label: 'Who', kind: 'selector' },
    { key: 'zone', label: 'Enters', kind: 'selector' },
  ],
  exit: [
    { key: 'who', label: 'Who', kind: 'selector' },
    { key: 'zone', label: 'Leaves', kind: 'selector' },
  ],
  key: [{ key: 'key', label: 'Key', kind: 'string' }],
  click: [{ key: 'target', label: 'Object', kind: 'selector' }],
  state: [
    { key: 'key', label: 'Variable', kind: 'string' },
    { key: 'op', label: 'Is', kind: 'op' },
    { key: 'value', label: 'Value', kind: 'value' },
  ],
  event: [{ key: 'name', label: 'Event', kind: 'string' }],
  fallBelow: [
    { key: 'target', label: 'Object', kind: 'selector' },
    { key: 'y', label: 'Below y', kind: 'number' },
  ],
};

/** Human labels of trigger kinds. */
export const TRIGGER_LABELS: Readonly<Record<Trigger['on'], string>> = {
  start: 'the game starts',
  tick: 'every few seconds',
  timer: 'a timer runs out',
  collision: 'objects collide',
  enter: 'something enters a zone',
  exit: 'something leaves a zone',
  key: 'a key is pressed',
  click: 'an object is clicked',
  state: 'a variable changes',
  event: 'an event happens',
  fallBelow: 'something falls',
};

const SOUNDS = ['pickup', 'hit', 'explosion', 'win', 'lose', 'click', 'whoosh', 'bell'] as const;

/** Action kinds with their fields. */
export const ACTION_FIELDS: Readonly<Record<Action['do'], readonly FieldDef[]>> = {
  set: [
    { key: 'key', label: 'Variable', kind: 'string' },
    { key: 'value', label: 'To', kind: 'value' },
  ],
  add: [
    { key: 'key', label: 'Variable', kind: 'string' },
    { key: 'amount', label: 'Amount', kind: 'number' },
  ],
  spawn: [
    { key: 'template', label: 'Template', kind: 'entity' },
    { key: 'at', label: 'At', kind: 'place', optional: true },
    { key: 'count', label: 'Count', kind: 'number' },
    { key: 'spread', label: 'Spread', kind: 'number' },
  ],
  destroy: [{ key: 'target', label: 'Object', kind: 'selector' }],
  impulse: [
    { key: 'target', label: 'Object', kind: 'selector' },
    { key: 'vector', label: 'Push', kind: 'vec3' },
  ],
  setVelocity: [
    { key: 'target', label: 'Object', kind: 'selector' },
    { key: 'vector', label: 'Velocity', kind: 'vec3' },
  ],
  teleport: [
    { key: 'target', label: 'Object', kind: 'selector' },
    { key: 'to', label: 'To', kind: 'place' },
  ],
  setProperty: [
    { key: 'target', label: 'Object', kind: 'selector' },
    { key: 'path', label: 'Property', kind: 'string' },
    { key: 'value', label: 'To', kind: 'value' },
  ],
  enableBehavior: [
    { key: 'target', label: 'Object', kind: 'selector' },
    { key: 'behavior', label: 'Behaviour', kind: 'string' },
    { key: 'enabled', label: 'Enabled', kind: 'bool' },
  ],
  explode: [
    { key: 'at', label: 'At', kind: 'place' },
    { key: 'force', label: 'Force', kind: 'number' },
    { key: 'radius', label: 'Radius', kind: 'number' },
  ],
  setGravity: [{ key: 'vector', label: 'Gravity', kind: 'vec3' }],
  emit: [
    { key: 'event', label: 'Event', kind: 'string' },
    { key: 'delay', label: 'Delay (s)', kind: 'number' },
  ],
  message: [
    { key: 'text', label: 'Text', kind: 'string' },
    { key: 'duration', label: 'Seconds', kind: 'number' },
  ],
  sound: [{ key: 'sound', label: 'Sound', kind: 'enum', options: SOUNDS }],
  win: [{ key: 'text', label: 'Text', kind: 'string' }],
  lose: [{ key: 'text', label: 'Text', kind: 'string' }],
  reset: [],
};

/** Human labels of action kinds. */
export const ACTION_LABELS: Readonly<Record<Action['do'], string>> = {
  set: 'Set variable',
  add: 'Add to variable',
  spawn: 'Spawn copies',
  destroy: 'Destroy',
  impulse: 'Push',
  setVelocity: 'Set velocity',
  teleport: 'Teleport',
  setProperty: 'Change property',
  enableBehavior: 'Toggle behaviour',
  explode: 'Explode',
  setGravity: 'Set gravity',
  emit: 'Emit event',
  message: 'Show message',
  sound: 'Play sound',
  win: 'Win',
  lose: 'Lose',
  reset: 'Restart',
};

/** Test kinds with their fields. */
export const TEST_FIELDS: Readonly<Record<WorldTest['kind'], readonly FieldDef[]>> = {
  stable: [
    { key: 'target', label: 'Objects', kind: 'selector' },
    { key: 'seconds', label: 'For (s)', kind: 'number' },
    { key: 'maxDrift', label: 'Max drift (m)', kind: 'number' },
  ],
  noOverlap: [{ key: 'target', label: 'Objects', kind: 'selector' }],
  reaches: [
    { key: 'target', label: 'Object', kind: 'selector' },
    { key: 'zone', label: 'Reaches', kind: 'selector' },
    { key: 'within', label: 'Within (s)', kind: 'number' },
  ],
  eventually: [
    { key: 'condition.key', label: 'Variable', kind: 'string' },
    { key: 'condition.op', label: 'Is', kind: 'op' },
    { key: 'condition.value', label: 'Value', kind: 'value' },
    { key: 'within', label: 'Within (s)', kind: 'number' },
  ],
  moves: [
    { key: 'target', label: 'Object', kind: 'selector' },
    { key: 'distance', label: 'At least (m)', kind: 'number' },
    { key: 'within', label: 'Within (s)', kind: 'number' },
  ],
  topples: [
    { key: 'target', label: 'Object', kind: 'selector' },
    { key: 'degrees', label: 'Tilt (°)', kind: 'number' },
    { key: 'within', label: 'Within (s)', kind: 'number' },
  ],
  staysAbove: [
    { key: 'target', label: 'Object', kind: 'selector' },
    { key: 'y', label: 'Above y', kind: 'number' },
    { key: 'within', label: 'For (s)', kind: 'number' },
  ],
  navigable: [
    { key: 'target', label: 'Building', kind: 'selector' },
    { key: 'clearance', label: 'Walkway (m)', kind: 'number' },
  ],
  npcs: [
    { key: 'target', label: 'Characters', kind: 'selector' },
    { key: 'seconds', label: 'Watch (s)', kind: 'number' },
    { key: 'stuckAfter', label: 'Stuck after (s)', kind: 'number' },
  ],
};

/** Human labels of test kinds. */
export const TEST_LABELS: Readonly<Record<WorldTest['kind'], string>> = {
  stable: 'Stays stable',
  noOverlap: 'Nothing overlaps',
  reaches: 'Reaches a place',
  eventually: 'Variable becomes',
  moves: 'Moves',
  topples: 'Topples',
  staysAbove: 'Stays above',
  navigable: 'Building is walkable',
  npcs: 'Characters work',
};

/** Comparison operators. */
export const OPS = ['==', '!=', '>', '<', '>=', '<='] as const;

/** Parse a typed value: numbers, true/false/null, JSON arrays/objects, else the text itself. */
export function parseLiteral(text: string): Json {
  const t = text.trim();
  if (t === '') return '';
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(t)) return Number(t);
  if (t === 'true' || t === 'false') return t === 'true';
  if (t === 'null') return null;
  if ((t.startsWith('[') && t.endsWith(']')) || (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('"') && t.endsWith('"'))) {
    try {
      return JSON.parse(t) as Json;
    } catch {
      return t;
    }
  }
  return text;
}

/** Text shown for a typed value (strings unquoted). */
export function literalText(v: Json | undefined): string {
  if (v === undefined) return '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** Parse a place: "x, y, z" → Vec3, otherwise a selector. */
export function parsePlace(text: string): Json {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 3 && parts.every((p) => Number.isFinite(Number(p)))) return parts.map(Number);
  return text.trim();
}

/** Default trigger of a kind (placeholders the user edits). */
export function defaultTrigger(on: Trigger['on']): Trigger {
  const defaults: Record<Trigger['on'], unknown> = {
    start: { on: 'start' },
    tick: { on: 'tick', every: 1 },
    timer: { on: 'timer', at: 10 },
    collision: { on: 'collision', a: 'player', b: '*', minImpulse: 0 },
    enter: { on: 'enter', zone: 'goal', who: 'player' },
    exit: { on: 'exit', zone: 'zone', who: 'player' },
    key: { on: 'key', key: 'e' },
    click: { on: 'click', target: '*' },
    state: { on: 'state', key: 'score', op: '>=', value: 10 },
    event: { on: 'event', name: 'alarm' },
    fallBelow: { on: 'fallBelow', target: 'player', y: -5 },
  };
  return Trigger.parse(defaults[on]);
}

/** Default action of a kind. */
export function defaultAction(kind: Action['do']): Action {
  const defaults: Record<Action['do'], unknown> = {
    set: { do: 'set', key: 'flag', value: true },
    add: { do: 'add', key: 'score', amount: 1 },
    spawn: { do: 'spawn', template: 'template', count: 1 },
    destroy: { do: 'destroy', target: 'player' },
    impulse: { do: 'impulse', target: 'player', vector: [0, 5, 0] },
    setVelocity: { do: 'setVelocity', target: 'player', vector: [0, 0, 0] },
    teleport: { do: 'teleport', target: 'player', to: [0, 1, 0] },
    setProperty: { do: 'setProperty', target: 'player', path: 'visible', value: false },
    enableBehavior: { do: 'enableBehavior', target: 'player', behavior: 'spin', enabled: true },
    explode: { do: 'explode', at: [0, 0, 0] },
    setGravity: { do: 'setGravity', vector: [0, -9.81, 0] },
    emit: { do: 'emit', event: 'alarm' },
    message: { do: 'message', text: 'Hello!' },
    sound: { do: 'sound', sound: 'pickup' },
    win: { do: 'win' },
    lose: { do: 'lose' },
    reset: { do: 'reset' },
  };
  return Action.parse(defaults[kind]);
}

/** Default test of a kind. */
export function defaultTest(kind: WorldTest['kind'], id: string): WorldTest {
  const defaults: Record<WorldTest['kind'], unknown> = {
    stable: { id, kind: 'stable', target: '*' },
    noOverlap: { id, kind: 'noOverlap', target: '*' },
    reaches: { id, kind: 'reaches', target: 'player', zone: 'goal' },
    eventually: { id, kind: 'eventually', condition: { key: 'score', op: '>=', value: 1 } },
    moves: { id, kind: 'moves', target: 'ball' },
    topples: { id, kind: 'topples', target: '#domino' },
    staysAbove: { id, kind: 'staysAbove', target: 'player', y: -1 },
    navigable: { id, kind: 'navigable', target: '*' },
    npcs: { id, kind: 'npcs', target: '*' },
  };
  return WorldTest.parse(defaults[kind]);
}

/** Read a (possibly dotted, one level) field. */
export function getField(obj: Readonly<Record<string, unknown>>, key: string): unknown {
  const dot = key.indexOf('.');
  if (dot < 0) return obj[key];
  const inner = obj[key.slice(0, dot)];
  return typeof inner === 'object' && inner !== null ? (inner as Record<string, unknown>)[key.slice(dot + 1)] : undefined;
}

/** Copy with a (possibly dotted, one level) field set; `undefined` removes it. */
export function setField<T extends Record<string, unknown>>(obj: T, key: string, value: unknown): T {
  const dot = key.indexOf('.');
  if (dot < 0) {
    const next: Record<string, unknown> = { ...obj };
    if (value === undefined) delete next[key];
    else next[key] = value;
    return next as T;
  }
  const head = key.slice(0, dot);
  const inner = obj[head];
  const base = typeof inner === 'object' && inner !== null ? (inner as Record<string, unknown>) : {};
  return { ...obj, [head]: setField(base, key.slice(dot + 1), value) } as T;
}

/** Validate an edited rule; returns the parsed rule or a readable error. */
export function validateRule(value: unknown): { ok: true; rule: Rule } | { ok: false; error: string } {
  const r = Rule.safeParse(value);
  if (r.success) return { ok: true, rule: r.data };
  const issue = r.error.issues[0];
  return { ok: false, error: issue ? `${issue.path.join('.') || 'rule'}: ${issue.message}` : 'Invalid rule.' };
}

/** Validate an edited test; returns the parsed test or a readable error. */
export function validateTest(value: unknown): { ok: true; test: WorldTest } | { ok: false; error: string } {
  const r = WorldTest.safeParse(value);
  if (r.success) return { ok: true, test: r.data };
  const issue = r.error.issues[0];
  return { ok: false, error: issue ? `${issue.path.join('.') || 'test'}: ${issue.message}` : 'Invalid test.' };
}
