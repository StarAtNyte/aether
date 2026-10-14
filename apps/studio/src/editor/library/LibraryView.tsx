/**
 * Library browser: the curated asset catalog as a searchable, filterable
 * grid of rendered thumbnails. Click places an asset at the view's focus;
 * drag drops it under the cursor (snapped to floors, walls and ceilings).
 * Stars mark favourites; every tile shows its source and licence.
 */
import { memo, useEffect, useMemo, useState, type ReactElement } from 'react';
import { libraryUrl, searchAssets, type AssetCategory, type Catalog, type CatalogEntry } from '@aether/assets';
import { useStudio, useUI } from '../../app/context';
import { Icon } from '../../components/Icon';
import { ASSET_DRAG_TYPE, dragState, useLibrary } from './useLibrary';

/** Category chips in display order, with labels. */
export const CATEGORY_LABELS: ReadonlyArray<readonly [AssetCategory, string]> = [
  ['furniture', 'Furniture'], ['kitchen', 'Kitchen'], ['bathroom', 'Bathroom'], ['decor', 'Decor'], ['lighting', 'Lighting'], ['plants', 'Plants'],
  ['nature', 'Nature'], ['rocks', 'Rocks'], ['building', 'Buildings'], ['street', 'Street'], ['vehicles', 'Vehicles'], ['characters', 'People'],
  ['animals', 'Animals'], ['food', 'Food'], ['tools', 'Tools'], ['props', 'Props'], ['sky', 'Skies'],
];

type Filter = AssetCategory | 'all' | 'favorites';

/** Pack title + licence line for a tile tooltip. */
function sourceLine(catalog: Catalog, e: CatalogEntry): string {
  const pack = catalog.packs.find((p) => p.id === e.pack);
  const by = e.authors?.join(', ') ?? pack?.author ?? '';
  return `${pack?.title ?? e.pack}${by ? ` · ${by}` : ''} · ${pack?.licence ?? 'CC0-1.0'}`;
}

function sizeText(e: CatalogEntry): string {
  if (e.kind === 'hdri') return 'HDR sky';
  const f = (v: number): string => (v >= 10 ? v.toFixed(0) : v.toFixed(1));
  return `${f(e.size[0])} × ${f(e.size[1])} × ${f(e.size[2])} m`;
}

const AssetTile = memo(function AssetTile({ entry, catalog, favorite, disabled }: { entry: CatalogEntry; catalog: Catalog; favorite: boolean; disabled: boolean }): ReactElement {
  const studio = useStudio();
  const [broken, setBroken] = useState(!entry.thumb);
  const animated = !!entry.anims && entry.anims.clips.length > 0;
  return (
    <div className="asset-tile" data-asset={entry.id}>
      <button
        type="button"
        className="tile asset-tile__btn"
        disabled={disabled}
        draggable={!disabled}
        onDragEnd={() => {
          dragState.asset = null;
          studio.assets.clearPreview();
        }}
        onDragStart={(e) => {
          dragState.asset = entry.id;
          e.dataTransfer.setData(ASSET_DRAG_TYPE, entry.id);
          e.dataTransfer.setData('text/plain', entry.name);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => void studio.assets.place(entry.id)}
        aria-label={`Add ${entry.name}`}
        data-tip={`${entry.name} — ${sizeText(entry)}\n${sourceLine(catalog, entry)}`}
      >
        <span className="tile__art">
          {broken || !entry.thumb ? (
            <Icon name={entry.kind === 'hdri' ? 'sun' : 'cube'} size={20} />
          ) : (
            <img src={libraryUrl(entry.thumb, catalog)} alt="" width={96} height={96} loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />
          )}
          {animated && <span className="asset-tile__badge" aria-label="Animated">Anim</span>}
        </span>
        <span className="tile__label">{entry.name}</span>
      </button>
      <button
        type="button"
        className={`asset-tile__star${favorite ? ' is-on' : ''}`}
        aria-pressed={favorite}
        aria-label={favorite ? `Remove ${entry.name} from favourites` : `Add ${entry.name} to favourites`}
        onClick={() => studio.assets.toggleFavorite(entry.id)}
      >
        <Icon name="star" size={13} />
      </button>
    </div>
  );
});

/** The library grid (search text comes from the panel toolbar). */
export const LibraryView = memo(function LibraryView({ query }: { query: string }): ReactElement {
  const studio = useStudio();
  const catalog = useLibrary((s) => s.catalog);
  const favorites = useLibrary((s) => s.favorites);
  const playing = useUI((s) => s.mode === 'play');
  const [filter, setFilter] = useState<Filter>('all');
  useEffect(() => {
    void studio.assets.ready();
  }, [studio]);
  const counts = useMemo(() => {
    const m = new Map<AssetCategory, number>();
    for (const e of catalog?.entries ?? []) m.set(e.category, (m.get(e.category) ?? 0) + 1);
    return m;
  }, [catalog]);
  const list = useMemo(() => {
    if (!catalog) return [];
    const fav = new Set(favorites);
    const hits = searchAssets(catalog, { text: query, limit: 200, ...(filter !== 'all' && filter !== 'favorites' ? { category: filter } : {}) }).map((h) => h.entry);
    const filtered = filter === 'favorites' ? hits.filter((e) => fav.has(e.id)) : hits;
    // Browsing (no query): favourites first, then the catalog order.
    return query.trim() === '' && filter === 'all' ? [...filtered.filter((e) => fav.has(e.id)), ...filtered.filter((e) => !fav.has(e.id))] : filtered;
  }, [catalog, favorites, filter, query]);
  if (!catalog) return <p className="panel-empty">Loading the asset library…</p>;
  if (catalog.entries.length === 0) return <p className="panel-empty">The asset library is not installed in this build.</p>;
  const fav = new Set(favorites);
  return (
    <div className="library">
      <button type="button" className="forge-cta" disabled={playing} onClick={() => studio.forge.open()}>
        <Icon name="sparkles" size={16} />
        <span>
          <strong>Create from an image or text</strong>
          <span className="forge-cta__sub">A model writes an editable 3D generator and checks it against your photo</span>
        </span>
      </button>
      <div className="chip-row scroll-x" role="toolbar" aria-label="Asset categories">
        <button type="button" className={`chip${filter === 'all' ? ' is-on' : ''}`} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </button>
        <button type="button" className={`chip${filter === 'favorites' ? ' is-on' : ''}`} aria-pressed={filter === 'favorites'} onClick={() => setFilter('favorites')} disabled={favorites.length === 0}>
          <Icon name="star" size={12} /> Favourites
        </button>
        {CATEGORY_LABELS.filter(([c]) => (counts.get(c) ?? 0) > 0).map(([c, label]) => (
          <button key={c} type="button" className={`chip${filter === c ? ' is-on' : ''}`} aria-pressed={filter === c} onClick={() => setFilter(filter === c ? 'all' : c)}>
            {label}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="panel-empty">No assets match{query ? ` “${query}”` : ''}. Try another word, or ask the agent to build it.</p>
      ) : (
        <div className="tile-grid asset-grid" data-count={list.length}>
          {list.map((e) => (
            <AssetTile key={e.id} entry={e} catalog={catalog} favorite={fav.has(e.id)} disabled={playing} />
          ))}
        </div>
      )}
    </div>
  );
});
