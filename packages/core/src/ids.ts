/**
 * Entity id helpers.
 */
import { EntityId as EntityIdSchema } from './schema';
import type { EntityId, WorldDoc } from './schema';
import { isForbiddenKey } from './guard';
import { hasOwn } from './json';

const MAX_ID_LENGTH = 64;

/** True when `s` is a syntactically valid, non-reserved entity id. */
export function isEntityId(s: string): boolean {
  return EntityIdSchema.safeParse(s).success && !isForbiddenKey(s);
}

/**
 * Convert any display name into an entity id: lowercase ASCII slug, diacritics
 * removed, separators collapsed to "-", at most 64 chars.
 * "Red Car!" → "red-car", "Ünïcödé Tower" → "unicode-tower", "" → "entity".
 */
export function slugify(name: string): EntityId {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ID_LENGTH)
    .replace(/-+$/, '');
  if (slug.length === 0) return 'entity';
  return isForbiddenKey(slug) ? `${slug}-entity` : slug;
}

/**
 * Return an id derived from `base` that is unused in `world` (and in `taken`,
 * useful when generating several ids before applying them).
 * "tree" → "tree" if free, else "tree-2", "tree-3", …; "tree-2" (taken) → "tree-3".
 */
export function uniqueId(world: Pick<WorldDoc, 'entities'>, base: string, taken?: ReadonlySet<string>): EntityId {
  const isTaken = (id: string): boolean => hasOwn(world.entities, id) || (taken?.has(id) ?? false);
  const slug = slugify(base);
  if (!isTaken(slug)) return slug;
  const m = /^(.*?)-(\d{1,9})$/.exec(slug);
  const stem = m?.[1] ? m[1] : slug;
  let n = m ? Number(m[2]) + 1 : 2;
  const limit = n + Object.keys(world.entities).length + (taken?.size ?? 0) + 1;
  for (; n <= limit; n++) {
    const suffix = `-${n}`;
    const candidate = `${stem.slice(0, MAX_ID_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
  // Unreachable: there are more candidates than taken ids (pigeonhole).
  throw new Error(`uniqueId: could not derive a free id from "${base}"`);
}
