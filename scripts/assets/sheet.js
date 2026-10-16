/**
 * Contact sheet of library thumbnails for visual review:
 *   npx tsx scripts/assets/sheet.ts <from> <count> <out.png>
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Catalog } from '../../packages/assets/src/schema';
import { withBrowserPage } from './browser';
const catalog = Catalog.parse(JSON.parse(readFileSync(resolve(import.meta.dirname, '../../assets/catalog.json'), 'utf8')));
const from = Number(process.argv[2] ?? 0);
const count = Number(process.argv[3] ?? 120);
const out = process.argv[4] ?? 'sheet.png';
const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const list = catalog.entries.slice(from, from + count);
await withBrowserPage(async (page, base) => {
    await page.setViewportSize({ width: 1500, height: 1100 });
    const cells = list.map((e) => `<div style="text-align:center"><img src="${base}/lib/${e.thumb ?? ''}" width="96" height="96"><div>${esc(e.id)} ${e.size.map((v) => v.toFixed(1)).join('x')}</div></div>`);
    await page.setContent(`<body style="margin:0;background:#e8e9ec;font:9px sans-serif;display:grid;grid-template-columns:repeat(15,100px)">${cells.join('')}</body>`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: out, fullPage: true });
});
