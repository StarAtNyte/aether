/**
 * The static deployment (vercel.json) and the Node server must send the same
 * Content-Security-Policy, and that policy must stay strict: no inline or
 * eval'd scripts, and the only wildcard is the visitor's own loopback bridge.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CSP_DIRECTIVES } from '../src/middleware';

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
