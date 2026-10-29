import { describe, expect, it } from 'vitest';
import { prefetchLinks, shouldSkipPrefetch } from '../src/lib/prefetch';
import { editorBootSource, editorPrefetchFiles, staticClosure } from '../../../scripts/vite/editor-prefetch';

describe('editor prefetch', () => {
  it('links only build-relative chunk paths', () => {
    const links = prefetchLinks({ js: ['assets/a-1.js', 'https://evil.example/x.js', '../x.js', 5], css: ['assets/e-2.css', 'assets/e.js.map'] });
    expect(links).toEqual([
      { rel: 'modulepreload', href: 'assets/a-1.js' },
      { rel: 'prefetch', href: 'assets/e-2.css' },
    ]);
    expect(prefetchLinks(null)).toEqual([]);
    expect(prefetchLinks('x')).toEqual([]);
  });
  it('skips on save-data and 2G links', () => {
    expect(shouldSkipPrefetch({ saveData: true })).toBe(true);
    expect(shouldSkipPrefetch({ effectiveType: 'slow-2g' })).toBe(true);
    expect(shouldSkipPrefetch({ effectiveType: '4g' })).toBe(false);
    expect(shouldSkipPrefetch(undefined)).toBe(false);
  });
  it('lists the editor closure without the home closure', () => {
    const c = (fileName: string, imports: string[], extra: object = {}) => ({ type: 'chunk' as const, fileName, imports, ...extra });
    const bundle = {
      'assets/index.js': c('assets/index.js', ['assets/react.js'], { isEntry: true, facadeModuleId: '/x/src/main.tsx' }),
      'assets/react.js': c('assets/react.js', []),
      'assets/editor.js': c('assets/editor.js', ['assets/react.js', 'assets/three.js'], { facadeModuleId: '/x/src/editor/EditorRoute.tsx', viteMetadata: { importedCss: new Set(['assets/editor.css']) } }),
      'assets/three.js': c('assets/three.js', ['assets/core.js']),
      'assets/core.js': c('assets/core.js', []),
      'assets/lazy.js': c('assets/lazy.js', []),
    };
    expect([...staticClosure(bundle, ['assets/editor.js'])].sort()).toEqual(['assets/core.js', 'assets/editor.js', 'assets/react.js', 'assets/three.js']);
    const out = editorPrefetchFiles(bundle, (x) => x.isEntry === true, (x) => /EditorRoute/.test(x.facadeModuleId ?? ''));
    expect(out.js).toEqual(['assets/core.js', 'assets/editor.js', 'assets/three.js']);
    expect(out.css).toEqual(['assets/editor.css']);
  });

  it('boot script only acts on editor routes and preloads the closure', () => {
    const src = editorBootSource(['assets/a-1.js', 'assets/b-2.js']);
    const run = (hash: string): { links: string[]; early: string[] } => {
      const links: string[] = [];
      const win: Record<string, unknown> = { fetch: () => Promise.resolve({}) };
      const doc = { currentScript: { src: 'https://x.test/editor-boot.js' }, head: { appendChild: (l: { href: string }) => links.push(l.href) }, createElement: () => ({}) };
      new Function('location', 'document', 'window', 'URL', 'fetch', src)({ hash, href: 'https://x.test/' }, doc, win, URL, win['fetch']);
      return { links, early: Object.keys((win['__aetherEarly'] as Record<string, unknown> | undefined) ?? {}) };
    };
    expect(run('').links).toEqual([]);
    expect(run('#/projects').links).toEqual([]);
    expect(run('#/new/casa-patio')).toEqual({ links: ['https://x.test/assets/a-1.js', 'https://x.test/assets/b-2.js'], early: ['/templates/worlds/casa-patio.json'] });
    expect(run('#/new').early).toEqual([]);
    expect(run('#/p/abc123').links).toHaveLength(2);
  });
});
