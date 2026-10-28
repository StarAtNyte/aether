/**
 * Static server for a production build that behaves like the host: brotli for text files, hashed assets immutable.
 * Used by the slow-network e2e runs (`load-slow`, `open-timeline`) with Slow 4G conditions set through CDP.
 */
import { createServer, type Server } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { extname, join } from 'node:path';

export const SLOW_4G = { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json', '.glb': 'model/gltf-binary', '.txt': 'text/plain' };
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.wasm', '.svg', '.webmanifest', '.txt']);
const brCache = new Map<string, Buffer>();

export function serveDist(DIST: string): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    let p = decodeURIComponent((req.url ?? '/').split(/[?#]/)[0]!);
    if (p === '/') p = '/index.html';
    else if (p === '/play') p = '/play.html';
    let file = join(DIST, p);
    if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
      if (existsSync(`${file}.html`)) file = `${file}.html`;
      else { res.writeHead(404).end('not found'); return; }
    }
    const ext = extname(file);
    const headers: Record<string, string> = { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': /^\/(assets|fonts)\//.test(p) ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate' };
    let body: Buffer = readFileSync(file);
    if (COMPRESSIBLE.has(ext) && /\bbr\b/.test(String(req.headers['accept-encoding']))) {
      let c = brCache.get(file);
      if (!c) { c = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }); brCache.set(file, c); }
      body = c;
      headers['content-encoding'] = 'br';
    }
    headers['content-length'] = String(body.length);
    res.writeHead(200, headers).end(body);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, server })));
}

