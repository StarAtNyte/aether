/**
 * Is Blender usable on this computer? Three things must be found: a Blender
 * executable (`AETHER_BLENDER`, PATH, or a well-known install folder), the
 * MCP for Blender add-on in Blender's user scripts, and `uvx` (which starts
 * the pinned MCP server). File checks only: nothing is spawned.
 */
import { accessSync, constants, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { which } from '../which';

/** Environment variable naming the Blender executable. */
export const BLENDER_ENV = 'AETHER_BLENDER';
/** Environment variable naming the uvx executable. */
export const UVX_ENV = 'AETHER_UVX';
/** The add-on's module name (file `mcp_for_blender.py` or folder `mcp_for_blender/`). */
export const ADDON_MODULE = 'mcp_for_blender';

/** What was found (null: missing). */
export interface BlenderInstall {
  blender: string | null;
  addon: string | null;
  uvx: string | null;
}

/** Options (injectable for tests). */
export interface DetectOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** Well-known Blender executables (newest version folder first). */
export function blenderFallbacks(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  if (platform === 'darwin') {
    out.push('/Applications/Blender.app/Contents/MacOS/Blender', join(home, 'Applications/Blender.app/Contents/MacOS/Blender'));
  } else if (platform === 'win32') {
    const pf = env['ProgramFiles'] ?? 'C:\\Program Files';
    for (const d of subdirs(join(pf, 'Blender Foundation'))) out.push(join(pf, 'Blender Foundation', d, 'blender.exe'));
  } else {
    for (const base of [join(home, 'tools'), join(home, 'opt'), '/opt']) {
      for (const d of subdirs(base)) if (/^blender/i.test(d)) out.push(join(base, d, 'blender'));
    }
    out.push('/snap/bin/blender', '/usr/bin/blender', '/usr/local/bin/blender');
  }
  return out;
}

/** Blender's per-version user config folders. */
export function blenderConfigRoots(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'darwin') return [join(home, 'Library/Application Support/Blender')];
  if (platform === 'win32') return [join(env['APPDATA'] ?? join(home, 'AppData/Roaming'), 'Blender Foundation', 'Blender')];
  return [join(env['XDG_CONFIG_HOME'] ?? join(home, '.config'), 'blender')];
}

/** Where the add-on is installed, or null. */
export function findAddon(opts: DetectOptions = {}): string | null {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? homedir();
  const dirs: string[] = [];
  const scripts = env['BLENDER_USER_SCRIPTS'];
  if (scripts) dirs.push(join(scripts, 'addons'));
  for (const root of blenderConfigRoots(platform, home, env)) {
    for (const ver of subdirs(root)) {
      if (!/^\d+\.\d+$/.test(ver)) continue;
      dirs.push(join(root, ver, 'scripts', 'addons'), join(root, ver, 'extensions', 'user_default'));
    }
  }
  for (const d of dirs) {
    const file = join(d, `${ADDON_MODULE}.py`);
    if (isFile(file)) return file;
    const pkg = join(d, ADDON_MODULE);
    if (isDir(pkg) && isFile(join(pkg, '__init__.py'))) return pkg;
  }
  return null;
}

/** An executable file (absolute paths are checked directly: install folders may contain spaces), else a PATH lookup. */
function executable(p: string | undefined, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  if (!p) return null;
  if (!isAbsolute(p)) return which(p, env, platform);
  try {
    if (!statSync(p).isFile()) return null;
    if (platform !== 'win32') accessSync(p, constants.X_OK);
    return p;
  } catch {
    return null;
  }
}

/** The Blender executable, or null. */
export function findBlender(opts: DetectOptions = {}): string | null {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? homedir();
  const override = env[BLENDER_ENV];
  if (override) return executable(override, env, platform);
  return which('blender', env, platform) ?? blenderFallbacks(platform, home, env).map((p) => executable(p, env, platform)).find((p) => p !== null) ?? null;
}

/** The uvx executable, or null. */
export function findUvx(opts: DetectOptions = {}): string | null {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? homedir();
  const override = env[UVX_ENV];
  if (override) return executable(override, env, platform);
  const exe = platform === 'win32' ? 'uvx.exe' : 'uvx';
  return which('uvx', env, platform) ?? [join(home, '.local', 'bin', exe), join(home, '.cargo', 'bin', exe)].map((p) => executable(p, env, platform)).find((p) => p !== null) ?? null;
}

/** Everything at once. */
export function detectBlender(opts: DetectOptions = {}): BlenderInstall {
  return { blender: findBlender(opts), addon: findAddon(opts), uvx: findUvx(opts) };
}

/** Why Blender cannot be used (null: everything was found). */
export function missingDetail(install: BlenderInstall): string | null {
  if (!install.blender) return `Blender was not found. Install Blender 4.2 or newer, or set ${BLENDER_ENV} to its executable.`;
  if (!install.addon) return 'The MCP for Blender add-on is not installed in Blender (pip install mcp-for-blender gives addon.py; install it in Blender, then run scripts/blender/mcp-addon-setup.py).';
  if (!install.uvx) return `uvx was not found (install uv from https://docs.astral.sh/uv/, or set ${UVX_ENV}).`;
  return null;
}
