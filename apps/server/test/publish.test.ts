/**
 * Publishing from the local app: the build library (validation, immutable
 * storage, safe serving with the player's CSP), the hosting publishers run
 * against FAKE CLIs on PATH (never a real deploy), deploy progress over
 * server-sent events, cancellation, the restricted environment, and the
 * LAN share (token, read-only, off by default).
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { LocalAi } from '@aether/bridge';
import { writeZip, type ZipEntry } from '@aether/assets/zip';
import { PLAY_CSP } from '../src/middleware';
import { checkGameJson, PublishStore } from '../src/publish/store';
import { deploySteps, findUrl, netlifyUrl, parseStatus, substitute, vercelUrl } from '../src/publish/hosts';
import { butlerCredsPath, cleanLine, type DeployEvent } from '../src/publish/jobs';
import type { PublishServices } from '../src/publish/services';
import { cleanupDirs, makeApp, makeConfig } from './helpers';

const posix = process.platform !== 'win32';
const dirs: string[] = [];
const services: LocalAi[] = [];
let publishServices: PublishServices | null = null;

afterEach(async () => {
  await publishServices?.dispose();
  publishServices = null;
  for (const s of services.splice(0)) s.dispose();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  cleanupDirs();
});

function temp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

const enc = new TextEncoder();
const world = createWorld({ name: 'Coin Island', entities: { box: { id: 'box', shape: { kind: 'primitive', primitive: 'box' } } } });
const gameJson = JSON.stringify({ format: 'aether-game', v: 1, title: 'Coin Island', world });

async function buildZip(extra: ZipEntry[] = [], opts: { game?: string | null; index?: boolean } = {}): Promise<Uint8Array> {
  const entries: ZipEntry[] = [
    ...(opts.index === false ? [] : [{ name: 'index.html', data: enc.encode('<!doctype html><title>Coin Island</title><script type="module" src="./assets/play-x.js"></script>') }]),
    { name: 'assets/play-x.js', data: enc.encode('console.log("player")') },
    ...(opts.game === null ? [] : [{ name: 'game.json', data: enc.encode(opts.game ?? gameJson) }]),
    ...extra,
  ];
  return writeZip(entries);
}

/** A directory of fake hosting CLIs (POSIX shell scripts) and a fake HOME. */
function fakeClis(opts: { slowDeploy?: boolean; itchCreds?: boolean } = {}): { env: NodeJS.ProcessEnv; home: string } {
  const bin = temp('aether-fake-bin-');
  const home = temp('aether-fake-home-');
  const script = (name: string, body: string): void => {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "$HOME/calls.log"\nenv >> "$HOME/env.log"\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  script(
    'netlify',
    `case "$1" in
  status) echo '{"account":{"Name":"Test User","Email":"t@example.org"}}' ;;
  sites:create) echo '{"id":"0123abcd-0000-4000-8000-0123456789ab","ssl_url":"https://my-game.netlify.app"}' ;;
  deploy) ${opts.slowDeploy ? 'sleep 30' : 'echo "Deploying"'}; echo '{"deploy_url":"https://abc--my-game.netlify.app","url":"https://my-game.netlify.app"}' ;;
esac`,
  );
  script(
    'vercel',
    `case "$1" in
  whoami) echo "testuser" ;;
  deploy) echo "Inspect: https://vercel.com/testuser/my-game/abc"; echo "Production: https://my-game.vercel.app" ;;
esac`,
  );
  script(
    'gh',
    `if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo testuser; exit 0; fi
if [ "$1" = "repo" ]; then echo "created"; exit 0; fi
case "$*" in
  *git/refs/heads/gh-pages*) echo "Not Found" 1>&2; exit 1 ;;
  *git/blobs*|*git/trees*|*git/commits*) echo 0123456789abcdef0123456789abcdef01234567 ;;
  *) echo '{}' ;;
esac`,
  );
  script('butler', `echo "pushing build"; echo "patch applied"`);
  if (opts.itchCreds !== false) {
    mkdirSync(join(home, '.config', 'itch'), { recursive: true });
    writeFileSync(join(home, '.config', 'itch', 'butler_creds'), 'x');
  }
  return {
    home,
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, NETLIFY_AUTH_TOKEN: 'super-secret-token', OPENAI_API_KEY: 'sk-secret-key', GH_TOKEN: 'ghp_secret' },
  };
}

function setup(env?: NodeJS.ProcessEnv): ReturnType<typeof makeApp> {
  const dataDir = temp('aether-publish-test-');
  const local = new LocalAi({ dataDir, commands: { codex: null, claude: null }, probe: async () => [] });
  services.push(local);
  return makeApp(makeConfig({ AETHER_LOCAL_AI: 'on' }), {
    local,
    isLoopback: () => true,
    publish: { dir: join(dataDir, 'published'), ...(env ? { env } : {}), lanHost: '127.0.0.1', lanAddresses: () => ['192.168.1.20'], tmpRoot: dataDir },
    onPublish: (s) => {
      publishServices = s;
    },
  });
}

const host = { host: 'localhost:8787' };

async function upload(app: ReturnType<typeof makeApp>, zip: Uint8Array): Promise<Response> {
  return app.request('/api/local/publish/builds', { method: 'POST', headers: { 'content-type': 'application/zip', ...host }, body: zip as Uint8Array<ArrayBuffer> });
}

async function waitJob(app: ReturnType<typeof makeApp>, id: string): Promise<{ state: string; url: string | null; error: string | null; events: DeployEvent[] }> {
  for (let i = 0; i < 200; i++) {
    const r = (await (await app.request(`/api/local/publish/jobs/${id}`, { headers: host })).json()) as { job: { state: string; url: string | null; error: string | null; events: DeployEvent[] } };
    if (r.job.state !== 'running') return r.job;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('job did not finish');
}

describe('published build store', () => {
  it('stores valid builds immutably and serves only their files', async () => {
    const store = new PublishStore(temp('aether-store-'));
    const meta = await store.add(await buildZip([{ name: 'assets/lib/m/x.0123abcd.glb', data: new Uint8Array([1, 2, 3]) }]));
    expect(meta.title).toBe('Coin Island');
    expect(meta.files).toBe(4);
    expect((await store.list()).map((b) => b.id)).toEqual([meta.id]);
    expect(await store.file(meta.id, '')).not.toBeNull();
    expect(await store.file(meta.id, 'assets/play-x.js')).not.toBeNull();
    for (const bad of ['../x', 'assets/../../etc/passwd', '%2e%2e/aether-build.json', 'aether-build.json', '/etc/passwd', 'assets\\play-x.js']) expect(await store.file(meta.id, bad), bad).toBeNull();
    expect(await store.file('nope', '')).toBeNull();
    expect(await store.remove(meta.id)).toBe(true);
    expect(await store.list()).toEqual([]);
  });

  it('rejects builds without a game, with unknown file types, invalid worlds or over the caps', async () => {
    const store = new PublishStore(temp('aether-store-'), { maxBuilds: 1, maxBuildBytes: 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024, maxFiles: 10, maxFileBytes: 512 * 1024 });
    await expect(store.add(await buildZip([], { game: null }))).rejects.toThrow(/index.html or game.json/);
    await expect(store.add(await buildZip([], { index: false }))).rejects.toThrow(/index.html or game.json/);
    await expect(store.add(await buildZip([{ name: 'run.exe', data: new Uint8Array(4) }]))).rejects.toThrow(/not allowed/);
    await expect(store.add(await buildZip([], { game: '{"format":"aether-game","world":{"entities":{"Bad Id":{}}}}' }))).rejects.toThrow(/invalid/);
    await expect(store.add(await buildZip([], { game: '{"format":"other"}' }))).rejects.toThrow(/not an Aether game/);
    await expect(store.add(await buildZip([{ name: 'big.js', data: new Uint8Array(600 * 1024) }]))).rejects.toThrow(/too large/);
    await expect(store.add(enc.encode('not a zip'))).rejects.toThrow(/rejected/);
    await store.add(await buildZip());
    await expect(store.add(await buildZip())).rejects.toThrow(/holds 1 builds/);
    expect(checkGameJson(enc.encode('{"format":"aether-game","world":{},"__proto__":{"x":1}}')).ok).toBe(false);
  });
});

describe('hosting publishers (pure)', () => {
  it('parses status, URLs and placeholders', () => {
    expect(parseStatus('netlify', 0, '{"account":{"Name":"Ann"}}', '')).toEqual({ signedIn: true, account: 'Ann' });
    expect(parseStatus('netlify', 1, '', 'Not logged in')).toEqual({ signedIn: false });
    expect(parseStatus('vercel', 0, 'Vercel CLI 40\nann\n', '')).toEqual({ signedIn: true, account: 'ann' });
    expect(parseStatus('github', 0, '<script>', '')).toEqual({ signedIn: false });
    expect(netlifyUrl('{"url":"https://x.netlify.app"}')).toBe('https://x.netlify.app/');
    expect(netlifyUrl('{"url":"https://evil.example"}')).toBeNull();
    expect(vercelUrl('a https://a.vercel.app\nProduction: https://b.vercel.app')).toBe('https://b.vercel.app/');
    expect(findUrl('see http://x.netlify.app and javascript:alert(1)', /netlify\.app$/)).toBeNull();
    const steps = deploySteps({ build: 'aaaaaaaaaaaa', target: 'github', name: 'my-game' }, ['index.html', 'game.json'], () => 'QQ==', 'v1');
    expect(steps.filter((s) => s.label.startsWith('Uploading'))).toHaveLength(2);
    const sub = substitute(steps[2], { owner: 'ann' }, { build: 'aaaaaaaaaaaa', target: 'github', name: 'my-game' });
    expect(sub?.args).toContain('repos/ann/my-game/git/blobs');
    const req = { build: 'aaaaaaaaaaaa', target: 'netlify' as const, name: 'x' };
    for (const s of deploySteps(req, [], () => '', 'v')) for (const a of substitute(s.args, {}, req)) expect(a).not.toMatch(/[;&|`$]/);
    expect(cleanLine('\u001b[32mok\u001b[0m\u0007')).toBe('ok');
    expect(butlerCredsPath({ HOME: '/h' }, 'linux')).toBe('/h/.config/itch/butler_creds');
  });
});

describe.runIf(posix)('publishing routes with fake CLIs', () => {
  it('lists hosting targets, signed-in state included, and never passes secrets to the CLIs', async () => {
    const { env, home } = fakeClis({ itchCreds: false });
    const app = setup(env);
    const r = (await (await app.request('/api/local/publish/targets', { headers: host })).json()) as { targets: Array<{ id: string; installed: boolean; signedIn: boolean; account?: string }> };
    const by = Object.fromEntries(r.targets.map((t) => [t.id, t]));
    expect(by['netlify']).toMatchObject({ installed: true, signedIn: true, account: 'Test User' });
    expect(by['vercel']).toMatchObject({ installed: true, signedIn: true, account: 'testuser' });
    expect(by['github']).toMatchObject({ installed: true, signedIn: true, account: 'testuser' });
    expect(by['itch']).toMatchObject({ installed: true, signedIn: false });
    const envLog = readFileSync(join(home, 'env.log'), 'utf8');
    expect(envLog).not.toMatch(/super-secret|sk-secret|ghp_secret/);
    expect(envLog).toMatch(/NO_COLOR=1/);
  });

  it('uploads a build, plays it locally with the player CSP, and deploys it to Netlify, Vercel, GitHub Pages and itch.io', async () => {
    const { env, home } = fakeClis();
    const app = setup(env);
    expect((await app.request('/api/local/publish/builds', { method: 'POST', headers: { 'content-type': 'application/json', ...host }, body: '{}' })).status).toBe(415);
    const up = await upload(app, await buildZip());
    expect(up.status).toBe(201);
    const { build, url } = (await up.json()) as { build: { id: string }; url: string };
    expect(url).toBe(`/published/${build.id}/`);
    const page = await app.request(url, { headers: host });
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toBe(PLAY_CSP);
    expect(page.headers.get('x-frame-options')).toBeNull();
    expect(await page.text()).toContain('Coin Island');
    expect((await app.request(`/published/${build.id}/aether-build.json`, { headers: host })).status).toBe(404);
    expect((await app.request(`/published/${build.id}/assets/play-x.js`, { headers: host })).headers.get('content-type')).toMatch(/javascript/);

    const deploy = async (body: Record<string, unknown>): Promise<{ state: string; url: string | null; error: string | null; events: DeployEvent[] }> => {
      const res = await app.request('/api/local/publish/deploy', { method: 'POST', headers: { 'content-type': 'application/json', ...host }, body: JSON.stringify({ build: build.id, ...body }) });
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(202);
      const { job } = (await res.json()) as { job: { id: string } };
      return waitJob(app, job.id);
    };
    const n = await deploy({ target: 'netlify', name: 'my-game' });
    expect(n).toMatchObject({ state: 'done', url: 'https://my-game.netlify.app/' });
    expect(n.events.some((e) => e.kind === 'step' && /Netlify/.test(e.text))).toBe(true);
    const v = await deploy({ target: 'vercel', name: 'my-game' });
    expect(v).toMatchObject({ state: 'done', url: 'https://my-game.vercel.app/' });
    const g = await deploy({ target: 'github', name: 'my-game' });
    expect(g).toMatchObject({ state: 'done', url: 'https://testuser.github.io/my-game/' });
    const i = await deploy({ target: 'itch', itch: 'testuser/my-game' });
    expect(i).toMatchObject({ state: 'done', url: 'https://testuser.itch.io/my-game' });
    const calls = readFileSync(join(home, 'calls.log'), 'utf8');
    expect(calls).toMatch(/netlify deploy --prod --dir \. --site 0123abcd-0000-4000-8000-0123456789ab --json/);
    expect(calls).toMatch(/vercel deploy \. --prod --yes/);
    expect(calls).toMatch(/gh api -X POST repos\/testuser\/my-game\/git\/blobs --input/);
    expect(calls).toMatch(/butler push \. testuser\/my-game:html5 --userversion/);
    // Throwaway build directories are removed.
    expect(existsSync(join(home, 'never'))).toBe(false);
    // Invalid requests are refused before anything runs.
    const bad = await app.request('/api/local/publish/deploy', { method: 'POST', headers: { 'content-type': 'application/json', ...host }, body: JSON.stringify({ build: build.id, target: 'netlify', name: 'Bad Name; rm -rf /' }) });
    expect(bad.status).toBe(400);
    const missing = await app.request('/api/local/publish/deploy', { method: 'POST', headers: { 'content-type': 'application/json', ...host }, body: JSON.stringify({ build: 'zzzzzzzzzzzz', target: 'vercel', name: 'x' }) });
    expect(missing.status).toBe(404);
  });

  it('streams progress over server-sent events and cancels a running deploy', async () => {
    const { env } = fakeClis({ slowDeploy: true });
    const app = setup(env);
    const { build } = (await (await upload(app, await buildZip())).json()) as { build: { id: string } };
    const res = await app.request('/api/local/publish/deploy', { method: 'POST', headers: { 'content-type': 'application/json', ...host }, body: JSON.stringify({ build: build.id, target: 'netlify', name: 'slow-game' }) });
    const { job } = (await res.json()) as { job: { id: string } };
    // A second deploy waits its turn.
    const second = await app.request('/api/local/publish/deploy', { method: 'POST', headers: { 'content-type': 'application/json', ...host }, body: JSON.stringify({ build: build.id, target: 'vercel', name: 'x' }) });
    expect(second.status).toBe(409);
    await new Promise((r) => setTimeout(r, 400));
    expect((await app.request(`/api/local/publish/jobs/${job.id}`, { method: 'DELETE', headers: host })).status).toBe(200);
    const done = await waitJob(app, job.id);
    expect(done.state).toBe('cancelled');
    const sse = await app.request(`/api/local/publish/jobs/${job.id}/events?after=0`, { headers: host });
    const text = await sse.text();
    expect(text).toMatch(/event: progress/);
    expect(text).toMatch(/event: end/);
    expect(text).toMatch(/"state":"cancelled"/);
  });

  it('shares a build on the local network behind a random token, read-only, and stops', async () => {
    const app = setup(fakeClis().env);
    const { build } = (await (await upload(app, await buildZip())).json()) as { build: { id: string } };
    expect(((await (await app.request('/api/local/publish/lan', { headers: host })).json()) as { on: boolean }).on).toBe(false);
    const on = (await (await app.request('/api/local/publish/lan', { method: 'POST', headers: { 'content-type': 'application/json', ...host }, body: JSON.stringify({ on: true, build: build.id }) })).json()) as { on: boolean; urls: string[] };
    expect(on.on).toBe(true);
    const url = on.urls[0] as string;
    expect(url).toMatch(/^http:\/\/192\.168\.1\.20:\d+\/s\/[A-Za-z0-9_-]{22}\/play\/[a-z0-9]{12}\/$/);
    const local = url.replace('192.168.1.20', '127.0.0.1');
    const ok = await fetch(local);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-security-policy')).toBe(PLAY_CSP);
    expect(await ok.text()).toContain('Coin Island');
    const wrong = local.replace(/\/s\/[^/]+\//, '/s/AAAAAAAAAAAAAAAAAAAAAA/');
    expect((await fetch(wrong)).status).toBe(404);
    expect((await fetch(local.replace(/\/s\/.*$/, '/api/health'))).status).toBe(404);
    expect((await fetch(`${local}../../../../../etc/passwd`)).status).toBe(404);
    expect((await fetch(local, { method: 'POST' })).status).toBe(405);
    const off = (await (await app.request('/api/local/publish/lan', { method: 'POST', headers: { 'content-type': 'application/json', ...host }, body: JSON.stringify({ on: false }) })).json()) as { on: boolean };
    expect(off.on).toBe(false);
    await expect(fetch(local)).rejects.toThrow();
  });

  it('is only reachable from this computer', async () => {
    const dataDir = temp('aether-publish-remote-');
    const local = new LocalAi({ dataDir, commands: { codex: null, claude: null }, probe: async () => [] });
    services.push(local);
    const app = makeApp(makeConfig({ AETHER_LOCAL_AI: 'on' }), { local, isLoopback: () => false, publish: { dir: join(dataDir, 'p') } });
    expect((await app.request('/api/local/publish/targets', { headers: host })).status).toBe(403);
    const hosted = makeApp(makeConfig({ AETHER_LOCAL_AI: 'off' }));
    expect((await hosted.request('/api/local/publish/targets', { headers: host })).status).toBe(404);
  });
});
