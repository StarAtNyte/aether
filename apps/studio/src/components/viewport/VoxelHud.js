import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Voxel game HUD: crosshair, hotbar with textured block icons, hearts,
 * hunger and breath, the day clock, the inventory + crafting screen, the
 * death screen and the loading state. Purely presentational: it renders
 * the session's {@link VoxelHudState} snapshot and calls back into the
 * running {@link VoxelPlay} for actions. Never renders untrusted HTML.
 */
import { memo, useCallback, useMemo, useState } from 'react';
import { useSimulation, useStudio, useUI } from '../../app/context';
import '../../styles/voxel.css';
const TILES = 16;
/** Block (isometric cube from the atlas) or item (pixel icon) picture. */
const Icon = memo(function Icon({ icon, hud, size = 30 }) {
    if (icon.kind === 'item') {
        const n = Math.max(1, hud.itemCount);
        const style = {
            width: size,
            height: size,
            backgroundImage: hud.itemsUrl ? `url(${hud.itemsUrl})` : undefined,
            backgroundSize: `${n * 100}% 100%`,
            backgroundPosition: `${n > 1 ? (icon.index / (n - 1)) * 100 : 0}% 0%`,
        };
        return _jsx("span", { className: "vx-icon vx-icon--item", style: style, "aria-hidden": "true" });
    }
    const tile = (t) => ({
        backgroundImage: hud.atlasUrl ? `url(${hud.atlasUrl})` : undefined,
        backgroundSize: `${TILES * 100}% ${TILES * 100}%`,
        backgroundPosition: `${((t % TILES) / (TILES - 1)) * 100}% ${(Math.floor(t / TILES) / (TILES - 1)) * 100}%`,
    });
    if (icon.flat)
        return _jsx("span", { className: "vx-icon vx-icon--item", style: { width: size, height: size, ...tile(icon.top) }, "aria-hidden": "true" });
    const f = Math.round(size * 0.62);
    return (_jsx("span", { className: "vx-cube", style: { width: size, height: size, ['--f']: `${f}px` }, "aria-hidden": "true", children: _jsxs("span", { className: "vx-cube__body", children: [_jsx("span", { className: "vx-cube__face vx-cube__face--top", style: tile(icon.top) }), _jsx("span", { className: "vx-cube__face vx-cube__face--front", style: tile(icon.side) }), _jsx("span", { className: "vx-cube__face vx-cube__face--right", style: tile(icon.side) })] }) }));
});
/** One slot (hotbar or inventory). */
function Slot({ slot, hud, selected, onClick, onContext, index, picked }) {
    const label = slot ? `${slot.label}${slot.count > 1 ? ` × ${slot.count}` : ''}` : 'Empty slot';
    const cls = `vx-slot${selected ? ' is-selected' : ''}${picked ? ' is-picked' : ''}`;
    const body = (_jsxs(_Fragment, { children: [slot && _jsx(Icon, { icon: slot.icon, hud: hud }), slot && slot.count > 1 && _jsx("span", { className: "vx-slot__count", children: slot.count })] }));
    if (!onClick) {
        return (_jsx("span", { className: cls, title: label, children: body }));
    }
    return (_jsx("button", { type: "button", className: cls, "aria-label": label, title: label, onClick: () => onClick(index), onContextMenu: (e) => {
            e.preventDefault();
            onContext?.(index);
        }, children: body }));
}
/** Ten pixel hearts / drumsticks. */
function Meter({ value, kind }) {
    const items = [];
    const v = Math.max(0, Math.min(20, value));
    const count = kind === 'air' ? 10 : 10;
    for (let i = 0; i < count; i++) {
        const fill = kind === 'air' ? (i < v ? 2 : 0) : Math.max(0, Math.min(2, v - i * 2));
        items.push(_jsx("span", { className: `vx-pip vx-pip--${kind} is-${fill === 2 ? 'full' : fill === 1 ? 'half' : 'empty'}` }, i));
    }
    const label = kind === 'heart' ? `Health ${v / 2} of 10` : kind === 'food' ? `Hunger ${v / 2} of 10` : `Breath ${v} of 10`;
    return (_jsx("span", { className: `vx-meter vx-meter--${kind}${kind === 'heart' && v <= 6 ? ' is-low' : ''}`, role: "img", "aria-label": label, children: items }));
}
function clock(hour) {
    const h = Math.floor(hour) % 24;
    const m = Math.floor((hour - Math.floor(hour)) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function RecipeCard({ r, hud, onCraft }) {
    return (_jsxs("li", { className: `vx-recipe${r.craftable ? ' is-ready' : ''}`, children: [_jsxs("span", { className: "vx-recipe__out", children: [_jsx(Icon, { icon: r.icon, hud: hud, size: 34 }), r.count > 1 && _jsx("span", { className: "vx-slot__count", children: r.count })] }), _jsxs("span", { className: "vx-recipe__body", children: [_jsxs("span", { className: "vx-recipe__name", children: [r.label, r.needsTable && _jsx("span", { className: "vx-badge", title: "Needs a crafting table nearby", children: "Table" })] }), _jsx("span", { className: "vx-recipe__inputs", children: r.inputs.map((i) => (_jsxs("span", { className: `vx-input${i.have >= i.count ? ' is-ok' : ''}`, title: `${i.label}: ${Math.min(i.have, 999)} / ${i.count}`, children: [_jsx(Icon, { icon: i.icon, hud: hud, size: 18 }), _jsxs("span", { children: [i.count, " ", i.label] })] }, i.label))) })] }), _jsx("button", { type: "button", className: "btn btn--sm btn--primary vx-recipe__craft", disabled: !r.craftable, onClick: () => onCraft(r.id), "aria-label": `Craft ${r.label}`, children: "Craft" })] }));
}
/** Largest save file accepted for import. */
const MAX_SAVE_FILE = 64 * 1024 * 1024;
/** Export / import / reset of the world save (footer of the inventory screen). */
function SaveActions({ play, toast }) {
    const [confirmReset, setConfirmReset] = useState(false);
    const onExport = async () => {
        const bytes = await play?.exportSave();
        if (!bytes)
            return;
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'world.aethersave';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const onImport = async (file) => {
        if (!file || !play)
            return;
        if (file.size > MAX_SAVE_FILE) {
            toast('That save file is too large.', 'error', 4);
            return;
        }
        try {
            await play.importSave(new Uint8Array(await file.arrayBuffer()));
            toast('World loaded from the save file.', 'success', 3);
        }
        catch (err) {
            toast(`Could not load that save: ${err instanceof Error ? err.message : 'invalid file'}`, 'error', 5);
        }
    };
    return (_jsxs("div", { className: "vx-save", children: [_jsx("button", { type: "button", className: "btn btn--sm", onClick: () => void onExport(), children: "Export world" }), _jsxs("label", { className: "btn btn--sm vx-save__import", children: ["Import\u2026", _jsx("input", { type: "file", accept: ".aethersave,application/octet-stream", onChange: (e) => void onImport(e.target.files?.[0]) })] }), _jsx("button", { type: "button", className: `btn btn--sm${confirmReset ? ' btn--danger' : ''}`, onClick: () => {
                    if (!confirmReset) {
                        setConfirmReset(true);
                        return;
                    }
                    setConfirmReset(false);
                    void play?.resetWorld();
                }, onBlur: () => setConfirmReset(false), children: confirmReset ? 'Click again to reset' : 'Reset world' })] }));
}
/** The inventory + crafting screen. */
function InventoryScreen({ hud, play, toast }) {
    const [picked, setPicked] = useState(null);
    const [filter, setFilter] = useState('');
    const onSlot = useCallback((i) => {
        if (!play)
            return;
        if (picked === null) {
            if (hud.slots[i])
                setPicked(i);
            return;
        }
        play.moveSlot(picked, i, false);
        setPicked(null);
    }, [play, picked, hud.slots]);
    const onHalf = useCallback((i) => {
        if (!play)
            return;
        if (picked === null)
            return;
        play.moveSlot(picked, i, true);
        setPicked(null);
    }, [play, picked]);
    const recipes = useMemo(() => {
        const q = filter.trim().toLowerCase();
        return q ? hud.recipes.filter((r) => r.label.toLowerCase().includes(q)) : hud.recipes;
    }, [hud.recipes, filter]);
    return (_jsx("div", { className: "vx-screen", role: "dialog", "aria-modal": "true", "aria-label": "Inventory and crafting", children: _jsxs("div", { className: "vx-screen__panel", children: [_jsxs("section", { className: "vx-screen__inv", "aria-label": "Inventory", children: [_jsxs("header", { className: "vx-screen__head", children: [_jsx("h2", { children: "Inventory" }), _jsx("span", { className: "vx-screen__hint", children: hud.touch ? 'Tap an item, then a slot to move it' : 'Click an item, then a slot to move it · right-click splits a stack' })] }), _jsx("div", { className: "vx-grid", children: hud.slots.slice(9).map((s, k) => (_jsx(Slot, { index: k + 9, slot: s, hud: hud, picked: picked === k + 9, onClick: onSlot, onContext: onHalf }, k + 9))) }), _jsx("div", { className: "vx-grid vx-grid--hotbar", children: hud.slots.slice(0, 9).map((s, k) => (_jsx(Slot, { index: k, slot: s, hud: hud, picked: picked === k, selected: hud.selected === k, onClick: onSlot, onContext: onHalf }, k))) })] }), _jsxs("section", { className: "vx-screen__craft", "aria-label": "Crafting", children: [_jsxs("header", { className: "vx-screen__head", children: [_jsx("h2", { children: "Crafting" }), _jsx("span", { className: `vx-table${hud.nearTable ? ' is-near' : ''}`, children: hud.nearTable ? 'Crafting table nearby' : 'No crafting table nearby' })] }), _jsx("input", { className: "input vx-search", type: "search", placeholder: "Search recipes", value: filter, onChange: (e) => setFilter(e.target.value), "aria-label": "Search recipes" }), _jsx("ul", { className: "vx-recipes", children: recipes.map((r) => (_jsx(RecipeCard, { r: r, hud: hud, onCraft: (id) => play?.craft(id) }, r.id))) })] }), _jsx(SaveActions, { play: play, toast: toast }), _jsxs("button", { type: "button", className: "btn vx-screen__close", onClick: () => play?.setInventoryOpen(false), children: ["Close ", !hud.touch && _jsx("kbd", { children: "E" })] })] }) }));
}
/** The HUD in the studio (state from the studio store). */
export const VoxelHud = memo(function VoxelHud() {
    const studio = useStudio();
    const hud = useUI((s) => s.voxelHud);
    const mode = useUI((s) => s.mode);
    const sim = useSimulation();
    if (!hud || mode !== 'play')
        return null;
    return _jsx(VoxelHudView, { hud: hud, play: sim?.voxel?.game ?? null, toast: studio.store.getState().toast });
});
/** The HUD itself, from props (the studio and published games share it). */
export const VoxelHudView = memo(function VoxelHudView({ hud, play, toast }) {
    const survival = hud.mode === 'survival';
    const night = hud.hour < 5 || hud.hour >= 19.5;
    return (_jsxs("div", { className: `vx-hud${hud.inventoryOpen ? ' is-ui' : ''}`, "data-testid": "voxel-hud", children: [hud.loading !== null && (_jsxs("div", { className: "vx-loading", role: "status", children: [_jsx("span", { className: "vx-loading__bar", style: { ['--p']: `${Math.round(hud.loading * 100)}%` } }), _jsx("span", { children: hud.loading >= 1 ? 'Placing you in the world…' : `Generating terrain… ${Math.round(hud.loading * 100)}%` })] })), hud.loading === null && !hud.dead && !hud.inventoryOpen && _jsx("span", { className: "vx-crosshair", "aria-hidden": "true" }), _jsxs("div", { className: "vx-top", children: [_jsxs("span", { className: `vx-pill vx-clock${night ? ' is-night' : ''}`, title: `Day ${hud.day + 1}`, children: [_jsx("span", { className: "vx-clock__orb", "aria-hidden": "true" }), "Day ", hud.day + 1, " \u00B7 ", clock(hud.hour)] }), hud.mode !== 'survival' && _jsx("span", { className: "vx-pill vx-mode", children: hud.mode === 'creative' ? (hud.flying ? 'Creative · flying' : 'Creative') : 'Explore' }), _jsxs("span", { className: "vx-pill vx-coords", title: "Position", children: [hud.position[0], ", ", hud.position[1], ", ", hud.position[2]] })] }), hud.target && !hud.inventoryOpen && _jsx("span", { className: "vx-target", children: hud.target }), hud.toast && _jsx("span", { className: "vx-toast", children: hud.toast }, hud.toast), hud.mode !== 'explore' && (_jsxs("div", { className: "vx-bottom", children: [survival && (_jsxs("div", { className: "vx-stats", children: [_jsx(Meter, { value: hud.health, kind: "heart" }), _jsxs("span", { className: "vx-stats__right", children: [hud.air < 10 && _jsx(Meter, { value: hud.air, kind: "air" }), _jsx(Meter, { value: hud.hunger, kind: "food" })] })] })), _jsxs("div", { className: "vx-hotbar", role: "toolbar", "aria-label": "Hotbar", children: [hud.slots.slice(0, 9).map((s, i) => (_jsx(Slot, { index: i, slot: s, hud: hud, selected: hud.selected === i, onClick: (k) => play?.select(k) }, i))), hud.touch && (_jsx("button", { type: "button", className: "vx-slot vx-slot--more", "aria-label": "Open inventory", onClick: () => play?.setInventoryOpen(true), children: _jsx("span", { "aria-hidden": "true", children: "\u2022\u2022\u2022" }) }))] })] })), hud.capture && !hud.inventoryOpen && !hud.dead && hud.loading === null && (_jsx("button", { type: "button", className: "vx-capture", onClick: () => play?.lockPointer(), children: hud.touch ? (_jsxs(_Fragment, { children: [_jsx("b", { children: "Tap to play" }), _jsx("span", { children: "Stick to move \u00B7 drag to look \u00B7 tap to place \u00B7 touch and hold to break \u00B7 \u2022\u2022\u2022 inventory" })] })) : (_jsxs(_Fragment, { children: [_jsx("b", { children: "Click to play" }), _jsxs("span", { children: [_jsx("kbd", { children: "WASD" }), " move \u00B7 ", _jsx("kbd", { children: "Space" }), " jump \u00B7 ", _jsx("kbd", { children: "Left" }), " break \u00B7 ", _jsx("kbd", { children: "Right" }), " place \u00B7 ", _jsx("kbd", { children: "E" }), " inventory \u00B7 ", _jsx("kbd", { children: "1\u20139" }), " hotbar \u00B7 ", _jsx("kbd", { children: "V" }), " view \u00B7 ", _jsx("kbd", { children: "Esc" }), " exit"] })] })) })), hud.inventoryOpen && _jsx(InventoryScreen, { hud: hud, play: play, toast: toast }), hud.dead && (_jsxs("div", { className: "vx-death", role: "dialog", "aria-modal": "true", "aria-label": "You died", children: [_jsx("h2", { children: "You died" }), _jsx("p", { children: deathText(hud.deathCause) }), _jsx("button", { type: "button", className: "btn btn--primary", autoFocus: true, onClick: () => play?.respawn(), children: "Respawn" })] }))] }));
});
function deathText(cause) {
    switch (cause) {
        case 'fall':
            return 'You hit the ground too hard.';
        case 'lava':
            return 'You tried to swim in lava.';
        case 'drown':
            return 'You ran out of air.';
        case 'starve':
            return 'You starved.';
        case 'mob':
            return 'Something got you in the dark.';
        case 'void':
            return 'You fell out of the world.';
        default:
            return 'Your items are where you fell.';
    }
}
