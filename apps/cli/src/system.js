/**
 * Operating-system helpers for the CLI: health probes of the local server,
 * the CLI-only admin calls, cross-platform process spawning (argument arrays
 * only, never a shell string) and opening the browser.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { commandPlan as bridgeCommandPlan, killTree, spawnCli } from '@aether/bridge';
import { z } from 'zod';
/** Header carrying the per-install secret on admin calls (same as the server's). */
export const ADMIN_HEADER = 'x-aether-admin';
const HealthSchema = z.object({ ok: z.literal(true), instance: z.string().max(64).optional(), local: z.boolean().optional() }).passthrough();
/** Probe `http://127.0.0.1:<port>/api/health` (null when nothing healthy answers in time). */
export async function probeHealth(port, timeoutMs = 1500, doFetch = fetch) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await doFetch(`http://127.0.0.1:${port}/api/health`, { signal: ctrl.signal, headers: { accept: 'application/json' } });
        if (!res.ok)
            return null;
        const text = await res.text();
        if (text.length > 16 * 1024)
            return null;
        const parsed = HealthSchema.safeParse(JSON.parse(text));
        return parsed.success ? parsed.data : null;
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(t);
    }
}
/** POST an admin call to the local server with the session secret. */
export async function adminPost(port, path, secret, timeoutMs = 5000, doFetch = fetch) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await doFetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', signal: ctrl.signal, headers: { [ADMIN_HEADER]: secret, accept: 'application/json' } });
        const text = await res.text();
        let body = null;
        try {
            body = text.length > 0 && text.length < 64 * 1024 ? JSON.parse(text) : null;
        }
        catch {
            body = null;
        }
        return { status: res.status, body };
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(t);
    }
}
/** Spawn a CLI found on PATH (Windows `.cmd` shims go through cmd.exe with fixed arguments; see `@aether/bridge` spawn-plan). */
export function spawnCommand(command, args, options, platform = process.platform) {
    return spawnCli(command, args, options, platform);
}
/** How {@link spawnCommand} runs `command` (re-exported for tests). */
export const commandPlan = bridgeCommandPlan;
/** The command that opens `url` in the default browser on this platform. */
export function browserCommand(url, platform) {
    if (platform === 'darwin')
        return { command: 'open', args: [url] };
    // rundll32 hands the URL to the protocol handler without any shell parsing.
    if (platform === 'win32')
        return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
    return { command: 'xdg-open', args: [url] };
}
/** Open `url` in the user's browser (best effort, detached). Only http(s) URLs. */
export function openBrowser(url) {
    if (!/^https?:\/\/[^\s"'<>]{1,500}$/.test(url))
        return false;
    const { command, args } = browserCommand(url, process.platform);
    try {
        const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false, windowsHide: true });
        child.on('error', () => undefined);
        child.unref();
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Best-effort identity check of a pid when health does not answer (Linux
 * only, via /proc): does its command line run the Aether server? Null when
 * the platform cannot tell.
 */
export function pidIsAetherServer(pid, platform = process.platform) {
    if (platform !== 'linux')
        return null;
    try {
        const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        return /apps[\\/]server[\\/]src[\\/]main\.ts/.test(cmd);
    }
    catch {
        return false;
    }
}
/** Terminate a detached server and its AI workers: the process group on POSIX, the tree (`taskkill /T`) on Windows. */
export function killServer(pid, signal) {
    killTree(pid, signal);
}
/** Sleep (ms). */
export function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
