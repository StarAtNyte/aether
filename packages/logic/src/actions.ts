/**
 * Execution of rule / script actions. Every action goes through the
 * {@link ActionEnv} (implemented by the runtime), and returns a short
 * human-readable description used in the "why" log.
 */
import { isForbiddenKey, type Action, type EntityId, type FeelEvent, type Json, type Vec3, type VfxPreset } from '@aether/core';
import { assertStorable } from './state';
import { fmt, fmtVec, isFiniteVec } from './vec';

/** Context of one action execution. */
export interface ActionContext {
  /** Emit-chain depth (0 for top-level triggers). */
  depth: number;
  /** Entity running a script: enables the script-only selector "self". */
  selfId?: EntityId;
}

/** What actions may do; implemented by the runtime. */
export interface ActionEnv {
  /** Resolve a selector to live ids (fresh array). */
  select(selector: string): EntityId[];
  positionOf(id: EntityId): Readonly<Vec3> | undefined;
  setState(key: string, value: Json): string;
  addState(key: string, amount: number): string;
  spawn(template: EntityId, at: Vec3 | string | undefined, count: number, spread: number, ctx: ActionContext): EntityId[];
  destroy(id: EntityId): void;
  impulse(id: EntityId, v: Readonly<Vec3>): void;
  setVelocity(id: EntityId, v: Readonly<Vec3>): void;
  teleport(id: EntityId, p: Readonly<Vec3>): void;
  setProperty(id: EntityId, path: string, value: Json): void;
  enableBehavior(id: EntityId, behavior: string, enabled: boolean): number;
  explode(center: Readonly<Vec3>, force: number, radius: number): void;
  setGravity(v: Readonly<Vec3>): void;
  emit(event: string, delay: number, ctx: ActionContext): void;
  message(text: string, duration: number): void;
  sound(name: string): void;
  gameOver(result: 'win' | 'lose', text: string, why: string): void;
  requestReset(): void;
  /** Visual-only burst / feel cue (see `LogicHost.feedback`). */
  effect(vfx: VfxPreset | 'none', at: Readonly<Vec3> | undefined, feel: FeelEvent | undefined, color: string | undefined, scale: number | undefined): void;
  /** The player's id, for effects without a place. */
  playerId(): EntityId | undefined;
}

/** Max entities a single action may affect (protects against "*" on huge worlds). */
export const MAX_TARGETS_PER_ACTION = 1000;
/** Property paths: dotted identifiers, at most 4 segments. */
const PROPERTY_PATH = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*){0,3}$/;
/** Max on-screen message length. */
const MAX_MESSAGE = 500;

function targets(env: ActionEnv, selector: string, ctx: ActionContext): readonly EntityId[] {
  if (selector === 'self' && ctx.selfId !== undefined) return [ctx.selfId];
  const ids = env.select(selector);
  return ids.length > MAX_TARGETS_PER_ACTION ? ids.slice(0, MAX_TARGETS_PER_ACTION) : ids;
}

/** Resolve a Vec3-or-selector location; selector → position of its first live match. */
export function locate(env: ActionEnv, at: Vec3 | string, ctx: ActionContext): Vec3 | undefined {
  if (typeof at !== 'string') return isFiniteVec(at) ? [at[0], at[1], at[2]] : undefined;
  const first = targets(env, at, ctx)[0];
  if (first === undefined) return undefined;
  const p = env.positionOf(first);
  return p ? [p[0], p[1], p[2]] : undefined;
}

function listIds(ids: readonly EntityId[]): string {
  if (ids.length === 0) return 'nothing';
  if (ids.length <= 3) return ids.join(', ');
  return `${ids.slice(0, 3).join(', ')} +${ids.length - 3} more`;
}

function checkVec(v: Readonly<Vec3>, what: string): void {
  if (!isFiniteVec(v)) throw new Error(`${what} must be finite numbers`);
}

/** Validate a property path for `setProperty` (identifier segments, no prototype keys). */
export function isSafePropertyPath(path: string): boolean {
  if (!PROPERTY_PATH.test(path)) return false;
  for (const seg of path.split('.')) if (isForbiddenKey(seg)) return false;
  return true;
}

/**
 * Execute one action. Throws on invalid input (the caller logs it); returns a
 * description of the effect for the log.
 */
export function executeAction(action: Action, env: ActionEnv, ctx: ActionContext): string {
  switch (action.do) {
    case 'set':
      return env.setState(action.key, action.value);
    case 'add':
      if (!Number.isFinite(action.amount)) throw new Error('add amount must be finite');
      return env.addState(action.key, action.amount);
    case 'spawn': {
      const ids = env.spawn(action.template, action.at, action.count, action.spread, ctx);
      return `spawn ${action.template} → ${listIds(ids)}`;
    }
    case 'destroy': {
      const ids = targets(env, action.target, ctx);
      for (const id of ids) env.destroy(id);
      return `destroy ${listIds(ids)}`;
    }
    case 'impulse': {
      checkVec(action.vector, 'impulse vector');
      const ids = targets(env, action.target, ctx);
      for (const id of ids) env.impulse(id, action.vector);
      return `impulse ${fmtVec(action.vector)} on ${listIds(ids)}`;
    }
    case 'setVelocity': {
      checkVec(action.vector, 'velocity');
      const ids = targets(env, action.target, ctx);
      for (const id of ids) env.setVelocity(id, action.vector);
      return `velocity ${fmtVec(action.vector)} on ${listIds(ids)}`;
    }
    case 'teleport': {
      const to = locate(env, action.to, ctx);
      if (!to) return `teleport skipped: '${String(action.to)}' not found`;
      const ids = targets(env, action.target, ctx);
      for (const id of ids) env.teleport(id, to);
      return `teleport ${listIds(ids)} to ${fmtVec(to)}`;
    }
    case 'setProperty': {
      if (!isSafePropertyPath(action.path)) throw new Error(`invalid property path '${action.path}'`);
      assertStorable(action.value);
      const ids = targets(env, action.target, ctx);
      for (const id of ids) env.setProperty(id, action.path, action.value);
      return `${action.path} = ${JSON.stringify(action.value).slice(0, 40)} on ${listIds(ids)}`;
    }
    case 'enableBehavior': {
      let n = 0;
      for (const id of targets(env, action.target, ctx)) n += env.enableBehavior(id, action.behavior, action.enabled);
      return `${action.enabled ? 'enable' : 'disable'} ${action.behavior} (${n})`;
    }
    case 'explode': {
      const at = locate(env, action.at, ctx);
      if (!at) return `explode skipped: '${String(action.at)}' not found`;
      env.explode(at, action.force, action.radius);
      return `explosion at ${fmtVec(at)} (force ${fmt(action.force)}, radius ${fmt(action.radius)})`;
    }
    case 'setGravity':
      checkVec(action.vector, 'gravity');
      env.setGravity(action.vector);
      return `gravity ${fmtVec(action.vector)}`;
    case 'emit':
      env.emit(action.event, action.delay, ctx);
      return action.delay > 0 ? `emit '${action.event}' in ${fmt(action.delay)}s` : `emit '${action.event}'`;
    case 'message': {
      const text = action.text.length > MAX_MESSAGE ? `${action.text.slice(0, MAX_MESSAGE)}…` : action.text;
      env.message(text, Math.min(action.duration, 60));
      return `message "${text.length > 40 ? `${text.slice(0, 37)}...` : text}"`;
    }
    case 'sound':
      env.sound(action.sound);
      return `sound ${action.sound}`;
    case 'win':
      env.gameOver('win', action.text, 'win action');
      return 'WIN';
    case 'lose':
      env.gameOver('lose', action.text, 'lose action');
      return 'LOSE';
    case 'reset':
      env.requestReset();
      return 'reset requested';
    case 'effect': {
      let at: Vec3 | undefined;
      if (action.at !== undefined) {
        at = locate(env, action.at, ctx);
        if (!at) return `effect skipped: '${String(action.at)}' not found`;
      } else {
        const who = ctx.selfId ?? env.playerId();
        const p = who !== undefined ? env.positionOf(who) : undefined;
        at = p ? [p[0], p[1], p[2]] : undefined;
      }
      env.effect(action.vfx, at, action.feel, action.color, action.scale);
      return `effect ${action.vfx}${action.feel ? ` (${action.feel})` : ''}${at ? ` at ${fmtVec(at)}` : ''}`;
    }
  }
}
