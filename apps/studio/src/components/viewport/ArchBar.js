import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Architecture bar (top centre of the viewport, edit mode, only when the
 * world has a building): 3D / floor-plan switch, wall display (full,
 * cutaway, low), storeys (stacked, exploded, one storey) with a level
 * selector, x-ray, a section cut, the daylight study, the studio render
 * toggle and the walkthrough. Everything here is a view of the building;
 * nothing changes the document.
 */
import { memo } from 'react';
import { useStudio, useUI } from '../../app/context';
import { Icon } from '../Icon';
import { Menu } from '../ui/Menu';
import { Popover } from '../ui/Popover';
import { Segmented } from '../ui/Segmented';
import { hourLabel, SECTION_RANGE, TIME_PRESETS } from '../../state/archUi';
const WALL_LABEL = { up: 'Walls up', cutaway: 'Cutaway', down: 'Walls down' };
const LEVEL_LABEL = { stacked: 'Stacked', exploded: 'Exploded', solo: 'One floor' };
/** Storey chip label: "Ground floor · 3.1 m". */
function levelText(name, height) {
    return `${name} · ${height.toFixed(height % 1 === 0 ? 0 : 2).replace(/0$/, '')} m`;
}
/** The architecture bar. */
export const ArchBar = memo(function ArchBar() {
    const studio = useStudio();
    const a = useUI((s) => s.arch);
    const playing = useUI((s) => s.mode === 'play');
    if (!a.building || playing)
        return null;
    const set = studio.store.getState().setArch;
    const multi = a.levels.length > 1;
    const current = a.levels.find((l) => l.index === a.level) ?? a.levels[0];
    return (_jsxs("div", { className: "arch-bar", role: "toolbar", "aria-label": "Building views", children: [_jsx(Segmented, { label: "View", size: "sm", value: a.plan ? 'plan' : '3d', onChange: (v) => set({ plan: v === 'plan' }), options: [
                    ['3d', '3D'],
                    ['plan', 'Plan'],
                ], titles: { '3d': '3D view', plan: 'Floor plan: rooms, areas, dimensions; draw rooms, doors and windows' } }), !a.plan && (_jsx(Menu, { label: "Walls", width: 200, items: ['up', 'cutaway', 'down'].map((w) => ({ id: w, label: WALL_LABEL[w], checked: a.walls === w, onSelect: () => set({ walls: w }) })), trigger: (t) => (_jsxs("button", { ...t, type: "button", className: `vp-btn vp-btn--label${a.walls !== 'up' ? ' is-on' : ''}`, "aria-label": `Walls: ${WALL_LABEL[a.walls]}`, "data-tip": "Walls: up, cutaway (doll's house) or down", children: [_jsx(Icon, { name: "walls" }), _jsx("span", { children: WALL_LABEL[a.walls] })] })) })), (multi || a.plan) && (_jsx(Menu, { label: "Storeys", width: 240, items: [
                    ...(!a.plan && multi
                        ? [
                            { kind: 'heading', id: 'h-mode', label: 'Storeys' },
                            ...['stacked', 'exploded', 'solo'].map((m) => ({ id: m, label: LEVEL_LABEL[m], checked: a.levelMode === m, onSelect: () => set({ levelMode: m }) })),
                            { kind: 'separator', id: 'sep' },
                        ]
                        : []),
                    { kind: 'heading', id: 'h-level', label: 'Floor' },
                    ...[...a.levels].reverse().map((l) => ({ id: `l${l.index}`, label: levelText(l.name, l.height), checked: a.level === l.index, onSelect: () => set({ level: l.index, ...(a.plan || a.levelMode !== 'solo' ? {} : { levelMode: 'solo' }) }) })),
                ], trigger: (t) => (_jsxs("button", { ...t, type: "button", className: `vp-btn vp-btn--label${a.levelMode !== 'stacked' && !a.plan ? ' is-on' : ''}`, "aria-label": "Storeys", "data-tip": "Storeys: stacked, exploded or one floor", children: [_jsx(Icon, { name: "layers" }), _jsx("span", { children: a.plan || a.levelMode === 'solo' ? (current?.name ?? 'Floor') : LEVEL_LABEL[a.levelMode] })] })) })), !a.plan && (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: `vp-btn${a.xray ? ' is-on' : ''}`, "aria-pressed": a.xray, "aria-label": "X-ray", "data-tip": "X-ray: see-through structure, furniture and lights stay solid", onClick: () => set({ xray: !a.xray }), children: _jsx(Icon, { name: "xray" }) }), _jsx(Popover, { label: "Section cut", side: "bottom", width: 240, trigger: (t) => (_jsx("button", { ...t, type: "button", className: `vp-btn${a.section !== null ? ' is-on' : ''}`, "aria-label": "Section cut", "data-tip": "Section: cut the building horizontally", children: _jsx(Icon, { name: "section" }) })), children: _jsxs("div", { className: "arch-pop", children: [_jsxs("label", { className: "arch-pop__row", children: [_jsx("input", { type: "checkbox", checked: a.section !== null, onChange: (e) => set({ section: e.target.checked ? 1.3 + a.level * 3 : null }) }), _jsx("span", { children: "Section cut" }), _jsx("span", { className: "arch-pop__value", children: a.section !== null ? `${a.section.toFixed(1)} m` : 'off' })] }), _jsx("input", { className: "arch-pop__range", type: "range", "aria-label": "Section height", min: SECTION_RANGE[0], max: Math.max(3, Math.min(SECTION_RANGE[1], a.levels.reduce((s, l) => s + l.height, 0) + 0.5)), step: 0.05, value: a.section ?? 1.3, onChange: (e) => set({ section: Number(e.target.value) }) })] }) })] })), !a.plan && (_jsxs("button", { type: "button", className: `vp-btn vp-btn--label${a.reveal !== null ? ' is-on' : ''}`, "aria-label": "Reveal", "data-tip": "Reveal: the plan drawn in ink, the walls rising out of it", onClick: () => (a.reveal !== null ? studio.arch.cancelReveal() : studio.arch.startReveal()), children: [_jsx(Icon, { name: "plan" }), _jsx("span", { children: "Reveal" })] })), _jsx("span", { className: "arch-bar__sep", "aria-hidden": "true" }), _jsx(Popover, { label: "Daylight study", side: "bottom", width: 260, trigger: (t) => (_jsxs("button", { ...t, type: "button", className: `vp-btn vp-btn--label${a.sunHour !== null ? ' is-on' : ''}`, "aria-label": "Daylight study", "data-tip": "Daylight study: move the sun through the day", children: [_jsx(Icon, { name: "sun" }), _jsx("span", { children: a.sunHour === null ? 'Daylight' : hourLabel(a.sunHour) })] })), children: _jsxs("div", { className: "arch-pop", children: [_jsxs("div", { className: "arch-pop__row", children: [_jsx("span", { children: "Sun" }), _jsx("span", { className: "arch-pop__value", children: a.sunHour === null ? 'as built' : hourLabel(a.sunHour) })] }), _jsx("input", { className: "arch-pop__range", type: "range", "aria-label": "Time of day", min: 5, max: 23, step: 0.1, value: a.sunHour ?? 14, onChange: (e) => set({ sunHour: Number(e.target.value) }) }), _jsxs("div", { className: "arch-pop__chips", children: [TIME_PRESETS.map((p) => (_jsx("button", { type: "button", className: `chip${a.sunHour === p.hour ? ' is-on' : ''}`, onClick: () => set({ sunHour: p.hour }), children: p.label }, p.key))), _jsx("button", { type: "button", className: "chip", onClick: () => set({ sunHour: null }), disabled: a.sunHour === null, children: "Reset" })] })] }) }), _jsxs("button", { type: "button", className: `vp-btn vp-btn--label${a.quality === 'studio' ? ' is-on' : ''}`, "aria-pressed": a.quality === 'studio', disabled: !a.studioAvailable, "aria-label": "Studio render", "data-tip": a.studioAvailable ? 'Studio render: ambient occlusion, soft shadows, temporal anti-aliasing; refines while the view rests' : 'Studio render needs post-processing (off in low memory mode)', onClick: () => set({ quality: a.quality === 'studio' ? 'realtime' : 'studio' }), children: [_jsx(Icon, { name: "sparkles" }), _jsx("span", { children: "Studio" })] }), _jsxs("button", { type: "button", className: "vp-btn vp-btn--label vp-btn--primary", "aria-label": "Walk through", "data-tip": "Walk through: WASD, E doors and lights, 1\u20134 time of day, P photo", onClick: () => void studio.togglePlay(), children: [_jsx(Icon, { name: "walk" }), _jsx("span", { children: "Walk" })] })] }));
});
