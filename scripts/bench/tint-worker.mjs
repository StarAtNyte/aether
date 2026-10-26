/** Actual worker canvas/color parity and UI timer gaps, with shared bitmap ownership checks. */
import { chromium, firefox } from 'playwright';
const firefoxMode = process.env.AETHER_BENCH_BROWSER === 'firefox', cpuRate = firefoxMode ? 1 : 4;
const browser = await (firefoxMode ? firefox.launch() : chromium.launch());
try {
  const page = await browser.newPage(), errors = [], workers = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('worker', w => workers.push(w.url()));
  if (!firefoxMode) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
  await page.route('**/tint-worker-probe', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.goto((process.env.AETHER_BENCH_URL ?? 'http://127.0.0.1:5177') + '/tint-worker-probe');
  const cases = await page.evaluate(async root => {
    const T = await import(root + 'node_modules/three/build/three.module.js');
    const { tintedMaterial, tintedMaterialAsync } = await import(root + 'packages/render/src/characters/tint.ts');
    const size = 1024, canvas = new OffscreenCanvas(size, size), ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pixels = ctx.createImageData(size, size);
    for (let i = 0; i < pixels.data.length; i += 4) pixels.data.set([(i / 4) % 251, (i / 16) % 253, (i / 64) % 249, (i / 256) % 256], i);
    ctx.putImageData(pixels, 0, 0);
    const bitmap = await createImageBitmap(canvas);
    const rawBitmap = await createImageBitmap(await canvas.convertToBlob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const masks = { width: 128, height: 64, data: new Uint8ClampedArray(128 * 64 * 4) };
    for (let i = 0; i < masks.data.length; i++) masks.data[i] = (i * 17 + Math.floor(i / 512)) % 256;
    const tint = { top: '#cc3399', bottom: '#247bc1', hair: '#234567' }, refs = { top: .12, bottom: .1, hair: .06 };
    const read = texture => texture.image.getContext('2d').getImageData(0, 0, size, size).data;
    async function measure(run) {
      let last = performance.now(), maxGap = 0;
      const timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; }, 4);
      await new Promise(r => setTimeout(r, 20)); const start = performance.now(), value = await run(), wallMs = performance.now() - start;
      await new Promise(r => setTimeout(r, 20)); clearInterval(timer); return { value, maxGap, wallMs };
    }
    const cases = [];
    for (const part of ['body', 'head', 'hair']) for (const sourceKind of ['bitmap', 'canvas', 'compressed-original']) {
      const map = new T.Texture(sourceKind === 'canvas' ? canvas : bitmap);
      map.flipY = false; map.wrapS = T.MirroredRepeatWrapping; map.channel = 2; map.anisotropy = 8;
      if (sourceKind === 'compressed-original') map.isCompressedTexture = true;
      const source = new T.MeshStandardMaterial({ map }), original = sourceKind === 'compressed-original' ? rawBitmap : null;
      const a = await measure(() => tintedMaterial(source, part, tint, refs, masks, original));
      const b = await measure(() => tintedMaterialAsync(source, part, tint, refs, masks, original));
      if (!a.value.texture || !b.value.texture) throw new Error('Missing baked texture');
      const x = read(a.value.texture), y = read(b.value.texture); let differences = 0, max = 0;
      for (let i = 0; i < x.length; i++) { if (x[i] !== y[i]) differences++; max = Math.max(max, Math.abs(x[i] - y[i])); }
      for (const key of ['colorSpace', 'flipY', 'wrapS', 'wrapT', 'anisotropy', 'generateMipmaps', 'minFilter', 'magFilter', 'premultiplyAlpha', 'channel']) if (a.value.texture[key] !== b.value.texture[key]) throw new Error('Sampling changed: ' + key);
      if (bitmap.width !== size || rawBitmap.width !== size || source.map !== map) throw new Error('Source ownership changed');
      cases.push({ part, sourceKind, differences, max, reference: { maxGap: a.maxGap, wallMs: a.wallMs }, worker: { maxGap: b.maxGap, wallMs: b.wallMs } });
      a.value.texture.dispose(); b.value.texture.dispose(); a.value.material.dispose(); b.value.material.dispose(); source.dispose(); map.dispose();
    }
    bitmap.close(); rawBitmap.close(); return cases;
  }, '/@fs' + process.cwd() + '/');
  console.log(JSON.stringify({ browser: firefoxMode ? 'firefox' : 'chromium', cpuRate, errors, workers, cases }, null, 2));
  if (errors.length || !workers.some(w => w.includes('tint-bake.worker')) || cases.some(c => c.differences)) process.exitCode = 1;
} finally { await browser.close(); }
