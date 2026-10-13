/**
 * Bridge pairing deep link, part 1 (dependency-free, runs before the router):
 * `?bridge=<loopback url>#aether-bridge=<token>`. The raw values are taken
 * out of the address bar synchronously so neither the router nor history
 * ever keeps the token; validation happens later in `session.ts`.
 */

/** Raw (unvalidated) deep-link values. */
export interface RawBridgeLink {
  url: string | null;
  token: string | null;
}

/**
 * Split `href` into the raw bridge link (null when absent) and the clean
 * relative URL to put back in the address bar.
 */
export function extractBridgeLink(href: string): { link: RawBridgeLink | null; clean: string } {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { link: null, clean: href };
  }
  const raw = url.searchParams.get('bridge');
  const m = /(?:^#|&)aether-bridge=([^&]{0,200})/.exec(url.hash);
  if (raw === null && !m) return { link: null, clean: `${url.pathname}${url.search}${url.hash}` };
  url.searchParams.delete('bridge');
  const rest = url.hash.replace(/^#/, '').split('&').filter((p) => p.length > 0 && !p.startsWith('aether-bridge=')).join('&');
  const hash = rest ? `#${rest}` : '';
  return { link: { url: raw ? raw.slice(0, 200) : null, token: m?.[1] ?? null }, clean: `${url.pathname}${url.search}${hash}` };
}
