import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Entity tree: search, selection synced with the viewport (selected rows
 * scroll into view, ancestors expand), focus, visibility, lock, delete, and
 * drag-and-drop re-parenting (drop on a row to nest, on the top band to
 * un-nest; world poses are kept). Virtualized above 300 rows.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OUTLINER_ROW_HEIGHT, OUTLINER_VIRTUALIZE_THRESHOLD } from '../../config';
import { useStudio, useUI, useWorld } from '../../app/context';
import { buildOutlinerRows, visibleRange } from '../../lib/outliner';
import { Icon } from '../Icon';
const KIND_ICON = {
    light: 'lightbulb',
    scatter: 'grid',
    procedural: 'box3d',
    primitive: 'cube',
    model: 'cube',
    mesh: 'mesh',
    group: 'folder',
    template: 'copy',
};
/** Drag-and-drop MIME type of outliner rows (payload: JSON list of ids). */
export const OUTLINER_DRAG_TYPE = 'application/x-aether-entities';
const Row = memo(function Row(p) {
    const { row, selected, collapsed, disabled } = p;
    return (_jsxs("div", { className: `outliner-row${selected ? ' is-selected' : ''}${row.visible ? '' : ' is-hidden'}${row.locked ? ' is-locked' : ''}${p.dropTarget ? ' is-drop' : ''}`, style: { paddingLeft: 8 + row.depth * 16 }, role: "treeitem", "aria-selected": selected, "aria-level": row.depth + 1, "aria-expanded": row.childCount > 0 ? !collapsed : undefined, tabIndex: selected ? 0 : -1, "data-id": row.id, draggable: !disabled, onDragStart: (e) => p.onDragStart(row.id, e), onDragOver: (e) => p.onDragOver(row.id, e), onDrop: (e) => p.onDrop(row.id, e), onClick: (e) => p.onSelect(row.id, e.shiftKey || e.metaKey || e.ctrlKey), onDoubleClick: () => p.onFocus(row.id), onKeyDown: (e) => {
            if (e.key === 'Enter')
                p.onFocus(row.id);
        }, children: [row.childCount > 0 ? (_jsx("button", { type: "button", className: "outliner-row__caret", "aria-label": collapsed ? 'Expand' : 'Collapse', onClick: (e) => {
                    e.stopPropagation();
                    p.onToggleCollapse(row.id);
                }, children: _jsx(Icon, { name: collapsed ? 'chevronRight' : 'chevronDown' }) })) : (_jsx("span", { className: "outliner-row__caret", "aria-hidden": "true" })), _jsx(Icon, { name: KIND_ICON[row.kind], className: "outliner-row__icon" }), _jsx("span", { className: "outliner-row__name", title: row.id, children: row.name }), row.tags.slice(0, 1).map((t) => (_jsxs("span", { className: "outliner-row__tag", title: `#${t}`, children: ["#", t] }, t))), row.hasBehaviors && _jsx(Icon, { name: "zap", className: "outliner-row__flag", label: "Has behaviours" }), row.locked && _jsx(Icon, { name: "lock", className: "outliner-row__flag outliner-row__lock", label: "Locked" }), _jsxs("span", { className: "outliner-row__actions", children: [_jsx("button", { type: "button", className: "icon-btn icon-btn--xs", title: "Focus camera", "aria-label": `Focus ${row.name}`, onClick: (e) => {
                            e.stopPropagation();
                            p.onFocus(row.id);
                        }, children: _jsx(Icon, { name: "target" }) }), _jsx("button", { type: "button", className: "icon-btn icon-btn--xs", disabled: disabled, title: row.locked ? 'Unlock' : 'Lock', "aria-label": row.locked ? `Unlock ${row.name}` : `Lock ${row.name}`, onClick: (e) => {
                            e.stopPropagation();
                            p.onToggleLock(row.id, !row.locked);
                        }, children: _jsx(Icon, { name: row.locked ? 'lock' : 'unlock' }) }), _jsx("button", { type: "button", className: "icon-btn icon-btn--xs", disabled: disabled, title: row.visible ? 'Hide' : 'Show', "aria-label": row.visible ? `Hide ${row.name}` : `Show ${row.name}`, onClick: (e) => {
                            e.stopPropagation();
                            p.onToggleVisible(row.id, !row.visible);
                        }, children: _jsx(Icon, { name: row.visible ? 'eye' : 'eyeOff' }) }), _jsx("button", { type: "button", className: "icon-btn icon-btn--xs", disabled: disabled || row.locked, title: "Delete", "aria-label": `Delete ${row.name}`, onClick: (e) => {
                            e.stopPropagation();
                            p.onDelete(row.id);
                        }, children: _jsx(Icon, { name: "trash" }) })] })] }));
});
/** Parse an outliner drag payload (ids), defensively. */
export function parseDragIds(text) {
    if (typeof text !== 'string' || text.length === 0 || text.length > 200_000)
        return [];
    try {
        const v = JSON.parse(text);
        return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(x)).slice(0, 2000) : [];
    }
    catch {
        return [];
    }
}
/** Entity tree with search, focus, visibility, lock, delete and drag-to-reparent; virtualized above 300 rows. */
export const Outliner = memo(function Outliner() {
    const studio = useStudio();
    const world = useWorld();
    const selection = useUI((s) => s.selection);
    const filter = useUI((s) => s.outlinerFilter);
    const playing = useUI((s) => s.mode === 'play');
    const [collapsed, setCollapsed] = useState(() => new Set());
    const [scroll, setScroll] = useState({ top: 0, height: 600 });
    const [dropOn, setDropOn] = useState(null);
    const [rootDrop, setRootDrop] = useState(false);
    const listRef = useRef(null);
    const anchor = useRef(null);
    const rows = useMemo(() => buildOutlinerRows(world, filter, collapsed), [world, filter, collapsed]);
    const selected = useMemo(() => new Set(selection), [selection]);
    const virtual = rows.length > OUTLINER_VIRTUALIZE_THRESHOLD;
    const range = virtual ? visibleRange(rows.length, OUTLINER_ROW_HEIGHT, scroll.top, scroll.height) : { start: 0, end: rows.length };
    // Viewport → outliner: expand the ancestors of a newly selected entity and scroll it into view.
    useEffect(() => {
        const id = selection[selection.length - 1];
        if (!id || filter)
            return;
        const ancestors = [];
        for (let p = world.entities[id]?.parent ?? null, guard = 0; p !== null && guard < 64; guard++, p = world.entities[p]?.parent ?? null)
            ancestors.push(p);
        if (ancestors.some((a) => collapsed.has(a))) {
            setCollapsed((prev) => {
                const next = new Set(prev);
                for (const a of ancestors)
                    next.delete(a);
                return next;
            });
            return;
        }
        const list = listRef.current;
        if (!list)
            return;
        const index = rows.findIndex((r) => r.id === id);
        if (index < 0)
            return;
        const top = index * OUTLINER_ROW_HEIGHT;
        if (top < list.scrollTop || top + OUTLINER_ROW_HEIGHT > list.scrollTop + list.clientHeight) {
            list.scrollTop = Math.max(0, top - list.clientHeight / 2);
        }
        // Only react to selection changes, not to every world edit.
    }, [selection]);
    const onSelect = useCallback((id, additive) => {
        anchor.current = id;
        studio.pick(id, additive);
    }, [studio]);
    const onFocus = useCallback((id) => studio.focus(id), [studio]);
    const onToggleCollapse = useCallback((id) => {
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(id))
                next.delete(id);
            else
                next.add(id);
            return next;
        });
    }, []);
    const onToggleVisible = useCallback((id, visible) => studio.editor.setHidden([id], !visible), [studio]);
    const onToggleLock = useCallback((id, locked) => studio.editor.setLocked([id], locked), [studio]);
    const onDelete = useCallback((id) => studio.deleteEntities([id]), [studio]);
    const onDragStart = useCallback((id, e) => {
        const sel = studio.store.getState().selection;
        const ids = sel.includes(id) ? sel : [id];
        e.dataTransfer.setData(OUTLINER_DRAG_TYPE, JSON.stringify(ids));
        e.dataTransfer.effectAllowed = 'move';
    }, [studio]);
    const onDragOver = useCallback((id, e) => {
        if (![...e.dataTransfer.types].includes(OUTLINER_DRAG_TYPE))
            return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setDropOn(id);
        setRootDrop(false);
    }, []);
    const onDrop = useCallback((id, e) => {
        setDropOn(null);
        const ids = parseDragIds(e.dataTransfer.getData(OUTLINER_DRAG_TYPE)).filter((x) => x !== id);
        if (ids.length === 0)
            return;
        e.preventDefault();
        e.stopPropagation();
        studio.editor.reparent(ids, id);
    }, [studio]);
    const total = Object.keys(world.entities).length;
    return (_jsxs("div", { className: "outliner", children: [_jsxs("div", { className: "panel-toolbar", children: [_jsxs("label", { className: "search-field search-field--sm", children: [_jsx(Icon, { name: "search" }), _jsx("input", { type: "search", value: filter, placeholder: "Search objects or #tag", "aria-label": "Search objects", onChange: (e) => studio.store.getState().setOutlinerFilter(e.target.value) })] }), _jsx("span", { className: "panel-toolbar__count", children: filter ? `${rows.length} / ${total}` : total })] }), rows.length === 0 ? (_jsx("p", { className: "panel-empty", children: total === 0 ? 'The world is empty. Describe something to the agent or add an asset.' : 'No matching objects.' })) : (_jsxs("div", { className: `outliner__list scroll-y${rootDrop ? ' is-root-drop' : ''}`, ref: listRef, role: "tree", "aria-label": "Entities", "aria-multiselectable": "true", onScroll: virtual ? (e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight }) : undefined, onDragOver: (e) => {
                    if (![...e.dataTransfer.types].includes(OUTLINER_DRAG_TYPE))
                        return;
                    e.preventDefault();
                    setDropOn(null);
                    setRootDrop(true);
                }, onDragLeave: (e) => {
                    if (e.currentTarget === e.target)
                        setRootDrop(false);
                }, onDrop: (e) => {
                    setRootDrop(false);
                    setDropOn(null);
                    const ids = parseDragIds(e.dataTransfer.getData(OUTLINER_DRAG_TYPE));
                    if (ids.length === 0)
                        return;
                    e.preventDefault();
                    studio.editor.reparent(ids, null);
                }, onDragEnd: () => {
                    setDropOn(null);
                    setRootDrop(false);
                }, children: [_jsx("div", { style: virtual ? { height: rows.length * OUTLINER_ROW_HEIGHT, position: 'relative' } : undefined, children: _jsx("div", { style: virtual ? { transform: `translateY(${range.start * OUTLINER_ROW_HEIGHT}px)` } : undefined, children: rows.slice(range.start, range.end).map((row) => (_jsx(Row, { row: row, selected: selected.has(row.id), collapsed: collapsed.has(row.id), disabled: playing, dropTarget: dropOn === row.id, onSelect: onSelect, onFocus: onFocus, onToggleCollapse: onToggleCollapse, onToggleVisible: onToggleVisible, onToggleLock: onToggleLock, onDelete: onDelete, onDragStart: onDragStart, onDragOver: onDragOver, onDrop: onDrop }, row.id))) }) }), _jsx("p", { className: "outliner__hint", children: "Drag onto an object to nest it; drop here to move it to the top level." })] }))] }));
});
