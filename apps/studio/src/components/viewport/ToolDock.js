import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Floating tool dock (bottom-centre of the viewport, edit mode): selection
 * and box selection, move / rotate / scale, the sculpt / paint / scatter
 * brushes, snapping (with a settings popover), add, focus, delete, frame
 * and labels. Every control has a tooltip with its shortcut.
 */
import { memo } from 'react';
import { useStudio, useUI } from '../../app/context';
import { Icon } from '../Icon';
import { Popover } from '../ui/Popover';
import { Segmented } from '../ui/Segmented';
import { NumberField, Toggle } from '../fields';
import { shortcut } from '../../lib/keys';
/** Tools shown in the dock: id, label, icon, shortcut, tooltip. */
export const DOCK_TOOLS = [
    { id: 'select', label: 'Select', icon: 'pointer', key: 'V', tip: 'Select' },
    { id: 'box', label: 'Box select', icon: 'marquee', key: 'B', tip: 'Box select (drag a rectangle)' },
    { id: 'move', label: 'Move', icon: 'move', key: 'W', tip: 'Move the selection' },
    { id: 'rotate', label: 'Rotate', icon: 'rotate', key: 'E', tip: 'Rotate the selection' },
    { id: 'scale', label: 'Scale', icon: 'scale', key: 'R', tip: 'Scale the selection' },
];
/** Brush tools. */
export const BRUSH_TOOLS = [
    { id: 'sculpt', label: 'Sculpt', icon: 'sculpt', key: 'S', tip: 'Sculpt terrain and meshes' },
    { id: 'paint', label: 'Paint', icon: 'brush', key: 'P', tip: 'Paint vertex colors' },
    { id: 'scatter', label: 'Scatter', icon: 'sprout', key: 'T', tip: 'Paint trees, grass and rocks' },
];
/** Snapping toggle + settings (grid, angle, scale step, surface / vertex snap, space and pivot). */
const SnapControl = memo(function SnapControl() {
    const studio = useStudio();
    const g = useUI((s) => s.gizmo);
    const set = studio.store.getState().setGizmoSettings;
    const active = g.snap || g.surface || g.vertex;
    return (_jsxs("div", { className: "dock__group", role: "group", "aria-label": "Snapping", children: [_jsx("button", { type: "button", className: `dock__btn${active ? ' is-active' : ''}`, "aria-pressed": g.snap, "aria-label": "Snap to grid", "data-tip": g.snap ? 'Snapping on (hold Ctrl to bypass)' : 'Snapping off (hold Ctrl to snap)', "data-kbd": shortcut('Shift+S'), "data-tip-pos": "top", onClick: () => set({ snap: !g.snap }), children: _jsx(Icon, { name: "magnet" }) }), _jsx(Popover, { label: "Transform options", trigger: (t) => (_jsx("button", { ...t, type: "button", className: "dock__btn dock__btn--narrow", "aria-label": "Transform options", "data-tip": "Snapping, space and pivot", "data-tip-pos": "top", children: _jsx(Icon, { name: "chevronUp", size: 14 }) })), children: _jsxs("div", { className: "popover__body", children: [_jsx("h3", { className: "popover__title", children: "Snapping" }), _jsx(Toggle, { label: "Grid, angle and scale", checked: g.snap, onChange: (v) => set({ snap: v }) }), _jsxs("div", { className: "popover__grid", children: [_jsxs("label", { className: "popover__field", children: [_jsx("span", { children: "Grid (m)" }), _jsx(NumberField, { label: "Grid size", value: g.grid, min: 0.01, max: 100, step: 0.25, onCommit: (n) => set({ grid: n }) })] }), _jsxs("label", { className: "popover__field", children: [_jsx("span", { children: "Angle (\u00B0)" }), _jsx(NumberField, { label: "Angle step", value: g.angle, min: 1, max: 90, step: 5, onCommit: (n) => set({ angle: n }) })] }), _jsxs("label", { className: "popover__field", children: [_jsx("span", { children: "Scale" }), _jsx(NumberField, { label: "Scale step", value: g.scaleStep, min: 0.01, max: 10, step: 0.05, onCommit: (n) => set({ scaleStep: n }) })] })] }), _jsx(Toggle, { label: "Snap to surfaces", hint: "Moved objects rest on what is under the pointer", checked: g.surface, onChange: (v) => set({ surface: v, vertex: v ? false : g.vertex }) }), _jsx(Toggle, { label: "Snap to vertices", hint: "The pivot jumps to the nearest vertex", checked: g.vertex, onChange: (v) => set({ vertex: v, surface: v ? false : g.surface }) }), _jsx("h3", { className: "popover__title", children: "Gizmo" }), _jsxs("div", { className: "popover__row", children: [_jsx("span", { children: "Space" }), _jsx(Segmented, { label: "Gizmo space", size: "sm", value: g.space, onChange: (v) => set({ space: v }), options: [['world', 'World'], ['local', 'Local']] })] }), _jsxs("div", { className: "popover__row", children: [_jsx("span", { children: "Pivot" }), _jsx(Segmented, { label: "Pivot", size: "sm", value: g.pivot, onChange: (v) => set({ pivot: v }), options: [['center', 'Centre'], ['origin', 'Active'], ['individual', 'Each']], titles: { center: 'Selection centre', origin: 'Active object origin', individual: 'Each object about its own origin' } })] })] }) })] }));
});
/** The dock. */
export const ToolDock = memo(function ToolDock() {
    const studio = useStudio();
    const selection = useUI((s) => s.selection);
    const tool = useUI((s) => s.tool);
    const labels = useUI((s) => s.settings.showLabels);
    const meshEdit = useUI((s) => s.meshEdit !== null);
    const st = studio.store.getState();
    const has = selection.length > 0;
    const toolButton = (t) => (_jsx("button", { type: "button", role: "radio", "aria-checked": tool === t.id, className: `dock__btn${tool === t.id ? ' is-active' : ''}`, onClick: () => st.setTool(t.id), "aria-label": t.label, "data-tip": t.tip, "data-kbd": t.key, "data-tip-pos": "top", "data-testid": `tool-${t.id}`, children: _jsx(Icon, { name: t.icon }) }, t.id));
    return (_jsxs("div", { className: "dock", role: "toolbar", "aria-label": "Tools", children: [_jsx("div", { className: "dock__group", role: "radiogroup", "aria-label": "Tool", children: DOCK_TOOLS.map(toolButton) }), _jsx("span", { className: "dock__sep", "aria-hidden": "true" }), _jsx("div", { className: "dock__group", role: "radiogroup", "aria-label": "Brushes", children: BRUSH_TOOLS.map(toolButton) }), _jsx("span", { className: "dock__sep", "aria-hidden": "true" }), _jsx(SnapControl, {}), _jsx("span", { className: "dock__sep", "aria-hidden": "true" }), _jsx("button", { type: "button", className: `dock__btn${meshEdit ? ' is-active' : ''}`, disabled: !has && !meshEdit, "aria-pressed": meshEdit, onClick: () => void studio.editor.toggleMeshEdit(), "aria-label": "Edit mesh", "data-tip": meshEdit ? 'Finish mesh editing' : 'Edit mesh (vertices, edges, faces)', "data-kbd": "Tab", "data-tip-pos": "top", "data-testid": "edit-mesh", children: _jsx(Icon, { name: "mesh" }) }), _jsx("button", { type: "button", className: "dock__btn dock__opt", onClick: () => st.showLeftView('assets'), "aria-label": "Add object", "data-tip": "Add object", "data-kbd": "A", "data-tip-pos": "top", children: _jsx(Icon, { name: "plus" }) }), _jsx("button", { type: "button", className: "dock__btn dock__opt", disabled: !has, onClick: () => selection[0] && studio.focus(selection[0]), "aria-label": "Focus selection", "data-tip": "Focus selection", "data-kbd": "F", "data-tip-pos": "top", children: _jsx(Icon, { name: "focus" }) }), _jsx("button", { type: "button", className: "dock__btn dock__opt", disabled: !has, onClick: () => studio.editor.deleteSelection(), "aria-label": "Delete selection", "data-tip": "Delete", "data-kbd": "Del", "data-tip-pos": "top", children: _jsx(Icon, { name: "trash" }) }), _jsx("span", { className: "dock__sep dock__opt", "aria-hidden": "true" }), _jsx("button", { type: "button", className: "dock__btn dock__opt", onClick: () => studio.viewPreset('reset'), "aria-label": "Frame world", "data-tip": "Frame world", "data-kbd": "0", "data-tip-pos": "top", children: _jsx(Icon, { name: "maximize" }) }), _jsx("button", { type: "button", className: `dock__btn dock__opt${labels ? ' is-active' : ''}`, "aria-pressed": labels, onClick: () => st.updateSettings({ showLabels: !labels }), "aria-label": "Object labels", "data-tip": "Object labels", "data-kbd": "L", "data-tip-pos": "top", children: _jsx(Icon, { name: "tag" }) })] }));
});
