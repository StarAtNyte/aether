import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Slim icon rail that switches the left panel's view (and collapses it when the active view is clicked again). */
import { memo } from 'react';
import { useStudio, useUI } from '../app/context';
import { Icon } from '../components/Icon';
/** Rail entries in order: id, label, icon, Alt+digit shortcut. */
export const LEFT_VIEWS = [
    { id: 'agent', label: 'Agent', icon: 'sparkles' },
    { id: 'objects', label: 'Objects', icon: 'layers' },
    { id: 'assets', label: 'Assets', icon: 'shapes' },
    { id: 'logic', label: 'Logic', icon: 'zap' },
    { id: 'verify', label: 'Checks', icon: 'shield' },
    { id: 'history', label: 'History', icon: 'history' },
];
/** Count of failing checks (for the rail badge). */
export function useFailingChecks() {
    return useUI((s) => (s.verify.status === 'failed' ? s.verify.results.filter((r) => !r.passed).length + s.verify.diagnostics.filter((d) => d.severity === 'error').length : 0));
}
/** The icon rail. */
export const IconRail = memo(function IconRail() {
    const studio = useStudio();
    const view = useUI((s) => s.leftView);
    const open = useUI((s) => s.panels.left);
    const failing = useFailingChecks();
    const busy = useUI((s) => s.agentBusy);
    return (_jsxs("nav", { className: "rail", "aria-label": "Panels", children: [_jsx("div", { className: "rail__group", role: "tablist", "aria-orientation": "vertical", "aria-label": "Left panel", children: LEFT_VIEWS.map((v, i) => {
                    const active = open && view === v.id;
                    return (_jsxs("button", { type: "button", role: "tab", "aria-selected": active, "aria-controls": "left-panel", id: `rail-${v.id}`, className: `rail__btn${active ? ' is-active' : ''}`, "aria-label": v.label, "data-tip": v.label, "data-kbd": `Alt+${i + 1}`, "data-tip-pos": "right", onClick: () => {
                            const st = studio.store.getState();
                            if (st.panels.left && st.leftView === v.id)
                                st.togglePanel('left');
                            else
                                st.showLeftView(v.id);
                        }, children: [_jsx(Icon, { name: v.icon }), v.id === 'verify' && failing > 0 && _jsx("span", { className: "rail__badge", children: failing > 9 ? '9+' : failing }), v.id === 'agent' && busy && _jsx("span", { className: "rail__pulse", "aria-hidden": "true" })] }, v.id));
                }) }), _jsx("div", { className: "rail__group", children: _jsx("button", { type: "button", className: "rail__btn", "aria-label": "Settings", "data-tip": "Settings", "data-tip-pos": "right", onClick: () => studio.store.getState().setSettingsOpen(true), children: _jsx(Icon, { name: "settings" }) }) })] }));
});
