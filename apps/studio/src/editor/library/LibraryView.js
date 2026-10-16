import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Library browser: the curated asset catalog as a searchable, filterable
 * grid of rendered thumbnails. Click places an asset at the view's focus;
 * drag drops it under the cursor (snapped to floors, walls and ceilings).
 * Stars mark favourites; every tile shows its source and licence.
 */
import { memo, useEffect, useMemo, useState } from 'react';
import { libraryUrl, searchAssets } from '@aether/assets';
import { useStudio, useUI } from '../../app/context';
import { Icon } from '../../components/Icon';
import { ASSET_DRAG_TYPE, dragState, useLibrary } from './useLibrary';
import { MATERIAL_DRAG_TYPE } from '../../lib/materials';
/** Category chips in display order, with labels. */
export const CATEGORY_LABELS = [
    ['furniture', 'Furniture'], ['kitchen', 'Kitchen'], ['bathroom', 'Bathroom'], ['decor', 'Decor'], ['lighting', 'Lighting'], ['plants', 'Plants'],
    ['nature', 'Nature'], ['rocks', 'Rocks'], ['building', 'Buildings'], ['street', 'Street'], ['vehicles', 'Vehicles'], ['characters', 'People'],
    ['animals', 'Animals'], ['food', 'Food'], ['tools', 'Tools'], ['props', 'Props'], ['sky', 'Skies'], ['materials', 'Surfaces'],
];
/** Tiles per category section while browsing everything. */
const BROWSE_PER_CATEGORY = 9;
/** Pack title + licence line for a tile tooltip. */
function sourceLine(catalog, e) {
    const pack = catalog.packs.find((p) => p.id === e.pack);
    const by = e.authors?.join(', ') ?? pack?.author ?? '';
    return `${pack?.title ?? e.pack}${by ? ` · ${by}` : ''} · ${pack?.licence ?? 'CC0-1.0'}`;
}
function sizeText(e) {
    if (e.kind === 'hdri')
        return 'HDR sky';
    const f = (v) => (v >= 10 ? v.toFixed(0) : v.toFixed(1));
    return `${f(e.size[0])} × ${f(e.size[1])} × ${f(e.size[2])} m`;
}
const AssetTile = memo(function AssetTile({ entry, catalog, favorite, disabled }) {
    const studio = useStudio();
    const [broken, setBroken] = useState(!entry.thumb);
    const animated = !!entry.anims && entry.anims.clips.length > 0;
    return (_jsxs("div", { className: "asset-tile", "data-asset": entry.id, children: [_jsxs("button", { type: "button", className: "tile asset-tile__btn", disabled: disabled, draggable: !disabled, onDragEnd: () => {
                    dragState.asset = null;
                    studio.assets.clearPreview();
                }, onDragStart: (e) => {
                    if (entry.kind === 'material' && entry.material) {
                        // Surfaces drop onto objects like the material swatches.
                        e.dataTransfer.setData(MATERIAL_DRAG_TYPE, JSON.stringify({ name: entry.name, spec: { finish: entry.material.finish } }));
                    }
                    else {
                        dragState.asset = entry.id;
                        e.dataTransfer.setData(ASSET_DRAG_TYPE, entry.id);
                    }
                    e.dataTransfer.setData('text/plain', entry.name);
                    e.dataTransfer.effectAllowed = 'copy';
                }, onClick: () => void studio.assets.place(entry.id), "aria-label": `Add ${entry.name}`, "data-tip": `${entry.name} — ${sizeText(entry)}\n${sourceLine(catalog, entry)}`, children: [_jsxs("span", { className: "tile__art", children: [broken || !entry.thumb ? (_jsx(Icon, { name: entry.kind === 'hdri' ? 'sun' : entry.kind === 'material' ? 'palette' : 'cube', size: 20 })) : (_jsx("img", { src: libraryUrl(entry.thumb, catalog), alt: "", width: 96, height: 96, loading: "lazy", decoding: "async", draggable: false, onError: () => setBroken(true) })), animated && _jsx("span", { className: "asset-tile__badge", "aria-label": "Animated", children: "Anim" })] }), _jsx("span", { className: "tile__label", children: entry.name })] }), _jsx("button", { type: "button", className: `asset-tile__star${favorite ? ' is-on' : ''}`, "aria-pressed": favorite, "aria-label": favorite ? `Remove ${entry.name} from favourites` : `Add ${entry.name} to favourites`, onClick: () => studio.assets.toggleFavorite(entry.id), children: _jsx(Icon, { name: "star", size: 13 }) })] }));
});
/** The library grid (search text comes from the panel toolbar). */
export const LibraryView = memo(function LibraryView({ query }) {
    const studio = useStudio();
    const catalog = useLibrary((s) => s.catalog);
    const favorites = useLibrary((s) => s.favorites);
    const playing = useUI((s) => s.mode === 'play');
    const [filter, setFilter] = useState('all');
    useEffect(() => {
        void studio.assets.ready();
    }, [studio]);
    const counts = useMemo(() => {
        const m = new Map();
        for (const e of catalog?.entries ?? [])
            m.set(e.category, (m.get(e.category) ?? 0) + 1);
        return m;
    }, [catalog]);
    const list = useMemo(() => {
        if (!catalog)
            return [];
        const fav = new Set(favorites);
        const hits = searchAssets(catalog, { text: query, limit: 200, ...(filter !== 'all' && filter !== 'favorites' ? { category: filter } : {}) }).map((h) => h.entry);
        const filtered = filter === 'favorites' ? hits.filter((e) => fav.has(e.id)) : hits;
        // Browsing (no query): favourites first, then the catalog order.
        return query.trim() === '' && filter === 'all' ? [...filtered.filter((e) => fav.has(e.id)), ...filtered.filter((e) => !fav.has(e.id))] : filtered;
    }, [catalog, favorites, filter, query]);
    const browsing = query.trim() === '' && filter === 'all';
    if (!catalog)
        return _jsx("p", { className: "panel-empty", children: "Loading the asset library\u2026" });
    if (catalog.entries.length === 0)
        return _jsx("p", { className: "panel-empty", children: "The asset library is not installed in this build." });
    const fav = new Set(favorites);
    return (_jsxs("div", { className: "library", children: [_jsxs("button", { type: "button", className: "forge-cta", disabled: playing, onClick: () => studio.forge.open(), children: [_jsx(Icon, { name: "sparkles", size: 16 }), _jsxs("span", { children: [_jsx("strong", { children: "Create from an image or text" }), _jsx("span", { className: "forge-cta__sub", children: "A model writes an editable 3D generator and checks it against your photo" })] })] }), _jsxs("div", { className: "chip-row scroll-x", role: "toolbar", "aria-label": "Asset categories", children: [_jsx("button", { type: "button", className: `chip${filter === 'all' ? ' is-on' : ''}`, "aria-pressed": filter === 'all', onClick: () => setFilter('all'), children: "All" }), _jsxs("button", { type: "button", className: `chip${filter === 'favorites' ? ' is-on' : ''}`, "aria-pressed": filter === 'favorites', onClick: () => setFilter('favorites'), disabled: favorites.length === 0, children: [_jsx(Icon, { name: "star", size: 12 }), " Favourites"] }), CATEGORY_LABELS.filter(([c]) => (counts.get(c) ?? 0) > 0).map(([c, label]) => (_jsx("button", { type: "button", className: `chip${filter === c ? ' is-on' : ''}`, "aria-pressed": filter === c, onClick: () => setFilter(filter === c ? 'all' : c), children: label }, c)))] }), list.length === 0 ? (_jsxs("p", { className: "panel-empty", children: ["No assets match", query ? ` “${query}”` : '', ". Try another word, or ask the agent to build it."] })) : browsing ? (
            // Browsing everything: favourites, then one short section per category, in a curated order.
            [
                favorites.length > 0 ? (_jsxs("section", { className: "assets__section", "aria-labelledby": "lib-favorites", children: [_jsx("header", { className: "assets__head", children: _jsx("h3", { id: "lib-favorites", className: "assets__title", children: "Favourites" }) }), _jsx("div", { className: "tile-grid asset-grid", children: favorites
                                .map((id) => catalog.entries.find((e) => e.id === id))
                                .filter((e) => e !== undefined)
                                .map((e) => (_jsx(AssetTile, { entry: e, catalog: catalog, favorite: true, disabled: playing }, e.id))) })] }, "favorites")) : null,
                ...CATEGORY_LABELS.map(([cat, label]) => {
                    const all = catalog.entries.filter((e) => e.category === cat);
                    if (all.length === 0)
                        return null;
                    const shown = all.slice(0, BROWSE_PER_CATEGORY);
                    return (_jsxs("section", { className: "assets__section", "aria-labelledby": `lib-${cat}`, children: [_jsxs("header", { className: "assets__head", children: [_jsx("h3", { id: `lib-${cat}`, className: "assets__title", children: label }), all.length > shown.length && (_jsxs("button", { type: "button", className: "link-btn assets__more", onClick: () => setFilter(cat), children: ["All ", all.length] }))] }), _jsx("div", { className: "tile-grid asset-grid", children: shown.map((e) => (_jsx(AssetTile, { entry: e, catalog: catalog, favorite: fav.has(e.id), disabled: playing }, e.id))) })] }, cat));
                }),
            ]) : (_jsx("div", { className: "tile-grid asset-grid", "data-count": list.length, children: list.map((e) => (_jsx(AssetTile, { entry: e, catalog: catalog, favorite: fav.has(e.id), disabled: playing }, e.id))) }))] }));
});
