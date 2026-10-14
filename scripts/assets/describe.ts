/**
 * Naming, keyword and collider helpers for the library build.
 */
import type { CatalogCollider } from '../../packages/assets/src/schema';
import { canonicalTags } from '../../packages/assets/src/synonyms';

/** `loungeSofaLong` / `tree_oak_dark` / `Sofa_01` → `lounge-sofa-long` / `tree-oak-dark` / `sofa-01`. */
export function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 64);
}

/** `loungeSofaLong` → `Lounge sofa long`. */
export function prettyName(name: string): string {
  const words = kebab(name).split('-').filter((w) => w && !/^\d+$/.test(w));
  const s = words.join(' ');
  return (s.charAt(0).toUpperCase() + s.slice(1)).slice(0, 60) || 'Asset';
}

const STOP = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'the', 'of', 'with', 'and', 'detailed']);

/** Keywords: words of the id and name, extra tags, synonyms of each word, category and style. */
export function tagsFor(id: string, name: string, category: string, extra: string, style: string): string[] {
  const words = new Set<string>();
  const add = (w: string): void => {
    const t = w.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (t.length < 2 || STOP.has(t) || t.length > 32) return;
    words.add(t);
  };
  for (const w of [...id.split('-'), ...name.split(/[\s()/,-]+/), ...extra.split(/[\s/,]+/)]) add(w);
  for (const w of [...words]) for (const s of canonicalTags(w)) add(s);
  add(category);
  add(style);
  return [...words].slice(0, 32);
}

/** Collider record for a collider kind. */
export function colliderFor(kind: 'box' | 'hull' | 'capsule', positions: Float32Array, hull: (p: Float32Array) => number[]): CatalogCollider {
  if (kind === 'box') return { type: 'box' };
  if (kind === 'capsule') return { type: 'capsule' };
  const points = hull(positions);
  return points.length >= 12 ? { type: 'hull', points: points.slice(0, 26 * 3) } : { type: 'box' };
}
