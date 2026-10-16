/**
 * Start, stop and inspect the detached local server.
 *
 * `start` spawns `node --import tsx apps/server/src/main.ts` detached in its
 * own process group (survives the terminal closing, `windowsHide` on
 * Windows), with stdin closed and stdout/stderr going to `server.out` (crash
 * output only: the server logs to the rotating `server.log` itself). It
 * waits for `/api/health` to answer with this start's random instance id,
 * then records pid + port in `server.json`.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { isLoopbackHost } from './args';
import { readTail, lastLines } from './logs';
import { adminPost, killServer, pidIsAetherServer, probeHealth, sleep } from './system';
import { classify, clearServerRecord, pidAlive, readServerRecord, writeServerRecord } from './state';
/** How long `start` waits for the server to become healthy (ms). */
export const START_TIMEOUT_MS = 60_000;
/** How long `stop` waits for a graceful shutdown before killing (ms). */
export const STOP_GRACE_MS = 12_000;
/** Hosting-platform markers that would make the server refuse local AI. */
const HOSTED_MARKERS = ['VERCEL', 'FLY_APP_NAME', 'RENDER', 'RAILWAY_ENVIRONMENT', 'K_SERVICE', 'AWS_LAMBDA_FUNCTION_NAME', 'DYNO', 'NETLIFY', 'KUBERNETES_SERVICE_HOST', 'AETHER_HOSTED'];
/**
 * Environment of the detached server (pure; exported for tests). The user's
 * environment is kept (PATH, HOME, CODEX_HOME… the server restricts what its
 * AI workers see), owner API keys are never used (the provider is the
 * offline planner unless AETHER_PROVIDER says otherwise), and the hardening
 * of the local app is switched on.
 */
export function serverEnv(source, i) {
    const env = {};
    for (const [k, v] of Object.entries(source))
        if (typeof v === 'string' && !HOSTED_MARKERS.includes(k))
            env[k] = v;
    const hosts = new Set([`127.0.0.1:${i.port}`, `localhost:${i.port}`]);
    for (const a of i.lanAddresses)
        hosts.add(`${a.includes(':') ? `[${a}]` : a}:${i.port}`);
    const origins = [...hosts].map((h) => `http://${h}`);
    Object.assign(env, {
        PORT: String(i.port),
        HOST: i.host,
        NODE_ENV: 'production',
        SERVE_STATIC: 'true',
        STATIC_DIR: join(i.root, 'apps/studio/dist'),
        DATA_DIR: i.paths.data,
        AETHER_LOCAL_AI: 'on',
        AETHER_PROVIDER: source['AETHER_PROVIDER'] && source['AETHER_PROVIDER'] !== '' ? source['AETHER_PROVIDER'] : 'mock',
        ALLOWED_ORIGINS: origins.join(','),
        AETHER_ALLOWED_HOSTS: [...hosts].join(','),
        AETHER_SECRET_FILE: i.paths.secret,
        AETHER_INSTANCE_ID: i.instance,
        AETHER_LOG_FILE: i.paths.log,
        LOG_LEVEL: source['LOG_LEVEL'] && source['LOG_LEVEL'] !== '' ? source['LOG_LEVEL'] : 'info',
    });
    if (i.accessTokenFile)
        env['AETHER_ACCESS_TOKEN_FILE'] = i.accessTokenFile;
    else
        delete env['AETHER_ACCESS_TOKEN_FILE'];
    if (i.origins.length > 0) {
        env['AETHER_BRIDGE_ORIGINS'] = i.origins.join(',');
        env['AETHER_BRIDGE_PORT'] = String(i.bridgePort);
    }
    else {
        delete env['AETHER_BRIDGE_ORIGINS'];
    }
    return env;
}
/** The link to print (`127.0.0.1` for a loopback server, else the first LAN address). */
export function serverUrl(host, port, lanAddresses) {
    if (isLoopbackHost(host) || host === '0.0.0.0' || host === '::') {
        if (!isLoopbackHost(host) && lanAddresses.length > 0) {
            const a = lanAddresses[0] ?? '127.0.0.1';
            return `http://${a.includes(':') ? `[${a}]` : a}:${port}`;
        }
        return `http://127.0.0.1:${port}`;
    }
    return `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
}
/** Inspect the recorded server. */
export async function inspect(paths) {
    const rec = readServerRecord(paths);
    if (!rec)
        return null;
    const health = await probeHealth(rec.port);
    return { rec, state: classify(rec, health, pidAlive(rec.pid)) };
}
/** The command that runs the server (node + tsx loader + the server entry). */
export function serverCommand(root) {
    // `--import tsx` resolves from the child's cwd, which is always the repo root.
    return { command: process.execPath, args: ['--import', 'tsx', join(root, 'apps/server/src/main.ts')] };
}
/** Spawn the server detached (or attached with `foreground`). */
export function spawnServer(root, paths, env, foreground) {
    const { command, args } = serverCommand(root);
    if (foreground) {
        const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit'], shell: false, windowsHide: true });
        if (child.pid === undefined)
            throw new Error('the server could not be started');
        return { child, pid: child.pid };
    }
    const fd = openSync(paths.out, 'w', 0o600);
    try {
        const child = spawn(command, args, { cwd: root, env, detached: true, stdio: ['ignore', fd, fd], shell: false, windowsHide: true });
        if (child.pid === undefined)
            throw new Error('the server could not be started');
        child.unref();
        return { child, pid: child.pid };
    }
    finally {
        closeSync(fd);
    }
}
/** Wait until health answers with `instance`, the child exits, or the timeout passes. */
export async function waitHealthy(port, instance, child, timeoutMs = START_TIMEOUT_MS) {
    let exited = false;
    child.once('exit', () => {
        exited = true;
    });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (exited || child.exitCode !== null)
            return 'exited';
        const h = await probeHealth(port, 1000);
        if (h?.instance === instance)
            return 'ok';
        await sleep(250);
    }
    return 'timeout';
}
/** The last lines of the crash output (for a failed start). */
export function crashTail(paths, n = 20) {
    return lastLines(readTail(paths.out, 64 * 1024), n);
}
/**
 * Stop the recorded server: graceful HTTP shutdown (session secret), then
 * SIGTERM / SIGKILL of its process group. A pid whose identity cannot be
 * confirmed (no health answer, not recognisably ours) is left alone unless
 * `force`.
 */
export async function stopServer(paths, secret, force, log) {
    const found = await inspect(paths);
    if (!found)
        return 'not-running';
    const { rec, state } = found;
    if (state === 'stale') {
        clearServerRecord(paths);
        return 'stale-cleaned';
    }
    if (state === 'unresponsive') {
        const ours = pidIsAetherServer(rec.pid);
        if (ours === false && !force) {
            log(`Process ${rec.pid} no longer looks like Aether; not touching it. The record was removed.`);
            clearServerRecord(paths);
            return 'stale-cleaned';
        }
        if (ours === null && !force) {
            log(`Aether (pid ${rec.pid}) is not answering. Run "aether stop --force" to end it.`);
            return 'refused';
        }
    }
    if (state === 'running' && secret)
        await adminPost(rec.port, '/api/admin/shutdown', secret);
    const gone = async (ms) => {
        const until = Date.now() + ms;
        while (Date.now() < until) {
            if (!pidAlive(rec.pid))
                return true;
            await sleep(150);
        }
        return !pidAlive(rec.pid);
    };
    if (!(await gone(state === 'running' && secret ? STOP_GRACE_MS : 0))) {
        killServer(rec.pid, 'SIGTERM');
        if (!(await gone(5_000))) {
            killServer(rec.pid, 'SIGKILL');
            if (!(await gone(3_000)))
                return 'failed';
        }
    }
    clearServerRecord(paths);
    return 'stopped';
}
/** A fresh instance id for one start. */
export function newInstanceId() {
    return randomUUID();
}
