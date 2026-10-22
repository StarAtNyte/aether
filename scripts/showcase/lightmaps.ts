/**
 * Baked interior light of the bundled worlds: bake a lightmap for each architecture showcase world in a real browser and keep
 * the `.lmap` file next to the worlds (`apps/studio/public/templates/lightmaps/<key>.lmap`, listed in `index.json`), so opening
 * one of them applies its baked light with no bake. The key is a content hash of the building, its light and the quality
 * (see `packages/render/src/environment/lightmap-asset.ts`): a world that changes (or a render change that alters what the bake
 * reads) no longer matches its file and bakes in the browser as before; `--verify` finds those.
 *
 *   npm run showcase:lightmaps                      bake the default worlds at the default quality (medium)
 *   npm run showcase:lightmaps -- photo-twin-room   only the worlds whose slug contains an argument
 *   npm run showcase:lightmaps -- --quality=high --samples=128
 *   npm run showcase:lightmaps -- --verify          open each world and check that its bundled lightmap applies
 *
 * Needs `npm run build` first (the browser runs the production build) and Chromium. `GEN_GPU=intel` bakes on the integrated GPU's
 * browser path (the bake itself is CPU work in a worker; the GPU only shows the result). Files of a world that was baked again
 * replace its old ones; the index lists every file present.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from '../../tests/e2e/support/env';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'apps/studio/public/templates/lightmaps');
const WORLDS = join(ROOT, 'apps/studio/public/templates/worlds');
const ARGS = process.argv.slice(2);
const VERIFY = ARGS.includes('--verify');
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const QUALITY = (arg('quality') ?? 'medium') as 'low' | 'medium' | 'high';
const SAMPLES = arg('samples') ? Number(arg('samples')) : null;
const FILTERS = ARGS.filter((a) => !a.startsWith('--'));
const TIMEOUT_S = Number(process.env['LM_TIMEOUT'] ?? 900);
/** Worlds with an interior worth baking: the architecture showcase (photo rooms and flagship houses). */
const DEFAULT_SLUGS = ['photo-hotel-bedroom', 'photo-twin-room', 'photo-four-poster', 'photo-vaulted-bedroom', 'skyline-penthouse', 'casa-patio'];

const log = (l: string): void => void process.stdout.write(`${l}\n`);
const INTEL_ARGS: readonly string[] = ['--enable-unsafe-webgpu', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'];

interface Index {
  keys: string[];
  /** Which world each file was baked for (so a re-bake replaces the old file), with its quality. */
  worlds: Record<string, { key: string; quality: string; samples: number; bytes: number }>;
}

function readIndex(): Index {
  try {
    const raw = JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) as Partial<Index>;
    return { keys: Array.isArray(raw.keys) ? raw.keys : [], worlds: raw.worlds && typeof raw.worlds === 'object' ? raw.worlds : {} };
  } catch {
    return { keys: [], worlds: {} };
  }
}

function writeIndex(index: Index): void {
  const files = new Set(readdirSync(OUT).filter((f) => f.endsWith('.lmap')).map((f) => f.slice(0, -5)));
  const keys = [...files].sort();
  const worlds: Index['worlds'] = {};
  for (const [slug, w] of Object.entries(index.worlds).sort(([a], [b]) => a.localeCompare(b))) if (files.has(w.key)) worlds[slug] = w;
  writeFileSync(join(OUT, 'index.json'), `${JSON.stringify({ keys, worlds }, null, 2)}\n`);
}

async function main(): Promise<number> {
  mkdirSync(OUT, { recursive: true });
  const slugs = (FILTERS.length > 0 ? DEFAULT_SLUGS.filter((s) => FILTERS.some((f) => s.includes(f))) : DEFAULT_SLUGS).filter((s) => existsSync(join(WORLDS, `${s}.json`)));
  if (slugs.length === 0) throw new Error('no world matches');
  const server = await startServer(log);
  const intel = process.env['GEN_GPU'] === 'intel';
  const browser = await chromium.launch({ executablePath: findChrome(), args: intel ? [...INTEL_ARGS] : [...CHROME_ARGS], headless: true });
  const index = readIndex();
  let failed = 0;
  try {
    for (const slug of slugs) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(SKIP_FIRST_RUN);
      await ctx.addInitScript('globalThis.__name = (f) => f;');
      try {
        const page = await ctx.newPage();
        page.on('pageerror', (e) => log(`  pageerror: ${e.message.slice(0, 200)}`));
        await page.goto(`${server.url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => {
            const a = window.__aether;
            if (!a || a.simulation === null) return false;
            const st = a.store.getState();
            return st.loading === null && !st.agentBusy && Object.keys(a.history.current.entities).length > 0;
          },
          null,
          { timeout: 180_000, polling: 250 },
        );
        await page.evaluate(async () => {
          await window.__aether?.simulation?.whenSynced();
        });
        const t0 = Date.now();
        if (!VERIFY) {
          await page.evaluate(
            ([q, s]) => {
              const a = window.__aether;
              if (!a) return;
              a.simulation?.renderer.bakeLight(q as 'low' | 'medium' | 'high', s === null ? undefined : (s as number));
            },
            [QUALITY, SAMPLES] as const,
          );
        }
        // The bake runs after the light volume is up; wait for the status to settle.
        await page
          .waitForFunction(
            () => {
              const r = window.__aether?.simulation?.renderer;
              const st = r?.lightmapStatus.state;
              return !!r && !r.lightVolumeBaking && (st === 'applied' || st === 'failed' || st === 'idle' || st === 'cancelled');
            },
            null,
            { timeout: TIMEOUT_S * 1000, polling: 500 },
          )
          .catch(() => undefined);
        const info = await page.evaluate(() => {
          const r = window.__aether?.simulation?.renderer;
          if (!r) return null;
          let b64: string | null = null;
          const a = r.lightmapAsset;
          if (a) {
            let s = '';
            for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
            b64 = btoa(s);
          }
          return { status: r.lightmapStatus, stats: r.lightmapStats, b64 };
        });
        const ok = info?.status.state === 'applied' && info.stats !== null;
        if (VERIFY) {
          const want = index.worlds[slug];
          const good = ok && info?.stats?.source === 'static' && want?.key === info.stats.key;
          log(`${good ? 'ok  ' : 'FAIL'} ${slug}: ${ok ? `${info?.stats?.source} ${info?.stats?.key}` : (info?.status.message ?? 'no status')}${want ? '' : ' (no bundled lightmap)'}`);
          if (!good) failed++;
        } else if (ok && info?.b64 && info.stats) {
          const bytes = Buffer.from(info.b64, 'base64');
          const old = index.worlds[slug];
          if (old && old.key !== info.stats.key && existsSync(join(OUT, `${old.key}.lmap`))) rmSync(join(OUT, `${old.key}.lmap`));
          writeFileSync(join(OUT, `${info.stats.key}.lmap`), bytes);
          index.worlds[slug] = { key: info.stats.key, quality: QUALITY, samples: SAMPLES ?? info.status.samples, bytes: bytes.byteLength };
          log(`baked ${slug}: ${info.status.message} -> ${info.stats.key}.lmap (${bytes.byteLength} B) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
        } else {
          log(`FAIL ${slug}: ${info?.status.state ?? 'no renderer'} ${info?.status.message ?? ''}`);
          failed++;
        }
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    await server.stop();
  }
  if (!VERIFY) writeIndex(index);
  return failed;
}

const failed = await main();
process.exit(failed > 0 ? 1 : 0);
