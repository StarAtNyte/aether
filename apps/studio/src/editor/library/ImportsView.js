import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The user's imported files (models, images, HDR skies): place, remove, or
 * import more. Everything is validated on import (see @aether/assets
 * `importUserAsset`) and kept in this browser's IndexedDB.
 */
import { memo, useEffect, useRef } from 'react';
import { userAsset } from '@aether/assets';
import { useStudio, useUI } from '../../app/context';
import { Icon } from '../../components/Icon';
import { formatBytes } from '../../lib/format';
import { ASSET_DRAG_TYPE, IMPORT_ACCEPT, useLibrary } from './useLibrary';
function kindLabel(m) {
    if (m.kind === 'model')
        return `${(m.triangles ?? 0).toLocaleString('en-US')} triangles${m.clips && m.clips.length > 0 ? ` · ${m.clips.length} clips` : ''}`;
    if (m.kind === 'image')
        return `Image · ${m.width ?? '?'}×${m.height ?? '?'}`;
    return `HDR sky · ${m.width ?? '?'}×${m.height ?? '?'}`;
}
const ImportRow = memo(function ImportRow({ meta, disabled }) {
    const studio = useStudio();
    const url = meta.kind === 'image' ? userAsset(meta.id)?.url : undefined;
    return (_jsxs("li", { className: "import-row", children: [_jsxs("button", { type: "button", className: "import-row__main", disabled: disabled, draggable: !disabled, onDragStart: (e) => {
                    e.dataTransfer.setData(ASSET_DRAG_TYPE, meta.id);
                    e.dataTransfer.effectAllowed = 'copy';
                }, onClick: () => void studio.assets.place(meta.id), "aria-label": `Add ${meta.name}`, children: [_jsx("span", { className: "import-row__art", children: url ? _jsx("img", { src: url, alt: "", width: 40, height: 40 }) : _jsx(Icon, { name: meta.kind === 'hdri' ? 'sun' : meta.kind === 'image' ? 'image' : 'cube', size: 18 }) }), _jsxs("span", { className: "import-row__text", children: [_jsx("span", { className: "import-row__name", children: meta.name }), _jsxs("span", { className: "import-row__meta", children: [kindLabel(meta), " \u00B7 ", formatBytes(meta.bytes)] })] })] }), _jsx("button", { type: "button", className: "icon-btn icon-btn--sm", "aria-label": `Remove ${meta.name}`, "data-tip": "Remove from this browser", onClick: () => void studio.assets.removeImport(meta.id), children: _jsx(Icon, { name: "trash", size: 14 }) })] }));
});
const CreationRow = memo(function CreationRow({ c, disabled }) {
    const studio = useStudio();
    const name = c.def.description.split(/[.;\n]/)[0]?.slice(0, 60) || c.def.id;
    return (_jsxs("li", { className: "import-row", children: [_jsxs("button", { type: "button", className: "import-row__main", disabled: disabled, onClick: () => void studio.assets.placeCreation(c.def), "aria-label": `Add ${name}`, children: [_jsx("span", { className: "import-row__art", children: c.thumb ? _jsx("img", { src: c.thumb, alt: "", width: 40, height: 40 }) : _jsx(Icon, { name: "sparkles", size: 18 }) }), _jsxs("span", { className: "import-row__text", children: [_jsx("span", { className: "import-row__name", children: name }), _jsxs("span", { className: "import-row__meta", children: ["Parametric \u00B7 ", Object.keys(c.def.params).length, " params", c.score !== null ? ` · ${Math.round(c.score * 100)}/100` : ''] })] })] }), _jsx("button", { type: "button", className: "icon-btn icon-btn--sm", "aria-label": `Refine ${name}`, "data-tip": "Refine (e.g. taller, walnut)", disabled: disabled, onClick: () => studio.forge.open(c.def), children: _jsx(Icon, { name: "wand", size: 14 }) }), _jsx("button", { type: "button", className: "icon-btn icon-btn--sm", "aria-label": `Remove ${name}`, "data-tip": "Remove from your library", onClick: () => void studio.assets.removeCreation(c.def.id), children: _jsx(Icon, { name: "trash", size: 14 }) })] }));
});
/** Imports list with the file picker. */
export const ImportsView = memo(function ImportsView({ query }) {
    const studio = useStudio();
    const imports = useLibrary((s) => s.imports);
    const persistent = useLibrary((s) => s.persistent);
    const busy = useLibrary((s) => s.busy);
    const playing = useUI((s) => s.mode === 'play');
    const input = useRef(null);
    const creations = useLibrary((s) => s.creations);
    useEffect(() => {
        void studio.assets.refreshImports();
        void studio.assets.refreshCreations();
    }, [studio]);
    const q = query.trim().toLowerCase();
    const list = q ? imports.filter((m) => m.name.toLowerCase().includes(q)) : imports;
    return (_jsxs("div", { className: "imports", children: [_jsx("input", { ref: input, type: "file", hidden: true, multiple: true, accept: IMPORT_ACCEPT, onChange: (e) => {
                    const files = [...(e.currentTarget.files ?? [])];
                    e.currentTarget.value = '';
                    if (files.length > 0)
                        void studio.assets.importFiles(files);
                } }), _jsxs("button", { type: "button", className: "drop-hint", disabled: playing || busy !== null, onClick: () => input.current?.click(), children: [_jsx(Icon, { name: "upload", size: 18 }), _jsxs("span", { children: [_jsx("strong", { children: busy ?? 'Import files' }), _jsx("span", { className: "drop-hint__sub", children: "GLB / glTF models, PNG / JPEG / WebP images (posters), .hdr skies or a world package. You can also drop files on the viewport." })] })] }), !persistent && _jsx("p", { className: "panel-note", children: "This browser blocks storage: imports last until you close the tab." }), creations.length > 0 && (_jsxs("section", { className: "assets__section", "aria-labelledby": "assets-creations", children: [_jsxs("header", { className: "assets__head", children: [_jsx("h3", { id: "assets-creations", className: "assets__title", children: "Your creations" }), _jsx("span", { className: "assets__hint", children: "Editable generators" })] }), _jsx("ul", { className: "import-list", children: creations
                            .filter((c) => !q || c.def.description.toLowerCase().includes(q) || c.def.id.includes(q))
                            .map((c) => (_jsx(CreationRow, { c: c, disabled: playing }, c.def.id))) })] })), list.length === 0 ? (_jsx("p", { className: "panel-empty", children: imports.length === 0 ? 'Nothing imported yet.' : `No imports match “${query}”.` })) : (_jsx("ul", { className: "import-list", children: list.map((m) => (_jsx(ImportRow, { meta: m, disabled: playing }, m.id))) }))] }));
});
