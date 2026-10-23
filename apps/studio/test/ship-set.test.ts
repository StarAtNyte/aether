import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shippedPaths } from '../../../scripts/vite/ship-set';

const ROOT = resolve(import.meta.dirname, '../../..');
const LIB = join(ROOT, 'assets', 'lib');

describe.skipIf(!existsSync(LIB))('lean build ship set', () => {
  const shipped = shippedPaths(ROOT, LIB);
  const set = new Set(shipped);
  const catalog = JSON.parse(readFileSync(join(ROOT, 'assets/catalog.json'), 'utf8')) as { entries: Array<{ id: string; file?: string; thumb?: string }> };
  const ktx = JSON.parse(readFileSync(join(ROOT, 'assets/ktx2.json'), 'utf8')) as { entries: Record<string, { file: string }> };

  it('ships every file of every model a bundled example world names (as its compressed twin when it has one)', () => {
    const worlds = ['medieval-village', 'apartment', 'kyoto-temple'];
    for (const w of worlds) {
      const text = readFileSync(join(ROOT, 'apps/studio/public/templates/worlds', `${w}.json`), 'utf8');
      const ids = new Set([...text.matchAll(/"id":\s*"([a-z0-9-]+)"/g)].map((m) => m[1]));
      for (const e of catalog.entries) {
        if (!e.file || !ids.has(e.id)) continue;
        expect(set.has(ktx.entries[e.file]?.file ?? e.file), `${w}: ${e.id}`).toBe(true);
      }
    }
  });

  it('ships every thumbnail but not the whole library', () => {
    for (const e of catalog.entries) if (e.thumb) expect(set.has(e.thumb), e.id).toBe(true);
    const total = readdirCount();
    expect(shipped.length).toBeLessThan(total * 0.75);
  });

  it('lists only files that exist', () => {
    for (const p of shipped) expect(existsSync(join(LIB, p)), p).toBe(true);
  });

  function readdirCount(): number {
    let n = 0;
    for (const d of ['c', 'h', 'i', 'k', 'm', 't', 'x']) n += readdirSyncSafe(join(LIB, d));
    return n;
  }
});

import { readdirSync } from 'node:fs';
function readdirSyncSafe(d: string): number {
  return existsSync(d) ? readdirSync(d).length : 0;
}
