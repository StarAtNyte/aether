/**
 * Dev and preview only: `/__hub/datasets/<dataset>/resolve/<revision>/<path>` reads the asset hub dataset on the server side,
 * so a private dataset works for the developer without a credential ever reaching the browser.
 *
 * - `AETHER_HUB_DIR=<folder>`: serve files from a local staging folder (`npm run assets:hf -- build`) instead of the network.
 * - otherwise forward to huggingface.co (redirects followed on the server), with `Authorization: Bearer $AETHER_HUB_TOKEN`
 *   (or `HF_TOKEN`) when one is set; the token is read here and nowhere else, never logged, never sent to a redirect target.
 *
 * Narrow on purpose: GET only, only the configured dataset, only the index, the embeddings and `models/<id>/…` files, so it
 * is not an open proxy and cannot be used to read anything else with the token.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const PREFIX = '/__hub/';
const FILE = /^(?:index\.min\.json|index\.json|embeddings\.(?:bin|json)|models\/[a-z0-9][a-z0-9_-]{0,63}\/[a-z0-9][a-z0-9_.-]{0,80}\.(?:glb|webp|json))$/;
const TYPES: Record<string, string> = { json: 'application/json', glb: 'model/gltf-binary', webp: 'image/webp', bin: 'application/octet-stream' };

export interface HubProxyOptions {
  dataset: string;
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof fetch;
}

/** Handle one request; returns false when it is not a hub request. */
export async function handleHubRequest(req: Pick<IncomingMessage, 'url' | 'method'>, res: ServerResponse, o: HubProxyOptions): Promise<boolean> {
  const url = req.url ?? '';
  if (!url.startsWith(PREFIX)) return false;
  const send = (status: number, body = '', type = 'text/plain'): boolean => {
    res.statusCode = status;
    res.setHeader('content-type', type);
    res.setHeader('cache-control', 'no-store');
    res.end(body);
    return true;
  };
  if (req.method !== 'GET') return send(405, 'GET only');
  const m = /^\/__hub\/datasets\/([^/]+\/[^/]+)\/resolve\/([0-9a-f]{40}|main)\/([^?#]+)(?:\?.*)?$/.exec(url);
  if (!m || m[1] !== o.dataset) return send(404, 'not found');
  const path = decodeURIComponent(m[3] as string);
  if (!FILE.test(path)) return send(404, 'not found');
  const env = o.env ?? process.env;
  const dir = env['AETHER_HUB_DIR'];
  if (dir) {
    const root = resolve(dir);
    const file = resolve(root, path);
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return send(404, 'not found');
    res.statusCode = 200;
    res.setHeader('content-type', TYPES[file.split('.').pop() ?? ''] ?? 'application/octet-stream');
    res.setHeader('cache-control', 'no-store');
    res.end(readFileSync(file));
    return true;
  }
  const token = env['AETHER_HUB_TOKEN'] ?? env['HF_TOKEN'];
  try {
    const r = await (o.fetch ?? fetch)(`https://huggingface.co/datasets/${o.dataset}/resolve/${m[2]}/${path.split('/').map(encodeURIComponent).join('/')}`, { redirect: 'follow', headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!r.ok) return send(r.status === 401 || r.status === 403 ? 404 : r.status, 'not available');
    res.statusCode = 200;
    res.setHeader('content-type', r.headers.get('content-type') ?? 'application/octet-stream');
    res.setHeader('cache-control', 'no-store');
    res.end(Buffer.from(await r.arrayBuffer()));
    return true;
  } catch {
    return send(502, 'the hub could not be reached');
  }
}

export function hubProxy(dataset: string) {
  const mount = (server: { middlewares: { use(fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): void } }): void => {
    server.middlewares.use((req, res, next) => {
      void handleHubRequest(req, res, { dataset }).then((handled) => {
        if (!handled) next();
      });
    });
  };
  return { name: 'aether-hub-proxy', configureServer: mount, configurePreviewServer: mount };
}
