/**
 * Vite plugin: serve the asset library (`assets/lib/`, built by
 * `npm run assets:build`) at `/assets/lib/` in dev and preview, and copy it
 * into the build output so the production server and static hosts serve it
 * next to the bundle under the same immutable-cache rule as `/assets/*`
 * (every library file name carries a content hash).
 *
 * Dev requests are confined to the library directory (no `..`, no
 * absolute paths, regular files only) and only known media types are served.
 */
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

/** URL prefix of the library. */
export const LIBRARY_PREFIX = '/assets/lib/';

const TYPES: Readonly<Record<string, string>> = {
  '.glb': 'model/gltf-binary',
  '.hdr': 'application/octet-stream',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
};

/** Resolve a request path to a library file, or null when it is outside the library or not servable. */
export function libraryFile(libDir: string, urlPath: string): string | null {
  if (!urlPath.startsWith(LIBRARY_PREFIX)) return null;
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath.slice(LIBRARY_PREFIX.length).split('?')[0] ?? '');
  } catch {
    return null;
  }
  if (rel === '' || rel.includes('\0') || rel.startsWith('/') || rel.split(/[\\/]/).includes('..')) return null;
  if (!(extname(rel) in TYPES)) return null;
  const root = resolve(libDir);
  const file = resolve(root, rel);
  if (!file.startsWith(root + sep)) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

interface MiddlewareHost {
  middlewares: { use(fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): void };
}

function middleware(libDir: string) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const file = libraryFile(libDir, req.url ?? '');
    if (!file) {
      next();
      return;
    }
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    createReadStream(file).pipe(res);
  };
}

/** The plugin. `libDir` is the repository's `assets/lib`. */
export function assetLibrary(libDir: string) {
  let outDir = 'dist';
  let root = process.cwd();
  return {
    name: 'aether-asset-library',
    configResolved(config: { root: string; build: { outDir: string } }) {
      root = config.root;
      outDir = config.build.outDir;
    },
    configureServer(server: MiddlewareHost) {
      server.middlewares.use(middleware(libDir));
    },
    configurePreviewServer(server: MiddlewareHost) {
      server.middlewares.use(middleware(libDir));
    },
    closeBundle() {
      if (!existsSync(libDir)) return;
      cpSync(libDir, join(resolve(root, outDir), 'assets', 'lib'), { recursive: true });
    },
  };
}
