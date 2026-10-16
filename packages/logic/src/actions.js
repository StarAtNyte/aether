/**
 * Execution of rule / script actions. Every action goes through the
 * {@link ActionEnv} (implemented by the runtime), and returns a short
 * human-readable description used in the "why" log.
 */
import { isForbiddenKey } from '@aether/core';
import { assertStorable } from './state';
import { fmt, fmtVec, isFiniteVec } from './vec';
/** Max entities a single action may affect (protects against "*" on huge worlds). */
export const MAX_TARGETS_PER_ACTION = 1000;
/** Property paths: dotted identifiers, at most 4 segments. */
const PROPERTY_PATH = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*){0,3}$/;
/** Max on-screen message length. */
const MAX_MESSAGE = 500;
function targets(env, selector, ctx) {
    if (selector === 'self' && ctx.selfId !== undefined)
        return [ctx.selfId];
    const ids = env.select(selector);
    return ids.length > MAX_TARGETS_PER_ACTION ? ids.slice(0, MAX_TARGETS_PER_ACTION) : ids;
}
/** Resolve a Vec3-or-selector location; selector → position of its first live match. */
export function locate(env, at, ctx) {
    if (typeof at !== 'string')
        return isFiniteVec(at) ? [at[0], at[1], at[2]] : undefined;
    const first = targets(env, at, ctx)[0];
    if (first === undefined)
        return undefined;
    const p = env.positionOf(first);
    return p ? [p[0], p[1], p[2]] : undefined;
}
function listIds(ids) {
    if (ids.length === 0)
        return 'nothing';
    if (ids.length <= 3)
        return ids.join(', ');
    return `${ids.slice(0, 3).join(', ')} +${ids.length - 3} more`;
}
function checkVec(v, what) {
    if (!isFiniteVec(v))
        throw new Error(`${what} must be finite numbers`);
}
/** Validate a property path for `setProperty` (identifier segments, no prototype keys). */
export function isSafePropertyPath(path) {
    if (!PROPERTY_PATH.test(path))
        return false;
    for (const seg of path.split('.'))
        if (isForbiddenKey(seg))
            return false;
    return true;
}
/**
 * Execute one action. Throws on invalid input (the caller logs it); returns a
 * description of the effect for the log.
 */
export function executeAction(action, env, ctx) {
    switch (action.do) {
        case 'set':
            return env.setState(action.key, action.value);
        case 'add':
            if (!Number.isFinite(action.amount))
                throw new Error('add amount must be finite');
            return env.addState(action.key, action.amount);
        case 'spawn': {
            const ids = env.spawn(action.template, action.at, action.count, action.spread, ctx);
            return `spawn ${action.template} → ${listIds(ids)}`;
        }
        case 'destroy': {
            const ids = targets(env, action.target, ctx);
            for (const id of ids)
                env.destroy(id);
            return `destroy ${listIds(ids)}`;
        }
        case 'impulse': {
            checkVec(action.vector, 'impulse vector');
            const ids = targets(env, action.target, ctx);
            for (const id of ids)
                env.impulse(id, action.vector);
            return `impulse ${fmtVec(action.vector)} on ${listIds(ids)}`;
        }
        case 'setVelocity': {
            checkVec(action.vector, 'velocity');
            const ids = targets(env, action.target, ctx);
            for (const id of ids)
                env.setVelocity(id, action.vector);
            return `velocity ${fmtVec(action.vector)} on ${listIds(ids)}`;
        }
        case 'teleport': {
            const to = locate(env, action.to, ctx);
            if (!to)
                return `teleport skipped: '${String(action.to)}' not found`;
            const ids = targets(env, action.target, ctx);
            for (const id of ids)
                env.teleport(id, to);
            return `teleport ${listIds(ids)} to ${fmtVec(to)}`;
        }
        case 'setProperty': {
            if (!isSafePropertyPath(action.path))
                throw new Error(`invalid property path '${action.path}'`);
            assertStorable(action.value);
            const ids = targets(env, action.target, ctx);
            for (const id of ids)
                env.setProperty(id, action.path, action.value);
            return `${action.path} = ${JSON.stringify(action.value).slice(0, 40)} on ${listIds(ids)}`;
        }
        case 'enableBehavior': {
            let n = 0;
            for (const id of targets(env, action.target, ctx))
                n += env.enableBehavior(id, action.behavior, action.enabled);
            return `${action.enabled ? 'enable' : 'disable'} ${action.behavior} (${n})`;
        }
        case 'explode': {
            const at = locate(env, action.at, ctx);
            if (!at)
                return `explode skipped: '${String(action.at)}' not found`;
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
    }
}
