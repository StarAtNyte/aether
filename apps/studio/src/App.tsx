/**
 * App root: applies the theme, and renders the route — the projects home,
 * the editor for a project, or the "new" route that creates a project and
 * replaces itself with the editor. A share link (`?world=<id>`) opened on
 * the home route becomes a new project that loads the shared world.
 */
import { memo, useEffect, useRef, useState, type ReactElement } from 'react';
import { useApp, useAppState } from './app/appContext';
import { EditorRoute } from './editor/EditorRoute';
import { Home } from './home/Home';
import { createBlankProject, createEmptyWorld, createFromTemplate } from './projects/create';
import { isHomeRoute } from './lib/router';
import { applyTheme, themeFromSetting } from './lib/theme';

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
  if (route.name === 'editor') return <EditorRoute key={route.id} id={route.id} />;
  if (route.name === 'new') return <NewRoute key={route.template ?? 'starter'} template={route.template} />;
  return <Home section={route.name} />;
});
