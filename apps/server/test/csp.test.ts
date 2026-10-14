/**
 * The static deployment (vercel.json) and the Node server must send the same
 * Content-Security-Policy, and that policy must stay strict: no inline or
 * eval'd scripts, and the only wildcard is the visitor's own loopback bridge.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BYOK_ORIGINS } from '../../studio/src/ai/byokCatalog';
import { BYOK_API_HOSTS, CSP_DIRECTIVES, DAG_WORKER_CSP, DAG_WORKER_PATH, SANDBOX_WORKER_CSP, SANDBOX_WORKER_PATH, VERIFY_WORKER_CSP, VERIFY_WORKER_PATH } from '../src/middleware';
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
    expect(rules.map((r) => r.source)).toEqual(['/((?!assets/sandbox\\.worker-|assets/verify\\.worker-|assets/dag\\.worker-).*)', '/assets/sandbox.worker-(.*)', '/assets/verify.worker-(.*)', '/assets/dag.worker-(.*)']);
    expect(rules[1]?.headers.find((x) => x.key === 'Content-Security-Policy')?.value).toBe(SANDBOX_WORKER_CSP);
    expect(rules[2]?.headers.find((x) => x.key === 'Content-Security-Policy')?.value).toBe(VERIFY_WORKER_CSP);
    // Both worker rules keep the other security headers of the page.
    expect(rules[3]?.headers.find((x) => x.key === 'Content-Security-Policy')?.value).toBe(DAG_WORKER_CSP);
    expect(rules[2]?.headers.map((x) => x.key).sort()).toEqual(rules[1]?.headers.map((x) => x.key).sort());
    expect(rules[3]?.headers.map((x) => x.key).sort()).toEqual(rules[1]?.headers.map((x) => x.key).sort());
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
