import { readFileSync } from 'node:fs';
import { withBrowserPage } from './browser';
const cat = JSON.parse(readFileSync('assets/catalog.json', 'utf8'));
const from = Number(process.argv[2] ?? 0), n = Number(process.argv[3] ?? 120), out = process.argv[4]!;
const list = cat.entries.slice(from, from + n);
await withBrowserPage(async (page, base) => {
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.setContent(`<body style="margin:0;background:#e8e9ec;font:9px sans-serif;display:grid;grid-template-columns:repeat(15,100px);gap:0">${list.map((e: any) => `<div style="text-align:center"><img src="${base}/lib/${e.thumb}" width="96" height="96"><div>${e.id} ${e.size.map((v: number) => v.toFixed(1)).join('x')}</div></div>`).join('')}</body>`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out, fullPage: true });
});
