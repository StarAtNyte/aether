/**
 * The `aether` CLI: argument parsing, state folder and files, stale pid
 * detection, port choice, build staleness, server environment, platform
 * command plans, log formatting and doctor checks.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PORT, isLoopbackHost, normalizeStudioOrigin, parseArgs } from '../src/args';
import { buildReason, newestMtime } from '../src/build';
import { checkDisk, checkNode } from '../src/doctor';
import { formatLogLine, lastLines, readTail } from '../src/logs';
import { pickPort } from '../src/ports';
import { serverEnv, serverUrl } from '../src/server';
import { classify, clearServerRecord, loadOrCreateSecret, pidAlive, readSecret, readServerRecord, resolveStateDir, statePaths, writeServerRecord, type ServerRecord } from '../src/state';
import { browserCommand, commandPlan } from '../src/system';
import { signInArgs } from '../src/accounts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'aether-cli-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function ok(argv: string[], env: Record<string, string> = {}): ReturnType<typeof parseArgs> & { ok: true } {
  const r = parseArgs(argv, env);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe('argument parsing', () => {
  it('defaults to a loopback start on the default port', () => {
    const { options } = ok([]);
    expect(options).toMatchObject({ command: 'start', port: null, host: '127.0.0.1', allowLan: false, open: false, build: 'auto', origins: [] });
    expect(DEFAULT_PORT).toBe(4280);
  });

  it('parses commands and flags (both --flag value and --flag=value)', () => {
    expect(ok(['start', '--port', '5000', '--open', '--no-build']).options).toMatchObject({ command: 'start', port: 5000, open: true, build: 'never' });
    expect(ok(['start', '--port=5001', '--rebuild']).options).toMatchObject({ port: 5001, build: 'always' });
    expect(ok(['logs', '-f', '-n', '20']).options).toMatchObject({ command: 'logs', follow: true, lines: 20 });
    expect(ok(['login', '--device-auth']).options).toMatchObject({ command: 'login', deviceAuth: true, backend: 'codex' });
    expect(ok(['logout', '--claude']).options).toMatchObject({ command: 'logout', backend: 'claude' });
    expect(ok(['stop', '--force']).options).toMatchObject({ command: 'stop', force: true });
    expect(ok(['--help']).options.command).toBe('help');
    expect(ok(['-v']).options.command).toBe('version');
    expect(ok(['status'], { AETHER_STATE_DIR: '/tmp/x' }).options.stateDir).toBe('/tmp/x');
    expect(ok(['status', '--state-dir', '/tmp/y'], { AETHER_STATE_DIR: '/tmp/x' }).options.stateDir).toBe('/tmp/y');
  });

  it('rejects unknown commands, unknown flags, bad ports and missing values', () => {
    for (const argv of [['bogus'], ['start', 'extra'], ['--nope'], ['--port', '0'], ['--port', '70000'], ['--port', 'abc'], ['--port'], ['-n', '0'], ['--host', 'bad host']]) {
      const r = parseArgs(argv);
      expect(r.ok, argv.join(' ')).toBe(false);
    }
  });

  it('refuses a non-loopback host without --allow-lan, and warns with it', () => {
    const refused = parseArgs(['--host', '0.0.0.0']);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/--allow-lan/);
    expect(parseArgs(['--allow-lan']).ok).toBe(false);
    const lan = ok(['--host', '0.0.0.0', '--allow-lan']);
    expect(lan.options.allowLan).toBe(true);
    expect(lan.warnings.join(' ')).toMatch(/network/);
    expect(ok(['--host', 'localhost']).warnings).toEqual([]);
  });

  it('accepts only https studio origins for the bridge (loopback http for testing)', () => {
    expect(normalizeStudioOrigin('https://studio.example/path?q=1')).toBe('https://studio.example');
    expect(normalizeStudioOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    for (const bad of ['http://studio.example', 'https://*.example', 'https://u:p@studio.example', 'javascript:alert(1)', 'not a url']) expect(normalizeStudioOrigin(bad), bad).toBeNull();
    expect(ok(['--origin', 'https://a.example', '--origin', 'https://a.example/']).options.origins).toEqual(['https://a.example']);
    expect(parseArgs(['--origin', 'http://evil.example']).ok).toBe(false);
  });

  it('recognises loopback hosts', () => {
    for (const h of ['127.0.0.1', 'localhost', '::1', '127.1.2.3']) expect(isLoopbackHost(h)).toBe(true);
    for (const h of ['0.0.0.0', '192.168.1.2', 'example.com']) expect(isLoopbackHost(h)).toBe(false);
  });
});

describe('state folder', () => {
  it('follows XDG on Linux/macOS, LOCALAPPDATA on Windows, and honours overrides', () => {
    expect(resolveStateDir({}, 'linux', '/home/u')).toBe(join('/home/u', '.local', 'state', 'aether'));
    expect(resolveStateDir({ XDG_STATE_HOME: '/xdg' }, 'linux', '/home/u')).toBe(join('/xdg', 'aether'));
    // Relative XDG values are invalid per the spec and ignored.
    expect(resolveStateDir({ XDG_STATE_HOME: 'rel' }, 'darwin', '/Users/u')).toBe(join('/Users/u', '.local', 'state', 'aether'));
    expect(resolveStateDir({ LOCALAPPDATA: process.platform === 'win32' ? 'C:\\Users\\u\\AppData\\Local' : '/appdata' }, 'win32', '/home/u')).toMatch(/Aether$/);
    expect(resolveStateDir({ AETHER_STATE_DIR: '/custom' }, 'linux', '/home/u')).toBe(join('/custom'));
    expect(resolveStateDir({ AETHER_STATE_DIR: '/custom' }, 'linux', '/home/u', '/flag')).toBe(join('/flag'));
  });

  it('writes and validates the server record (0600), rejecting tampered or oversized files', () => {
    const paths = statePaths(tmp());
    const rec: ServerRecord = { version: 1, pid: 1234, port: 4280, host: '127.0.0.1', url: 'http://127.0.0.1:4280', instance: 'abcdef12-3456', startedAt: 1, lan: false, bridge: null };
    writeServerRecord(paths, rec);
    expect(readServerRecord(paths)).toEqual(rec);
    if (process.platform !== 'win32') expect(statSync(paths.server).mode & 0o777).toBe(0o600);
    writeFileSync(paths.server, JSON.stringify({ ...rec, pid: -1 }));
    expect(readServerRecord(paths)).toBeNull();
    writeFileSync(paths.server, JSON.stringify({ ...rec, extra: 1 }));
    expect(readServerRecord(paths)).toBeNull();
    writeFileSync(paths.server, JSON.stringify({ ...rec, url: 'javascript:alert(1)' }));
    expect(readServerRecord(paths)).toBeNull();
    writeFileSync(paths.server, 'x'.repeat(20_000));
    expect(readServerRecord(paths)).toBeNull();
    writeFileSync(paths.server, '{not json');
    expect(readServerRecord(paths)).toBeNull();
    clearServerRecord(paths);
    expect(readServerRecord(paths)).toBeNull();
  });

  it('creates the per-install secret once (0600) and replaces a damaged one', () => {
    const paths = statePaths(tmp());
    expect(readSecret(paths.secret)).toBeNull();
    const a = loadOrCreateSecret(paths.secret);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(loadOrCreateSecret(paths.secret)).toBe(a);
    expect(readSecret(paths.secret)).toBe(a);
    if (process.platform !== 'win32') expect(statSync(paths.secret).mode & 0o777).toBe(0o600);
    writeFileSync(paths.secret, 'short');
    const b = loadOrCreateSecret(paths.secret);
    expect(b).not.toBe(a);
    expect(readFileSync(paths.secret, 'utf8').trim()).toBe(b);
  });
});

describe('stale pid detection', () => {
  const rec: ServerRecord = { version: 1, pid: 99, port: 1, host: '127.0.0.1', url: 'http://127.0.0.1:1', instance: 'instance-0001', startedAt: 0, lan: false, bridge: null };

  it('classifies running / unresponsive / stale', () => {
    expect(classify(rec, { instance: 'instance-0001' }, true)).toBe('running');
    // A different Aether (or anything else) answering on the port is not ours.
    expect(classify(rec, { instance: 'instance-0002' }, false)).toBe('stale');
    expect(classify(rec, { instance: 'instance-0002' }, true)).toBe('unresponsive');
    expect(classify(rec, null, true)).toBe('unresponsive');
    expect(classify(rec, null, false)).toBe('stale');
  });

  it('treats ESRCH as dead and EPERM as alive', () => {
    const err = (code: string) => () => {
      throw Object.assign(new Error(code), { code });
    };
    expect(pidAlive(5, err('ESRCH'))).toBe(false);
    expect(pidAlive(5, err('EPERM'))).toBe(true);
    expect(pidAlive(5, () => undefined)).toBe(true);
    expect(pidAlive(0, () => undefined)).toBe(false);
    expect(pidAlive(process.pid)).toBe(true);
  });

  it('sees a real exited process as dead', async () => {
    const child = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
    const pid = child.pid ?? 0;
    await new Promise((r) => child.once('exit', r));
    // Reaped: the pid no longer exists (pid reuse within this window is practically impossible).
    expect(pidAlive(pid)).toBe(false);
  });
});

describe('port choice', () => {
  const busy = (taken: number[]) => async (p: number) => !taken.includes(p);

  it('uses the preferred port, falls forward, then falls back to an ephemeral port', async () => {
    expect(await pickPort({ preferred: 4280, explicit: false, host: '127.0.0.1', isFree: busy([]) })).toEqual({ port: 4280 });
    expect(await pickPort({ preferred: 4280, explicit: false, host: '127.0.0.1', isFree: busy([4280, 4281]) })).toEqual({ port: 4282 });
    expect(await pickPort({ preferred: 4280, explicit: false, host: '127.0.0.1', range: 2, isFree: busy([4280, 4281]), ephemeral: async () => 51234 })).toEqual({ port: 51234 });
  });

  it('never replaces an explicit port', async () => {
    const r = await pickPort({ preferred: 5000, explicit: true, host: '127.0.0.1', isFree: busy([5000]) });
    expect(r).toHaveProperty('error');
  });
});

describe('studio build staleness', () => {
  it('is missing without dist, stale when a source is newer, current otherwise; ignores tests and node_modules', () => {
    const root = tmp();
    mkdirSync(join(root, 'apps/studio/src'), { recursive: true });
    mkdirSync(join(root, 'apps/studio/dist'), { recursive: true });
    mkdirSync(join(root, 'packages/core/src'), { recursive: true });
    mkdirSync(join(root, 'packages/core/test'), { recursive: true });
    mkdirSync(join(root, 'packages/core/node_modules/x'), { recursive: true });
    const index = join(root, 'apps/studio/dist/index.html');
    expect(buildReason(root, index)).toBe('missing');
    const src = join(root, 'packages/core/src/a.ts');
    writeFileSync(src, 'x');
    writeFileSync(index, '<html>');
    const t = Date.now() / 1000;
    utimesSync(src, t - 100, t - 100);
    utimesSync(index, t - 50, t - 50);
    expect(buildReason(root, index)).toBeNull();
    const testFile = join(root, 'packages/core/test/a.test.ts');
    writeFileSync(testFile, 'x');
    writeFileSync(join(root, 'packages/core/node_modules/x/y.js'), 'x');
    expect(buildReason(root, index)).toBeNull();
    utimesSync(src, t, t);
    expect(buildReason(root, index)).toBe('stale');
    expect(newestMtime(root)).toBeGreaterThan(0);
  });
});

describe('server environment', () => {
  const paths = statePaths('/state');
  const base = { root: '/repo', paths, port: 4280, host: '127.0.0.1', instance: 'abcdef12-0000', lanAddresses: [] as string[], accessTokenFile: null, origins: [] as string[], bridgePort: 8790 };

  it('turns on the local hardening and never uses owner API keys or hosting markers', () => {
    const env = serverEnv({ PATH: '/bin', HOME: '/home/u', VERCEL: '1', OPENAI_API_KEY: 'sk-owner', AETHER_ACCESS_TOKEN_FILE: '/stale', AETHER_BRIDGE_ORIGINS: 'https://old' }, base);
    expect(env).toMatchObject({
      PORT: '4280',
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      SERVE_STATIC: 'true',
      AETHER_LOCAL_AI: 'on',
      AETHER_PROVIDER: 'mock',
      AETHER_ALLOWED_HOSTS: '127.0.0.1:4280,localhost:4280',
      ALLOWED_ORIGINS: 'http://127.0.0.1:4280,http://localhost:4280',
      AETHER_SECRET_FILE: join('/state', 'secret'),
      AETHER_INSTANCE_ID: 'abcdef12-0000',
      AETHER_LOG_FILE: join('/state', 'server.log'),
      DATA_DIR: join('/state', 'data'),
      PATH: '/bin',
    });
    expect(env['VERCEL']).toBeUndefined();
    expect(env['AETHER_ACCESS_TOKEN_FILE']).toBeUndefined();
    expect(env['AETHER_BRIDGE_ORIGINS']).toBeUndefined();
  });

  it('adds LAN hosts, the access token and the bridge when asked', () => {
    const env = serverEnv({}, { ...base, host: '0.0.0.0', lanAddresses: ['192.168.1.5'], accessTokenFile: '/state/access-token', origins: ['https://studio.example'], bridgePort: 9000 });
    expect(env['AETHER_ALLOWED_HOSTS']).toBe('127.0.0.1:4280,localhost:4280,192.168.1.5:4280');
    expect(env['AETHER_ACCESS_TOKEN_FILE']).toBe('/state/access-token');
    expect(env['AETHER_BRIDGE_ORIGINS']).toBe('https://studio.example');
    expect(env['AETHER_BRIDGE_PORT']).toBe('9000');
  });

  it('prints a loopback link, or the LAN address in LAN mode', () => {
    expect(serverUrl('127.0.0.1', 4280, [])).toBe('http://127.0.0.1:4280');
    expect(serverUrl('localhost', 4280, [])).toBe('http://127.0.0.1:4280');
    expect(serverUrl('0.0.0.0', 4280, ['192.168.1.5'])).toBe('http://192.168.1.5:4280');
    expect(serverUrl('0.0.0.0', 4280, [])).toBe('http://127.0.0.1:4280');
    expect(serverUrl('10.0.0.2', 4280, ['10.0.0.2'])).toBe('http://10.0.0.2:4280');
  });
});

describe('platform command plans', () => {
  it('runs Windows .cmd shims through cmd.exe with quoted fixed arguments, refusing metacharacters', () => {
    const plan = commandPlan('C:\\npm\\codex.cmd', ['login', '--device-auth'], 'win32', 'C:\\Windows\\system32\\cmd.exe');
    expect(plan).toEqual({ command: 'C:\\Windows\\system32\\cmd.exe', args: ['/d', '/s', '/c', '""C:\\npm\\codex.cmd" "login" "--device-auth""'], verbatim: true });
    expect(() => commandPlan('C:\\npm\\codex.cmd', ['a&calc'], 'win32')).toThrow();
    expect(commandPlan('/usr/bin/codex', ['login'], 'linux')).toEqual({ command: '/usr/bin/codex', args: ['login'], verbatim: false });
    expect(commandPlan('C:\\bin\\codex.exe', ['login'], 'win32').verbatim).toBe(false);
  });

  it('opens the browser without a shell on every platform', () => {
    expect(browserCommand('http://127.0.0.1:4280', 'linux')).toEqual({ command: 'xdg-open', args: ['http://127.0.0.1:4280'] });
    expect(browserCommand('http://127.0.0.1:4280', 'darwin')).toEqual({ command: 'open', args: ['http://127.0.0.1:4280'] });
    expect(browserCommand('http://127.0.0.1:4280', 'win32')).toEqual({ command: 'rundll32', args: ['url.dll,FileProtocolHandler', 'http://127.0.0.1:4280'] });
  });

  it('signs in with the browser flow by default and the device code on request', () => {
    expect(signInArgs('codex', false)).toEqual(['login']);
    expect(signInArgs('codex', true)).toEqual(['login', '--device-auth']);
    expect(signInArgs('claude', false)).toEqual(['auth', 'login', '--claudeai']);
  });
});

describe('logs and doctor', () => {
  it('pretty-prints JSON log lines and strips terminal escapes', () => {
    expect(formatLogLine('{"level":"info","time":"2026-10-14T04:18:08.000Z","msg":"request","path":"/","status":200}')).toBe('04:18:08 INFO  request  path=/ status=200');
    expect(formatLogLine('plain \u001b[31mred\u001b[0m text')).toBe('plain [31mred[0m text');
    expect(formatLogLine('{broken')).toBe('{broken');
  });

  it('tails the last lines of a file, dropping a partial first line', () => {
    const f = join(tmp(), 'log');
    writeFileSync(f, Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n') + '\n');
    expect(lastLines(readTail(f), 3)).toEqual(['line 97', 'line 98', 'line 99']);
    const tail = readTail(f, 20);
    expect(tail.startsWith('line')).toBe(true);
    expect(readTail(join(tmp(), 'missing'))).toBe('');
  });

  it('checks the Node version and disk space', () => {
    expect(checkNode('v22.1.0').status).toBe('ok');
    expect(checkNode('v20.11.0').status).toBe('fail');
    expect(checkDisk(10 * 1024 ** 3).status).toBe('ok');
    expect(checkDisk(100 * 1024 ** 2).status).toBe('warn');
    expect(checkDisk(null).status).toBe('warn');
  });
});
