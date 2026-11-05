/**
 * "Share on local network": an opt-in, read-only second listener on all
 * interfaces that serves exactly one published build to devices on the
 * same network (phones, a TV, a friend's laptop):
 *
 *   http://<lan-address>:<port>/s/<token>/play/<build>/…
 *
 * - Off by default; the studio turns it on with a clear warning, and it
 *   switches itself off after a time limit.
 * - A random 128-bit token is part of every path (relative URLs inside the
 *   build keep it); anything else gets 404, including the studio and /api.
 * - GET / HEAD only, published files only (the store resolves paths
 *   safely), a strict Content-Security-Policy, nosniff, no caching of the
 *   token in referrers, a per-client request rate limit.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { extname } from 'node:path';
import { TokenBucketLimiter } from '../rate-limit';
import { PLAY_CSP } from '../middleware';
import { BUILD_ID_RE, type PublishStore } from './store';

/** Content types of build files. */
export const BUILD_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2',
  '.hdr': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.aethersave': 'application/octet-stream',
  // The gzipped product index (assets/abo.json.gz): the player inflates it itself, so it is served as plain bytes.
  '.gz': 'application/gzip',
};

/** Headers of every served build file. */
export function buildHeaders(path: string): Record<string, string> {
  const sandbox = /(^|\/)sandbox\.worker-[A-Za-z0-9_-]{4,32}\.js$/.test(path);
  return {
    'Content-Type': BUILD_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'Content-Security-Policy': sandbox ? "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'" : PLAY_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-cache',
  };
}

/** Status of the LAN share. */
export interface LanStatus {
  on: boolean;
  build: string | null;
  urls: string[];
  /** When it switches itself off (ms since epoch). */
  until: number | null;
}

/** Private (RFC 1918 / link-local / ULA) addresses of this machine. */
export function lanAddresses(ifaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): string[] {
  const out: string[] = [];
  for (const list of Object.values(ifaces)) {
    for (const a of list ?? []) {
      if (a.internal) continue;
      if (a.family === 'IPv4' && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push(a.address);
    }
  }
  return out;
}

/** Options of {@link LanShare}. */
export interface LanOptions {
  store: PublishStore;
  /** Port (0: any free port). */
  port?: number;
  /** Interface to bind (default all). */
  host?: string;
  /** Minutes until it switches itself off (default 120). */
  minutes?: number;
  now?: () => number;
  addresses?: () => string[];
}

/** The LAN share (see module docs). */
export class LanShare {
  private server: Server | null = null;
  private token = '';
  private build: string | null = null;
  private port = 0;
  private until: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly limiter: TokenBucketLimiter;

  constructor(private readonly opts: LanOptions) {
    this.limiter = new TokenBucketLimiter({ perMinute: 600, burst: 200, now: opts.now ?? Date.now });
  }

  /** Current status. */
  status(): LanStatus {
    if (!this.server || !this.build) return { on: false, build: null, urls: [], until: null };
    const addrs = (this.opts.addresses ?? lanAddresses)();
    return { on: true, build: this.build, urls: addrs.map((a) => `http://${a}:${this.port}/s/${this.token}/play/${this.build}/`), until: this.until };
  }

  /** Share `build` (a fresh token each time). */
  async start(build: string): Promise<LanStatus> {
    if (!BUILD_ID_RE.test(build) || !(await this.opts.store.meta(build))) throw new Error('That build does not exist.');
    await this.stop();
    this.token = randomBytes(16).toString('base64url');
    this.build = build;
    const server = createServer((req, res) => void this.handle(req, res));
    server.headersTimeout = 15_000;
    server.requestTimeout = 60_000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.opts.port ?? 0, this.opts.host ?? '0.0.0.0', () => resolve());
    });
    this.server = server;
    this.port = (server.address() as AddressInfo).port;
    const minutes = Math.max(1, Math.min(24 * 60, this.opts.minutes ?? 120));
    this.until = (this.opts.now ?? Date.now)() + minutes * 60_000;
    this.timer = setTimeout(() => void this.stop(), minutes * 60_000);
    this.timer.unref?.();
    return this.status();
  }

  /** Stop sharing. */
  async stop(): Promise<LanStatus> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const s = this.server;
    this.server = null;
    this.build = null;
    this.until = null;
    this.token = '';
    if (s) {
      s.closeAllConnections();
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    return this.status();
  }

  /** The bound port (tests). */
  get boundPort(): number {
    return this.port;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const deny = (status: number): void => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.end(status === 429 ? 'Too many requests' : 'Not found');
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return deny(405);
    const ip = req.socket.remoteAddress ?? 'unknown';
    if (!this.limiter.take(ip).allowed) return deny(429);
    const url = (req.url ?? '').split('?')[0] ?? '';
    const m = /^\/s\/([A-Za-z0-9_-]{22})\/play\/([a-z0-9]{12})(\/.*)?$/.exec(url);
    if (!m || !this.build || m[2] !== this.build || !tokenEquals(m[1] as string, this.token)) return deny(404);
    if (m[3] === undefined) {
      // `/play/<id>` → `/play/<id>/` so relative URLs resolve inside the build.
      res.writeHead(308, { Location: `${url}/`, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    const rel = (m[3] as string).slice(1);
    const f = await this.opts.store.file(this.build, rel);
    if (!f) return deny(404);
    const name = rel === '' || rel.endsWith('/') ? `${rel}index.html` : rel;
    res.writeHead(200, { ...buildHeaders(name), 'Content-Length': String(f.size) });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(f.file).on('error', () => res.destroy()).pipe(res);
  }
}

function tokenEquals(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && b.length > 0 && timingSafeEqual(x, y);
}
