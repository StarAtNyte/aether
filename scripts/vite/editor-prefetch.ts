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

/** Name of the small classic script that starts the editor's downloads on an editor URL. */
export const EDITOR_BOOT = 'editor-boot.js';

/** Editor routes (`#/new`, `#/new/<template>`, `#/p/<id>`) in the form the boot script tests. */
const BOOT_ROUTE = '/^#\\/(?:new(?:\\/([a-z0-9-]{1,80}))?(?:[?]|$)|p\\/)/';

/**
 * Source of the boot script (pure; exported for tests). On a cold open of an editor URL the editor route is
 * otherwise discovered only after the home bundle has run (entry, then the route chunk, then its imports: three
 * serial round trips on a slow link). This script runs while the entry is still downloading, so it
 *   - links every file of the editor's static closure as `modulepreload` (all in parallel, one round trip), and
 *   - for a template, starts its world JSON fetch now and hands the response to `loadTemplateWorld` through
 *     `window.__aetherEarly` (taken once; a failed or missing early fetch falls back to a normal one).
 * The tag is the first thing in `<head>`, so its request goes out before the home page's own files. It never runs on the home page (any other hash), so the home page's own budget is untouched.
 */
export function editorBootSource(js: readonly string[]): string {
  return `(function(){var m=${BOOT_ROUTE}.exec(location.hash);if(!m)return;var b=document.currentScript&&document.currentScript.src||location.href,f=${JSON.stringify(js)},h=document.head,i,l;for(i=0;i<f.length;i++){l=document.createElement('link');l.rel='modulepreload';l.href=new URL(f[i],b).href;h.appendChild(l)}if(m[1]&&window.fetch){var u=new URL('templates/worlds/'+m[1]+'.json',b).pathname;var e=window.__aetherEarly=window.__aetherEarly||{};e[u]=fetch(u,{headers:{accept:'application/json'}})}})();\n`;
}

/** The plugin (studio build only). */
export function editorPrefetch() {
  return {
    name: 'aether-editor-prefetch',
    apply: 'build' as const,
    enforce: 'post' as const,
    generateBundle: { order: 'post' as const, handler(this: { emitFile(f: { type: 'asset'; fileName: string; source: string }): void }, _options: unknown, bundle: Record<string, Chunk>): void {
      const files = editorPrefetchFiles(
        bundle,
        (c) => c.isEntry === true && !/play/.test(`${c.facadeModuleId ?? ''} ${c.fileName}`),
        (c) => /[\\/]src[\\/]editor[\\/]EditorRoute\.tsx$/.test(c.facadeModuleId ?? ''),
      );
      this.emitFile({ type: 'asset', fileName: EDITOR_PREFETCH, source: `${JSON.stringify({ version: 1, ...files })}\n` });
      this.emitFile({ type: 'asset', fileName: EDITOR_BOOT, source: editorBootSource(files.js) });
      const page = bundle['index.html'] as unknown as { source?: string } | undefined;
      if (typeof page?.source === 'string' && !page.source.includes(EDITOR_BOOT)) page.source = page.source.replace(/<head>/, `<head>\n    <script src="./${EDITOR_BOOT}" async></script>`);
    } },
  };
}
