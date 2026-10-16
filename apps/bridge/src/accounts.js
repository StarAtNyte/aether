/**
 * Several Codex sign-ins on one machine: each extra account is its own
 * `CODEX_HOME` directory (mode 0700) that the Codex CLI fills during its
 * device sign-in. The registry (mode 0600) holds only `{id, label, home}`:
 * never tokens, and Aether never opens the files the CLI writes.
 *
 * The default account is the machine's own login (`$CODEX_HOME` or
 * `~/.codex`). Switching accounts is a manual choice, refused while jobs
 * run; there is no automatic rotation between accounts.
 */
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { runProcess } from './process';
import { restrictedEnv } from './sandbox';
/** Id of the machine's own login. */
export const DEFAULT_ACCOUNT_ID = 'default';
/** Most extra accounts. */
export const MAX_ACCOUNTS = 8;
const ACCOUNT_ID_RE = /^(default|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const Registry = z.object({
    activeId: z.string().regex(ACCOUNT_ID_RE),
    accounts: z
        .array(z.object({ id: z.string().regex(ACCOUNT_ID_RE), label: z.string().min(1).max(80), home: z.string().max(1024).nullable() }))
        .max(MAX_ACCOUNTS + 1),
});
/** Multi-account registry. */
export class CodexAccounts {
    opts;
    file;
    homes;
    cache = new Map();
    ttl;
    now;
    lock = Promise.resolve();
    constructor(opts) {
        this.opts = opts;
        this.file = join(opts.dir, 'codex-accounts.json');
        this.homes = join(opts.dir, 'codex-accounts');
        this.ttl = opts.statusTtlMs ?? 30_000;
        this.now = opts.now ?? Date.now;
    }
    /** Serialize registry updates. */
    exclusive(fn) {
        const next = this.lock.then(fn, fn);
        this.lock = next.catch(() => undefined);
        return next;
    }
    async read() {
        try {
            const raw = JSON.parse(await readFile(this.file, 'utf8'));
            const r = Registry.safeParse(raw);
            if (r.success && r.data.accounts.some((a) => a.id === DEFAULT_ACCOUNT_ID)) {
                // Homes must stay inside our directory (a tampered registry cannot point elsewhere).
                const accounts = r.data.accounts.filter((a) => a.home === null || this.inside(a.home));
                const activeId = accounts.some((a) => a.id === r.data.activeId) ? r.data.activeId : DEFAULT_ACCOUNT_ID;
                return { activeId, accounts };
            }
        }
        catch {
            /* missing or unreadable: defaults */
        }
        return { activeId: DEFAULT_ACCOUNT_ID, accounts: [{ id: DEFAULT_ACCOUNT_ID, label: 'This computer', home: null }] };
    }
    inside(path) {
        const root = resolve(this.homes) + sep;
        return resolve(path).startsWith(root);
    }
    async write(data) {
        await mkdir(this.opts.dir, { recursive: true, mode: 0o700 });
        await chmod(this.opts.dir, 0o700).catch(() => undefined);
        const tmp = `${this.file}.${process.pid}.tmp`;
        await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
        await chmod(tmp, 0o600).catch(() => undefined);
        await rename(tmp, this.file);
    }
    /** `codex login status` for one home (cached). */
    async status(id, home) {
        const hit = this.cache.get(id);
        if (hit && this.now() - hit.at < this.ttl)
            return hit;
        if (!this.opts.codexCommand)
            return { signedIn: false, detail: 'Codex CLI not installed' };
        const r = await runProcess(this.opts.codexCommand, ['login', 'status'], {
            cwd: tmpdir(),
            env: restrictedEnv(this.opts.env, home ? { CODEX_HOME: home } : {}),
            timeoutMs: 15_000,
            ...(this.opts.spawn ? { spawn: this.opts.spawn } : {}),
        });
        const text = `${r.stdout}\n${r.stderr}`.replace(/\s+/g, ' ').trim().slice(0, 160);
        const signedIn = !r.spawnError && r.code === 0 && /logged in/i.test(text) && !/not logged in/i.test(text);
        const out = { at: this.now(), signedIn, detail: signedIn ? text || 'Signed in' : 'Not signed in' };
        this.cache.set(id, out);
        return out;
    }
    /** Forget cached status (after a sign-in or sign-out). */
    invalidate(id) {
        if (id)
            this.cache.delete(id);
        else
            this.cache.clear();
    }
    /** Every account with its status. */
    async list() {
        const data = await this.read();
        const items = await Promise.all(data.accounts.map(async (a) => {
            const s = await this.status(a.id, a.home);
            return { id: a.id, label: a.label, active: a.id === data.activeId, signedIn: s.signedIn, detail: s.detail };
        }));
        return { items, activeId: data.activeId };
    }
    /** Home directory of an account (null: the machine default); undefined when unknown. */
    async homeOf(id) {
        const data = await this.read();
        return data.accounts.find((a) => a.id === id)?.home;
    }
    /** Home directory of the active account (null: the machine default). */
    async activeHome() {
        const data = await this.read();
        return data.accounts.find((a) => a.id === data.activeId)?.home ?? null;
    }
    /** Id of the active account. */
    async activeId() {
        return (await this.read()).activeId;
    }
    /** Create a new, empty account (its own CODEX_HOME) to sign in to. */
    async create(label) {
        const clean = label.replace(/\s+/g, ' ').trim();
        if (clean.length < 1 || clean.length > 80)
            throw new Error('Account names need 1–80 characters.');
        return this.exclusive(async () => {
            const data = await this.read();
            if (data.accounts.length > MAX_ACCOUNTS)
                throw new Error(`At most ${MAX_ACCOUNTS} extra accounts.`);
            const id = randomUUID();
            const home = join(this.homes, id);
            await mkdir(this.homes, { recursive: true, mode: 0o700 });
            await chmod(this.homes, 0o700).catch(() => undefined);
            await mkdir(home, { mode: 0o700 });
            await chmod(home, 0o700).catch(() => undefined);
            data.accounts.push({ id, label: clean, home });
            await this.write(data);
            return { id, home };
        });
    }
    /** Make an account active (refused while jobs run or when it is not signed in). */
    async activate(id, runningJobs) {
        if (runningJobs > 0)
            throw new Error('Wait for running jobs to finish before switching accounts.');
        return this.exclusive(async () => {
            const data = await this.read();
            const a = data.accounts.find((x) => x.id === id);
            if (!a)
                throw new Error('That account does not exist.');
            this.invalidate(id);
            const s = await this.status(a.id, a.home);
            if (!s.signedIn)
                throw new Error('That account is not signed in yet.');
            data.activeId = id;
            await this.write(data);
            return { id, label: a.label, active: true, signedIn: true, detail: s.detail };
        });
    }
    /** Remove an extra account and its home (never the default; never the active one). */
    async remove(id) {
        if (id === DEFAULT_ACCOUNT_ID)
            throw new Error('The computer’s own login cannot be removed (sign out instead).');
        return this.exclusive(async () => {
            const data = await this.read();
            const a = data.accounts.find((x) => x.id === id);
            if (!a)
                return;
            if (data.activeId === id)
                throw new Error('Switch to another account before removing this one.');
            data.accounts = data.accounts.filter((x) => x.id !== id);
            await this.write(data);
            if (a.home && this.inside(a.home))
                await rm(a.home, { recursive: true, force: true });
            this.invalidate(id);
        });
    }
}
