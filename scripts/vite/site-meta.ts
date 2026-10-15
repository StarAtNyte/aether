/**
 * Vite plugin: make the studio's link-preview tags absolute at build time.
 *
 * `index.html` carries Open Graph / Twitter tags with root-relative URLs
 * (`/og.jpg`). Most link-preview crawlers only accept absolute URLs, so when
 * the public address of the deployment is known the plugin rewrites them:
 *
 * - `VITE_AETHER_SITE_URL` (an `https://` origin, e.g. `https://aether.example.com`), else
 * - `VERCEL_PROJECT_PRODUCTION_URL` (set by Vercel during builds; a bare host name).
 *
 * Without either (local builds, the container) the tags stay relative, which
 * is still valid HTML. Values are validated strictly: anything that is not a
 * plain https origin is ignored, so a hostile environment cannot inject markup.
 */

/** Plain https origin: scheme, host name, optional port, nothing else. */
const HTTPS_ORIGIN = /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*(?::\d{1,5})?$/;

/** The public origin of this build, or null when unknown or invalid. */
export function siteOrigin(env: Readonly<Record<string, string | undefined>>): string | null {
  const explicit = env['VITE_AETHER_SITE_URL']?.trim().replace(/\/+$/, '');
  if (explicit) return HTTPS_ORIGIN.test(explicit) ? explicit : null;
  const vercel = env['VERCEL_PROJECT_PRODUCTION_URL']?.trim();
  if (vercel) {
    const origin = `https://${vercel.replace(/\/+$/, '')}`;
    return HTTPS_ORIGIN.test(origin) ? origin : null;
  }
  return null;
}

/** Meta tags whose root-relative `content` becomes absolute. */
const URL_META = /(<meta\s+(?:property|name)="(?:og:image|og:url|twitter:image)"\s+content=")(\/[^"]*)(")/g;

/** Rewrite root-relative preview URLs in `html` against `origin` (pure; exported for tests). */
export function absolutizePreviewTags(html: string, origin: string | null): string {
  if (origin === null) return html;
  return html.replace(URL_META, (_m, head: string, path: string, tail: string) => `${head}${origin}${path}${tail}`);
}

/** The plugin (studio entry only; the player page has no preview tags). */
export function siteMeta(env: Readonly<Record<string, string | undefined>> = process.env) {
  const origin = siteOrigin(env);
  return {
    name: 'aether-site-meta',
    transformIndexHtml: {
      order: 'post' as const,
      handler(html: string, ctx: { filename: string }): string {
        return /(^|[\\/])index\.html$/.test(ctx.filename) ? absolutizePreviewTags(html, origin) : html;
      },
    },
  };
}
