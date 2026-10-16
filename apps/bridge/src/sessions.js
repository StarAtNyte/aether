/**
 * Resumable conversations per project: the Codex thread id or Claude Code
 * session id of the latest conversation for a session key, the hash of its
 * system prompt and the conversation body already sent. A follow-up call
 * whose body extends the stored one sends only the new part.
 *
 * Bounded (LRU + time to live), in memory only, and cleared per project when
 * the studio deletes the project. Runs stay read-only / tool-less: resuming a
 * conversation changes nothing about the lockdown.
 */
import { createHash } from 'node:crypto';
/** Most conversations remembered. */
export const MAX_SESSIONS = 64;
/** Forget a conversation after this long without use (ms): 6 hours. */
export const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
/** Bodies longer than this are not resumed (bounded memory). */
export const MAX_SESSION_BODY = 512 * 1024;
/** Session keys: `<project>` (from the studio) plus backend and model. */
export const SESSION_KEY_RE = /^[a-z0-9][a-z0-9-]{7,79}$/;
/** sha256 hex of a string. */
export function sha256(s) {
    return createHash('sha256').update(s).digest('hex');
}
/** In-memory LRU of conversations. */
export class SessionStore {
    onEvict;
    now;
    map = new Map();
    constructor(onEvict = () => undefined, now = Date.now) {
        this.onEvict = onEvict;
        this.now = now;
    }
    key(project, backend, model) {
        return `${project}|${backend}|${model ?? 'default'}`;
    }
    sweep() {
        const t = this.now();
        for (const [k, e] of this.map) {
            if (t - e.used > SESSION_TTL_MS) {
                this.map.delete(k);
                this.onEvict(e);
            }
        }
        while (this.map.size > MAX_SESSIONS) {
            const oldest = this.map.keys().next();
            if (oldest.done)
                break;
            const e = this.map.get(oldest.value);
            this.map.delete(oldest.value);
            if (e)
                this.onEvict(e);
        }
    }
    /** Decide how to send `body` for a session: resume with the new part, or start over. */
    plan(project, backend, model, system, body) {
        this.sweep();
        const e = this.map.get(this.key(project, backend, model));
        if (!e || e.systemHash !== sha256(system) || !body.startsWith(e.body) || body.length > MAX_SESSION_BODY)
            return { resume: null };
        return { resume: e, delta: body.slice(e.body.length) };
    }
    /** The remembered conversation of a key, if any (no side effects). */
    peek(project, backend, model) {
        const e = this.map.get(this.key(project, backend, model));
        return e ? { ...e } : undefined;
    }
    /** The working directory a session should use (Claude Code), if one is remembered. */
    dirOf(project, backend, model) {
        return this.map.get(this.key(project, backend, model))?.dir;
    }
    /** Remember (or update) a conversation after a successful call. */
    record(project, backend, model, entry) {
        if (!SESSION_KEY_RE.test(project) || entry.body.length > MAX_SESSION_BODY)
            return;
        const k = this.key(project, backend, model);
        const prev = this.map.get(k);
        this.map.delete(k);
        if (prev && prev.dir && prev.dir !== entry.dir)
            this.onEvict(prev);
        this.map.set(k, { ...entry, used: this.now() });
        this.sweep();
    }
    /** Forget one conversation (e.g. a failed resume). */
    forget(project, backend, model) {
        const k = this.key(project, backend, model);
        const e = this.map.get(k);
        if (!e)
            return;
        this.map.delete(k);
        this.onEvict(e);
    }
    /** Forget every conversation of a project (the project was deleted). Returns how many. */
    clearProject(project) {
        let n = 0;
        for (const [k, e] of [...this.map]) {
            if (k.startsWith(`${project}|`)) {
                this.map.delete(k);
                this.onEvict(e);
                n++;
            }
        }
        return n;
    }
    /** Forget everything (shutdown). */
    clear() {
        for (const e of this.map.values())
            this.onEvict(e);
        this.map.clear();
    }
    /** Number of remembered conversations. */
    get size() {
        return this.map.size;
    }
}
