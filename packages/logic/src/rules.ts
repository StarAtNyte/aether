/**
 * Rules engine: evaluates world-level "when / if / then" rules.
 *
 * Triggers are indexed by kind so each tick only touches relevant rules.
 * Safety rails: at most {@link MAX_FIRINGS_PER_TICK} firings per tick, emit
 * chains deeper than {@link MAX_EMIT_DEPTH} are dropped, the delayed event
 * queue is bounded, and action errors are logged instead of thrown.
 */
import { compare, stableStringify, type EntityId, type Json, type Rule, type Trigger } from '@aether/core';
import { executeAction, type ActionContext, type ActionEnv } from './actions';
import { normalizeKey } from './keys';
import type { LogEntry, PhysicsEventLike } from './types';
import { fmt } from './vec';

/** Max rule firings per tick. */
export const MAX_FIRINGS_PER_TICK = 64;
/** Max depth of synchronous emit → event → emit chains. */
export const MAX_EMIT_DEPTH = 8;
/** Max pending delayed events. */
export const MAX_EVENT_QUEUE = 256;
/** Max zone/who pairs checked per tick for enter/exit rules. */
export const MAX_ZONE_PAIRS_PER_TICK = 4_000;
/** Max catch-up firings of one `tick` rule per tick. */
const MAX_TICK_CATCHUP = 4;

/** Services the rules engine needs from the runtime. */
export interface RuleHost extends ActionEnv {
  readonly time: number;
  playing(): boolean;
  readState(key: string): Json | undefined;
  matches(id: EntityId, selector: string): boolean;
  /** Zone containment by id (physics contact or geometry). */
  inZone(zoneId: EntityId, whoId: EntityId): boolean;
    log(text: string, rule?: string): LogEntry;
}

interface RuleRt {
  rule: Rule;
  key: string;
  doneOnce: boolean;
  acc: number;
  timerFired: boolean;
  stateWas: boolean;
  /** enter/exit: pair key → generation stamp; fallBelow: id → generation stamp. */
  inside: Map<string, number>;
}

interface QueuedEvent {
  due: number;
  seq: number;
  name: string;
}

/** One-line description of a trigger (for logs, docs and UI). */
export function describeTrigger(t: Trigger): string {
  switch (t.on) {
    case 'start': return 'start';
    case 'tick': return `every ${fmt(t.every)}s`;
    case 'timer': return `timer at ${fmt(t.at)}s`;
    case 'collision': return `collision ${t.a} × ${t.b}`;
    case 'enter': return `${t.who} enters ${t.zone}`;
    case 'exit': return `${t.who} exits ${t.zone}`;
    case 'key': return `key '${t.key}'`;
    case 'click': return `click ${t.target}`;
    case 'state': return `${t.key} ${t.op} ${JSON.stringify(t.value)}`;
    case 'event': return `event '${t.name}'`;
    case 'fallBelow': return `${t.target} below y=${fmt(t.y)}`;
  }
}

/** Rule evaluation state machine. One instance per runtime. */
export class RuleEngine {
  private rules: RuleRt[] = [];
  private byKind = new Map<Trigger['on'], RuleRt[]>();
  private byKey = new Map<string, RuleRt[]>();
  private byEvent = new Map<string, RuleRt[]>();
  private queue: QueuedEvent[] = [];
  private seq = 0;
  private firings = 0;
  private capWarned = false;
  private generation = 0;
  private pairBudget = 0;

  constructor(private readonly host: RuleHost) {}

  /** (Re)load rules. Runtime state of unchanged rules (same id and definition) is preserved. */
  load(rules: readonly Rule[]): void {
    const previous = new Map<string, RuleRt>();
    for (const rr of this.rules) previous.set(rr.rule.id, rr);
    this.rules = [];
    this.byKind.clear();
    this.byKey.clear();
    this.byEvent.clear();
    const seen = new Set<string>();
    for (const rule of rules) {
      if (seen.has(rule.id)) continue; // duplicate ids: first wins
      seen.add(rule.id);
      const key = stableStringify(rule);
      const old = previous.get(rule.id);
      const rr: RuleRt =
        old && old.key === key
          ? old
          : { rule, key, doneOnce: false, acc: 0, timerFired: false, stateWas: false, inside: new Map() };
      this.rules.push(rr);
      const kind = rule.when.on;
      let list = this.byKind.get(kind);
      if (!list) this.byKind.set(kind, (list = []));
      list.push(rr);
      if (rule.when.on === 'key') pushTo(this.byKey, normalizeKey(rule.when.key), rr);
      if (rule.when.on === 'event') pushTo(this.byEvent, rule.when.name, rr);
    }
  }

  /** Forget all runtime state (once flags, timers, queues) — used by reset. */
  resetState(): void {
    for (const rr of this.rules) {
      rr.doneOnce = false;
      rr.acc = 0;
      rr.timerFired = false;
      rr.stateWas = false;
      rr.inside.clear();
    }
    this.queue = [];
  }

  /** Start of a tick: reset per-tick budgets. */
  beginTick(): void {
    this.firings = 0;
    this.capWarned = false;
    this.generation++;
    this.pairBudget = MAX_ZONE_PAIRS_PER_TICK;
  }

  private kind(on: Trigger['on']): readonly RuleRt[] {
    return this.byKind.get(on) ?? EMPTY;
  }

  /** Fire every 'start' rule. */
  fireStart(): void {
    for (const rr of this.kind('start')) this.fire(rr, 'world started', 0);
  }

  /** Advance 'tick' accumulators and 'timer' rules. Call after time has advanced by `dt`. */
  timers(dt: number): void {
    for (const rr of this.kind('tick')) {
      const w = rr.rule.when;
      if (w.on !== 'tick') continue;
      const every = Math.max(w.every, 1e-3);
      rr.acc += dt;
      let n = 0;
      while (rr.acc + 1e-9 >= every) {
        rr.acc -= every;
        if (n++ < MAX_TICK_CATCHUP) this.fire(rr, `every ${fmt(every)}s (t=${fmt(this.host.time)})`, 0);
      }
    }
    for (const rr of this.kind('timer')) {
      const w = rr.rule.when;
      if (w.on !== 'timer' || rr.timerFired || this.host.time + 1e-9 < w.at) continue;
      rr.timerFired = true;
      this.fire(rr, `timer reached ${fmt(w.at)}s`, 0);
    }
  }

  /** 'key' rules for keys that went down this tick. */
  keys(pressed: ReadonlySet<string>): void {
    if (pressed.size === 0 || this.byKey.size === 0) return;
    for (const k of pressed) {
      const list = this.byKey.get(k);
      if (!list) continue;
      for (const rr of list) this.fire(rr, `key '${k}' pressed`, 0);
    }
  }

  /** 'click' rules. */
  click(id: EntityId): void {
    for (const rr of this.kind('click')) {
      const w = rr.rule.when;
      if (w.on === 'click' && this.host.matches(id, w.target)) this.fire(rr, `clicked ${id}`, 0);
    }
  }

  /** 'collision' rules from physics events. */
  collisions(events: readonly PhysicsEventLike[]): void {
    const list = this.kind('collision');
    if (list.length === 0) return;
    for (const ev of events) {
      if (ev.type !== 'collisionStart') continue;
      const impulse = typeof ev.impulse === 'number' && Number.isFinite(ev.impulse) ? ev.impulse : 0;
      for (const rr of list) {
        const w = rr.rule.when;
        if (w.on !== 'collision' || impulse < w.minImpulse) continue;
        const h = this.host;
        let first: EntityId | undefined;
        let second: EntityId | undefined;
        if (h.matches(ev.a, w.a) && h.matches(ev.b, w.b)) {
          first = ev.a;
          second = ev.b;
        } else if (h.matches(ev.b, w.a) && h.matches(ev.a, w.b)) {
          first = ev.b;
          second = ev.a;
        }
        if (first === undefined || second === undefined) continue;
        const imp = impulse > 0 ? ` (impulse ${fmt(impulse)})` : '';
        this.fire(rr, `${first} hit ${second}${imp}`, 0);
      }
    }
  }

  /** 'enter' / 'exit' rules (sensor contacts or geometric containment). */
  zones(): void {
    this.zoneKind('enter');
    this.zoneKind('exit');
  }

  private zoneKind(kind: 'enter' | 'exit'): void {
    const gen = this.generation;
    for (const rr of this.kind(kind)) {
      const w = rr.rule.when;
      if (w.on !== 'enter' && w.on !== 'exit') continue;
      const zones = this.host.select(w.zone);
      const whos = this.host.select(w.who);
      for (const z of zones) {
        for (const who of whos) {
          if (who === z) continue;
          if (--this.pairBudget < 0) {
            if (this.pairBudget === -1) this.host.log(`zone checks capped at ${MAX_ZONE_PAIRS_PER_TICK} pairs this tick`);
            return;
          }
          if (!this.host.inZone(z, who)) continue;
          const key = `${z}\u0000${who}`;
          const had = rr.inside.has(key);
          rr.inside.set(key, gen);
          if (!had && kind === 'enter') this.fire(rr, `${who} entered ${z}`, 0);
        }
      }
      for (const [key, stamp] of rr.inside) {
        if (stamp === gen) continue;
        rr.inside.delete(key);
        if (kind === 'exit') {
          const sep = key.indexOf('\u0000');
          this.fire(rr, `${key.slice(sep + 1)} left ${key.slice(0, sep)}`, 0);
        }
      }
    }
  }

  /** 'fallBelow' rules (edge-triggered per target; re-armed when it rises above again). */
  falls(): void {
    const gen = this.generation;
    for (const rr of this.kind('fallBelow')) {
      const w = rr.rule.when;
      if (w.on !== 'fallBelow') continue;
      for (const id of this.host.select(w.target)) {
        const p = this.host.positionOf(id);
        if (!p || !(p[1] < w.y)) continue;
        const had = rr.inside.has(id);
        rr.inside.set(id, gen);
        if (!had) this.fire(rr, `${id} fell below y=${fmt(w.y)} (y=${fmt(p[1])})`, 0);
      }
      for (const [id, stamp] of rr.inside) if (stamp !== gen) rr.inside.delete(id);
    }
  }

  /** 'state' rules: fire when the condition goes from false to true. */
  states(): void {
    for (const rr of this.kind('state')) {
      const w = rr.rule.when;
      if (w.on !== 'state') continue;
      const v = this.host.readState(w.key);
      const now = compare(v, w.op, w.value);
      const was = rr.stateWas;
      rr.stateWas = now;
      if (now && !was) this.fire(rr, `${w.key} ${w.op} ${JSON.stringify(w.value)} (now ${JSON.stringify(v ?? null)})`, 0);
    }
  }

  /** Queue or synchronously dispatch an event. */
  emit(name: string, delay: number, ctx: ActionContext): void {
    if (!(delay > 0)) {
      this.dispatch(name, ctx.depth + 1);
      return;
    }
    if (this.queue.length >= MAX_EVENT_QUEUE) {
      this.host.log(`event '${name}' dropped: event queue is full (${MAX_EVENT_QUEUE})`);
      return;
    }
    this.queue.push({ due: this.host.time + delay, seq: this.seq++, name });
  }

  /** Dispatch delayed events whose time has come (in due order). */
  processDue(): void {
    if (this.queue.length === 0) return;
    const t = this.host.time + 1e-9;
    const due: QueuedEvent[] = [];
    const keep: QueuedEvent[] = [];
    for (const q of this.queue) (q.due <= t ? due : keep).push(q);
    if (due.length === 0) return;
    this.queue = keep;
    due.sort((a, b) => a.due - b.due || a.seq - b.seq);
    for (const q of due) this.dispatch(q.name, 0);
  }

  /** Fire 'event' rules listening for `name`. */
  dispatch(name: string, depth: number): void {
    if (depth > MAX_EMIT_DEPTH) {
      this.host.log(`event '${name}' dropped: emit chain deeper than ${MAX_EMIT_DEPTH}`);
      return;
    }
    const list = this.byEvent.get(name);
    if (!list) return;
    for (const rr of list.slice()) this.fire(rr, `event '${name}'`, depth);
  }

  private fire(rr: RuleRt, why: string, depth: number): void {
    const rule = rr.rule;
    if (!rule.enabled || (rule.once && rr.doneOnce) || !this.host.playing()) return;
    for (const c of rule.if) if (!compare(this.host.readState(c.key), c.op, c.value)) return;
    if (this.firings >= MAX_FIRINGS_PER_TICK) {
      if (!this.capWarned) {
        this.capWarned = true;
        this.host.log(`rule '${rule.id}' skipped: more than ${MAX_FIRINGS_PER_TICK} rule firings this tick`, rule.id);
      }
      return;
    }
    this.firings++;
    if (rule.once) rr.doneOnce = true;
    const entry = this.host.log(`rule '${rule.id}' fired: ${why}`, rule.id);
    const effects: string[] = [];
    const ctx: ActionContext = { depth };
    for (const action of rule.then) {
      try {
        const d = executeAction(action, this.host, ctx);
        if (d) effects.push(d);
      } catch (err) {
        effects.push(`error in ${action.do}: ${errorText(err)}`);
      }
    }
    if (effects.length > 0) entry.text += ` → ${effects.join('; ')}`;
  }
}

const EMPTY: readonly RuleRt[] = Object.freeze([]) as readonly RuleRt[];

function pushTo<K, V>(map: Map<K, V[]>, key: K, v: V): void {
  const list = map.get(key);
  if (list) list.push(v);
  else map.set(key, [v]);
}

/** Message of an unknown thrown value. */
export function errorText(err: unknown): string {
  const s = err instanceof Error ? err.message : String(err);
  return s.length > 200 ? `${s.slice(0, 197)}...` : s;
}
