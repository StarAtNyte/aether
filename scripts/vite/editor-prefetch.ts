/**
 * Vite plugin: list the files the editor needs beyond the home page into `editor-prefetch.json`, so the home page
 * can fetch them in the background once it is interactive (and on hover of "open" / "new"). Opening a project then
 * finds the editor already in the browser cache instead of starting a 1 MB waterfall on click.
 *
 * Files are the static-import closure of the editor route chunk minus what the home page already loads. Lazy
 * features (path tracer, on-device model, QuickJS, exporters) are separate dynamic imports and never listed.
 */

/** Minimal shape of the chunks Rolldown hands to `generateBundle`. */
interface Chunk {
  type: 'chunk' | 'asset';
  fileName: string;
  isEntry?: boolean;
  facadeModuleId?: string | null;
  imports?: string[];
  viteMetadata?: { importedCss?: Set<string> };
}

/** Name of the list written next to the build. */
export const EDITOR_PREFETCH = 'editor-prefetch.json';

/** Static-import closure of `roots` over `bundle` (pure; exported for tests). */
export function staticClosure(bundle: Record<string, Chunk>, roots: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const f = stack.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const i of bundle[f]?.imports ?? []) stack.push(i);
  }
  return seen;
}

/** Files to prefetch: the editor route closure without the home page's own closure (pure; exported for tests). */
export function editorPrefetchFiles(bundle: Record<string, Chunk>, pageEntry: (c: Chunk) => boolean, editorEntry: (c: Chunk) => boolean): { js: string[]; css: string[] } {
  const chunks = Object.values(bundle).filter((c) => c.type === 'chunk');
  const home = staticClosure(bundle, chunks.filter(pageEntry).map((c) => c.fileName));
  const editor = staticClosure(bundle, chunks.filter(editorEntry).map((c) => c.fileName));
  const js = [...editor].filter((f) => !home.has(f) && f.endsWith('.js')).sort();
  const homeCss = new Set([...home].flatMap((f) => [...(bundle[f]?.viteMetadata?.importedCss ?? [])]));
  const css = [...new Set([...editor].flatMap((f) => [...(bundle[f]?.viteMetadata?.importedCss ?? [])]))].filter((f) => !homeCss.has(f)).sort();
  return { js, css };
}

/** The plugin (studio build only). */
export function editorPrefetch() {
  return {
    name: 'aether-editor-prefetch',
    apply: 'build' as const,
    generateBundle(this: { emitFile(f: { type: 'asset'; fileName: string; source: string }): void }, _options: unknown, bundle: Record<string, Chunk>): void {
      const files = editorPrefetchFiles(
        bundle,
        (c) => c.isEntry === true && !/play/.test(`${c.facadeModuleId ?? ''} ${c.fileName}`),
        (c) => /[\\/]src[\\/]editor[\\/]EditorRoute\.tsx$/.test(c.facadeModuleId ?? ''),
      );
      this.emitFile({ type: 'asset', fileName: EDITOR_PREFETCH, source: `${JSON.stringify({ version: 1, ...files })}\n` });
    },
  };
}
