import { chromium, firefox } from 'playwright';
import { CHROME_ARGS, findChrome, findFirefox, FIREFOX_PREFS } from './support/env';
for (const which of ['chromium', 'firefox']) {
const browser = which === 'chromium' ? await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] }) : await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } });
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
console.log(which, await page.evaluate(async () => {
  const r: Record<string, number> = {};
  for (const wrf of [true, false]) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const ctx = c.getContext('2d', { willReadFrequently: wrf })!;
    const px = new Uint8ClampedArray(256 * 256 * 4); for (let i = 0; i < px.length; i++) px[i] = (i * 31) & 255;
    let t = performance.now(); ctx.putImageData(new ImageData(px, 256, 256), 0, 0); r[`put${wrf}`] = performance.now() - t;
    t = performance.now(); const p = new Promise<Blob | null>((ok) => c.toBlob(ok)); r[`toBlobCall${wrf}`] = performance.now() - t;
    await p; r[`toBlobDone${wrf}`] = performance.now() - t;
    t = performance.now(); c.toDataURL(); r[`dataUrl${wrf}`] = performance.now() - t;
    t = performance.now(); const cs = new Blob([px]).stream().pipeThrough(new CompressionStream('deflate')); await new Response(cs).arrayBuffer(); r[`deflate${wrf}`] = performance.now() - t;
  }
  return r;
}));
await browser.close();
}
