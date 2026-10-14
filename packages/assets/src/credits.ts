/**
 * Credits for the assets a world uses: grouped by pack, with author,
 * licence and source link. CC-BY assets require this attribution; CC0 ones
 * get it as a courtesy. Used by the in-app credits panel, the play-mode
 * credits screen and exported packages (`CREDITS.txt`).
 */
import type { WorldDoc } from '@aether/core';
import { assetInfo, effectiveAssetId } from './info';
import { getCatalog } from './registry';
import type { Catalog, CatalogPack } from './schema';

/** One credit line. */
export interface Credit {
  /** Pack (or "Your imports"). */
  source: string;
  author: string;
  licence: string;
  licenceUrl: string | null;
  url: string | null;
  /** Asset names used from this source (sorted, unique). */
  assets: string[];
}

/** Every asset id a world references (entities, templates and the environment HDRI). */
export function worldAssetIds(world: Pick<WorldDoc, 'entities' | 'environment'>): string[] {
  const ids = new Set<string>();
  for (const e of Object.values(world.entities)) {
    if (e.shape.kind !== 'asset') continue;
    ids.add(effectiveAssetId(e.shape));
    if (e.shape.variant) ids.add(e.shape.id);
  }
  if (world.environment.hdri) ids.add(world.environment.hdri);
  return [...ids].sort();
}

/** Credits for a world's assets (library packs first, then per-author entries, then user imports). */
export function creditsFor(world: Pick<WorldDoc, 'entities' | 'environment'>, catalog: Catalog | null = getCatalog()): Credit[] {
  const packs = new Map<string, CatalogPack>((catalog?.packs ?? []).map((p) => [p.id, p]));
  const groups = new Map<string, Credit>();
  for (const id of worldAssetIds(world)) {
    const info = assetInfo(id);
    if (!info) continue;
    if (info.user) {
      const key = 'user';
      const g = groups.get(key) ?? { source: 'Your imports', author: info.user.credit ?? 'Imported by the author of this world', licence: 'as provided by the author', licenceUrl: null, url: null, assets: [] };
      g.assets.push(info.user.name);
      groups.set(key, g);
      continue;
    }
    const e = info.entry;
    if (!e) continue;
    const pack = packs.get(e.pack);
    const author = e.authors?.join(', ') ?? pack?.author ?? 'Unknown';
    const key = `${e.pack}|${author}`;
    const g = groups.get(key) ?? { source: pack?.title ?? e.pack, author, licence: pack?.licence ?? 'CC0-1.0', licenceUrl: pack?.licenceUrl ?? null, url: pack?.url ?? null, assets: [] };
    g.assets.push(e.name);
    groups.set(key, g);
  }
  const out = [...groups.values()];
  for (const g of out) g.assets = [...new Set(g.assets)].sort();
  return out.sort((a, b) => (a.source === 'Your imports' ? 1 : b.source === 'Your imports' ? -1 : a.source.localeCompare(b.source) || a.author.localeCompare(b.author)));
}

/** Plain-text credits (for `CREDITS.txt` in exported packages). */
export function creditsText(worldName: string, credits: readonly Credit[]): string {
  const lines = [`Credits — ${worldName}`, ''];
  if (credits.length === 0) lines.push('This world uses no third-party assets.');
  for (const c of credits) {
    lines.push(`${c.source} by ${c.author}`);
    lines.push(`  Licence: ${c.licence}${c.licenceUrl ? ` (${c.licenceUrl})` : ''}`);
    if (c.url) lines.push(`  Source: ${c.url}`);
    lines.push(`  Used: ${c.assets.join(', ')}`);
    lines.push('');
  }
  lines.push('Made with Aether.');
  return `${lines.join('\n')}\n`;
}
