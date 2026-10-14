/**
 * Hash routing for the two halves of the app: the projects home and the
 * editor. Hash URLs work on any static host (no server rewrite rules) and
 * keep the query string free for `?world=` share links and `?debug=1`.
 *
 *   #/            home (recently opened)
 *   #/templates   template gallery
 *   #/projects    all projects
 *   #/published   published worlds (placeholder)
 *   #/docs        documentation
 *   #/p/<id>      editor for project <id>
 *   #/new         create a project from the starter scene and open it
 *   #/new/<slug>  create a project from a template and open it
 *   #/view/<tok>  read-only viewer of a world carried in the link (see shareLink.ts)
 *
 * Everything parsed from the URL is untrusted: ids and slugs are matched
 * against strict patterns and anything else falls back to the home route.
 */

/** Pages of the home dashboard. */
export type HomeSection = 'home' | 'templates' | 'projects' | 'published' | 'docs';

/** A parsed route. */
export type Route = { name: HomeSection } | { name: 'editor'; id: string } | { name: 'new'; template: string | null } | { name: 'view'; token: string };

/** Project ids: lowercase base36, 8–32 chars (see `newProjectId`). */
export const PROJECT_ID = /^[a-z0-9]{8,32}$/;
/** Template slugs: lowercase words joined by dashes. */
export const TEMPLATE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+){0,7}$/;
/** Longest hash considered at all (anything longer is ignored), except viewer links. */
const MAX_HASH = 256;
/** Longest viewer link hash (`#/view/` + token, see `MAX_LINK_TOKEN`). */
export const MAX_VIEW_HASH = 60_016;
/** Viewer tokens: format tag, dot, base64url. */
const VIEW_TOKEN = /^#?\/view\/((?:z1|j1)\.[A-Za-z0-9_-]+)$/;

const SECTIONS: ReadonlySet<string> = new Set<HomeSection>(['templates', 'projects', 'published', 'docs']);

/** Parse `location.hash` (with or without the leading `#`). Never throws. */
export function parseRoute(hash: string): Route {
  if (typeof hash !== 'string') return { name: 'home' };
  if (hash.length <= MAX_VIEW_HASH && /^#?\/view\//.test(hash)) {
    const m = VIEW_TOKEN.exec(hash);
    return m ? { name: 'view', token: m[1] as string } : { name: 'home' };
  }
  if (hash.length > MAX_HASH) return { name: 'home' };
  const path = hash.replace(/^#/, '').replace(/[?].*$/, '');
  const parts = path.split('/').filter((p) => p !== '');
  const [head, arg, extra] = parts;
  if (head === undefined) return { name: 'home' };
  if (extra !== undefined) return { name: 'home' };
  if (head === 'p' && arg !== undefined && PROJECT_ID.test(arg)) return { name: 'editor', id: arg };
  if (head === 'new') {
    if (arg === undefined) return { name: 'new', template: null };
    return TEMPLATE_SLUG.test(arg) ? { name: 'new', template: arg } : { name: 'home' };
  }
  if (arg === undefined && SECTIONS.has(head)) return { name: head as HomeSection };
  return { name: 'home' };
}

/** The hash (`#/…`) for a route. */
export function routeHash(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'editor':
      return `#/p/${route.id}`;
    case 'new':
      return route.template ? `#/new/${route.template}` : '#/new';
    case 'view':
      return `#/view/${route.token}`;
    default:
      return `#/${route.name}`;
  }
}

/** True for routes rendered by the home dashboard. */
export function isHomeRoute(route: Route): route is { name: HomeSection } {
  return route.name === 'home' || route.name === 'templates' || route.name === 'projects' || route.name === 'published' || route.name === 'docs';
}
