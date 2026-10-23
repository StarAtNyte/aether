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
import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { shippedPaths } from './ship-set';

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

/**
 * The plugin. `libDir` is the repository's `assets/lib`. With `cdn` (a base URL ending in `/` that serves the
 * same tree, pinned to a commit) the build ships only {@link shippedPaths} plus `remote.json`
 * (`{ base, shipped }`); the app fetches every other file from `cdn`. Without it the whole library ships.
 * Dev and preview always serve the whole local library.
 */
export function assetLibrary(libDir: string, cdn?: string) {
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
      const dest = join(resolve(root, outDir), 'assets', 'lib');
      if (!cdn) {
        cpSync(libDir, dest, { recursive: true });
        return;
      }
      const repoRoot = resolve(libDir, '..', '..');
      const shipped = shippedPaths(repoRoot, libDir);
      for (const p of shipped) {
        mkdirSync(dirname(join(dest, p)), { recursive: true });
        cpSync(join(libDir, p), join(dest, p));
      }
      writeFileSync(join(dest, REMOTE_FILE), JSON.stringify({ base: cdn, shipped }));
    },
  };
}

/** Name of the lean build's index under the library prefix. */
export const REMOTE_FILE = 'remote.json';

/**
 * The CDN base for a lean build, or undefined (ship everything) when none is configured or the CDN does not
 * serve the library yet (a private repository, a commit that is not pushed). `AETHER_LIB_CDN` names a base
 * directly; `AETHER_LIB_REPO` (`owner/name`) with `VERCEL_GIT_COMMIT_SHA` / `AETHER_LIB_REF` builds a jsDelivr one.
 */
export async function libraryCdn(env: Record<string, string | undefined>, libDir: string): Promise<string | undefined> {
  let base = env['AETHER_LIB_CDN'];
  const ref = env['AETHER_LIB_REF'] ?? env['VERCEL_GIT_COMMIT_SHA'];
  if (!base && env['AETHER_LIB_REPO'] && ref) base = `https://cdn.jsdelivr.net/gh/${env['AETHER_LIB_REPO']}@${ref}/assets/lib/`;
  if (!base) return undefined;
  if (!base.endsWith('/')) base += '/';
  try {
    const probe = existsSync(join(libDir, 'k')) ? 'k/' : 'm/';
    const name = existsSync(join(libDir, probe)) ? readdirSync(join(libDir, probe))[0] : undefined;
    if (!name) return undefined;
    const res = await fetch(`${base}${probe}${name}`, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
    if (res.ok) return base;
    console.warn(`[asset-library] ${base} answered ${res.status}: shipping the whole library`);
  } catch (e) {
    console.warn(`[asset-library] ${base} unreachable (${e instanceof Error ? e.message : 'error'}): shipping the whole library`);
  }
  return undefined;
}
