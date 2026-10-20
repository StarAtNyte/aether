/**
 * Resolve an executable on PATH without spawning a shell.
 */
import { accessSync, constants, readdirSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, posix as posixPath, win32 as win32Path } from 'node:path';

/**
 * Extensions to try. On Windows an extensionless file next to `codex.cmd`
 * is npm's POSIX shell shim, which Windows cannot execute: only PATHEXT
 * extensions are tried unless the name already carries one.
 */
export function windowsExtensions(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (platform !== 'win32') return [''];
  const list = (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.trim().toLowerCase()).filter((e) => /^\.[a-z0-9]{1,8}$/.test(e));
  const lower = name.toLowerCase();
  return list.some((e) => lower.endsWith(e)) ? [''] : list;
}

/** Absolute path of `name` on `PATH`, or null. Absolute paths are checked as given. */
export function which(name: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  if (!/^[A-Za-z0-9._/\\:-]{1,512}$/.test(name)) return null;
  const exts = windowsExtensions(name, env, platform);
  const candidates = isAbsolute(name) ? [name] : (env['PATH'] ?? '').split(delimiter).filter((d) => d.length > 0).map((d) => join(d, name));
  for (const base of candidates) {
    for (const ext of exts) {
      const p = `${base}${ext}`;
      try {
        if (!statSync(p).isFile()) continue;
        accessSync(p, constants.X_OK);
        return p;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}

/** The CLIs the bridge drives. */
export type CliName = 'codex' | 'claude';

/** Environment variable that names a CLI's executable explicitly. */
export const CLI_ENV_OVERRIDE: Readonly<Record<CliName, string>> = { codex: 'AETHER_CODEX_BIN', claude: 'AETHER_CLAUDE_BIN' };

/** Options of {@link locateCli} (injectable for tests). */
export interface LocateOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Node version of the running process (`v24.14.0`): its nvm folder is tried first. */
  nodeVersion?: string;
  /** Machine-wide folders tried last (defaults per platform). */
  systemDirs?: readonly string[];
}

/** Where a CLI was found. */
export interface CliLocation {
  path: string | null;
  /** `override`: the env variable; `path`: PATH; `fallback`: a well-known install folder. */
  source: 'override' | 'path' | 'fallback' | null;
  /** Set when the override variable names something that is not an executable file. */
  badOverride?: string;
}

const DEFAULT_SYSTEM_DIRS: Readonly<Record<string, readonly string[]>> = {
  win32: [],
  darwin: ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'],
  default: ['/usr/local/bin', '/usr/bin', '/snap/bin'],
};

function versionKey(name: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(name);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** nvm's per-version bin folders: the running Node's first, then newest to oldest. */
function nvmBinDirs(env: NodeJS.ProcessEnv, home: string | undefined, nodeVersion: string, P: typeof posixPath): string[] {
  const roots = [env['NVM_DIR'], home ? P.join(home, '.nvm') : undefined].filter((r): r is string => typeof r === 'string' && r.length > 0 && P.isAbsolute(r));
  const out: string[] = [];
  for (const root of [...new Set(roots)]) {
    const versions = P.join(root, 'versions', 'node');
    let names: string[];
    try {
      names = readdirSync(versions);
    } catch {
      continue;
    }
    const keyed = names.map((n) => ({ n, k: versionKey(n) })).filter((v): v is { n: string; k: number[] } => v.k !== null);
    keyed.sort((a, b) => {
      if (a.n === nodeVersion) return -1;
      if (b.n === nodeVersion) return 1;
      for (let i = 0; i < 3; i++) if (a.k[i] !== b.k[i]) return (b.k[i] ?? 0) - (a.k[i] ?? 0);
      return 0;
    });
    for (const v of keyed) out.push(P.join(versions, v.n, 'bin'));
  }
  return out;
}

/** Well-known global install folders, in the order they are tried after PATH. */
export function fallbackDirs(opts: LocateOptions = {}): string[] {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const P = platform === 'win32' ? win32Path : posixPath;
  const home = platform === 'win32' ? (env['USERPROFILE'] ?? env['HOME']) : (env['HOME'] ?? env['USERPROFILE']);
  const dirs: Array<string | undefined> = [env['NVM_BIN']];
  const prefix = env['npm_config_prefix'] ?? env['NPM_CONFIG_PREFIX'] ?? env['PREFIX'];
  if (prefix) dirs.push(platform === 'win32' ? prefix : P.join(prefix, 'bin'));
  if (platform === 'win32') {
    if (env['APPDATA']) dirs.push(P.join(env['APPDATA'], 'npm'));
    if (env['NVM_SYMLINK']) dirs.push(env['NVM_SYMLINK']);
    if (env['LOCALAPPDATA']) dirs.push(P.join(env['LOCALAPPDATA'], 'Volta', 'bin'));
  }
  dirs.push(env['VOLTA_HOME'] ? P.join(env['VOLTA_HOME'], 'bin') : undefined, env['PNPM_HOME']);
  if (home) {
    dirs.push(...nvmBinDirs(env, home, opts.nodeVersion ?? process.version, P));
    dirs.push(P.join(home, '.npm-global', 'bin'), P.join(home, '.local', 'bin'), P.join(home, '.volta', 'bin'), P.join(home, '.npm', 'bin'), P.join(home, 'bin'));
    if (platform === 'darwin') dirs.push(P.join(home, 'Library', 'pnpm'));
    else if (platform !== 'win32') dirs.push(P.join(home, '.local', 'share', 'pnpm'));
  }
  dirs.push(...(opts.systemDirs ?? DEFAULT_SYSTEM_DIRS[platform] ?? DEFAULT_SYSTEM_DIRS['default'] ?? []));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of dirs) {
    if (typeof d !== 'string' || d.length === 0 || !P.isAbsolute(d) || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

/**
 * Find a CLI: the `AETHER_<NAME>_BIN` override wins (and is not second-guessed:
 * a bad one is reported, not silently replaced), then PATH, then the folders
 * global npm installs land in (every nvm Node version, npm prefixes, Volta,
 * pnpm, ~/.local/bin, /usr/local/bin…). A server started under one Node
 * version thus still finds a CLI installed under another.
 */
export function locateCli(name: CliName, opts: LocateOptions = {}): CliLocation {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const override = env[CLI_ENV_OVERRIDE[name]]?.trim();
  if (override) {
    const p = isAbsolute(override) ? which(override, env, platform) : null;
    return p ? { path: p, source: 'override' } : { path: null, source: null, badOverride: override.slice(0, 120) };
  }
  const onPath = which(name, env, platform);
  if (onPath) return { path: onPath, source: 'path' };
  for (const dir of fallbackDirs(opts)) {
    const p = which(join(dir, name), env, platform);
    if (p) return { path: p, source: 'fallback' };
  }
  return { path: null, source: null };
}

/** Path of a CLI ({@link locateCli}), or null. */
export function findCliPath(name: CliName, opts: LocateOptions = {}): string | null {
  return locateCli(name, opts).path;
}

/** What to tell the user when a CLI cannot be found (fits the 200-character status detail). */
export function cliMissingDetail(name: CliName, env: NodeJS.ProcessEnv = process.env): string {
  const loc = locateCli(name, { env });
  const variable = CLI_ENV_OVERRIDE[name];
  if (loc.badOverride) return `${variable} is set to "${loc.badOverride.slice(0, 60)}", which is not an executable file. Fix or unset it.`;
  return name === 'codex'
    ? `Codex CLI not found. Install it with "npm i -g @openai/codex", or set ${variable} to the codex executable's full path.`
    : `Claude Code CLI not found. Install it (npm i -g @anthropic-ai/claude-code), or set ${variable} to its full path.`;
}
