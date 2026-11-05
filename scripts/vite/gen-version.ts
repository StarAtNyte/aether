/**
 * Code version of generated geometry: a hash of every source that decides what a generator outputs and how the
 * renderer prepares it (procgen, arch, core, and render's geometry and virtual-geometry code). It salts the keys of the persistent
 * geometry cache (packages/render/src/geometry/ddc.ts), so a build that changes any of them never serves geometry
 * made by an older one. Coarse but safe: an unrelated edit in these packages only costs one cold load.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIRS = ['packages/procgen/src', 'packages/arch/src', 'packages/core/src', 'packages/render/src/geometry', 'packages/render/src/virtual'];
const FILES = ['packages/render/src/materials/presets.ts'];

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|json)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
}

/** Hex digest (16 chars) of the generation sources. */
export function generationCodeVersion(): string {
  const files: string[] = [];
  for (const d of DIRS) walk(join(ROOT, d), files);
  for (const f of FILES) files.push(join(ROOT, f));
  const h = createHash('sha256');
  for (const f of files) {
    h.update(f.slice(ROOT.length));
    h.update('\u0000');
    h.update(readFileSync(f));
    h.update('\u0000');
  }
  return h.digest('hex').slice(0, 16);
}
