/**
 * CLI discovery beyond PATH: a server started under one Node version must
 * still find a Codex CLI that was installed globally under another (nvm),
 * honour AETHER_CODEX_BIN, and say clearly what to do when nothing is found.
 * Every case runs against a fake home in a temp folder, never this machine's
 * real install locations.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { probeCodex } from '../src/backends/status';
import { resolveCommands } from '../src/headless';
import { restrictedEnv } from '../src/sandbox';
import { cliMissingDetail, fallbackDirs, locateCli } from '../src/which';

const posix = process.platform !== 'win32';

let root: string;
let home: string;
let emptyPath: string;

function exe(dir: string, name: string, mode = 0o755): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, '#!/bin/sh\necho ok\n');
  chmodSync(p, mode);
  return p;
}

function envOf(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { HOME: home, PATH: emptyPath, ...extra };
}

const opts = (env: NodeJS.ProcessEnv, nodeVersion = 'v24.14.0') => ({ env, platform: 'linux' as const, nodeVersion, systemDirs: [join(root, 'usr-local-bin')] });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aether-cli-discovery-'));
  home = join(root, 'home');
  emptyPath = join(root, 'empty-bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(emptyPath, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe.runIf(posix)('locateCli', () => {
  it('finds codex installed under another nvm Node version when PATH has none', () => {
    const p = exe(join(home, '.nvm', 'versions', 'node', 'v22.19.0', 'bin'), 'codex');
    expect(locateCli('codex', opts(envOf()))).toEqual({ path: p, source: 'fallback' });
  });

  it("prefers the running Node's nvm folder, then the newest version", () => {
    const nvm = join(home, '.nvm', 'versions', 'node');
    exe(join(nvm, 'v20.19.5', 'bin'), 'codex');
    const v22 = exe(join(nvm, 'v22.22.0', 'bin'), 'codex');
    exe(join(nvm, 'v22.9.0', 'bin'), 'codex');
    expect(locateCli('codex', opts(envOf(), 'v24.14.0')).path).toBe(v22);
    const v20 = join(nvm, 'v20.19.5', 'bin', 'codex');
    expect(locateCli('codex', opts(envOf(), 'v20.19.5')).path).toBe(v20);
  });

  it('skips files that are not executable', () => {
    exe(join(home, '.nvm', 'versions', 'node', 'v24.14.0', 'bin'), 'codex', 0o644);
    const p = exe(join(home, '.local', 'bin'), 'codex');
    expect(locateCli('codex', opts(envOf())).path).toBe(p);
  });

  it('PATH wins over the fallback folders', () => {
    exe(join(home, '.nvm', 'versions', 'node', 'v22.19.0', 'bin'), 'codex');
    const onPath = exe(join(root, 'path-bin'), 'codex');
    expect(locateCli('codex', opts(envOf({ PATH: join(root, 'path-bin') })))).toEqual({ path: onPath, source: 'path' });
  });

  it('honours AETHER_CODEX_BIN over PATH, and reports a bad one instead of guessing', () => {
    exe(join(root, 'path-bin'), 'codex');
    const pinned = exe(join(root, 'custom'), 'my-codex');
    expect(locateCli('codex', opts(envOf({ PATH: join(root, 'path-bin'), AETHER_CODEX_BIN: pinned })))).toEqual({ path: pinned, source: 'override' });
    const bad = locateCli('codex', opts(envOf({ PATH: join(root, 'path-bin'), AETHER_CODEX_BIN: join(root, 'nope') })));
    expect(bad.path).toBeNull();
    expect(bad.badOverride).toBe(join(root, 'nope'));
    expect(locateCli('codex', opts(envOf({ AETHER_CODEX_BIN: 'relative/codex' }))).path).toBeNull();
  });

  it('looks in npm prefixes, ~/.npm-global, Volta, pnpm and the system folders', () => {
    const dirs = fallbackDirs({ env: envOf({ npm_config_prefix: join(root, 'prefix'), VOLTA_HOME: join(root, 'volta'), PNPM_HOME: join(root, 'pnpm') }), platform: 'linux', systemDirs: ['/usr/local/bin'] });
    expect(dirs).toEqual(expect.arrayContaining([join(root, 'prefix', 'bin'), join(root, 'volta', 'bin'), join(root, 'pnpm'), join(home, '.npm-global', 'bin'), join(home, '.local', 'bin'), '/usr/local/bin']));
    expect(dirs.at(-1)).toBe('/usr/local/bin');
    const sys = exe(join(root, 'usr-local-bin'), 'claude');
    expect(locateCli('claude', opts(envOf())).path).toBe(sys);
  });

  it('uses Windows npm and nvm-windows folders', () => {
    const dirs = fallbackDirs({ env: { USERPROFILE: 'C:\\Users\\a', APPDATA: 'C:\\Users\\a\\AppData\\Roaming', NVM_SYMLINK: 'C:\\nvm4w\\nodejs' }, platform: 'win32', systemDirs: [] });
    expect(dirs.some((d) => d.endsWith('npm'))).toBe(true);
    expect(dirs).toContain('C:\\nvm4w\\nodejs');
  });

  it('resolveCommands uses the same search', () => {
    const p = exe(join(home, '.nvm', 'versions', 'node', 'v22.19.0', 'bin'), 'codex');
    expect(resolveCommands({ env: envOf() }).codex).toBe(p);
  });
});

describe('missing-CLI message', () => {
  it('says how to install Codex or point AETHER_CODEX_BIN at it, within the status detail limit', async () => {
    const detail = cliMissingDetail('codex', envOf());
    expect(detail).toMatch(/npm i -g @openai\/codex/);
    expect(detail).toMatch(/AETHER_CODEX_BIN/);
    expect(detail.length).toBeLessThanOrEqual(200);
    const status = await probeCodex({ codexCommand: null, claudeCommand: null, env: envOf() });
    expect(status.installed).toBe(false);
    expect(status.detail).toBe(detail);
  });

  it('names a bad override plainly', () => {
    const detail = cliMissingDetail('codex', envOf({ AETHER_CODEX_BIN: join(root, 'gone', 'codex') }));
    expect(detail).toMatch(/AETHER_CODEX_BIN is set to .*not an executable file/);
    expect(detail.length).toBeLessThanOrEqual(200);
  });

  it('passes the override to the worker environment (a path, not a secret)', () => {
    expect(restrictedEnv({ AETHER_CODEX_BIN: '/opt/codex', AETHER_CLAUDE_BIN: '/opt/claude', OPENAI_API_KEY: 'x' })).toEqual({ AETHER_CODEX_BIN: '/opt/codex', AETHER_CLAUDE_BIN: '/opt/claude' });
  });
});
