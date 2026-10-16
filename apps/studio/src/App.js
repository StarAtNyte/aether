import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * App root: applies the theme, and renders the route — the projects home,
 * the editor for a project, or the "new" route that creates a project and
 * replaces itself with the editor. A share link (`?world=<id>`) opened on
 * the home route becomes a new project that loads the shared world.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { ErrorBoundary, lazyBoundary } from './components/ErrorBoundary';
import { useApp, useAppState } from './app/appContext';
import { EditorSkeleton } from './editor/EditorSkeleton';
import { Home } from './home/Home';
import { createBlankProject, createEmptyWorld, createFromTemplate } from './projects/create';
import { isHomeRoute } from './lib/router';
import { applyTheme, themeFromSetting } from './lib/theme';
import { FirstRunHost } from './onboarding/FirstRunHost';
/**
 * The editor (renderer, physics, agent — three.js and the engine packages)
 * loads on demand: the projects home never pays for it.
 */
const EditorRoute = lazyBoundary(() => import('./editor/EditorRoute').then((m) => ({ default: m.EditorRoute })), { what: 'editor', fallback: _jsx(EditorSkeleton, {}) });
/** Read-only viewer of a world carried in a share link (same engine chunk as the editor). */
const ViewerRoute = lazyBoundary(() => import('./editor/ViewerRoute').then((m) => ({ default: m.ViewerRoute })), { what: 'viewer', fallback: _jsx(EditorSkeleton, {}) });
/** Share-link world ids (server-generated, 12 base62 chars). */
const SHARE_ID = /^[0-9A-Za-z]{12}$/;
/** Creates the project for `#/new[/<template>]`, then replaces the URL with its editor. */
const NewRoute = memo(function NewRoute({ template }) {
    const { repo, navigate, store } = useApp();
    const started = useRef(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (!repo || started.current)
            return;
        started.current = true;
        void (template ? createFromTemplate(repo, template) : createBlankProject(repo, 'starter')).then((r) => {
            if (r.ok)
                navigate({ name: 'editor', id: r.value.id }, { replace: true });
            else {
                setError(r.error);
                store.getState().toast(r.error, 'error', 6);
                navigate({ name: 'home' }, { replace: true });
            }
        });
    }, [repo, template, navigate, store]);
    return (_jsx("div", { className: "page-center", "aria-busy": "true", children: _jsx("span", { className: "page-center__text", children: error ?? 'Creating project…' }) }));
});
/** Opens `?world=<id>` share links as a new project. */
function useShareLink() {
    const { repo, navigate } = useApp();
    const route = useAppState((s) => s.route);
    const done = useRef(false);
    useEffect(() => {
        if (!repo || done.current || !isHomeRoute(route))
            return;
        const id = new URLSearchParams(location.search).get('world');
        if (!id || !SHARE_ID.test(id))
            return;
        done.current = true;
        // The editor's Studio loads the shared world from the URL into this new project.
        void repo.create({ world: createEmptyWorld('Shared world') }).then((r) => {
            if (r.ok)
                navigate({ name: 'editor', id: r.value.id }, { replace: true });
        });
    }, [repo, route, navigate]);
}
/** The application. */
export const App = memo(function App() {
    const route = useAppState((s) => s.route);
    const dark = useAppState((s) => s.settings.darkTheme);
    useEffect(() => applyTheme(document, themeFromSetting(dark)), [dark]);
    useShareLink();
    let page;
    if (route.name === 'editor') {
        page = _jsx(EditorRoute, { id: route.id }, route.id);
    }
    else if (route.name === 'view') {
        page = _jsx(ViewerRoute, { token: route.token }, route.token);
    }
    else if (route.name === 'new')
        page = _jsx(NewRoute, { template: route.template }, route.template ?? 'starter');
    else
        page = _jsx(Home, { section: route.name });
    return (_jsxs(_Fragment, { children: [_jsx(ErrorBoundary, { what: "app", children: page }, route.name === 'editor' ? route.id : route.name), route.name !== 'view' && _jsx(FirstRunHost, {})] }));
});
