import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Assets panel, in four tabs sharing one search field:
 * - Library: the curated real-world asset catalog (see `library/LibraryView`).
 * - Basics: the procedural object palette (primitives, generators, lights).
 * - Materials: drag-on material swatches.
 * - Imports: the user's own models, images and HDR skies.
 * Click places at the centre of the view; tiles can be dragged onto the viewport.
 */
import { memo, useMemo, useState } from 'react';
import { Segmented } from '../components/ui/Segmented';
import { LibraryView } from './library/LibraryView';
import { ImportsView } from './library/ImportsView';
import { useLibrary } from './library/useLibrary';
import { useStudio, useUI } from '../app/context';
import { fuzzyScore } from '../lib/fuzzy';
import { PALETTE_DRAG_TYPE, PALETTE_ITEMS, PALETTE_SECTIONS } from '../lib/palette';
import { Icon } from '../components/Icon';
import { MATERIAL_DRAG_TYPE, MATERIAL_LIBRARY, materialDragData, parseMaterialDrag } from '../lib/materials';
export { MATERIAL_DRAG_TYPE, parseMaterialDrag, PALETTE_DRAG_TYPE };
/** A draggable material swatch: drop it on an object, or click to apply it to the selection. */
const MaterialSwatch = memo(function MaterialSwatch({ m, disabled, onApply }) {
    return (_jsxs("button", { type: "button", className: "mat-tile", disabled: disabled, draggable: !disabled, onDragStart: (e) => {
            e.dataTransfer.setData(MATERIAL_DRAG_TYPE, materialDragData(m));
            e.dataTransfer.effectAllowed = 'copy';
        }, onClick: () => onApply(m), "aria-label": `Material ${m.name}`, "data-tip": `${m.name} — drag onto an object or click to apply to the selection`, children: [_jsx("span", { className: `mat-tile__ball${m.glow ? ' is-glow' : ''}`, style: { ['--swatch']: m.swatch }, "aria-hidden": "true" }), _jsx("span", { className: "mat-tile__label", children: m.name })] }));
});
const Tile = memo(function Tile({ item, disabled, onPlace }) {
    // Lights have no geometry to render: they get an icon instead of a preview image.
    const [failed, setFailed] = useState(item.entity.shape === undefined);
    return (_jsxs("button", { type: "button", className: "tile", disabled: disabled, draggable: !disabled, onDragStart: (e) => {
            e.dataTransfer.setData(PALETTE_DRAG_TYPE, item.id);
            e.dataTransfer.effectAllowed = 'copy';
        }, onClick: () => onPlace(item.id), "aria-label": `Add ${item.label}`, title: `Add ${item.label}`, children: [_jsx("span", { className: "tile__art", children: failed ? _jsx(Icon, { name: item.section === 'lights' ? 'lightbulb' : 'cube', size: 20 }) : _jsx("img", { src: `/palette/${item.id}.webp`, alt: "", width: 96, height: 96, loading: "lazy", decoding: "async", draggable: false, onError: () => setFailed(true) }) }), _jsx("span", { className: "tile__label", children: item.label })] }));
});
/** The assets panel. */
export const AssetsPanel = memo(function AssetsPanel() {
    const studio = useStudio();
    const [query, setQuery] = useState('');
    const [tab, setTab] = useState('library');
    const busy = useLibrary((s) => s.busy);
    return (_jsxs("div", { className: "assets", children: [_jsxs("div", { className: "panel-toolbar assets__toolbar", children: [_jsxs("label", { className: "search-field search-field--sm", children: [_jsx(Icon, { name: "search" }), _jsx("input", { type: "search", value: query, maxLength: 64, placeholder: tab === 'library' ? 'Search 350+ assets' : 'Search', "aria-label": "Search assets", onChange: (e) => setQuery(e.target.value) })] }), _jsx(Segmented, { value: tab, onChange: setTab, label: "Asset source", size: "sm", stretch: true, options: [
                            ['library', 'Library'],
                            ['basics', 'Basics'],
                            ['materials', 'Materials'],
                            ['imports', 'Imports'],
                        ], titles: { library: 'Ready-made real-world assets', basics: 'Shapes, procedural objects and lights', materials: 'Drag a material onto an object', imports: 'Your own models, images and skies' } })] }), _jsxs("div", { className: "assets__scroll scroll-y", children: [tab === 'library' && _jsx(LibraryView, { query: query }), tab === 'basics' && _jsx(BasicsView, { query: query }), tab === 'materials' && _jsx(MaterialsView, { query: query }), tab === 'imports' && _jsx(ImportsView, { query: query })] }), _jsxs("footer", { className: "assets__footer", children: [_jsx("span", { className: "assets__footnote", children: busy ?? 'CC0 assets by Kenney and Poly Haven' }), _jsxs("button", { type: "button", className: "btn btn--ghost btn--xs", onClick: () => studio.assets.setCreditsOpen(true), children: [_jsx(Icon, { name: "credits", size: 13 }), "Credits"] })] })] }));
});
/** Procedural palette sections (primitives, nature, buildings, props, gameplay, lights, effects). */
const BasicsView = memo(function BasicsView({ query }) {
    const studio = useStudio();
    const playing = useUI((s) => s.mode === 'play');
    const q = query.trim();
    const items = useMemo(() => (q ? PALETTE_ITEMS.filter((p) => fuzzyScore(q, p.label) !== null || fuzzyScore(q, p.keywords) !== null) : PALETTE_ITEMS), [q]);
    const place = (id) => void studio.addFromPalette(id);
    if (items.length === 0)
        return _jsxs("p", { className: "panel-empty", children: ["No objects match \u201C", q, "\u201D."] });
    return (_jsx(_Fragment, { children: PALETTE_SECTIONS.map((s) => {
            const list = items.filter((i) => i.section === s.id);
            if (list.length === 0)
                return null;
            return (_jsxs("section", { className: "assets__section", "aria-labelledby": `assets-${s.id}`, children: [_jsxs("header", { className: "assets__head", children: [_jsx("h3", { id: `assets-${s.id}`, className: "assets__title", children: s.title }), _jsx("span", { className: "assets__hint", children: s.hint })] }), _jsx("div", { className: "tile-grid", children: list.map((it) => (_jsx(Tile, { item: it, disabled: playing, onPlace: place }, it.id))) })] }, s.id));
        }) }));
});
/** Material swatches. */
const MaterialsView = memo(function MaterialsView({ query }) {
    const studio = useStudio();
    const playing = useUI((s) => s.mode === 'play');
    const q = query.trim();
    const mats = useMemo(() => (q ? MATERIAL_LIBRARY.filter((m) => fuzzyScore(q, m.name) !== null) : MATERIAL_LIBRARY), [q]);
    const applyMaterial = (m) => {
        const sel = studio.store.getState().selection;
        if (sel.length === 0) {
            studio.store.getState().toast('Select objects first, or drag the material onto one.', 'info', 3);
            return;
        }
        studio.editor.applyMaterial(sel, { ...m.spec, color: m.spec.color ?? null, roughness: m.spec.roughness ?? null, metalness: m.spec.metalness ?? null }, `Apply ${m.name}`);
    };
    if (mats.length === 0)
        return _jsxs("p", { className: "panel-empty", children: ["No materials match \u201C", q, "\u201D."] });
    return (_jsxs("section", { className: "assets__section", "aria-labelledby": "assets-materials", children: [_jsxs("header", { className: "assets__head", children: [_jsx("h3", { id: "assets-materials", className: "assets__title", children: "Materials" }), _jsx("span", { className: "assets__hint", children: "Drag onto an object" })] }), _jsx("div", { className: "mat-grid", children: mats.map((m) => (_jsx(MaterialSwatch, { m: m, disabled: playing, onApply: applyMaterial }, m.id))) })] }));
});
