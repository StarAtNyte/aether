import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Read-only viewer of a shared world (`#/view/<token>`): the world from the
 * link fills the window with a slim bar — its name, a "Shared" badge, Play,
 * Export and Remix. Nothing is saved; editing tools and the agent are
 * absent. Remix copies the world into a new project and opens the editor.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../app/appContext';
import { StudioProvider, useStudio, useUI, useWorld } from '../app/context';
import { Studio } from '../engine/Studio';
import { decodeWorldToken } from '../lib/shareLink';
import { shortcut } from '../lib/keys';
import { Icon } from '../components/Icon';
import { Logomark } from '../components/Logo';
import { Toasts } from '../components/Toasts';
import { Viewport } from '../components/viewport/Viewport';
import { exposeDebug } from './EditorRoute';
import { EditorSkeleton } from './EditorSkeleton';
/** The viewer's bar and viewport. */
const ViewerShell = memo(function ViewerShell({ onRemix, remixing }) {
    const studio = useStudio();
    const world = useWorld();
    const mode = useUI((s) => s.mode);
    const modeBusy = useUI((s) => s.modeBusy);
    const loading = useUI((s) => s.loading);
    const playing = mode === 'play';
    useEffect(() => {
        document.title = `${world.name || 'Shared world'} · Aether`;
    }, [world.name]);
    // Keyboard: play / stop, Esc stops.
    useEffect(() => {
        const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                void studio.togglePlay();
            }
            else if (e.key === 'Escape' && studio.store.getState().mode === 'play')
                void studio.togglePlay();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [studio]);
    return (_jsxs("div", { className: "viewer editor", "data-layout": "viewer", "data-mode": mode, "data-tool": "orbit", children: [_jsxs("header", { className: "viewer-bar", "aria-label": "Shared world", children: [_jsx("a", { className: "viewer-bar__brand", href: "#/", "aria-label": "Aether home", "data-tip": "Aether home", children: _jsx(Logomark, { size: 22 }) }), _jsxs("span", { className: "viewer-bar__title", children: [_jsx("span", { className: "viewer-bar__name", children: world.name || 'Shared world' }), _jsxs("span", { className: "badge viewer-bar__badge", children: [_jsx(Icon, { name: "eye", size: 12 }), " Shared \u00B7 read only"] })] }), _jsx("span", { className: "spacer" }), _jsxs("button", { type: "button", className: `btn btn--sm ${playing ? 'btn--stop' : ''} play-btn`, onClick: () => void studio.togglePlay(), disabled: modeBusy || loading !== null, "aria-pressed": playing, "data-kbd": shortcut('Mod+Enter'), "data-tip": playing ? 'Stop' : 'Play the world', children: [_jsx(Icon, { name: playing ? 'stop' : 'play' }), _jsx("span", { className: "btn__label", children: playing ? 'Stop' : 'Play' })] }), _jsxs("button", { type: "button", className: "btn btn--sm hide-phone", onClick: () => studio.exportToFile(), disabled: playing, "data-tip": "Download as .aether.json", children: [_jsx(Icon, { name: "download" }), _jsx("span", { className: "btn__label", children: "Export" })] }), _jsxs("button", { type: "button", className: "btn btn--sm btn--primary", onClick: onRemix, disabled: remixing || playing, "data-tip": "Copy into a new project you can edit", children: [_jsx(Icon, { name: "branch" }), _jsx("span", { className: "btn__label", children: remixing ? 'Remixing…' : 'Remix' })] })] }), _jsx("main", { className: "viewer__canvas", children: _jsx(Viewport, {}) }), _jsx(Toasts, {})] }));
});
/** Error state for a link that cannot be opened. */
function ViewerError({ message }) {
    return (_jsx("div", { className: "page-center", children: _jsxs("div", { className: "empty-state", children: [_jsx("span", { className: "empty-state__icon", children: _jsx(Icon, { name: "link", size: 20 }) }), _jsx("h3", { className: "empty-state__title", children: "This world link can\u2019t be opened" }), _jsx("p", { className: "empty-state__text", children: message }), _jsxs("a", { className: "btn btn--primary", href: "#/", children: [_jsx(Icon, { name: "arrowLeft" }), " Go to Aether"] })] }) }));
}
/** The viewer route. */
export const ViewerRoute = memo(function ViewerRoute({ token }) {
    const { repo, navigate } = useApp();
    const [studio, setStudio] = useState(null);
    const [error, setError] = useState(null);
    const [remixing, setRemixing] = useState(false);
    const original = useRef(null);
    useEffect(() => {
        let cancelled = false;
        let created = null;
        void decodeWorldToken(token).then((r) => {
            if (cancelled)
                return;
            if (!r.ok) {
                setError(r.error);
                return;
            }
            original.current = r.world;
            // Nothing is persisted: the project save is a no-op and safe mode never swaps the world.
            const s = new Studio({ project: { world: r.world, chat: [] }, onSave: async () => null, safeMode: false });
            s.store.getState().setViewer(true);
            s.store.getState().setPanel('left', false);
            s.store.getState().setPanel('right', false);
            created = s;
            void s.boot();
            exposeDebug(s);
            setStudio(s);
        });
        return () => {
            cancelled = true;
            if (created) {
                if (window.__aether?.studio === created)
                    delete window.__aether;
                created.dispose();
            }
            setStudio(null);
            setError(null);
        };
    }, [token]);
    const remix = useCallback(async () => {
        const world = original.current;
        if (!repo || !world || remixing)
            return;
        setRemixing(true);
        const r = await repo.create({ world, name: world.name || 'Remixed world' });
        setRemixing(false);
        if (r.ok)
            navigate({ name: 'editor', id: r.value.id }, { replace: true });
        else
            studio?.store.getState().toast(r.error, 'error', 6);
    }, [repo, remixing, navigate, studio]);
    if (error)
        return _jsx(ViewerError, { message: error });
    if (!studio)
        return _jsx(EditorSkeleton, {});
    return (_jsx(StudioProvider, { studio: studio, children: _jsx(ViewerShell, { onRemix: () => void remix(), remixing: remixing }) }));
});
