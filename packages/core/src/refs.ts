/**
 * Reference walking: every place where rules, tests and entities refer to
 * other entities. Used for selector validation and for `rename`, which must
 * rewrite references everywhere. Mappers preserve object identity when nothing
 * changes (structural sharing).
 */
import type { Entity, Rule, WorldTest } from './schema';

/** Callbacks invoked for each kind of reference; return the (possibly rewritten) value. */
export interface RefMapper {
  /** A selector ("id", "#tag", "player", "*"). */
  selector(s: string): string;
  /** A state key ("score" or "door-1.open"). */
  stateKey(k: string): string;
  /** A plain entity id (e.g. a spawn template). */
  entityId(id: string): string;
}

type Rec = Record<string, unknown>;

const TRIGGER_SELECTOR_FIELDS = ['a', 'b', 'zone', 'who', 'target'] as const;
const ACTION_SELECTOR_FIELDS = ['target', 'at', 'to'] as const;

function mapFields(obj: Rec, fields: readonly string[], fn: (s: string) => string): Rec {
  let out = obj;
  for (const f of fields) {
    const v = obj[f];
    if (typeof v !== 'string') continue;
    const nv = fn(v);
    if (nv !== v) {
      if (out === obj) out = { ...obj };
      out[f] = nv;
    }
  }
  return out;
}

function mapList<T>(list: readonly T[], fn: (item: T) => T): T[] {
  let out: T[] | undefined;
  for (let i = 0; i < list.length; i++) {
    const item = list[i] as T;
    const mapped = fn(item);
    if (mapped !== item) {
      out ??= list.slice();
      out[i] = mapped;
    }
  }
  return out ?? (list as T[]);
}

function mapCondition<T extends { key: string }>(c: T, m: RefMapper): T {
  const key = m.stateKey(c.key);
  return key === c.key ? c : { ...c, key };
}

/** Map every reference in a rule. Returns the same object when unchanged. */
export function mapRuleRefs(rule: Rule, m: RefMapper): Rule {
  let when = mapFields(rule.when as Rec, TRIGGER_SELECTOR_FIELDS, (s) => m.selector(s));
  if (when['on'] === 'state') when = mapFields(when, ['key'], (k) => m.stateKey(k));
  const conditions = mapList(rule.if, (c) => mapCondition(c, m));
  const actions = mapList(rule.then, (a) => {
    let out = mapFields(a as Rec, ACTION_SELECTOR_FIELDS, (s) => m.selector(s));
    if (a.do === 'set' || a.do === 'add') out = mapFields(out, ['key'], (k) => m.stateKey(k));
    if (a.do === 'spawn') out = mapFields(out, ['template'], (id) => m.entityId(id));
    return out as typeof a;
  });
  if (when === (rule.when as Rec) && conditions === rule.if && actions === rule.then) return rule;
  return { ...rule, when: when as Rule['when'], if: conditions, then: actions };
}

/** Map every reference in a verification test. Returns the same object when unchanged. */
export function mapTestRefs(test: WorldTest, m: RefMapper): WorldTest {
  let out = mapFields(test as Rec, ['target', 'zone'], (s) => m.selector(s)) as WorldTest;
  if (out.kind === 'eventually') {
    const condition = mapCondition(out.condition, m);
    if (condition !== out.condition) out = { ...out, condition };
  }
  return out;
}

/** Visit every selector of a rule (for validation). */
export function forEachRuleSelector(rule: Rule, fn: (s: string, where: string) => void): void {
  mapRuleRefs(rule, {
    selector: (s) => (fn(s, 'selector'), s),
    stateKey: (k) => k,
    entityId: (id) => (fn(id, 'template'), id),
  });
}

/** Visit every selector of a test (for validation). */
export function forEachTestSelector(test: WorldTest, fn: (s: string) => void): void {
  mapTestRefs(test, { selector: (s) => (fn(s), s), stateKey: (k) => k, entityId: (id) => id });
}

/**
 * Rewrite references from entity `from` to entity `to` inside one entity:
 * parent, joint target, scatter surface, architecture room / host wall, and behavior params whose value is
 * exactly the old id (or an array of strings containing it).
 */
export function renameEntityRefs(e: Entity, from: string, to: string): Entity {
  let out = e;
  if (e.parent === from) out = { ...out, parent: to };
  if (e.attachedTo === from) out = { ...out, attachedTo: to };
  if (e.joint && e.joint.target === from) out = { ...out, joint: { ...e.joint, target: to } };
  if (e.shape.kind === 'scatter' && e.shape.onSurface === from) out = { ...out, shape: { ...e.shape, onSurface: to } };
  if (e.arch && (e.arch.room === from || e.arch.wall === from)) {
    out = { ...out, arch: { ...e.arch, ...(e.arch.room === from ? { room: to } : {}), ...(e.arch.wall === from ? { wall: to } : {}) } };
  }
  const behaviors = mapList(e.behaviors, (b) => {
    let params = b.params;
    for (const [k, v] of Object.entries(b.params)) {
      let nv = v;
      if (v === from) nv = to;
      else if (Array.isArray(v) && v.includes(from)) nv = v.map((x) => (x === from ? to : x));
      if (nv !== v) {
        if (params === b.params) params = { ...b.params };
        params[k] = nv;
      }
    }
    return params === b.params ? b : { ...b, params };
  });
  if (behaviors !== e.behaviors) out = { ...out, behaviors };
  return out;
}

/** Mapper that renames entity `from` to `to` in selectors, state keys and ids. */
export function renameMapper(from: string, to: string): RefMapper {
  const prefix = `${from}.`;
  return {
    selector: (s) => (s === from ? to : s),
    stateKey: (k) => (k.startsWith(prefix) ? `${to}.${k.slice(prefix.length)}` : k),
    entityId: (id) => (id === from ? to : id),
  };
}
