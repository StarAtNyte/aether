/**
 * App root: applies the theme, and renders the route — the projects home,
 * the editor for a project, or the "new" route that creates a project and
 * replaces itself with the editor. A share link (`?world=<id>`) opened on
 * the home route becomes a new project that loads the shared world.
 */
import { lazy, memo, Suspense, useEffect, useRef, useState, type ReactElement } from 'react';
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
const EditorRoute = lazy(() => import('./editor/EditorRoute').then((m) => ({ default: m.EditorRoute })));
/** Read-only viewer of a world carried in a share link (same engine chunk as the editor). */
const ViewerRoute = lazy(() => import('./editor/ViewerRoute').then((m) => ({ default: m.ViewerRoute })));

/** Share-link world ids (server-generated, 12 base62 chars). */
const SHARE_ID = /^[0-9A-Za-z]{12}$/;

/** Creates the project for `#/new[/<template>]`, then replaces the URL with its editor. */
const NewRoute = memo(function NewRoute({ template }: { template: string | null }): ReactElement {
  const { repo, navigate, store } = useApp();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!repo || started.current) return;
    started.current = true;
    void (template ? createFromTemplate(repo, template) : createBlankProject(repo, 'starter')).then((r) => {
      if (r.ok) navigate({ name: 'editor', id: r.value.id }, { replace: true });
      else {
        setError(r.error);
        store.getState().toast(r.error, 'error', 6);
        navigate({ name: 'home' }, { replace: true });
      }
    });
  }, [repo, template, navigate, store]);
  return (
    <div className="page-center" aria-busy="true">
      <span className="page-center__text">{error ?? 'Creating project…'}</span>
    </div>
  );
});

/** Opens `?world=<id>` share links as a new project. */
function useShareLink(): void {
  const { repo, navigate } = useApp();
  const route = useAppState((s) => s.route);
  const done = useRef(false);
  useEffect(() => {
    if (!repo || done.current || !isHomeRoute(route)) return;
    const id = new URLSearchParams(location.search).get('world');
    if (!id || !SHARE_ID.test(id)) return;
    done.current = true;
    // The editor's Studio loads the shared world from the URL into this new project.
    void repo.create({ world: createEmptyWorld('Shared world') }).then((r) => {
      if (r.ok) navigate({ name: 'editor', id: r.value.id }, { replace: true });
    });
  }, [repo, route, navigate]);
}

/** The application. */
export const App = memo(function App(): ReactElement {
  const route = useAppState((s) => s.route);
  const dark = useAppState((s) => s.settings.darkTheme);
  useEffect(() => applyTheme(document, themeFromSetting(dark)), [dark]);
  useShareLink();
  let page: ReactElement;
  if (route.name === 'editor') {
    page = (
      <Suspense fallback={<EditorSkeleton />}>
        <EditorRoute key={route.id} id={route.id} />
      </Suspense>
    );
  } else if (route.name === 'view') {
    page = (
      <Suspense fallback={<EditorSkeleton />}>
        <ViewerRoute key={route.token} token={route.token} />
      </Suspense>
    );
  } else if (route.name === 'new') page = <NewRoute key={route.template ?? 'starter'} template={route.template} />;
  else page = <Home section={route.name} />;
  return (
    <>
      {page}
      {/* First-run "Connect your AI" screen: probes once, loads lazily, never blocks the app (not over a shared world). */}
      {route.name !== 'view' && <FirstRunHost />}
    </>
  );
});
