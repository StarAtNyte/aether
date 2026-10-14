/**
 * Cross-platform spawning of the user's CLIs without a shell string.
 *
 * On Windows, npm installs `codex` / `claude` as `.cmd` shims. Node refuses
 * to spawn a `.cmd` / `.bat` file with `shell: false` (EINVAL since the
 * 2024 batch-file argument-injection fix), so such shims run through
 * `cmd.exe /d /s /c` with arguments this program fixed itself; anything
 * containing a cmd.exe metacharacter is rejected rather than escaped.
 * Everywhere else the command runs directly.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

/** How to run one command (exported for tests). */
export interface CommandPlan {
  command: string;
  args: string[];
  /** Pass `windowsVerbatimArguments` (the cmd.exe line is pre-quoted). */
  verbatim: boolean;
}

const BATCH_RE = /\.(cmd|bat)$/i;
const CMD_META_RE = /["%^&|<>\r\n]/;

/** True for a Windows batch shim. */
export function isBatchShim(command: string): boolean {
  return BATCH_RE.test(command);
}

/**
 * The plan for `command args` on `platform` (pure). Throws when a batch shim
 * would receive an argument cmd.exe could misinterpret.
 */
export function commandPlan(command: string, args: readonly string[], platform: NodeJS.Platform, comSpec?: string): CommandPlan {
  if (platform === 'win32' && isBatchShim(command)) {
    for (const a of [command, ...args]) if (CMD_META_RE.test(a)) throw new Error('unsafe argument for a Windows command shim');
    return { command: comSpec && comSpec.length > 0 ? comSpec : 'cmd.exe', args: ['/d', '/s', '/c', `"${[command, ...args].map((a) => `"${a}"`).join(' ')}"`], verbatim: true };
  }
  return { command, args: [...args], verbatim: false };
}

/**
 * `spawn` with {@link commandPlan} applied, `shell: false` and `windowsHide`
 * forced. Same signature as `child_process.spawn` for argument arrays.
 */
export function spawnCli(command: string, args: readonly string[], options: SpawnOptions, platform: NodeJS.Platform = process.platform): ChildProcess {
  const env = options.env ?? process.env;
  const plan = commandPlan(command, args, platform, env['ComSpec'] ?? env['COMSPEC'] ?? process.env['ComSpec']);
  return spawn(plan.command, plan.args, { ...options, shell: false, windowsHide: true, ...(plan.verbatim ? { windowsVerbatimArguments: true } : {}) });
}

/**
 * The executable to hand an SDK that spawns the CLI itself (Codex SDK
 * `codexPathOverride`): a Windows batch shim cannot be spawned that way, so
 * the SDK's own bundled binary is used instead (same `CODEX_HOME` login).
 */
export function sdkExecutable(path: string | null, platform: NodeJS.Platform = process.platform): string | undefined {
  if (!path) return undefined;
  if (platform === 'win32' && isBatchShim(path)) return undefined;
  return path;
}
