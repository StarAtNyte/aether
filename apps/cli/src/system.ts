/**
 * Operating-system helpers for the CLI: health probes of the local server,
 * the CLI-only admin calls, cross-platform process spawning (argument arrays
 * only, never a shell string) and opening the browser.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** Header carrying the per-install secret on admin calls (same as the server's). */
export const ADMIN_HEADER = 'x-aether-admin';

const HealthSchema = z.object({ ok: z.literal(true), instance: z.string().max(64).optional(), local: z.boolean().optional() }).passthrough();
/** What `/api/health` tells the CLI. */
export type Health = z.infer<typeof HealthSchema>;

/** Probe `http://127.0.0.1:<port>/api/health` (null when nothing healthy answers in time). */
export async function probeHealth(port: number, timeoutMs = 1500, doFetch: typeof fetch = fetch): Promise<Health | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await doFetch(`http://127.0.0.1:${port}/api/health`, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > 16 * 1024) return null;
    const parsed = HealthSchema.safeParse(JSON.parse(text) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** POST an admin call to the local server with the session secret. */
export async function adminPost(port: number, path: string, secret: string, timeoutMs = 5000, doFetch: typeof fetch = fetch): Promise<{ status: number; body: unknown } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await doFetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', signal: ctrl.signal, headers: { [ADMIN_HEADER]: secret, accept: 'application/json' } });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text.length > 0 && text.length < 64 * 1024 ? (JSON.parse(text) as unknown) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Spawn a CLI found on PATH. Windows `.cmd` / `.bat` shims (how npm installs
 * `codex`) cannot be spawned directly, so they run through `cmd.exe /d /s /c`
 * with the fixed, quoted arguments this program passes (never user text).
 */
export function spawnCommand(command: string, args: readonly string[], options: SpawnOptions, platform: NodeJS.Platform = process.platform): ChildProcess {
  const plan = commandPlan(command, args, platform, process.env['ComSpec']);
  return spawn(plan.command, plan.args, { ...options, shell: false, windowsHide: true, ...(plan.verbatim ? { windowsVerbatimArguments: true } : {}) });
}

/** How {@link spawnCommand} runs `command` (exported for tests). */
export function commandPlan(command: string, args: readonly string[], platform: NodeJS.Platform, comSpec?: string): { command: string; args: string[]; verbatim: boolean } {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    for (const a of [command, ...args]) if (/["%^&|<>\r\n]/.test(a)) throw new Error('unsafe argument for a Windows command shim');
    return { command: comSpec && comSpec.length > 0 ? comSpec : 'cmd.exe', args: ['/d', '/s', '/c', `"${[command, ...args].map((a) => `"${a}"`).join(' ')}"`], verbatim: true };
  }
  return { command, args: [...args], verbatim: false };
}

/** The command that opens `url` in the default browser on this platform. */
export function browserCommand(url: string, platform: NodeJS.Platform): { command: string; args: string[] } {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  // rundll32 hands the URL to the protocol handler without any shell parsing.
  if (platform === 'win32') return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
  return { command: 'xdg-open', args: [url] };
}

/** Open `url` in the user's browser (best effort, detached). Only http(s) URLs. */
export function openBrowser(url: string): boolean {
  if (!/^https?:\/\/[^\s"'<>]{1,500}$/.test(url)) return false;
  const { command, args } = browserCommand(url, process.platform);
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false, windowsHide: true });
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort identity check of a pid when health does not answer (Linux
 * only, via /proc): does its command line run the Aether server? Null when
 * the platform cannot tell.
 */
export function pidIsAetherServer(pid: number, platform: NodeJS.Platform = process.platform): boolean | null {
  if (platform !== 'linux') return null;
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    return /apps[\\/]server[\\/]src[\\/]main\.ts/.test(cmd);
  } catch {
    return false;
  }
}

/** Terminate a detached server: its whole process group on POSIX, the process on Windows. */
export function killServer(pid: number, signal: NodeJS.Signals): void {
  try {
    if (process.platform === 'win32') process.kill(pid, signal);
    else process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}

/** Sleep (ms). */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
