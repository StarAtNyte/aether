/**
 * The static deployment (vercel.json) and the Node server must send the same
 * Content-Security-Policy, and that policy must stay strict: no inline or
 * eval'd scripts, and the only wildcard is the visitor's own loopback bridge.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BYOK_ORIGINS } from '../../studio/src/ai/byokCatalog';
import { BUILD_PLAY_CSP, BYOK_API_HOSTS, COOKED_HOSTS, CSP_DIRECTIVES, HUB_IMAGE_HOSTS, DAG_WORKER_CSP, DAG_WORKER_PATH, PLAY_CSP, SANDBOX_WORKER_CSP, SANDBOX_WORKER_PATH, TRANSCODER_WORKER_CSP, TRANSCODER_WORKER_PATH, VERIFY_WORKER_CSP, VERIFY_WORKER_PATH } from '../src/middleware';
import { cleanupDirs, makeApp, makeConfig } from './helpers';

type Policy = Map<string, string[]>;

function parsePolicy(text: string): Policy {
  const out: Policy = new Map();
  for (const part of text.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out.set(name, sources.sort());
  }
  return out;
}

function serverPolicy(): Policy {
  const out: Policy = new Map();
  for (const [key, sources] of Object.entries(CSP_DIRECTIVES)) out.set(key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), [...sources].sort());
  return out;
}

function vercelPolicy(): Policy {
  const file = fileURLToPath(new URL('../../../vercel.json', import.meta.url));
  const config = JSON.parse(readFileSync(file, 'utf8')) as { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> };
  const value = config.headers.flatMap((h) => h.headers).find((h) => h.key.toLowerCase() === 'content-security-policy')?.value;
  if (!value) throw new Error('vercel.json has no Content-Security-Policy');
  return parsePolicy(value);
}

describe('Content-Security-Policy', () => {
  it('is identical for the static deployment and the Node server', () => {
    expect(Object.fromEntries(vercelPolicy())).toEqual(Object.fromEntries(serverPolicy()));
  });

  it('stays strict: no inline/eval scripts, wildcards only for the loopback bridge', () => {
    const p = serverPolicy();
    expect(p.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"].sort());
    for (const [name, sources] of p) {
      expect(sources, name).not.toContain("'unsafe-eval'");
      if (name !== 'style-src') expect(sources, name).not.toContain("'unsafe-inline'");
      expect(sources, name).not.toContain('*');
      for (const s of sources.filter((x) => x.includes('*'))) expect(['http://127.0.0.1:*', 'http://localhost:*'], `${name} ${s}`).toContain(s);
      for (const s of sources.filter((x) => /^https?:/.test(x) && !x.includes('*'))) expect(s.startsWith('https://'), `${name} ${s}`).toBe(true);
    }
    expect(p.get('object-src')).toEqual(["'none'"]);
    expect(p.get('frame-ancestors')).toEqual(["'none'"]);
  });
});

describe('bring-your-own-key provider origins', () => {
  it('allows exactly the provider APIs the studio calls with a user key', () => {
    expect([...BYOK_API_HOSTS].sort()).toEqual([...BYOK_ORIGINS].sort());
    const connect = serverPolicy().get('connect-src') ?? [];
    for (const o of BYOK_ORIGINS) expect(connect, o).toContain(o);
    // No other non-loopback model API host (and no wildcard subdomains).
    expect(connect.filter((s) => /api|openrouter|googleapis/.test(s)).sort()).toEqual([...BYOK_ORIGINS].sort());
  });
});

describe('generator sandbox worker policy', () => {
  it('allows eval only in the sandbox worker script, and nothing else there', () => {
    const p = parsePolicy(SANDBOX_WORKER_CSP);
    expect(p.get('default-src')).toEqual(["'none'"]);
    expect(p.get('script-src')).toEqual(["'self'", "'unsafe-eval'", "'wasm-unsafe-eval'"].sort());
    expect([...p.keys()].sort()).toEqual(['default-src', 'script-src']);
    expect(SANDBOX_WORKER_PATH.test('/assets/sandbox.worker-BvSP-eys.js')).toBe(true);
    expect(SANDBOX_WORKER_PATH.test('/assets/index-abc.js')).toBe(false);
    expect(SANDBOX_WORKER_PATH.test('/assets/sandbox.worker-x.js/../index.js')).toBe(false);
  });

  it('is the same on the static deployment, which keeps the strict policy everywhere else', () => {
    const file = fileURLToPath(new URL('../../../vercel.json', import.meta.url));
    const config = JSON.parse(readFileSync(file, 'utf8')) as { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> };
    const rules = config.headers.filter((h) => h.headers.some((x) => x.key === 'Content-Security-Policy'));
    expect(rules.map((r) => r.source)).toEqual([
      '/((?!assets/sandbox\\.worker-|assets/verify\\.worker-|assets/dag\\.worker-|basis/ktx2-worker\\.js$|play$|play\\.html$).*)',
      '/play(\\.html)?',
      '/assets/sandbox.worker-(.*)',
      '/basis/ktx2-worker.js',
      '/assets/verify.worker-(.*)',
      '/assets/dag.worker-(.*)',
    ]);
    expect(rules[1]?.headers.find((x) => x.key === 'Content-Security-Policy')?.value).toBe(PLAY_CSP);
    expect(rules[2]?.headers.find((x) => x.key === 'Content-Security-Policy')?.value).toBe(SANDBOX_WORKER_CSP);
    expect(rules[3]?.headers.find((x) => x.key === 'Content-Security-Policy')?.value).toBe(TRANSCODER_WORKER_CSP);
    expect(rules[4]?.headers.find((x) => x.key === 'Content-Security-Policy')?.value).toBe(VERIFY_WORKER_CSP);
    // Every worker rule keeps the other security headers of the page.
    expect(rules[5]?.headers.find((x) => x.key === 'Content-Security-Policy')?.value).toBe(DAG_WORKER_CSP);
    for (const r of rules.slice(3)) expect(r.headers.map((x) => x.key).sort()).toEqual(rules[2]?.headers.map((x) => x.key).sort());
    // The page rule does not also apply to the worker scripts (two CSP headers would combine).
    const main = new RegExp(`^${rules[0]?.source}$`);
    for (const path of ['/assets/sandbox.worker-BvSP-eys.js', '/basis/ktx2-worker.js', '/assets/verify.worker-DDbpC4GI.js', '/assets/dag.worker-DKylClzY.js']) expect(main.test(path), path).toBe(false);
    expect(main.test('/basis/basis_transcoder.js')).toBe(true);
  });

  it('is sent by the Node server for the worker only', async () => {
    const app = makeApp(makeConfig());
    const worker = await app.request('/assets/sandbox.worker-BvSP-eys.js');
    expect(worker.headers.get('content-security-policy')).toBe(SANDBOX_WORKER_CSP);
    const page = await app.request('/api/health');
    expect(page.headers.get('content-security-policy')).not.toMatch(/'unsafe-eval'/);
    cleanupDirs();
  });
});

describe('KTX2 transcoder worker policy', () => {
  it('allows eval and wasm in the transcoder worker only, with no network and no nested workers', async () => {
    const p = parsePolicy(TRANSCODER_WORKER_CSP);
    expect(p.get('default-src')).toEqual(["'none'"]);
    expect(p.get('script-src')).toEqual(["'self'", "'unsafe-eval'", "'wasm-unsafe-eval'"].sort());
    expect([...p.keys()].sort()).toEqual(['default-src', 'script-src']);
    expect(TRANSCODER_WORKER_PATH.test('/basis/ktx2-worker.js')).toBe(true);
    expect(TRANSCODER_WORKER_PATH.test('/published/abcdefgh1234/basis/ktx2-worker.js')).toBe(true);
    expect(TRANSCODER_WORKER_PATH.test('/basis/basis_transcoder.js')).toBe(false);
    expect(TRANSCODER_WORKER_PATH.test('/basis/ktx2-worker.js/../../index.html')).toBe(false);
    const app = makeApp(makeConfig());
    const worker = await app.request('/basis/ktx2-worker.js');
    expect(worker.headers.get('content-security-policy')).toBe(TRANSCODER_WORKER_CSP);
    const glue = await app.request('/basis/basis_transcoder.js');
    expect(glue.headers.get('content-security-policy')).not.toMatch(/'unsafe-eval'/);
    cleanupDirs();
  });
});

describe('physics verification worker policy', () => {
  it('allows wasm and same-origin fetches only (no eval, no other hosts)', () => {
    const p = parsePolicy(VERIFY_WORKER_CSP);
    expect(p.get('default-src')).toEqual(["'none'"]);
    expect(p.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"].sort());
    expect(p.get('connect-src')).toEqual(["'self'"]);
    expect([...p.keys()].sort()).toEqual(['connect-src', 'default-src', 'script-src']);
    expect(VERIFY_WORKER_PATH.test('/assets/verify.worker-DDbpC4GI.js')).toBe(true);
    expect(VERIFY_WORKER_PATH.test('/assets/verify.worker-x.js/../index.js')).toBe(false);
  });

  it('is sent by the Node server for the verification worker only', async () => {
    const app = makeApp(makeConfig());
    const worker = await app.request('/assets/verify.worker-DDbpC4GI.js');
    expect(worker.headers.get('content-security-policy')).toBe(VERIFY_WORKER_CSP);
    const sandbox = await app.request('/assets/sandbox.worker-BvSP-eys.js');
    expect(sandbox.headers.get('content-security-policy')).toBe(SANDBOX_WORKER_CSP);
    cleanupDirs();
  });
});

describe('geometry worker policy', () => {
  it('allows same-origin script only (no eval, no wasm, no network) and is sent for that worker only', async () => {
    const p = parsePolicy(DAG_WORKER_CSP);
    expect(p.get('default-src')).toEqual(["'none'"]);
    expect(p.get('script-src')).toEqual(["'self'"]);
    expect([...p.keys()].sort()).toEqual(['default-src', 'script-src']);
    expect(DAG_WORKER_PATH.test('/assets/dag.worker-DKylClzY.js')).toBe(true);
    expect(DAG_WORKER_PATH.test('/assets/dag.worker-x.js/../index.js')).toBe(false);
    const app = makeApp(makeConfig());
    const worker = await app.request('/assets/dag.worker-DKylClzY.js');
    expect(worker.headers.get('content-security-policy')).toBe(DAG_WORKER_CSP);
    cleanupDirs();
  });
});

describe('player page policy (/play, published builds)', () => {
  it('is strict, reads only the cooked-package hosts and may be embedded', () => {
    const p = parsePolicy(PLAY_CSP);
    expect(p.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"].sort());
    expect(p.get('connect-src')).toEqual(["'self'", 'blob:', 'data:', ...COOKED_HOSTS].sort());
    // The dataset's resolve URLs, and the CDN host its packs redirect to (checked against the live dataset).
    expect([...COOKED_HOSTS].sort()).toEqual(['https://huggingface.co', 'https://us.aws.cdn.hf.co']);
    expect(p.get('object-src')).toEqual(["'none'"]);
    expect(p.get('frame-ancestors')).toEqual(['*']);
    for (const [name, sources] of p) {
      expect(sources, name).not.toContain("'unsafe-eval'");
      if (name !== 'style-src') expect(sources, name).not.toContain("'unsafe-inline'");
      if (name !== 'frame-ancestors' && name !== 'connect-src') for (const s of sources) expect(s, `${name} ${s}`).not.toMatch(/^https?:|\*/);
    }
    // The generation lanes fetch the packs from their worker, which is served under /assets/ with the studio policy.
    for (const h of COOKED_HOSTS) expect(serverPolicy().get('connect-src'), h).toContain(h);
    // A published build's page is the same policy without any third-party host.
    expect(BUILD_PLAY_CSP).toBe(PLAY_CSP.replace(` ${COOKED_HOSTS.join(' ')}`, ''));
  });

  it('is the same on the static deployment and the Node server, which also serves /play', async () => {
    const file = fileURLToPath(new URL('../../../vercel.json', import.meta.url));
    const config = JSON.parse(readFileSync(file, 'utf8')) as { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>; rewrites: Array<{ source: string; destination: string }> };
    const rule = config.headers.find((h) => h.source === '/play(\\.html)?');
    expect(rule?.headers.find((x) => x.key === 'Content-Security-Policy')?.value).toBe(PLAY_CSP);
    expect(rule?.headers.some((x) => x.key === 'X-Frame-Options')).toBe(false);
    expect(config.rewrites[0]).toEqual({ source: '/play', destination: '/play.html' });
    // The page rule does not also apply to /play (two CSP headers would combine).
    const main = new RegExp(`^${config.headers[0]?.source}$`);
    expect(main.test('/play')).toBe(false);
    expect(main.test('/play.html')).toBe(false);
    expect(main.test('/playground')).toBe(true);
    const app = makeApp(makeConfig());
    for (const path of ['/play', '/play.html']) {
      const res = await app.request(path);
      expect(res.headers.get('content-security-policy'), path).toBe(PLAY_CSP);
      expect(res.headers.get('x-frame-options'), path).toBeNull();
    }
    const studio = await app.request('/api/health');
    expect(studio.headers.get('x-frame-options')).toBe('DENY');
    cleanupDirs();
  });
});

describe('asset hub (Hugging Face dataset)', () => {
  it('lets the studio page GET the index, models and thumbnails from Hugging Face and its CDN redirect hosts, and nothing else new', () => {
    const p = serverPolicy();
    expect([...HUB_IMAGE_HOSTS].sort()).toEqual(
      ['https://huggingface.co', 'https://cdn-lfs.huggingface.co', 'https://cdn-lfs-us-1.huggingface.co', 'https://cdn-lfs.hf.co', 'https://cdn-lfs-us-1.hf.co', 'https://cas-bridge.xethub.hf.co'].sort(),
    );
    for (const h of HUB_IMAGE_HOSTS) {
      expect(p.get('connect-src'), h).toContain(h);
      expect(p.get('img-src'), h).toContain(h);
    }
    // Thumbnails only: no hub host may run scripts, load frames, workers or media.
    for (const d of ['script-src', 'worker-src', 'media-src', 'font-src', 'style-src', 'default-src']) expect((p.get(d) ?? []).filter((s) => /huggingface|hf\.co/.test(s)), d).toEqual([]);
  });

  it('keeps published builds closed: they embed the hub models they use and never talk to Hugging Face', () => {
    expect(BUILD_PLAY_CSP).not.toMatch(/huggingface|hf\.co/);
    expect(parsePolicy(BUILD_PLAY_CSP).get('connect-src')).toEqual(["'self'", 'blob:', 'data:'].sort());
    expect(parsePolicy(PLAY_CSP).get('img-src')).toEqual(["'self'", 'data:', 'blob:'].sort());
    expect(readFileSync(fileURLToPath(new URL('../../studio/src/publish/gameBuild.ts', import.meta.url)), 'utf8')).not.toMatch(/Content-Security-Policy[^\n]*huggingface/i);
  });
});
