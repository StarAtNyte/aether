/**
 * A headless Chromium plus a tiny loopback file server for the library
 * build's GPU / image work (texture re-encoding, thumbnails). One browser,
 * closed by {@link withBrowserPage}; the server binds 127.0.0.1 on a random
 * port and only serves `three` and the library directory.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve, sep } from 'node:path';
import { chromium, type Page } from 'playwright';
import { CHROME_ARGS, findChrome } from '../../tests/e2e/support/env';

const ROOT = resolve(import.meta.dirname, '../..');
const MOUNTS: Record<string, string> = {
  '/three/': join(ROOT, 'node_modules', 'three'),
  '/lib/': join(ROOT, 'assets', 'lib'),
  ...(process.env['AETHER_BROWSER_EXTRA_DIR'] ? { '/extra/': resolve(process.env['AETHER_BROWSER_EXTRA_DIR']) } : {}),
};
const TYPES: Record<string, string> = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.html': 'text/html' };

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
</head><body style="margin:0;background:transparent"></body></html>`;

function serve(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    if (path === '/' || path === '/page.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(PAGE);
      return;
    }
    for (const [prefix, dir] of Object.entries(MOUNTS)) {
      if (!path.startsWith(prefix)) continue;
      const file = resolve(dir, `.${path.slice(prefix.length - 1)}`);
      if (!file.startsWith(dir + sep) || !existsSync(file) || !statSync(file).isFile()) break;
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      createReadStream(file).pipe(res);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

/** Run `fn` with a page on the helper server; the browser and server are always closed. */
export async function withBrowserPage<T>(fn: (page: Page, base: string) => Promise<T>): Promise<T> {
  const { server, url } = await serve();
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  try {
    const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
    await page.goto(`${url}/page.html`);
    return await fn(page, url);
  } finally {
    await browser.close();
    server.close();
  }
}
