import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Command palette (Ctrl/⌘+K): fuzzy search over actions, entities,
 * projects and templates supplied by the current page. ARIA combobox +
 * listbox; arrows move, Enter runs, Esc closes.
 */
import { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fuzzyScore } from '../../lib/fuzzy';
import { Icon } from '../Icon';
const MAX_RESULTS = 60;
function rank(commands, query) {
    const q = query.trim();
    if (q === '')
        return commands.slice(0, MAX_RESULTS);
    const scored = [];
    commands.forEach((c, i) => {
        const a = fuzzyScore(q, c.title);
        const b = c.keywords ? fuzzyScore(q, c.keywords) : null;
        const s = Math.max(a ?? -Infinity, b === null ? -Infinity : b - 50);
        if (Number.isFinite(s))
            scored.push({ c, s, i });
    });
    scored.sort((x, y) => y.s - x.s || x.i - y.i);
    return scored.slice(0, MAX_RESULTS).map((x) => x.c);
}
/** Shortest query offered to the {@link CommandPalette} `fallback` (e.g. "Ask the agent: …"). */
export const MIN_FALLBACK_QUERY = 3;
/**
 * Ranked results plus the fallback command for free text. The fallback
 * comes first when the query reads like a sentence (two or more words) that
 * no command title contains — Enter then sends it — and last otherwise. Pure.
 */
export function paletteResults(commands, query, fallback) {
    const ranked = rank(commands, query);
    const q = query.trim();
    const extra = fallback && q.length >= MIN_FALLBACK_QUERY ? fallback(q) : null;
    if (!extra)
        return ranked;
    const lower = q.toLowerCase();
    const sentence = /\S\s+\S/.test(q) && !ranked.some((c) => c.title.toLowerCase().includes(lower));
    if (ranked.length === 0 || sentence)
        return [extra, ...ranked.slice(0, MAX_RESULTS - 1)];
    return [...ranked.slice(0, MAX_RESULTS - 1), extra];
}
/** Command palette overlay. */
export const CommandPalette = memo(function CommandPalette({ open, onClose, commands, placeholder = 'Type a command or search…', fallback, }) {
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const inputRef = useRef(null);
    const listRef = useRef(null);
    const restoreRef = useRef(null);
    const listId = useId();
    const results = useMemo(() => paletteResults(commands, query, fallback), [commands, query, fallback]);
    useEffect(() => {
        if (!open)
            return;
        restoreRef.current = document.activeElement;
        setQuery('');
        setActive(0);
        requestAnimationFrame(() => inputRef.current?.focus());
        return () => {
            const el = restoreRef.current;
            if (el instanceof HTMLElement && el.isConnected)
                el.focus();
        };
    }, [open]);
    useEffect(() => setActive(0), [query]);
    useEffect(() => {
        const el = listRef.current?.querySelector(`[data-index="${active}"]`);
        el?.scrollIntoView({ block: 'nearest' });
    }, [active]);
    if (!open)
        return null;
    const runAt = (i) => {
        const c = results[i];
        if (!c)
            return;
        onClose();
        c.run();
    };
    let lastGroup = '';
    return createPortal(_jsx("div", { className: "palette-scrim", onMouseDown: (e) => {
            if (e.target === e.currentTarget)
                onClose();
        }, children: _jsxs("div", { className: "palette", role: "dialog", "aria-modal": "true", "aria-label": "Command palette", children: [_jsxs("div", { className: "palette__search", children: [_jsx(Icon, { name: "search" }), _jsx("input", { ref: inputRef, className: "palette__input", value: query, maxLength: 200, placeholder: placeholder, role: "combobox", "aria-expanded": "true", "aria-controls": listId, "aria-activedescendant": results[active] ? `${listId}-${active}` : undefined, "aria-autocomplete": "list", spellCheck: false, onChange: (e) => setQuery(e.target.value), onKeyDown: (e) => {
                                if (e.key === 'ArrowDown') {
                                    e.preventDefault();
                                    setActive((a) => Math.min(results.length - 1, a + 1));
                                }
                                else if (e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    setActive((a) => Math.max(0, a - 1));
                                }
                                else if (e.key === 'Enter') {
                                    e.preventDefault();
                                    runAt(active);
                                }
                                else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onClose();
                                }
                            } }), _jsx("kbd", { className: "palette__esc", children: "Esc" })] }), _jsxs("div", { ref: listRef, id: listId, className: "palette__list", role: "listbox", "aria-label": "Results", children: [results.length === 0 && _jsxs("div", { className: "palette__empty", children: ["No results for \u201C", query.trim(), "\u201D"] }), results.map((c, i) => {
                            const header = query.trim() === '' && c.group !== lastGroup ? c.group : null;
                            lastGroup = c.group;
                            return (_jsxs("div", { role: "presentation", children: [header && _jsx("div", { className: "palette__group", children: header }), _jsxs("div", { id: `${listId}-${i}`, "data-index": i, role: "option", "aria-selected": i === active, className: `palette__item${i === active ? ' is-active' : ''}`, onMouseMove: () => setActive(i), onClick: () => runAt(i), children: [_jsx("span", { className: "palette__icon", children: c.icon && _jsx(Icon, { name: c.icon }) }), _jsx("span", { className: "palette__title", children: c.title }), query.trim() !== '' && _jsx("span", { className: "palette__meta", children: c.group }), c.hint && _jsx("span", { className: "palette__meta", children: c.hint }), c.shortcut && _jsx("kbd", { className: "palette__kbd", children: c.shortcut })] })] }, c.id));
                        })] }), _jsxs("div", { className: "palette__footer", children: [_jsxs("span", { children: [_jsx("kbd", { children: "\u2191" }), _jsx("kbd", { children: "\u2193" }), " navigate"] }), _jsxs("span", { children: [_jsx("kbd", { children: "\u21B5" }), " run"] })] })] }) }), document.body);
});
