/**
 * Render library thumbnails (192 px WebP, transparent background, three-
 * quarter view, neutral studio lighting) in one headless Chromium and
 * record them in `assets/catalog.json`. Only missing thumbnails are
 * rendered unless `--force` is passed.
 *
 *   npm run assets:thumbs [-- --force] [-- --only id1,id2]
 *
 * `--front=<dir>` instead writes a straight-on view from +Z (the way a prop's front must face) of the models
 * named by `--only` to `<dir>/<id>.webp` and leaves the catalog alone: used to check a model's orientation
 * (`--yaw=90` looks from +X, 180 from the back, 270 from -X).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Catalog } from '../../packages/assets/src/schema';
import { withBrowserPage } from './browser';
import { SETUP } from './thumb-render';

const ROOT = resolve(import.meta.dirname, '../..');
const LIB = join(ROOT, 'assets', 'lib');
const CATALOG = join(ROOT, 'assets', 'catalog.json');

const force = process.argv.includes('--force');
const onlyArg = process.argv.find((a, i) => process.argv[i - 1] === '--only');
const frontArg = process.argv.find((a) => a.startsWith('--front='))?.slice(8);
const yaw = Number(process.argv.find((a) => a.startsWith('--yaw='))?.slice(6) ?? 0);
const only = onlyArg ? new Set(onlyArg.split(',')) : null;

/** Delete thumbnails no catalog entry references (left behind by rebuilt models). */
function removeOrphans(catalog: Catalog): void {
  const keep = new Set(catalog.entries.map((e) => e.thumb).filter((t): t is string => !!t));
  for (const f of readdirSync(join(LIB, 't'))) if (!keep.has(`t/${f}`)) unlinkSync(join(LIB, 't', f));
}

async function main(): Promise<void> {
  const catalog = Catalog.parse(JSON.parse(readFileSync(CATALOG, 'utf8')));
  const todo = catalog.entries.filter((e) => e.file && (frontArg || force || !e.thumb || !existsSync(join(LIB, e.thumb))) && (!only || only.has(e.id)));
  if (todo.length === 0) {
    removeOrphans(catalog);
    console.log('all thumbnails present');
    return;
  }
  mkdirSync(join(LIB, 't'), { recursive: true });
  await withBrowserPage(async (page) => {
    await page.addScriptTag({ type: 'module', content: SETUP });
    await page.waitForFunction(() => (window as unknown as { __thumbReady?: boolean }).__thumbReady === true, undefined, { timeout: 30_000 });
    if (frontArg) mkdirSync(frontArg, { recursive: true });
    for (const e of todo) {
      const url = `/lib/${e.file}`;
      const b64 = e.kind === 'hdri'
        ? await page.evaluate((u) => (window as unknown as { __thumb: { hdri(u: string): Promise<string> } }).__thumb.hdri(u), url)
        : await page.evaluate(([u, idle, back, front]) => (window as unknown as { __thumb: { model(u: string, i: string | null, b: boolean, f: number | false): Promise<string> } }).__thumb.model(u, idle, back, front), [url, e.anims?.idle ?? null, e.facing === '-z', frontArg ? yaw : false] as const);
      const data = Buffer.from(b64, 'base64');
      if (frontArg) {
        writeFileSync(join(frontArg, `${e.id}.webp`), data);
        continue;
      }
      const h = createHash('sha256').update(data).digest('hex').slice(0, 8);
      const rel = `t/${e.id}.${h}.webp`;
      if (e.thumb && e.thumb !== rel && existsSync(join(LIB, e.thumb))) unlinkSync(join(LIB, e.thumb));
      writeFileSync(join(LIB, rel), data);
      e.thumb = rel;
      process.stdout.write(`${e.id} ${data.byteLength} B\n`);
    }
  });
  if (frontArg) {
    console.log(`${todo.length} front views in ${frontArg}`);
    return;
  }
  writeFileSync(CATALOG, `${JSON.stringify(Catalog.parse(catalog))}\n`);
  removeOrphans(catalog);
  console.log(`${todo.length} thumbnails rendered`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
