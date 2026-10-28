/**
 * Build with a size report (dev tool, see CONTRIBUTING.md "Keeping the first load small"): the studio build plus
 * `$REPORT` (per-chunk module list with importers) and `$REPORT.graph` (static import edges of every module), to find
 * which import pulls a heavy package into an eager chunk.
 *   AETHER_OUTDIR=/tmp/r REPORT=/tmp/r.json npx vite build -c apps/studio/vite.report.config.ts apps/studio
 */
import { writeFileSync } from 'node:fs';
import base from './vite.config.ts';
export default async (env: any) => {
  const c: any = await (base as any)(env);
  c.plugins.push({
    name: 'chunk-report',
    generateBundle(this: any, _o: any, bundle: any) {
      const out: any[] = [];
      for (const [f, ch] of Object.entries<any>(bundle)) {
        if (ch.type !== 'chunk') continue;
        const mods = Object.entries<any>(ch.modules ?? {}).map(([id, m]) => {
          const info = this.getModuleInfo(id);
          return { id, len: m.renderedLength, importers: (info?.importers ?? []).slice(0, 4), dyn: (info?.dynamicImporters ?? []).slice(0, 3) };
        });
        out.push({ f, isEntry: ch.isEntry, imports: ch.imports, dyn: ch.dynamicImports, mods });
      }
      const graph: Record<string,string[]> = {};
      for (const id of this.getModuleIds()) graph[id] = (this.getModuleInfo(id)?.importedIds ?? []);
      writeFileSync(process.env.REPORT + '.graph', JSON.stringify(graph));
      writeFileSync(process.env.REPORT!, JSON.stringify(out));
    },
  });
  return c;
};
