/**
 * Small, self-contained HTML error pages for browser navigations (`404`,
 * `500`, `503`). API routes keep their JSON errors; these are only sent when a
 * request outside `/api/` asks for HTML.
 *
 * The pages carry no script and no external resource, so they render under
 * the studio's strict CSP (inline styles are allowed by `style-src`), follow
 * the visitor's light / dark preference, and never echo request data.
 */
import type { Context } from 'hono';

/** Statuses with a dedicated page. */
export type ErrorPageStatus = 404 | 500 | 503;

const COPY: Readonly<Record<ErrorPageStatus, { title: string; message: string }>> = Object.freeze({
  404: { title: 'Page not found', message: 'There is nothing at this address. Your projects are safe in this browser.' },
  500: { title: 'Something went wrong', message: 'The server hit an unexpected error. Reload the page in a moment; your projects are stored in this browser.' },
  503: { title: 'Back in a moment', message: 'The server is restarting or busy. Reload the page in a few seconds.' },
});

/** Shared page styles (kept in sync with `apps/studio/public/404.html`). */
const STYLE = `:root{color-scheme:light dark;--bg:#f6f5f2;--fg:#1b1a18;--muted:#5f5d58;--card:#fff;--line:#e4e2dd;--accent:#1b1a18}
@media (prefers-color-scheme:dark){:root{--bg:#1b1a18;--fg:#efede8;--muted:#a8a59e;--card:#232220;--line:#33312e;--accent:#efede8}}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:420px;width:100%;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:32px 28px;text-align:left}
.code{font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;color:var(--muted);margin:0 0 14px}
h1{font-size:20px;line-height:1.3;margin:0 0 8px;font-weight:600}p{margin:0 0 22px;color:var(--muted)}
a{display:inline-block;background:var(--accent);color:var(--bg);text-decoration:none;font-weight:500;padding:9px 16px;border-radius:8px}
a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}svg{display:block;margin:0 0 20px}`;

const LOGO =
  '<svg width="28" height="28" viewBox="0 0 20 20" aria-hidden="true"><rect width="20" height="20" rx="5.5" fill="currentColor"/><path d="M5 13.25 10 5.75l5 7.5" fill="none" style="stroke:var(--card)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.75 15.25h10.5" fill="none" style="stroke:var(--card)" stroke-width="1.75" stroke-linecap="round"/></svg>';

const cache = new Map<ErrorPageStatus, string>();

/** The complete HTML document for `status` (constant text; built once per status). */
export function errorPageHtml(status: ErrorPageStatus): string {
  const hit = cache.get(status);
  if (hit !== undefined) return hit;
  const { title, message } = COPY[status];
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title} · Aether</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><style>${STYLE}</style></head>
<body><main>${LOGO}<p class="code">${status}</p><h1>${title}</h1><p>${message}</p><a href="/">Open Aether</a></main></body></html>
`;
  cache.set(status, html);
  return html;
}

/**
 * True when the request is a browser navigation outside the API (an HTML
 * page should answer it rather than JSON).
 */
export function wantsHtmlPage(c: Context): boolean {
  const path = c.req.path;
  if (path === '/api' || path.startsWith('/api/')) return false;
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return false;
  return (c.req.header('accept') ?? '').includes('text/html');
}

/** Send the error page for `status` (never cached: the next visit should get the real page). */
export function sendErrorPage(c: Context, status: ErrorPageStatus, html: string = errorPageHtml(status)): Response {
  c.header('Cache-Control', 'no-store');
  return c.html(html, status);
}
