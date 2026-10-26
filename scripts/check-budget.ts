/**
 * Build budget: the JavaScript and CSS a first visit downloads (gzip) must stay under the limits in
 * scripts/size-budget.json. "Initial" is everything the page reaches by script/modulepreload tags and static
 * imports; lazy chunks (path tracer, on-device model, QuickJS, exporters) are not counted.
 * Usage: tsx scripts/check-budget.ts [dist-dir]   (default apps/studio/dist; exit 1 over budget)
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = resolve(process.argv[2] ?? 'apps/studio/dist');
const budget = JSON.parse(readFileSync(new URL('./size-budget.json', import.meta.url), 'utf8')) as Record<string, { jsGzipKB: number; cssGzipKB: number }>;

function initialFiles(html: string): { js: Set<string>; css: Set<string> } {
  const js = new Set<string>(), css = new Set<string>();
  const page = readFileSync(join(dist, html), 'utf8');
  const visit = (file: string): void => {
    if (js.has(file) || !existsSync(file)) return;
    js.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:^|[;}\s])(?:import|export)\s*(?:[^'"()]*?\sfrom\s*)?["'](\.[^"']+\.js)["']/g)) visit(resolve(dirname(file), m[1]!));
  };
  for (const m of page.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+\.(?:js|css))"[^>]*>/g)) {
    const tag = m[0], ref = m[1]!;
    if (/rel="(?:prefetch|preload)"/.test(tag) && !/modulepreload/.test(tag)) continue;
    const file = resolve(dist, html === 'index.html' || !ref.startsWith('.') ? '.' : '.', ref.replace(/^\.\//, '').replace(/^\//, ''));
    if (ref.endsWith('.css')) css.add(file); else visit(file);
  }
  return { js, css };
}
const gz = (files: Set<string>): number => [...files].reduce((n, f) => n + (existsSync(f) ? gzipSync(readFileSync(f)).length : 0), 0) / 1024;

let failed = false;
for (const [page, limit] of Object.entries(budget)) {
  const { js, css } = initialFiles(page);
  const jsKB = gz(js), cssKB = gz(css);
  const ok = jsKB <= limit.jsGzipKB && cssKB <= limit.cssGzipKB;
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'OVER'} ${page}: js ${jsKB.toFixed(0)} kB gzip (limit ${limit.jsGzipKB}, ${js.size} files), css ${cssKB.toFixed(0)} kB (limit ${limit.cssGzipKB})`);
}
if (failed) { console.error('Initial download is over budget. Lazy-load the new code, or raise scripts/size-budget.json with a reason in the commit.'); process.exit(1); }
