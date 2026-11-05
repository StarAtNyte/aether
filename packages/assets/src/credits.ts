/**
 * Credits for the assets a world uses: grouped by pack, with author,
 * licence and source link. CC-BY assets require this attribution; CC0 ones
 * get it as a courtesy. Used by the in-app credits panel, the play-mode
 * credits screen and exported packages (`CREDITS.txt`).
 */
import type { WorldDoc } from '@aether/core';
import { assetInfo, effectiveAssetId } from './info';
import { LICENCE_URLS } from './imported';
import { TEXTURE_PROVENANCE_LABEL } from './texture-sets';
import { getCatalog } from './registry';
import { ABO_CREDIT, ABO_PACK, ABO_PACK_ID } from './abo';
import type { Catalog, CatalogPack } from './schema';
import { characterCredit } from './characters/credits';
import { castById } from './characters/library';

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
  /** The exact attribution line the source asks for, when it gives one (Amazon Berkeley Objects). */
  line?: string;
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
export function creditsFor(world: Pick<WorldDoc, 'entities' | 'environment'> & { player?: Pick<WorldDoc['player'], 'character'> }, catalog: Catalog | null = getCatalog()): Credit[] {
  const packs = new Map<string, CatalogPack>([...(catalog?.packs ?? []), ABO_PACK].map((p) => [p.id, p]));
  const groups = new Map<string, Credit>();
  for (const id of worldAssetIds(world)) {
    const info = assetInfo(id);
    if (!info) continue;
    if (info.user) {
      // Each distinct credit line is kept (imports from SimReady Central carry their own CC BY line); the rest share one entry.
      const credit = info.user.credit ?? 'Imported by the author of this world';
      const key = `user|${credit}`;
      const known = /\bCC BY 4\.0\b/.test(credit) ? 'CC-BY-4.0' : /\bCC0\b/.test(credit) ? 'CC0-1.0' : /\bMIT\b/.test(credit) ? 'MIT' : null;
      const g = groups.get(key) ?? { source: 'Your imports', author: credit, licence: known ?? 'as provided by the author', licenceUrl: known ? (LICENCE_URLS[known] ?? null) : null, url: null, assets: [] };
      g.assets.push(info.user.name);
      groups.set(key, g);
      continue;
    }
    const e = info.entry;
    if (!e) continue;
    const pack = packs.get(e.pack);
    const author = e.authors?.join(', ') ?? pack?.author ?? 'Unknown';
    const key = `${e.pack}|${author}`;
    const g = groups.get(key) ?? { source: pack?.title ?? e.pack, author, licence: pack?.licence ?? 'CC0-1.0', licenceUrl: pack?.licenceUrl ?? null, url: pack?.url ?? null, assets: [], ...(e.pack === ABO_PACK_ID ? { line: ABO_CREDIT } : {}) };
    g.assets.push(e.name);
    groups.set(key, g);
  }
  const people = new Set<string>();
  let anyPerson = Boolean(world.player?.character);
  if (world.player?.character?.body) people.add(world.player.character.body);
  for (const e of Object.values(world.entities)) {
    if (!e.character) continue;
    anyPerson = true;
    if (e.character.body && castById(e.character.body)) people.add(e.character.body);
  }
  const out = [...groups.values()];
  if (anyPerson) out.push(characterCredit(people.size > 0 ? [...people] : undefined));
  for (const g of out) g.assets = [...new Set(g.assets)].sort();
  return out.sort((a, b) => ((a.source === 'Your imports' ? 1 : 0) - (b.source === 'Your imports' ? 1 : 0) || a.source.localeCompare(b.source) || a.author.localeCompare(b.author)));
}

/** Plain-text credits (for `CREDITS.txt` in exported packages). */
/** One texture set of a world as the UI states it: where its pixels came from, never hidden. */
export interface TextureCredit {
  id: string;
  name: string;
  provenance: 'photographed' | 'ai-generated' | 'procedural';
  /** `photographed (sampled from your photo)`, `AI-generated`, `procedural (made by the app)`. */
  label: string;
  /** What it was made from (photo region, prompt, model), when recorded. */
  detail: string;
}

/** The texture sets of a world with their provenance. They belong to the project: no third-party licence applies. */
export function textureCredits(world: Pick<WorldDoc, 'textures'>): TextureCredit[] {
  return Object.entries(world.textures ?? {}).map(([id, d]) => ({
    id,
    name: d.name,
    provenance: d.provenance,
    label: TEXTURE_PROVENANCE_LABEL[d.provenance],
    detail: [d.source?.photo, d.source?.region, d.source?.prompt ? `prompt: ${d.source.prompt}` : '', d.source?.model ? `model: ${d.source.model}` : ''].filter((x): x is string => !!x).join('; '),
  }));
}

/**
 * The attribution lines a world's licences require (CC BY sources and imports that carry a CC BY line), for a published
 * game's manifest and end screen. A source's own line when it gives one, else "<source> by <author>, <licence> (<url>)".
 */
export function attributionLines(credits: readonly Credit[]): string[] {
  const out: string[] = [];
  for (const c of credits) {
    if (c.licence !== 'CC-BY-4.0') continue;
    const line = c.line ?? (c.source === 'Your imports' ? c.author : `${c.source} by ${c.author}, CC BY 4.0${c.url ? ` (${c.url})` : ''}`);
    if (!out.includes(line)) out.push(line.slice(0, 300));
  }
  return out;
}

export function creditsText(worldName: string, credits: readonly Credit[], textures: readonly TextureCredit[] = []): string {
  const lines = [`Credits — ${worldName}`, ''];
  if (credits.length === 0) lines.push('This world uses no third-party assets.');
  for (const c of credits) {
    lines.push(`${c.source} by ${c.author}`);
    if (c.line) lines.push(`  Credit: ${c.line}`);
    lines.push(`  Licence: ${c.licence}${c.licenceUrl ? ` (${c.licenceUrl})` : ''}`);
    if (c.url) lines.push(`  Source: ${c.url}`);
    lines.push(`  Used: ${c.assets.join(', ')}`);
    lines.push('');
  }
  if (textures.length > 0) {
    lines.push('Textures made for this project (yours; no third-party licence applies):');
    for (const t of textures) lines.push(`  ${t.name}: ${t.label}${t.detail ? ` — ${t.detail}` : ''}`);
    lines.push('');
  }
  lines.push('Made with Aether.');
  return `${lines.join('\n')}\n`;
}
