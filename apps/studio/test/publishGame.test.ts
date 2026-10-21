import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { readZip } from '@aether/assets/zip';
import { BUILD_CSP, buildGame, buildId, publishedIndexHtml, webManifest } from '../src/publish/gameBuild';
import { defaultControls, defaultDescription, defaultTitle, gameJson, parseGameManifest } from '../src/publish/manifest';
import { serviceWorkerSource } from '../src/player/offline';
import { isGeneratedServiceWorker } from '@aether/assets/offline-sw';
import { MemoryLibrary, PublishLibrary, MAX_SNAPSHOTS } from '../src/publish/library';
import { PublishStore } from '../../server/src/publish/store';

const PLAY_HTML = `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content="A playable 3D world made with Aether." />
    <title>Aether player</title>
    <script type="module" crossorigin src="./assets/play-abc.js"></script>
  </head>
  <body><div id="player"></div></body>
</html>`;

const world = createWorld({
  name: 'Beaver <Pond>',
  entities: {
    beaver: { id: 'beaver', shape: { kind: 'asset', id: 'beaver' } },
    wall: { id: 'wall', shape: { kind: 'primitive', primitive: 'box' }, material: { preset: 'stone', finish: 'brick' } },
  },
});

function fakeFetch(log: string[]): (path: string) => Promise<Uint8Array> {
  return async (path: string) => {
    log.push(path);
    if (path === 'play-manifest.json') return new TextEncoder().encode(JSON.stringify({ version: 1, entry: 'play.html', files: ['assets/play-abc.js', 'assets/three-x.js', 'assets/rapier_wasm3d_bg-y.wasm', 'play.html'] }));
    if (path === 'play.html') return new TextEncoder().encode(PLAY_HTML);
    if (path === 'favicon.svg') return new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    if (path.startsWith('assets/')) return new TextEncoder().encode(`file:${path}`);
    throw new Error(`unexpected fetch ${path}`);
  };
}

describe('game build (zip)', () => {
  it('packs the player, the world, its assets, PWA files, covers and the project file', async () => {
    const log: string[] = [];
    const crops: string[] = [];
    const b = await buildGame({
      world,
      title: 'Beaver <Pond>',
      description: 'Build a dam.',
      author: 'Ann',
      controls: 'WASD move',
      music: 'calm',
      cover: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      save: new Uint8Array([9, 9]),
      imports: [{ meta: { id: 'user-0123456789ab', mime: 'model/gltf-binary', kind: 'model', name: 'chair', bytes: 3 }, data: new Uint8Array([7, 7, 7]) }],
      fetchFile: fakeFetch(log),
      images: { crop: async (_img, w, h) => (crops.push(`${w}x${h}`), new Uint8Array([w & 255, h & 255])) },
      now: 1_700_000_000_000,
    });
    expect(b.fileName).toBe('beaver-pond-web.zip');
    const zip = await readZip(b.zip);
    expect(zip.ok).toBe(true);
    if (!zip.ok) return;
    const names = zip.entries.map((e) => e.name).sort();
    for (const f of ['index.html', 'game.json', 'assets/play-abc.js', 'assets/three-x.js', 'assets/rapier_wasm3d_bg-y.wasm', 'assets/lib/m/beaver.088f13b3.glb', 'assets/lib/x/brick.albedo.f2219b7d.webp', 'assets/lib/x/brick.albedo.256.b95c137d.webp', 'assets/user/user-0123456789ab.glb', 'saves/world.aethersave', 'manifest.webmanifest', 'sw.js', 'cover.png', 'screenshot.png', 'icon-192.png', 'icon-512.png', 'CREDITS.txt', 'README.md', 'project/beaver-pond.aether.json', 'favicon.svg', '.nojekyll'])
      expect(names, f).toContain(f);
    expect(names).not.toContain('play.html');
    expect(crops).toEqual(['630x500', '1280x720', '192x192', '512x512']);
    const text = (name: string): string => new TextDecoder().decode(zip.entries.find((e) => e.name === name)?.data);
    const html = text('index.html');
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${BUILD_CSP}" />`);
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script'));
    expect(html).toContain('<title>Beaver &lt;Pond&gt;</title>');
    expect(html).toContain('src="./assets/play-abc.js"');
    expect(html).toContain('rel="manifest"');
    const game = parseGameManifest(JSON.parse(text('game.json')));
    expect(game.ok).toBe(true);
    if (game.ok) {
      expect(game.game.world).toEqual(world);
      expect(game.game.music).toBe('calm');
      expect(game.game.save).toBe('saves/world.aethersave');
      expect(game.game.imports?.[0]?.file).toBe('assets/user/user-0123456789ab.glb');
      expect(game.game.title).toBe('Beaver <Pond>');
    }
    const sw = text('sw.js');
    expect(sw).toContain('"./index.html"');
    expect(sw).toContain('"./assets/lib/m/beaver.088f13b3.glb"');
    expect(sw).not.toContain('project/');
    // The local app's build library accepts only the generated worker: a real build's must pass.
    expect(isGeneratedServiceWorker(sw)).toBe(true);
    expect(JSON.parse(text('manifest.webmanifest'))).toMatchObject({ start_url: './', display: 'fullscreen' });
    expect(text('README.md')).toMatch(/itch\.io/);
    expect(text('CREDITS.txt')).toMatch(/Beaver/);
    // Library files are fetched from the studio's own library path.
    expect(log).toContain('assets/lib/m/beaver.088f13b3.glb');
  });

  it('ships the avatar body, its mask and the motion set so the published player can draw people', async () => {
    const b = await buildGame({ world: createWorld({ name: 'People' }), title: 'People', description: '', author: '', controls: '', music: null, cover: null, fetchFile: fakeFetch([]), images: { crop: async () => new Uint8Array([1]) }, now: 1_700_000_000_000 });
    const zip = await readZip(b.zip);
    expect(zip.ok).toBe(true);
    const names = zip.ok ? zip.entries.map((e) => e.name) : [];
    expect(names.some((n) => /^assets\/lib\/c\/motions-(male|female)\.[0-9a-f]+\.glb$/.test(n))).toBe(true);
    expect(names.some((n) => /^assets\/lib\/c\/(?!motions)[a-z]+\.[0-9a-f]+\.glb$/.test(n))).toBe(true);
  });

  it('includes the automatic sky file when the world has a sky preset but names no hdri', async () => {
    const build = (env: object) => buildGame({ world: createWorld({ name: 'Sky', environment: env as never }), title: 'Sky', description: '', author: '', controls: '', music: null, cover: null, fetchFile: fakeFetch([]), images: { crop: async () => new Uint8Array([1]) }, now: 1_700_000_000_000 });
    const names = async (env: object): Promise<string[]> => {
      const zip = await readZip((await build(env)).zip);
      return zip.ok ? zip.entries.map((e) => e.name) : [];
    };
    expect((await names({ sky: 'day' })).some((n) => /sky-partly-cloudy/.test(n))).toBe(true);
    expect((await names({ sky: 'space' })).some((n) => /sky-/.test(n))).toBe(false);
  });

  it("is accepted by the local app's build library, which trusts only its own player code", async () => {
    // Producer / consumer contract: the zip the studio builds passes the library's no-foreign-code check
    // when the library's player build is the one the studio packed (same files, same bytes).
    const dir = mkdtempSync(join(tmpdir(), 'aether-player-'));
    try {
      const fetchFile = fakeFetch([]);
      for (const f of ['play-manifest.json', 'play.html', 'assets/play-abc.js', 'assets/three-x.js', 'assets/rapier_wasm3d_bg-y.wasm']) {
        mkdirSync(dirname(join(dir, 'player', f)), { recursive: true });
        writeFileSync(join(dir, 'player', f), await fetchFile(f));
      }
      const store = new PublishStore(join(dir, 'library'), undefined, undefined, join(dir, 'player'));
      const b = await buildGame({ world, title: 'Pond', description: '', author: '', controls: '', music: null, cover: null, fetchFile, now: 1 });
      const meta = await store.add(b.zip);
      expect(meta.title).toBe('Pond');
      // The same build from a player this computer does not have is refused.
      const other = await buildGame({ world, title: 'Pond', description: '', author: '', controls: '', music: null, cover: null, now: 1, fetchFile: async (path) => (path === 'assets/three-x.js' ? new TextEncoder().encode('fetch("/api/local/accounts")') : fetchFile(path)) });
      await expect(store.add(other.zip)).rejects.toThrow(/not part of the Aether player/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses an unsafe player manifest and reports a missing player build', async () => {
    const bad = async (path: string): Promise<Uint8Array> => {
      if (path === 'play-manifest.json') return new TextEncoder().encode(JSON.stringify({ version: 1, entry: 'play.html', files: ['../../etc/passwd', 'play.html'] }));
      return new Uint8Array();
    };
    await expect(buildGame({ world, title: 't', description: '', author: '', controls: '', music: null, cover: null, fetchFile: bad })).rejects.toThrow(/unsafe/);
    const missing = async (): Promise<Uint8Array> => {
      throw new Error('HTTP 404');
    };
    await expect(buildGame({ world, title: 't', description: '', author: '', controls: '', music: null, cover: null, fetchFile: missing })).rejects.toThrow(/player build is missing/);
  });

  it('stops when cancelled', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(buildGame({ world, title: 't', description: '', author: '', controls: '', music: null, cover: null, fetchFile: fakeFetch([]), signal: ctrl.signal })).rejects.toThrow(/cancelled/);
  });

  it('escapes title and description in the page and keeps ids content-derived', () => {
    const html = publishedIndexHtml(PLAY_HTML, { title: '"><script>x</script>', description: 'a "b" <c>' });
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
    // Replacement patterns typed into a title must stay literal text (no `$'` page splicing).
    for (const t of ["$'", '$`', '$&', '$1', '$$']) {
      const page = publishedIndexHtml(PLAY_HTML, { title: `Game ${t}`, description: `About ${t}` });
      const e = t.replace(/&/g, '&amp;').replace(/'/g, '&#39;');
      expect(page, t).toContain(`<title>Game ${e}</title>`);
      expect(page, t).toContain(`<meta property="og:description" content="About ${e}" />`);
      expect(page.split('<title>').length, t).toBe(2);
      expect(page.match(/http-equiv="Content-Security-Policy"/g)?.length, t).toBe(1);
    }
    expect(buildId('a', ['x'])).toBe(buildId('a', ['x']));
    expect(buildId('a', ['x'])).not.toBe(buildId('b', ['x']));
    expect(JSON.parse(webManifest('T', 'D')).icons).toHaveLength(2);
    expect(serviceWorkerSource('id', ['ok.js', '../bad.js', 'a b.js'])).not.toMatch(/bad\.js|a b\.js/);
  });

  it('round-trips game.json and rejects hostile ones', () => {
    const g = parseGameManifest(JSON.parse(gameJson({ title: 'T', description: 'D', author: 'A', controls: 'C', music: null, world })));
    expect(g.ok).toBe(true);
    expect(parseGameManifest({ format: 'aether-game', v: 1, title: 'T', world, extra: true }).ok).toBe(false);
    expect(parseGameManifest({ format: 'aether-game', v: 1, title: 'T', world, save: '../../x.aethersave' }).ok).toBe(false);
    expect(parseGameManifest({ format: 'aether-game', v: 1, title: 'T', world, imports: [{ meta: {}, file: 'assets/user/../../x.glb' }] }).ok).toBe(false);
    expect(parseGameManifest({ format: 'aether-game', v: 1, title: 'T', world: { entities: { 'Bad Id': {} } } }).ok).toBe(false);
  });
});

describe('publish library', () => {
  it('keeps history newest first with re-downloadable files, and caps everything', async () => {
    let t = 1000;
    const lib = new PublishLibrary(new MemoryLibrary(), () => t++);
    const a = await lib.add({ projectId: 'abcdefgh12', kind: 'render', title: 'Render', detail: '1920×1080', fileName: 'r.png', mime: 'image/png', blob: new Blob([new Uint8Array(10)], { type: 'image/png' }) });
    await lib.add({ projectId: null, kind: 'hosting', title: 'Site', url: 'https://x.netlify.app/' });
    const bad = await lib.add({ projectId: null, kind: 'link', title: 'Link', url: 'javascript:alert(1)' as string, thumb: 'data:text/html,<b>' });
    expect(bad.url).toBeUndefined();
    expect(bad.thumb).toBeUndefined();
    const items = await lib.items();
    expect(items.map((i) => i.title)).toEqual(['Link', 'Site', 'Render']);
    expect((await lib.items('abcdefgh12')).map((i) => i.id)).toEqual([a.id]);
    expect((await lib.file(a.id))?.size).toBe(10);
    await lib.remove(a.id);
    expect(await lib.file(a.id)).toBeNull();
  });

  it('saves and restores validated version snapshots, newest first, capped per project', async () => {
    let t = 0;
    const lib = new PublishLibrary(new MemoryLibrary(), () => t++);
    for (let i = 0; i < MAX_SNAPSHOTS + 3; i++) await lib.snapshot('abcdefgh12', { ...world, name: `v${i}` }, `Version ${i}`);
    const list = await lib.snapshots('abcdefgh12');
    expect(list).toHaveLength(MAX_SNAPSHOTS);
    expect(list[0]?.label).toBe(`Version ${MAX_SNAPSHOTS + 2}`);
    const w = await lib.snapshotWorld(list[0]?.id ?? '');
    expect(w?.name).toBe(`v${MAX_SNAPSHOTS + 2}`);
    expect(await lib.snapshot('Not A Project', world, 'x')).toBeNull();
    // Damaged records are ignored, never restored.
    await lib.backend.put('snapshots', 'zzzzzzzzzz', { v: 1, id: 'zzzzzzzzzz', projectId: 'abcdefgh12', createdAt: 9e9, label: 'evil', entityCount: 0, world: { entities: { 'Bad Id': {} } } });
    expect(await lib.snapshotWorld('zzzzzzzzzz')).toBeNull();
  });

  it('remembers a camera path per project and rejects invalid ones', async () => {
    const lib = new PublishLibrary(new MemoryLibrary());
    const path = { v: 1 as const, name: 'S', duration: 4, easeInOut: true, keys: [{ t: 0, pos: [0, 1, 2] as [number, number, number], target: [0, 0, 0] as [number, number, number], fov: 50, ease: 'linear' as const }] };
    await lib.savePath('abcdefgh12', path);
    expect(await lib.path('abcdefgh12')).toEqual(path);
    await lib.backend.put('paths', 'abcdefgh13', { v: 1, keys: 'nope' });
    expect(await lib.path('abcdefgh13')).toBeNull();
  });
});

describe('title-screen defaults', () => {
  it('fall back to the world name and derived controls without a title card', () => {
    expect(defaultTitle(world)).toBe('Beaver <Pond>');
    expect(defaultDescription(world)).toBe('');
    expect(defaultControls(world)).toMatch(/orbit|WASD|throttle/);
  });

  it("come from the world's title card when it has one (capped to the title-screen limits)", () => {
    const carded = createWorld({ ...world, intro: { title: 'Lantern Isles', tagline: 'Light the way home', objective: 'Find twelve lanterns', controls: ['WASD — move', 'Space — jump'] } });
    expect(defaultTitle(carded)).toBe('Lantern Isles');
    expect(defaultDescription(carded)).toBe('Light the way home — Find twelve lanterns');
    expect(defaultControls(carded)).toBe('WASD — move · Space — jump');
    const long = createWorld({ ...world, intro: { title: 'T', tagline: '', controls: Array.from({ length: 6 }, () => 'x'.repeat(60)) } });
    expect(defaultControls(long).length).toBeLessThanOrEqual(300);
    expect(defaultDescription(long)).toBe('');
  });
});
