import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Side panel shells: the left panel (view chosen on the icon rail), the
 * right inspector, the collapsed right rail (medium layout) and the resize
 * handle shared by both sides.
 */
import { lazyBoundary } from '../components/ErrorBoundary';
import { memo, useRef } from 'react';
import { useStudio, useUI } from '../app/context';
import { PANEL_WIDTH } from '../lib/layout';
import { Icon } from '../components/Icon';
import { Menu } from '../components/ui/Menu';
import { HistoryPanel } from '../components/panels/HistoryPanel';
import { LogicPanel } from '../components/panels/LogicPanel';
import { Outliner } from '../components/panels/Outliner';
import { VerifyPanel } from '../components/panels/VerifyPanel';
import { AgentPanel } from './AgentPanel';
/** The asset browser (library, imports, forge entry) loads with its first use. */
const AssetsPanel = lazyBoundary(async () => ({ default: (await import('./AssetsPanel')).AssetsPanel }), { what: 'assets panel', fallback: _jsx("p", { className: "panel-empty", children: "Loading assets\u2026" }), variant: 'inline' });
import { LEFT_VIEWS } from './IconRail';
import { InspectorPanel } from './InspectorPanel';
/** Panel header: title on the left, actions on the right. */
export function PanelHeader({ title, children, id }) {
    return (_jsxs("div", { className: "panel__header", children: [_jsx("h2", { className: "panel__title", id: id, children: title }), children && _jsx("div", { className: "panel__actions", children: children })] }));
}
const ProviderChip = memo(function ProviderChip() {
    const provider = useUI((s) => s.provider);
    if (provider.status === 'checking')
        return _jsx("span", { className: "chip chip--quiet", children: "Connecting\u2026" });
    return (_jsxs("span", { className: "chip chip--quiet", "data-tip": provider.status === 'live' ? `Model: ${provider.name}` : 'Built-in planner (runs in your browser)', children: [_jsx("span", { className: `status-dot${provider.status === 'live' ? ' is-live' : ''}`, "aria-hidden": "true" }), provider.status === 'live' ? 'Connected' : 'Offline planner'] }));
});
/** Body of a left view (also used by the phone sheet). */
export function LeftViewBody({ view }) {
    switch (view) {
        case 'agent':
            return _jsx(AgentPanel, {});
        case 'objects':
            return _jsx(Outliner, {});
        case 'assets':
            return (_jsx(AssetsPanel, {}));
        case 'logic':
            return _jsx(LogicPanel, {});
        case 'verify':
            return _jsx(VerifyPanel, {});
        case 'history':
            return _jsx(HistoryPanel, {});
    }
}
/** Header actions of a left view. */
export const LeftViewActions = memo(function LeftViewActions({ view }) {
    const studio = useStudio();
    const chatLength = useUI((s) => s.chat.length);
    const busy = useUI((s) => s.agentBusy);
    if (view !== 'agent')
        return null;
    return (_jsxs(_Fragment, { children: [_jsx(ProviderChip, {}), _jsx(Menu, { label: "Agent actions", align: "end", items: [{ id: 'clear', label: 'Clear conversation', icon: 'trash', disabled: busy || chatLength === 0, onSelect: () => studio.store.getState().clearChat() }], trigger: (t) => (_jsx("button", { ...t, type: "button", className: "icon-btn icon-btn--sm", "aria-label": "Agent actions", "data-tip": "More", children: _jsx(Icon, { name: "more" }) })) })] }));
});
/** The left panel. */
export const LeftPanel = memo(function LeftPanel() {
    const view = useUI((s) => s.leftView);
    const title = LEFT_VIEWS.find((v) => v.id === view)?.label ?? '';
    return (_jsxs("section", { className: "panel panel--left", id: "left-panel", role: "tabpanel", "aria-labelledby": `rail-${view}`, children: [_jsx(PanelHeader, { title: title, children: _jsx(LeftViewActions, { view: view }) }), _jsx("div", { className: "panel__body", children: _jsx(LeftViewBody, { view: view }) })] }));
});
/** The right panel (inspector). */
export const RightPanel = memo(function RightPanel() {
    return (_jsx("aside", { className: "panel panel--right", "aria-label": "Inspector", children: _jsx(InspectorPanel, {}) }));
});
/** Collapsed right side (medium layout): a rail button that opens the inspector. */
export const RightRail = memo(function RightRail() {
    const studio = useStudio();
    const selected = useUI((s) => s.selection.length > 0);
    return (_jsx("nav", { className: "rail rail--right", "aria-label": "Inspector", children: _jsx("div", { className: "rail__group", children: _jsxs("button", { type: "button", className: "rail__btn", "aria-label": "Show inspector", "data-tip": selected ? 'Inspect selection' : 'Scene settings', "data-tip-pos": "left", onClick: () => studio.store.getState().showInspector(), children: [_jsx(Icon, { name: "sliders" }), selected && _jsx("span", { className: "rail__dot", "aria-hidden": "true" })] }) }) }));
});
/**
 * Drag handle on a panel's inner edge. Updates the CSS width variable live
 * (no React render per pointer move) and commits the width on release.
 * Keyboard: arrows resize by 16 px, Home resets.
 */
export const ResizeHandle = memo(function ResizeHandle({ side, width, onCommit, hostRef }) {
    const drag = useRef(null);
    const cssVar = side === 'left' ? '--left-w' : '--right-w';
    const clamp = (w) => Math.round(Math.max(PANEL_WIDTH.min, Math.min(PANEL_WIDTH.max, w)));
    const onDown = (e) => {
        if (e.button !== 0)
            return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: width, cur: width };
        hostRef.current?.classList.add('is-resizing');
    };
    const onMove = (e) => {
        const d = drag.current;
        if (!d)
            return;
        const dx = e.clientX - d.x;
        d.cur = clamp(d.w + (side === 'left' ? dx : -dx));
        hostRef.current?.style.setProperty(cssVar, `${d.cur}px`);
    };
    const onUp = () => {
        const d = drag.current;
        drag.current = null;
        hostRef.current?.classList.remove('is-resizing');
        if (d)
            onCommit(d.cur);
    };
    const onKey = (e) => {
        const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
        const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
        if (e.key === grow || e.key === shrink) {
            e.preventDefault();
            onCommit(clamp(width + (e.key === grow ? 16 : -16)));
        }
        else if (e.key === 'Home') {
            e.preventDefault();
            onCommit(side === 'left' ? PANEL_WIDTH.left : PANEL_WIDTH.right);
        }
    };
    return (_jsx("div", { className: `resize-handle resize-handle--${side}`, role: "separator", "aria-orientation": "vertical", "aria-label": side === 'left' ? 'Resize left panel' : 'Resize inspector', "aria-valuenow": width, "aria-valuemin": PANEL_WIDTH.min, "aria-valuemax": PANEL_WIDTH.max, tabIndex: 0, onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp, onDoubleClick: () => onCommit(side === 'left' ? PANEL_WIDTH.left : PANEL_WIDTH.right), onKeyDown: onKey }));
});
