/**
 * Where a published game comes from: the URL fragment of a share link
 * (`#w=…`, decoded and validated by `publish/share.ts`), a bundled template
 * (`#t=<slug>`, a published world of this site with its cooked package at
 * `<cooked base><slug>/manifest.json`, the hosted dataset by default), or the `game.json` next to a downloaded /
 * self-hosted build. All are untrusted and fully validated; a failure becomes
 * a readable message, never a crash.
 */
import { decodeShare, shareValueFromHash } from '../publish/share';
import { defaultControls, IMPORT_PATH, MAX_GAME_JSON_BYTES, parseGameManifest, type GameManifest } from '../publish/manifest';

/** Outcome of {@link loadGame}. */
export type GameSource = { kind: 'game'; game: GameManifest; from: 'link' | 'build' | 'template' } | { kind: 'none' } | { kind: 'error'; message: string };

/** Template slugs (as `showcase/load.ts`). */
const TEMPLATE_SLUG = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+){0,7}$/;

/**
 * The options of a `#t=<slug>` fragment: `cook=0` opens the template live (no cooked package), `cook=local` reads the
 * package from the page's own `cooked/` folder instead of the hosted one (a dist with `scripts/cook.ts --install`),
 * `cook=record` is the cook's own recording run (scripts/cook.ts: live, and the page exposes what the cook reads),
 * `tier=<tier>` starts on that render tier.
 */
export interface TemplateRoute {
  slug: string;
  cook: 'use' | 'off' | 'record' | 'local';
  tier: 'low' | 'medium' | 'high' | 'ultra' | null;
}

/** Parse a `#t=<slug>[&cook=0|record][&tier=…]` fragment (null for any other fragment). */
export function templateRoute(hash: string): TemplateRoute | null {
  if (!hash.startsWith('#t=')) return null;
  const q = new URLSearchParams(hash.slice(1));
  const slug = q.get('t') ?? '';
  if (!TEMPLATE_SLUG.test(slug)) return null;
  const c = q.get('cook');
  const t = q.get('tier');
  return { slug, cook: c === '0' || c === 'off' ? 'off' : c === 'record' ? 'record' : c === 'local' ? 'local' : 'use', tier: t === 'low' || t === 'medium' || t === 'high' || t === 'ultra' ? t : null };
}

/** Where the published templates' cooked packages are hosted (a public dataset; scripts/cook-upload.ts fills it). */
export const HOSTED_COOKED_BASE = 'https://huggingface.co/datasets/StarAtNyte1/aether-cooked/resolve/main/';
/** The page's own folder of cooked packages (the dev server, a dist with installed packages). */
export const LOCAL_COOKED_BASE = './cooked/';

/** Build-time base of the cooked packages (vite.config.ts: `AETHER_COOKED_BASE`, else hosted for builds, local in dev). */
declare const __AETHER_COOKED_BASE__: string | undefined;

/** A usable base: an https URL or a path, ending in `/` (anything else: null). */
export function normalizeCookedBase(base: string | undefined | null): string | null {
  const b = (base ?? '').trim();
  if (!b) return null;
  if (!/^https:\/\/[^/\s]+\//.test(b) && !/^\.{0,2}\/(?!\/)/.test(b)) return null;
  return b.endsWith('/') ? b : `${b}/`;
}

/** The base this build reads cooked packages from. */
export function cookedBase(): string {
  return normalizeCookedBase(typeof __AETHER_COOKED_BASE__ === 'string' ? __AETHER_COOKED_BASE__ : null) ?? LOCAL_COOKED_BASE;
}

/** The manifest of a template's cooked package under `base` (this build's by default). */
export function templateCookUrl(slug: string, base: string = cookedBase()): string {
  return `${normalizeCookedBase(base) ?? LOCAL_COOKED_BASE}${slug}/manifest.json`;
}

/** Start mode of a template kind (a slug without a row in showcase/publish.ts; the IR's own `startMode` wins). */
export function startModeForKind(kind: string | undefined): 'play' | 'walkthrough' | 'orbit' {
  return kind === 'game' ? 'play' : kind === 'architecture' ? 'walkthrough' : 'orbit';
}

/** Longest wait for `game.json` (ms). */
const FETCH_TIMEOUT_MS = 20_000;

/** Read the game for this page (`pathname`: the studio's `/play` route never has a game.json next to it). */
export async function loadGame(hash: string, fetchFn: typeof fetch = fetch, pathname = typeof location !== 'undefined' ? location.pathname : '/'): Promise<GameSource> {
  const value = shareValueFromHash(hash);
  if (value !== null) {
    const r = await decodeShare(value);
    if (!r.ok) return { kind: 'error', message: r.error };
    const { world, meta, proof } = r.payload;
    return {
      kind: 'game',
      from: 'link',
      game: {
        title: meta.title ?? world.name,
        description: meta.description ?? '',
        author: meta.author ?? '',
        controls: meta.controls ?? defaultControls(world),
        music: meta.music ?? null,
        ...(proof !== undefined ? { proof } : {}),
        world,
      },
    };
  }
  const template = templateRoute(hash);
  if (template) {
    const [{ loadTemplateWorld }, { SHOWCASE }, { templatePublish }] = await Promise.all([import('../showcase/load'), import('../showcase/manifest'), import('../showcase/publish')]);
    const r = await loadTemplateWorld(template.slug, (u, i) => fetchFn(u, i));
    if (!r.ok) return { kind: 'error', message: r.error };
    const entry = SHOWCASE.find((e) => e.slug === template.slug);
    const world = r.world;
    return {
      kind: 'game',
      from: 'template',
      game: {
        title: world.intro?.title ?? entry?.title ?? world.name,
        description: entry?.description ?? world.description,
        author: '',
        controls: defaultControls(world),
        music: null,
        world,
        startMode: world.startMode ?? templatePublish(template.slug, entry?.kind).startMode,
        ...(template.cook === 'use' ? { cook: templateCookUrl(template.slug) } : template.cook === 'local' ? { cook: templateCookUrl(template.slug, LOCAL_COOKED_BASE) } : {}),
      },
    };
  }
  if (/\/play(\.html)?$/.test(pathname)) return { kind: 'none' };
  let res: Response;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    res = await fetchFn('./game.json', { cache: 'no-cache', signal: ctrl.signal, credentials: 'same-origin' });
  } catch {
    clearTimeout(timer);
    return { kind: 'none' };
  }
  try {
    if (!res.ok) return { kind: 'none' };
    // Static hosts may answer unknown paths with an HTML page: that is "no game here".
    const type = res.headers.get('content-type') ?? '';
    if (!/json/i.test(type)) return { kind: 'none' };
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > MAX_GAME_JSON_BYTES) return { kind: 'error', message: 'This game is too large to open.' };
    const text = await res.text();
    if (text.length > MAX_GAME_JSON_BYTES) return { kind: 'error', message: 'This game is too large to open.' };
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return { kind: 'error', message: 'game.json is damaged (not valid JSON).' };
    }
    const g = parseGameManifest(value);
    if (!g.ok) return { kind: 'error', message: g.error };
    if (!g.game.controls) g.game.controls = defaultControls(g.game.world);
    return { kind: 'game', from: 'build', game: g.game };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a bundled block-world save (≤ 64 MB), or null. */
export async function loadSave(path: string, fetchFn: typeof fetch = fetch): Promise<Uint8Array | null> {
  try {
    const res = await fetchFn(`./${path}`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength > 0 && buf.byteLength <= 64 * 1024 * 1024 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Register the user imports a build ships (models, posters, skies). Each
 * file is re-validated exactly like a fresh import in the studio, and its
 * content-addressed id must match the metadata — an altered or substituted
 * file is skipped (the world shows a stand-in). Returns how many loaded.
 */
export async function registerBundledImports(game: GameManifest, fetchFn: typeof fetch = fetch): Promise<number> {
  const list = game.imports ?? [];
  if (list.length === 0) return 0;
  const [{ UserAssetMeta, importUserAsset }, { registerUserAsset }] = await Promise.all([import('@aether/assets/import'), import('@aether/assets')]);
  let loaded = 0;
  for (const item of list) {
    const meta = UserAssetMeta.safeParse(item.meta);
    const m = IMPORT_PATH.exec(item.file);
    if (!meta.success || !m || m[1] !== meta.data.id) continue;
    try {
      const res = await fetchFn(`./${item.file}`, { cache: 'force-cache' });
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > 64 * 1024 * 1024) continue;
      const r = await importUserAsset(bytes, `${meta.data.name || 'import'}.${m[2]}`);
      if (!r.ok || r.asset.meta.id !== meta.data.id) continue;
      const url = URL.createObjectURL(new Blob([r.asset.data as Uint8Array<ArrayBuffer>], { type: r.asset.meta.mime }));
      registerUserAsset({ meta: r.asset.meta, url });
      loaded++;
    } catch {
      /* skipped: a stand-in is shown */
    }
  }
  return loaded;
}
