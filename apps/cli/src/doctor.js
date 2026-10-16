/**
 * `aether doctor`: everything a first run needs, each with a fix.
 */
import { accessSync, constants, existsSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { cliStatus } from './accounts';
import { buildReason } from './build';
import { DEFAULT_PORT } from './args';
import { portFree } from './ports';
import { probeHealth } from './system';
import { readServerRecord } from './state';
/** Minimum Node major version. */
export const MIN_NODE_MAJOR = 22;
/** Free disk space below this is a warning (bytes). */
export const MIN_FREE_BYTES = 500 * 1024 * 1024;
/** Node version check (pure). */
export function checkNode(version) {
    const major = Number(/^v?(\d+)/.exec(version)?.[1] ?? 0);
    return major >= MIN_NODE_MAJOR
        ? { name: 'Node.js', status: 'ok', detail: version }
        : { name: 'Node.js', status: 'fail', detail: `${version} is too old`, fix: `Install Node.js ${MIN_NODE_MAJOR} or newer (https://nodejs.org)` };
}
/** Disk space check (pure). */
export function checkDisk(freeBytes) {
    if (freeBytes === null)
        return { name: 'Disk space', status: 'warn', detail: 'could not be measured' };
    const gb = (freeBytes / 1024 ** 3).toFixed(1);
    return freeBytes >= MIN_FREE_BYTES ? { name: 'Disk space', status: 'ok', detail: `${gb} GB free` } : { name: 'Disk space', status: 'warn', detail: `only ${gb} GB free`, fix: 'Free some space: builds and AI jobs need a few hundred MB' };
}
function freeBytes(dir) {
    let p = dir;
    for (let i = 0; i < 8 && !existsSync(p); i++)
        p = join(p, '..');
    try {
        const s = statfsSync(p);
        return Number(s.bavail) * Number(s.bsize);
    }
    catch {
        return null;
    }
}
/** Run every check. */
export async function runDoctor(root, paths) {
    const checks = [checkNode(process.version)];
    checks.push(existsSync(join(root, 'node_modules', 'tsx')) ? { name: 'Dependencies', status: 'ok', detail: 'installed' } : { name: 'Dependencies', status: 'fail', detail: 'not installed', fix: 'Run: npm ci' });
    const reason = buildReason(root, join(root, 'apps/studio/dist/index.html'));
    checks.push(reason === null ? { name: 'Studio build', status: 'ok', detail: 'up to date' } : { name: 'Studio build', status: 'warn', detail: reason === 'missing' ? 'not built yet' : 'older than the sources', fix: '"aether start" builds it automatically' });
    try {
        if (existsSync(paths.dir))
            accessSync(paths.dir, constants.W_OK);
        checks.push({ name: 'State folder', status: 'ok', detail: paths.dir });
    }
    catch {
        checks.push({ name: 'State folder', status: 'fail', detail: `${paths.dir} is not writable`, fix: 'Fix its permissions, or use --state-dir <folder>' });
    }
    checks.push(checkDisk(freeBytes(paths.dir)));
    const rec = readServerRecord(paths);
    const health = rec ? await probeHealth(rec.port) : null;
    if (rec && health?.instance === rec.instance)
        checks.push({ name: 'Server', status: 'ok', detail: `running at ${rec.url}` });
    else if (await portFree(DEFAULT_PORT, '127.0.0.1'))
        checks.push({ name: 'Port', status: 'ok', detail: `${DEFAULT_PORT} is free` });
    else
        checks.push({ name: 'Port', status: 'warn', detail: `${DEFAULT_PORT} is in use by another program`, fix: '"aether start" picks the next free port' });
    const [codex, claude] = await Promise.all([cliStatus('codex'), cliStatus('claude')]);
    if (!codex.installed)
        checks.push({ name: 'Codex CLI', status: 'warn', detail: 'not installed (the studio still works offline)', fix: 'npm i -g @openai/codex, then: aether login' });
    else if (!codex.loggedIn)
        checks.push({ name: 'Codex CLI', status: 'warn', detail: 'installed, not signed in', fix: 'Run: aether login (or sign in from the studio)' });
    else
        checks.push({ name: 'Codex CLI', status: 'ok', detail: codex.account ? `signed in (${codex.account})` : 'signed in' });
    if (!claude.installed)
        checks.push({ name: 'Claude Code CLI', status: 'ok', detail: 'not installed (optional)' });
    else
        checks.push({ name: 'Claude Code CLI', status: claude.loggedIn ? 'ok' : 'warn', detail: claude.loggedIn ? `signed in${claude.account ? ` (${claude.account})` : ''}` : 'installed, not signed in', ...(claude.loggedIn ? {} : { fix: 'Run: aether login --claude' }) });
    return checks;
}
