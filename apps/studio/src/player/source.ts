/**
 * Where a published game comes from: the URL fragment of a share link
 * (`#w=…`, decoded and validated by `publish/share.ts`), or the `game.json`
 * next to a downloaded / self-hosted build. Both are untrusted and fully
 * validated; a failure becomes a readable message, never a crash.
 */
import { decodeShare, shareValueFromHash } from '../publish/share';
import { defaultControls, IMPORT_PATH, MAX_GAME_JSON_BYTES, parseGameManifest, type GameManifest } from '../publish/manifest';

/** Outcome of {@link loadGame}. */
export type GameSource = { kind: 'game'; game: GameManifest; from: 'link' | 'build' } | { kind: 'none' } | { kind: 'error'; message: string };

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
