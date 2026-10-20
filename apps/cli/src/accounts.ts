/**
 * `aether login` / `aether logout`: the CLIs' own sign-in flows for the
 * user's OWN account, run interactively in this terminal. Aether never reads
 * or copies the credentials: Codex keeps its login in `CODEX_HOME` (default
 * `~/.codex`), Claude Code in its own config folder.
 */
import { loginArgs, logoutArgs, probeClaude, probeCodex, restrictedEnv, findCliPath } from '@aether/bridge';
import { spawnCommand } from './system';

/** Variables a sign-in needs to open the user's browser (not secrets). */
const DESKTOP_ENV = ['DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'BROWSER'] as const;

/** Environment for an interactive sign-in: the allowlist plus the desktop session. */
export function loginEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const desktop: Record<string, string> = {};
  for (const k of DESKTOP_ENV) {
    const v = source[k];
    if (typeof v === 'string' && v.length > 0 && v.length < 1024) desktop[k] = v;
  }
  // Terminal capabilities so the CLI can draw its prompts.
  for (const k of ['TERM', 'COLORTERM']) {
    const v = source[k];
    if (typeof v === 'string' && v.length < 64) desktop[k] = v;
  }
  return restrictedEnv(source, desktop);
}

/** Login arguments for `aether login` (Codex: browser flow, or device code with --device-auth). */
export function signInArgs(backend: 'codex' | 'claude', deviceAuth: boolean): string[] {
  if (backend === 'claude') return loginArgs('claude-code');
  return deviceAuth ? loginArgs('codex') : ['login'];
}

/** Resolve the CLI binary: AETHER_CODEX_BIN / AETHER_CLAUDE_BIN, PATH, then the usual global install folders (null when not installed). */
export function findCli(backend: 'codex' | 'claude', env: NodeJS.ProcessEnv = process.env): string | null {
  return findCliPath(backend === 'codex' ? 'codex' : 'claude', { env });
}

/** Current sign-in status of one CLI. */
export async function cliStatus(backend: 'codex' | 'claude', env: NodeJS.ProcessEnv = process.env): Promise<{ installed: boolean; loggedIn: boolean; detail: string; account?: string }> {
  const command = findCli(backend, env);
  const deps = { codexCommand: backend === 'codex' ? command : null, claudeCommand: backend === 'claude' ? command : null, env };
  const s = backend === 'codex' ? await probeCodex(deps) : await probeClaude(deps);
  return { installed: s.installed, loggedIn: s.loggedIn, detail: s.detail, ...(s.account ? { account: s.account } : {}) };
}

/** Run a CLI interactively; resolves to its exit code (127 when it cannot start). */
export function runInteractive(command: string, args: readonly string[], env: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnCommand(command, args, { stdio: 'inherit', env, cwd: process.cwd() });
    } catch {
      resolve(127);
      return;
    }
    child.once('error', () => resolve(127));
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

/** Sign-out arguments. */
export function signOutArgs(backend: 'codex' | 'claude'): string[] {
  return logoutArgs(backend === 'codex' ? 'codex' : 'claude-code');
}
