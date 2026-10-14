/**
 * Local app hardening (`aether start`): Host allowlist (DNS rebinding),
 * per-install session cookie on the studio page and on `/api/local/*`, LAN
 * access token, CLI-only shutdown and bridge pairing, rotating log file.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAi } from '@aether/bridge';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, redactConfig, secretValues } from '../src/config';
import { hostAllowed, secretEquals, ADMIN_HEADER } from '../src/local-guard';
import { createRotatingSink } from '../src/log-file';
import { cleanupDirs, makeApp, makeConfig } from './helpers';

const SECRET = 'S'.repeat(20) + 'abcdefghijklmnop_-0123';
const TOKEN = 'T'.repeat(16) + 'qrstuvwxyz0123456789AB';
const dirs: string[] = [];
const services: LocalAi[] = [];

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'aether-guard-'));
  dirs.push(d);
  return d;
}

function secretFile(value: string): string {
  const f = join(tmp(), 'secret');
  writeFileSync(f, `${value}\n`, { mode: 0o600 });
  return f;
}

function staticDir(): string {
  const d = tmp();
  writeFileSync(join(d, 'index.html'), '<!doctype html><title>Aether</title>');
  return d;
}

function localService(): LocalAi {
  const local = new LocalAi({
    dataDir: tmp(),
    commands: { codex: null, claude: null },
    runWorker: async () => ({ ok: true, kind: 'complete', text: '{}', model: 'm' }),
    probe: async () => [{ id: 'codex', label: 'Codex', installed: true, loggedIn: true, detail: 'Logged in', models: [] }],
  });
  services.push(local);
  return local;
}

afterEach(() => {
  for (const s of services.splice(0)) s.dispose();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  cleanupDirs();
});

describe('local app config', () => {
  it('binds 127.0.0.1 by default and parses hosts, secrets and bridge origins', () => {
    expect(makeConfig().host).toBe('127.0.0.1');
    const c = makeConfig({
      AETHER_LOCAL_AI: 'on',
      AETHER_ALLOWED_HOSTS: '127.0.0.1:4280, LOCALHOST:4280',
      AETHER_SECRET_FILE: secretFile(SECRET),
      AETHER_INSTANCE_ID: 'abc12345-run',
      AETHER_BRIDGE_ORIGINS: 'https://studio.example/',
    });
    expect(c.local.allowedHosts).toEqual(['127.0.0.1:4280', 'localhost:4280']);
    expect(c.local.sessionSecret).toBe(SECRET);
    expect(c.local.bridge).toEqual({ origins: ['https://studio.example'], port: 8790 });
    expect(secretValues(c)).toContain(SECRET);
    expect(JSON.stringify(redactConfig(c))).not.toContain(SECRET);
  });

  it('rejects bad hosts, unreadable or malformed secret files, insecure bridge origins (never echoing values)', () => {
    expect(() => makeConfig({ AETHER_ALLOWED_HOSTS: 'evil host' })).toThrow(ConfigError);
    expect(() => makeConfig({ AETHER_SECRET_FILE: join(tmpdir(), 'missing-aether-secret') })).toThrow(/cannot be read/);
    const bad = secretFile('short');
    try {
      makeConfig({ AETHER_SECRET_FILE: bad });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain('short');
    }
    expect(() => makeConfig({ AETHER_LOCAL_AI: 'on', AETHER_BRIDGE_ORIGINS: 'http://evil.example' })).toThrow(ConfigError);
    // The bridge spends the local subscription: never without local AI (e.g. on a hosted platform).
    expect(() => loadConfig({ AETHER_PROVIDER: 'mock', NODE_ENV: 'production', AETHER_BRIDGE_ORIGINS: 'https://studio.example' })).toThrow(/needs local AI/);
  });
});

describe('host allowlist (DNS rebinding)', () => {
  it('matches exact host:port values only', () => {
    const set = new Set(['127.0.0.1:4280', 'localhost:4280']);
    expect(hostAllowed('127.0.0.1:4280', set)).toBe(true);
    expect(hostAllowed('LOCALHOST:4280', set)).toBe(true);
    expect(hostAllowed('localhost:4281', set)).toBe(false);
    expect(hostAllowed('rebind.attacker.example:4280', set)).toBe(false);
    expect(hostAllowed(undefined, set)).toBe(false);
    expect(hostAllowed('x'.repeat(400), set)).toBe(false);
  });

  it('refuses every route (static and API) for a foreign Host', async () => {
    const app = makeApp(makeConfig({ AETHER_ALLOWED_HOSTS: '127.0.0.1:4280,localhost:4280' }));
    const evil = await app.request('http://rebind.attacker.example:4280/api/health', { headers: { host: 'rebind.attacker.example:4280' } });
    expect(evil.status).toBe(421);
    const ok = await app.request('http://127.0.0.1:4280/api/health', { headers: { host: '127.0.0.1:4280' } });
    expect(ok.status).toBe(200);
  });
});

describe('session secret', () => {
  it('compares in constant time and rejects empty or oversized values', () => {
    expect(secretEquals(SECRET, SECRET)).toBe(true);
    expect(secretEquals(`${SECRET}x`, SECRET)).toBe(false);
    expect(secretEquals('', SECRET)).toBe(false);
    expect(secretEquals(undefined, SECRET)).toBe(false);
    expect(secretEquals('a'.repeat(300), SECRET)).toBe(false);
  });

  it('sets an HttpOnly SameSite=Strict cookie on the studio page and requires it on /api/local/*', async () => {
    const config = makeConfig({ AETHER_LOCAL_AI: 'on', SERVE_STATIC: 'true', STATIC_DIR: staticDir(), AETHER_SECRET_FILE: secretFile(SECRET) });
    const app = makeApp(config, { local: localService(), isLoopback: () => true });
    const page = await app.request('http://127.0.0.1/', { headers: { host: '127.0.0.1', accept: 'text/html' } });
    expect(page.status).toBe(200);
    const cookie = page.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`aether_session=${SECRET}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    // No cookie on API responses.
    expect((await app.request('http://127.0.0.1/api/health', { headers: { host: '127.0.0.1' } })).headers.get('set-cookie')).toBeNull();

    const without = await app.request('http://127.0.0.1/api/local/status', { headers: { host: '127.0.0.1' } });
    expect(without.status).toBe(401);
    expect(await without.text()).not.toContain(SECRET);
    const wrong = await app.request('http://127.0.0.1/api/local/status', { headers: { host: '127.0.0.1', cookie: 'aether_session=nope' } });
    expect(wrong.status).toBe(401);
    const withCookie = await app.request('http://127.0.0.1/api/local/status', { headers: { host: '127.0.0.1', cookie: `aether_session=${SECRET}` } });
    expect(withCookie.status).toBe(200);
    const cli = await app.request('http://127.0.0.1/api/local/status', { headers: { host: '127.0.0.1', [ADMIN_HEADER]: SECRET } });
    expect(cli.status).toBe(200);
  });

  it('keeps the loopback-only rule even with the secret', async () => {
    const config = makeConfig({ AETHER_LOCAL_AI: 'on', AETHER_SECRET_FILE: secretFile(SECRET) });
    const app = makeApp(config, { local: localService(), isLoopback: () => false });
    const r = await app.request('http://127.0.0.1/api/local/status', { headers: { host: '127.0.0.1', cookie: `aether_session=${SECRET}` } });
    expect(r.status).toBe(403);
  });

  it('serves the CLI-only shutdown and bridge pairing endpoints', async () => {
    let stopped = 0;
    let issued = 0;
    const config = makeConfig({ AETHER_LOCAL_AI: 'on', AETHER_SECRET_FILE: secretFile(SECRET) });
    const bridge = { url: 'http://127.0.0.1:8790', origins: ['https://studio.example'], code: () => 'ABCD-EFGH', issue: () => `tok${++issued}`.padEnd(43, 'x') };
    const app = makeApp(config, { local: localService(), isLoopback: () => true, requestShutdown: () => stopped++, bridge });
    const h = { host: '127.0.0.1' };
    expect((await app.request('http://127.0.0.1/api/admin/shutdown', { method: 'POST', headers: h })).status).toBe(401);
    // The studio's cookie is not enough: only the CLI header may stop the server or mint pairing links.
    expect((await app.request('http://127.0.0.1/api/admin/shutdown', { method: 'POST', headers: { ...h, cookie: `aether_session=${SECRET}` } })).status).toBe(401);
    expect((await app.request('http://127.0.0.1/api/local/bridge/pair', { method: 'POST', headers: { ...h, cookie: `aether_session=${SECRET}` } })).status).toBe(401);
    expect(stopped).toBe(0);
    const pair = await app.request('http://127.0.0.1/api/local/bridge/pair', { method: 'POST', headers: { ...h, [ADMIN_HEADER]: SECRET } });
    expect(pair.status).toBe(200);
    const body = (await pair.json()) as { code: string; links: string[]; url: string };
    expect(body.code).toBe('ABCD-EFGH');
    expect(body.links[0]).toMatch(/^https:\/\/studio\.example\/\?bridge=http%3A%2F%2F127\.0\.0\.1%3A8790#aether-bridge=tok1/);
    const stop = await app.request('http://127.0.0.1/api/admin/shutdown', { method: 'POST', headers: { ...h, [ADMIN_HEADER]: SECRET } });
    expect(stop.status).toBe(202);
    expect(stopped).toBe(1);
  });

  it('reports the instance id in /api/health only when configured', async () => {
    const plain = makeApp(makeConfig());
    expect(await (await plain.request('/api/health')).json()).not.toHaveProperty('instance');
    const app = makeApp(makeConfig({ AETHER_INSTANCE_ID: 'run-0123456789' }));
    expect(await (await app.request('/api/health')).json()).toMatchObject({ instance: 'run-0123456789' });
  });
});

describe('LAN access token', () => {
  it('turns ?access=<token> into a cookie + clean redirect and gates everything but /api/health', async () => {
    const app = makeApp(makeConfig({ SERVE_STATIC: 'true', STATIC_DIR: staticDir(), AETHER_ACCESS_TOKEN_FILE: secretFile(TOKEN) }));
    const h = { host: '192.168.1.5:4280', accept: 'text/html' };
    expect((await app.request('http://192.168.1.5:4280/', { headers: h })).status).toBe(403);
    expect((await app.request('http://192.168.1.5:4280/api/health', { headers: h })).status).toBe(200);
    expect((await app.request(`http://192.168.1.5:4280/?access=wrong`, { headers: h })).status).toBe(403);
    const first = await app.request(`http://192.168.1.5:4280/?access=${TOKEN}&x=1`, { headers: h });
    expect(first.status).toBe(303);
    expect(first.headers.get('location')).toBe('/?x=1');
    expect(first.headers.get('set-cookie') ?? '').toMatch(/aether_access=.*HttpOnly/i);
    const page = await app.request('http://192.168.1.5:4280/', { headers: { ...h, cookie: `aether_access=${TOKEN}` } });
    expect(page.status).toBe(200);
  });
});

describe('rotating log file', () => {
  it('appends with mode 0600 and rotates past the size cap, keeping N copies', () => {
    const file = join(tmp(), 'server.log');
    const sink = createRotatingSink(file, { maxBytes: 4096, keep: 2 });
    const line = 'x'.repeat(1000);
    for (let i = 0; i < 20; i++) sink(`${i} ${line}`);
    expect(existsSync(file)).toBe(true);
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(existsSync(`${file}.2`)).toBe(true);
    expect(existsSync(`${file}.3`)).toBe(false);
    expect(statSync(file).size).toBeLessThanOrEqual(4096);
    expect(readFileSync(file, 'utf8')).toContain('19 ');
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
