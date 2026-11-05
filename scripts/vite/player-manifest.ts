/**
 * Vite plugin: list every build file the standalone player (`play.html`)
 * can load — its entry chunk, static and dynamic imports, workers, wasm,
 * stylesheets and their assets — into `play-manifest.json`. The studio
 * reads that list to package a published game (index.html + exactly these
 * files + the world) entirely in the browser.
 *
 * Reachability is computed by following references: every emitted file
 * name found in a reachable file's text (HTML, JS, CSS) is reachable too.
 * That covers `import()` targets, `new URL('./x.worker.js', import.meta.url)`
 * workers and `?url` assets alike, without depending on bundler internals.
 * A guard fails the build if editor-only code leaks into the player.
 */

/** Minimal shape of the bundle Vite / Rolldown hands to `generateBundle`. */
interface OutputFile {
  type: 'chunk' | 'asset';
  fileName: string;
  code?: string;
  source?: string | Uint8Array;
}

/** Name of the manifest written next to the build. */
export const PLAYER_MANIFEST = 'play-manifest.json';

const TEXT = /\.(html|js|mjs|css|json)$/;
const NAME = /[A-Za-z0-9_][A-Za-z0-9_.-]*\.(?:js|mjs|css|wasm|woff2?|png|svg|json|webp|jpg|jpeg|glb|hdr|gz)/g;

/** Files reachable from `entry` (pure; exported for tests). */
export function reachableFiles(bundle: Record<string, OutputFile>, entry: string): string[] {
  const byBase = new Map<string, string>();
  for (const f of Object.values(bundle)) byBase.set(f.fileName.split('/').pop() as string, f.fileName);
  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const name = queue.shift() as string;
    const f = bundle[name];
    if (!f || !TEXT.test(name)) continue;
    const text = f.type === 'chunk' ? (f.code ?? '') : typeof f.source === 'string' ? f.source : new TextDecoder().decode(f.source ?? new Uint8Array());
    for (const m of text.matchAll(NAME)) {
      const hit = byBase.get(m[0]);
      if (hit && !seen.has(hit)) {
        seen.add(hit);
        queue.push(hit);
      }
    }
  }
  return [...seen].sort();
}

/** The plugin. `forbidden` matches chunk names that must never reach the player. */
export function playerManifest(opts: { entry?: string; forbidden?: RegExp } = {}) {
  const entry = opts.entry ?? 'play.html';
  const forbidden = opts.forbidden ?? /(^|\/)(webllm|EditorRoute|AgentPanel|SettingsDialog)[-.]/;
  return {
    name: 'aether-player-manifest',
    enforce: 'post' as const,
    generateBundle(this: { emitFile(f: { type: 'asset'; fileName: string; source: string }): void; error(msg: string): never }, _options: unknown, bundle: Record<string, OutputFile>) {
      if (!bundle[entry]) return;
      const files = reachableFiles(bundle, entry);
      const leaked = files.filter((f) => forbidden.test(f));
      if (leaked.length > 0) this.error(`editor-only code reached the player bundle: ${leaked.join(', ')}`);
      const bytes = files.reduce((s, f) => {
        const o = bundle[f];
        if (!o) return s;
        return s + (o.type === 'chunk' ? (o.code ?? '').length : typeof o.source === 'string' ? o.source.length : (o.source?.byteLength ?? 0));
      }, 0);
      this.emitFile({ type: 'asset', fileName: PLAYER_MANIFEST, source: JSON.stringify({ version: 1, entry, files, bytes }, null, 2) });
    },
  };
}
