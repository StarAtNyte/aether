/**
 * Compact catalog summary for LLM prompts: counts and a few example ids per
 * category, so the model knows real assets exist and how to ask for more
 * (the `search_assets` tool). Kept well under 2 KB.
 */
import type { AssetCategory, Catalog } from './schema';

/** Categories in prompt order (most useful first). */
const ORDER: readonly AssetCategory[] = [
  'furniture', 'kitchen', 'bathroom', 'decor', 'lighting', 'plants', 'nature', 'rocks', 'building', 'street',
  'vehicles', 'characters', 'animals', 'food', 'tools', 'props', 'sky',
];

/** One-line-per-category summary (examples are the first ids, smallest first). */
export function catalogSummary(catalog: Catalog | null, examplesPerCategory = 7, maxChars = 1800): string {
  if (!catalog || catalog.entries.length === 0) return '';
  const lines: string[] = [];
  for (const cat of ORDER) {
    const list = catalog.entries.filter((e) => e.category === cat);
    if (list.length === 0) continue;
    const anim = list.some((e) => e.anims && e.anims.clips.length > 0) ? ' (animated: idle/walk/run)' : '';
    const ex = list.slice(0, examplesPerCategory).map((e) => e.id);
    lines.push(`- ${cat} (${list.length})${anim}: ${ex.join(', ')}${list.length > ex.length ? ', …' : ''}`);
  }
  let text = lines.join('\n');
  if (text.length > maxChars) text = `${text.slice(0, maxChars - 1)}…`;
  return text;
}
