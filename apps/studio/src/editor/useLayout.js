/** Layout hooks: the current layout mode (tracks resizes) and persisted panel widths. */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { STORAGE_KEYS } from '../config';
import { clampPanelWidth, constrainPanels, layoutModeFor, PANEL_WIDTH } from '../lib/layout';
import { browserStorage, readJson, writeJson } from '../lib/storage';
import { useStudio } from '../app/context';
function subscribe(fn) {
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
}
/** The editor layout mode for the current window width. */
export function useLayoutMode() {
    return useSyncExternalStore(subscribe, () => layoutModeFor(window.innerWidth), () => 'wide');
}
/** Keep the open panels valid when the layout mode changes (e.g. resizing into `medium`). */
export function usePanelConstraints(mode) {
    const studio = useStudio();
    useEffect(() => {
        const st = studio.store.getState();
        const next = constrainPanels(mode, st.panels);
        if (next.left !== st.panels.left)
            st.setPanel('left', next.left);
        if (next.right !== st.panels.right)
            st.setPanel('right', next.right);
    }, [mode, studio]);
}
/** Persisted side panel widths. */
export function usePanelWidths() {
    const [widths, setWidths] = useState(() => {
        const raw = readJson(browserStorage(), STORAGE_KEYS.layout);
        const r = typeof raw === 'object' && raw !== null ? raw : {};
        return { left: clampPanelWidth(r['left'], PANEL_WIDTH.left), right: clampPanelWidth(r['right'], PANEL_WIDTH.right) };
    });
    const setWidth = useCallback((side, w) => {
        setWidths((prev) => {
            const next = { ...prev, [side]: clampPanelWidth(w, side === 'left' ? PANEL_WIDTH.left : PANEL_WIDTH.right) };
            writeJson(browserStorage(), STORAGE_KEYS.layout, next);
            return next;
        });
    }, []);
    return { ...widths, setWidth };
}
