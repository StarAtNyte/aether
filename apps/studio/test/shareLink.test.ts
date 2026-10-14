import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { decodeWorldToken, encodeWorldToken, fromBase64Url, MAX_LINK_TOKEN, toBase64Url, viewerUrl } from '../src/lib/shareLink';
import { MAX_VIEW_HASH, parseRoute, routeHash } from '../src/lib/router';
import { createStarterWorld } from '../src/lib/starterWorld';

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe('share links (world in the URL fragment)', () => {
  it('round-trips the starter world through a compact token', async () => {
    const world = createStarterWorld();
    const token = await encodeWorldToken(world);
    expect(token).not.toBeNull();
    if (!token) return;
    expect(token.startsWith('z1.')).toBe(true);
    expect(token).toMatch(/^z1\.[A-Za-z0-9_-]+$/);
    // Compression pays: far smaller than the JSON.
    expect(token.length).toBeLessThan(JSON.stringify(world).length / 2);
    const r = await decodeWorldToken(token);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.world).toEqual(world);
    // The viewer route carries the token unchanged.
    const url = viewerUrl(token, { origin: 'https://example.test', pathname: '/' });
    const hash = url.slice(url.indexOf('#'));
    expect(parseRoute(hash)).toEqual({ name: 'view', token });
    expect(routeHash({ name: 'view', token })).toBe(hash);
  });

  it('accepts the uncompressed j1 form', async () => {
    const world = createWorld({ name: 'Plain' });
    const token = `j1.${toBase64Url(new TextEncoder().encode(JSON.stringify(world)))}`;
    const r = await decodeWorldToken(token);
    expect(r.ok && r.world.name).toBe('Plain');
  });

  it('refuses worlds that do not fit in a link', async () => {
    expect(await encodeWorldToken(createStarterWorld(), 40)).toBeNull();
  });

  it('rejects malformed, oversized and hostile tokens without throwing', async () => {
    for (const bad of ['', 'z1.', 'x1.abc', 'z1.ab$cd', 'z1.a', `z1.${'A'.repeat(MAX_LINK_TOKEN + 10)}`, 'j1.bm90IGpzb24']) {
      const r = await decodeWorldToken(bad);
      expect(r.ok).toBe(false);
    }
    // Valid deflate, but garbage inside.
    const junk = `z1.${toBase64Url(await deflateRaw(new TextEncoder().encode('{"entities":{"__proto__":{"x":1}}}')))}`;
    expect((await decodeWorldToken(junk)).ok).toBe(false);
  });

  it('stops a decompression bomb at the size cap', async () => {
    const bomb = await deflateRaw(new Uint8Array(2 * 1024 * 1024).fill(32));
    expect(bomb.byteLength).toBeLessThan(10_000);
    const r = await decodeWorldToken(`z1.${toBase64Url(bomb)}`, 64 * 1024);
    expect(r).toEqual({ ok: false, error: 'The world in this link is too large.' });
  });

  it('base64url helpers round-trip and reject bad input', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const s = toBase64Url(bytes);
    expect(s).not.toMatch(/[+/=]/);
    expect(Array.from(fromBase64Url(s) ?? [])).toEqual(Array.from(bytes));
    expect(fromBase64Url('a')).toBeNull();
    expect(fromBase64Url('ab+c')).toBeNull();
  });

  it('routes only well-formed viewer hashes', () => {
    expect(parseRoute('#/view/')).toEqual({ name: 'home' });
    expect(parseRoute('#/view/z1.abc/extra')).toEqual({ name: 'home' });
    expect(parseRoute('#/view/q9.abc')).toEqual({ name: 'home' });
    expect(parseRoute('#/view/z1.<script>')).toEqual({ name: 'home' });
    expect(parseRoute(`#/view/z1.${'a'.repeat(MAX_VIEW_HASH)}`)).toEqual({ name: 'home' });
    expect(parseRoute('#/view/z1.AbC-_9')).toEqual({ name: 'view', token: 'z1.AbC-_9' });
  });
});
