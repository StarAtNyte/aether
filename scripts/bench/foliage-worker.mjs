/** Real worker + OffscreenCanvas parity and event-loop responsiveness for every foliage kind. */
import { chromium, firefox } from 'playwright';
const root = '/@fs' + process.cwd() + '/';
const browserName = process.env.AETHER_BENCH_BROWSER ?? 'chromium';
const browser = await (browserName === 'firefox' ? firefox.launch() : chromium.launch({ args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] }));
try {
  const page = await browser.newPage();
  await page.route('**/foliage-worker-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Atlas worker probe</title>' }));
  const errors = [], workers = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('worker', w => workers.push(w.url().split('/').pop()));
  await page.goto(`${process.env.AETHER_BENCH_URL ?? 'http://127.0.0.1:5177'}/foliage-worker-probe`);
  const result = await page.evaluate(async ({ root, size, inline }) => {
    const { FoliageAtlasClient } = await import(root + 'packages/render/src/materials/foliage-atlas-client.ts');
    const { composePhotoAtlas, photoAtlasJob, loadLeafPhotos, PHOTO_KINDS } = await import(root + 'packages/render/src/materials/foliage-photo.ts');
    const { foliagePixels, foliagePixelsJob } = await import(root + 'packages/procgen/src/foliage-pixels.ts');
    const { textureWork } = await import(root + 'packages/render/src/gpu/task-queue.ts');
    const base = new URL('/foliage/', location.href).href;
    const photos = await loadLeafPhotos(base);
    if (!photos) throw new Error('Missing photographed foliage sheet');
    const client = new FoliageAtlasClient();
    const compare = (a, b) => {
      if (!a || !b || a.length !== b.length) throw new Error('Worker returned no/incorrect atlas');
      let different = 0, solid = 0, maxDelta = 0;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) different++;
        maxDelta = Math.max(maxDelta, Math.abs(a[i] - b[i]));
        if (i % 4 === 3 && a[i]) solid++;
      }
      return { different, solid, maxDelta };
    };
    const measure = async run => {
      const gaps = []; let last = performance.now();
      const timer = setInterval(() => { const now = performance.now(); gaps.push(now - last); last = now; }, 8);
      const start = performance.now();
      const value = await run();
      const elapsed = performance.now() - start;
      await new Promise(resolve => setTimeout(resolve, 16));
      clearInterval(timer);
      return { value, elapsed, maxGap: Math.max(0, ...gaps) };
    };
    const results = [], reference = new Map();
    try {
      for (const kind of ['broadleaf', 'shrub', 'fern', 'needles', 'blossom', 'flower', 'grass']) {
        for (const photo of [false, true]) {
          if (photo && !PHOTO_KINDS.has(kind)) continue;
          const baseline = await measure(async () => {
            if (inline) return photo ? composePhotoAtlas(kind, size, photos.sheet, photos.image) : foliagePixels(kind, size).rgba;
            // Match the existing runtime fallback, including its cooperative job boundaries.
            const job = photo ? photoAtlasJob(kind, size, photos.sheet, photos.image) : foliagePixelsJob(kind, size);
            for (const step of job.steps) await textureWork.run(step);
            return photo ? await textureWork.run(() => job.finish()) : job.rgba;
          });
          if (photo || kind === 'grass') reference.set(kind, baseline.value);
          const worker = await measure(() => client.compose(kind, size, photo ? base : null));
          results.push({ kind, photo, size, ...compare(baseline.value, worker.value), baselineMs: baseline.elapsed, baselineGap: baseline.maxGap, workerMs: worker.elapsed, workerGap: worker.maxGap });
        }
      }
    } finally { client.dispose(); photos.image.close(); }
    const { FoliageTextures } = await import(root + 'packages/render/src/materials/foliage-textures.ts');
    const cache = new FoliageTextures();
    let changes = 0;
    cache.onChange = () => { changes++; };
    cache.configure(size);
    cache.usePhotos(base);
    const textures = new Map([...reference.keys()].map(kind => [kind, cache.get(kind)]));
    // Cancel outstanding requests by changing the source while keeping the texture objects.
    cache.usePhotos(base + '../foliage/');
    const deadline = performance.now() + 60000;
    while (cache.pending) {
      if (performance.now() > deadline) throw new Error('Foliage texture cache timed out');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    try {
      for (const [kind, texture] of textures) {
        // Grass uses twice the configured size, capped at 1024.
        const expected = texture.image.width === size ? reference.get(kind) : foliagePixels(kind, texture.image.width).rgba;
        const parity = compare(expected, texture.image.data);
        if (cache.get(kind) !== texture || parity.different || !parity.solid || texture.version < 2) throw new Error('Texture cache integration failed: ' + kind);
      }
      if (changes !== textures.size) throw new Error('Stale worker results updated the cache');
    } finally { cache.dispose(); }
    return { results, cacheTextures: textures.size, cacheChanges: changes };
  }, { root, size: Number(process.env.AETHER_BENCH_SIZE ?? 512), inline: process.env.AETHER_BENCH_INLINE === '1' });
  console.log(JSON.stringify({ browser: browserName, baseline: process.env.AETHER_BENCH_INLINE === '1' ? 'inline' : 'cooperative', workers, errors, ...result }, null, 2));
  if (errors.length || !workers.length || result.results.some(r => r.different || !r.solid)) process.exitCode = 1;
} finally { await browser.close(); }
