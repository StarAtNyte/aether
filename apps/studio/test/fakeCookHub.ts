/**
 * A fake Hugging Face Hub for the cooked-world upload tests (api/_lib/cook-upload.ts): LFS batch (upload and download),
 * storage PUT and GET, verify, commit, the commit history and the file tree. Commits are applied to `files`, so the history
 * and the tree answer from what was published.
 */
import { createHash } from 'node:crypto';

export const TOKEN = 'hf_SECRETtokenVALUE0123456789';
export const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

export interface HubCall {
  kind: 'batch' | 'put' | 'get' | 'verify' | 'commit' | 'commits' | 'tree';
  body: string;
}

export interface FakeHub {
  fetch: typeof fetch;
  calls: HubCall[];
  /** LFS storage: oid to bytes. */
  stored: Map<string, Uint8Array>;
  /** The repository: path to size, and the content of plain files. */
  files: Map<string, { size: number; oid?: string; text?: string }>;
  /** The history, newest first. */
  history: Array<{ title: string; date: string }>;
  /** Corrupt the next download of this oid. */
  damage: Set<string>;
}

export function fakeHub(opts: { echo?: boolean; failCommit?: boolean; now?: () => number } = {}): FakeHub {
  const calls: HubCall[] = [];
  const stored = new Map<string, Uint8Array>();
  const files = new Map<string, { size: number; oid?: string; text?: string }>();
  const history: Array<{ title: string; date: string }> = [];
  const damage = new Set<string>();
  const now = opts.now ?? Date.now;
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? init.body : init?.body ? `<${(init.body as Uint8Array).byteLength} bytes>` : '';
    if (url.endsWith('/info/lfs/objects/batch')) {
      calls.push({ kind: 'batch', body });
      const req = JSON.parse(body) as { operation: string; objects: Array<{ oid: string; size: number }> };
      if (req.operation === 'download') {
        return new Response(JSON.stringify({ transfer: 'basic', objects: req.objects.map((o) => (stored.has(o.oid) ? { ...o, actions: { download: { href: `https://storage.test/get/${o.oid}` } } } : { ...o, error: { code: 404, message: 'not found' } })) }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          transfer: 'basic',
          objects: req.objects.map((o) => (stored.has(o.oid) ? o : { ...o, actions: { upload: { href: `https://storage.test/${o.oid}` }, verify: { href: 'https://huggingface.co/verify', header: { Authorization: `Bearer ${TOKEN}` } } } })),
        }),
        { status: 200 },
      );
    }
    if (url.startsWith('https://storage.test/get/')) {
      calls.push({ kind: 'get', body });
      const oid = url.split('/').pop()!;
      const b = stored.get(oid)!;
      if (damage.delete(oid)) return new Response(new Uint8Array(b.byteLength) as Uint8Array<ArrayBuffer>, { status: 200 });
      return new Response(b as Uint8Array<ArrayBuffer>, { status: 200 });
    }
    if (url.startsWith('https://storage.test/')) {
      calls.push({ kind: 'put', body });
      const bytes = new Uint8Array(init!.body as Uint8Array);
      stored.set(sha(bytes), bytes);
      return new Response('', { status: 200 });
    }
    if (url === 'https://huggingface.co/verify') {
      calls.push({ kind: 'verify', body });
      return new Response('{}', { status: 200 });
    }
    if (url.endsWith('/commit/main')) {
      calls.push({ kind: 'commit', body });
      if (opts.failCommit) return new Response(`{"error":"bad token ${TOKEN}"}`, { status: 403, headers: { 'x-debug': TOKEN } });
      const lines = body.split('\n').map((l) => JSON.parse(l) as { key: string; value: { summary?: string; path?: string; size?: number; oid?: string; content?: string } });
      for (const l of lines.slice(1)) {
        if (l.key === 'lfsFile') files.set(l.value.path!, { size: l.value.size!, oid: l.value.oid! });
        if (l.key === 'file') {
          const text = Buffer.from(l.value.content!, 'base64').toString('utf8');
          files.set(l.value.path!, { size: Buffer.byteLength(text), text });
        }
        if (l.key === 'deletedFile') files.delete(l.value.path!);
      }
      history.unshift({ title: lines[0]!.value.summary!, date: new Date(now()).toISOString() });
      return new Response('{"commitOid":"x"}', { status: 200 });
    }
    const commits = /\/api\/datasets\/[^/]+\/[^/]+\/commits\/main\?limit=(\d+)&p=(\d+)$/.exec(url);
    if (commits) {
      calls.push({ kind: 'commits', body: '' });
      const n = Number(commits[1]), p = Number(commits[2]);
      return new Response(JSON.stringify(history.slice(p * n, (p + 1) * n).map((h) => ({ id: 'x', title: opts.echo ? `${h.title} ${TOKEN}` : h.title, date: h.date }))), { status: 200 });
    }
    const tree = /\/api\/datasets\/[^/]+\/[^/]+\/tree\/main\/(.+)\?recursive=true/.exec(url);
    if (tree) {
      calls.push({ kind: 'tree', body: '' });
      const under = `${tree[1]}/`;
      const list = [...files].filter(([p]) => p.startsWith(under)).map(([path, v]) => ({ type: 'file', path, size: v.size, ...(v.oid ? { lfs: { oid: v.oid, size: v.size } } : {}) }));
      if (list.length === 0) return new Response(`{"error":"${tree[1]} does not exist"}`, { status: 404 });
      return new Response(JSON.stringify(list), { status: 200 });
    }
    return new Response(opts.echo ? `unknown ${TOKEN}` : 'unknown', { status: 404 });
  }) as typeof fetch;
  return { fetch: f, calls, stored, files, history, damage };
}

/**
 * The dataset as the player reads it (`<base>users/…`): plain files from `files`, LFS files from `stored`. Lets a test open a
 * published world through its short link.
 */
export function datasetFetch(hub: FakeHub, base: string): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (!url.startsWith(base)) return new Response('', { status: 404 });
    const f = hub.files.get(url.slice(base.length));
    if (!f) return new Response('Entry not found', { status: 404 });
    if (f.text !== undefined) return new Response(f.text, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    return new Response(hub.stored.get(f.oid!)! as Uint8Array<ArrayBuffer>, { status: 200 });
  }) as typeof fetch;
}
