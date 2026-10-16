import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { cleanMeta, decodeShare, encodeShare, fromBase64Url, linkSizeLabel, MAX_FRAGMENT_CHARS, shareUrl, shareValueFromHash, toBase64Url } from '../src/publish/share';
async function deflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}
describe('share links (URL fragment)', () => {
    const world = createWorld({
        name: 'Coin Island',
        entities: {
            ground: { id: 'ground', shape: { kind: 'primitive', primitive: 'box', size: [20, 1, 20] }, transform: { position: [0, -0.5, 0] } },
            coin: { id: 'coin', shape: { kind: 'primitive', primitive: 'cylinder' }, transform: { position: [2, 1, 0] }, tags: ['coin'] },
        },
    });
    it('round-trips a world and its title-screen text', async () => {
        const enc = await encodeShare(world, { title: 'Coin Island', description: 'Collect them all.\nGood luck!', author: 'Me' });
        expect(enc.fits).toBe(true);
        expect(enc.value.startsWith('D')).toBe(true);
        expect(enc.chars).toBe(enc.value.length);
        const url = shareUrl('https://example.org/play', enc.value);
        expect(url).toBe(`https://example.org/play#w=${enc.value}`);
        const back = await decodeShare(shareValueFromHash(new URL(url).hash) ?? '');
        expect(back.ok).toBe(true);
        if (!back.ok)
            return;
        expect(back.payload.world).toEqual(world);
        expect(back.payload.meta).toEqual({ title: 'Coin Island', description: 'Collect them all.\nGood luck!', author: 'Me' });
    });
    it('compresses: the link is much smaller than the JSON', async () => {
        const big = createWorld({
            name: 'Many',
            entities: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`crate-${i}`, { id: `crate-${i}`, shape: { kind: 'primitive', primitive: 'box' }, transform: { position: [i % 20, 0.5, Math.floor(i / 20)] } }])),
        });
        const enc = await encodeShare(big);
        expect(enc.chars).toBeLessThan(enc.jsonBytes / 3);
    });
    it('reads the value among other fragment keys and ignores missing ones', () => {
        expect(shareValueFromHash('#x=1&w=Dabc&y=2')).toBe('Dabc');
        expect(shareValueFromHash('#/p/abc')).toBeNull();
        expect(shareValueFromHash('')).toBeNull();
    });
    it('rejects malformed, oversized and hostile fragments with a message', async () => {
        for (const bad of ['', 'D', 'D!!!!', 'Xabcd', 'J' + toBase64Url(new TextEncoder().encode('{nope'))]) {
            const r = await decodeShare(bad);
            expect(r.ok, bad).toBe(false);
            if (!r.ok)
                expect(r.error.length).toBeGreaterThan(5);
        }
        const huge = await decodeShare('D' + 'A'.repeat(MAX_FRAGMENT_CHARS + 10));
        expect(huge.ok).toBe(false);
        // Not an envelope / unknown keys.
        const odd = await decodeShare('J' + toBase64Url(new TextEncoder().encode(JSON.stringify({ v: 1, world: {}, extra: 1 }))));
        expect(odd.ok).toBe(false);
        // Prototype pollution inside the world.
        const polluted = await decodeShare('J' + toBase64Url(new TextEncoder().encode('{"v":1,"world":{"name":"x","__proto__":{"polluted":true}}}')));
        expect(polluted.ok).toBe(false);
        expect({}['polluted']).toBeUndefined();
        // Invalid world.
        const invalid = await decodeShare('J' + toBase64Url(new TextEncoder().encode(JSON.stringify({ v: 1, world: { entities: { 'Bad Id': {} } } }))));
        expect(invalid.ok).toBe(false);
    });
    it('stops a compression bomb at the inflate cap', async () => {
        // 20 MB of spaces deflate to a few KB.
        const bomb = await deflate(new TextEncoder().encode(`{"v":1,"world":{"name":"${' '.repeat(20 * 1024 * 1024)}"}}`));
        expect(bomb.byteLength).toBeLessThan(100_000);
        const r = await decodeShare('D' + toBase64Url(bomb));
        expect(r.ok).toBe(false);
        if (!r.ok)
            expect(r.error).toMatch(/8 MB/);
    });
    it('cleans title-screen text (control and bidi characters, lengths)', () => {
        const m = cleanMeta({ title: 'A‮B\u0000C  ', description: 'x'.repeat(2000), author: '   ' });
        expect(m.title).toBe('A B C');
        expect(m.description?.length).toBe(600);
        expect(m.author).toBeUndefined();
    });
    it('base64url round-trips arbitrary bytes and rejects junk', () => {
        const bytes = new Uint8Array(1000).map((_, i) => (i * 37) & 0xff);
        expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
        expect(fromBase64Url('a+b/')).toBeNull();
        expect(fromBase64Url('a')).toBeNull();
    });
    it('labels link sizes', () => {
        expect(linkSizeLabel(500)).toBe('500 B');
        expect(linkSizeLabel(40_000)).toBe('39 KB');
        expect(linkSizeLabel(2_000_000)).toBe('1.9 MB');
    });
});
