/**
 * Render the share card and app icons into `apps/studio/public/`:
 *
 * - `og.jpg` (1200×630): the link preview shown by chat apps and social
 *   sites, a mosaic of four showcase renders with the name and tagline;
 * - `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`: home-screen
 *   icons (the SVG favicon covers desktop tabs).
 *
 * Reproducible: every input is in the repository (the logomark of
 * `favicon.svg`, the showcase renders under `docs/screenshots/showcase/`,
 * system fonts). One headless Chromium, closed at the end.
 *
 *   npx tsx scripts/brand/render.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { findChrome } from '../../tests/e2e/support/env';
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const PUBLIC = join(ROOT, 'apps/studio/public');
const SHOTS = join(ROOT, 'docs/screenshots/showcase');
/** Showcase renders in the card, in mosaic order. */
const CARD_SHOTS = ['lantern-isles', 'neon-rain-city', 'dusk-lake-house', 'chain-reaction'];
const MARK = (stroke) => `<path d="M5 13.25 10 5.75l5 7.5" fill="none" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.75 15.25h10.5" fill="none" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round"/>`;
function dataUrl(file) {
    return `data:image/webp;base64,${readFileSync(file).toString('base64')}`;
}
function cardHtml() {
    const tiles = CARD_SHOTS.map((s) => `<div class="tile" style="background-image:url('${dataUrl(join(SHOTS, `${s}.webp`))}')"></div>`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}
  body{width:1200px;height:630px;background:#0f1013;color:#f4f4f6;font-family:"Inter","Segoe UI",system-ui,sans-serif;overflow:hidden;position:relative}
  .mosaic{position:absolute;right:-40px;top:-30px;width:760px;height:690px;display:grid;grid-template-columns:1fr 1fr;gap:14px;transform:rotate(-6deg);transform-origin:center}
  .tile{border-radius:18px;background-size:cover;background-position:center;box-shadow:0 18px 50px rgba(0,0,0,.45)}
  .fade{position:absolute;inset:0;background:linear-gradient(90deg,#0f1013 0%,#0f1013 38%,rgba(15,16,19,.82) 52%,rgba(15,16,19,0) 72%)}
  .copy{position:absolute;left:72px;top:0;bottom:0;width:560px;display:flex;flex-direction:column;justify-content:center}
  .brand{display:flex;align-items:center;gap:18px;margin-bottom:40px}
  .brand span{font-size:44px;font-weight:650;letter-spacing:-.02em}
  h1{font-size:58px;line-height:1.06;font-weight:700;letter-spacing:-.03em;margin-bottom:24px}
  p{font-size:25px;line-height:1.4;color:#b9bcc6}
  .chip{display:inline-flex;align-items:center;gap:10px;margin-top:36px;font-size:20px;color:#c9c6ff}
  .dot{width:10px;height:10px;border-radius:50%;background:#6f68ff}
  </style></head><body>
  <div class="mosaic">${tiles}</div><div class="fade"></div>
  <div class="copy">
    <div class="brand"><svg width="64" height="64" viewBox="0 0 20 20"><rect width="20" height="20" rx="5.5" fill="#f4f4f6"/>${MARK('#0f1013')}</svg><span>Aether</span></div>
    <h1>Describe a world.<br>Play it.</h1>
    <p>Plain language in, a physically verified, playable 3D world out — right in the browser.</p>
    <div class="chip"><i class="dot"></i>WebGPU · WebGL2 · runs offline</div>
  </div></body></html>`;
}
function iconHtml(size, padding) {
    const inner = size - padding * 2;
    return `<!doctype html><html><head><style>*{margin:0}body{width:${size}px;height:${size}px;background:#18191d;display:grid;place-items:center}</style></head><body><svg width="${inner}" height="${inner}" viewBox="2.5 2.5 15 15">${MARK('#ffffff')}</svg></body></html>`;
}
async function main() {
    const browser = await chromium.launch({ executablePath: findChrome() });
    try {
        const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
        await page.setContent(cardHtml(), { waitUntil: 'load' });
        writeFileSync(join(PUBLIC, 'og.jpg'), await page.screenshot({ type: 'jpeg', quality: 86 }));
        for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
            // Maskable-safe: the mark stays inside the central 80 % circle.
            await page.setViewportSize({ width: size, height: size });
            await page.setContent(iconHtml(size, Math.round(size * 0.2)), { waitUntil: 'load' });
            writeFileSync(join(PUBLIC, name), await page.screenshot({ type: 'png' }));
        }
        process.stdout.write('wrote og.jpg, apple-touch-icon.png, icon-192.png, icon-512.png\n');
    }
    finally {
        await browser.close();
    }
}
main().catch((err) => {
    process.stderr.write(`brand render failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
});
