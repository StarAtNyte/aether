import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateWorld, type WorldDoc } from '@aether/core';
import { readZip } from '@aether/assets/zip';
import { checkProof, createProof, worldHash, type Proof } from '@aether/verifier';
import { buildGame, publishedIndexHtml, sealStamp } from '../src/publish/gameBuild';
import { gameJson, parseGameManifest } from '../src/publish/manifest';
import { decodeShare, encodeShare, MAX_LINK_PROOF_CHARS, shareUrl, shareValueFromHash } from '../src/publish/share';
import { claimedPlayable, stateOfCheck } from '../src/player/ProofBadge';

const TEMPLATES = new URL('../public/templates/worlds/', import.meta.url);

function template(slug: string): WorldDoc {
  const raw = JSON.parse(readFileSync(new URL(`${slug}.json`, TEMPLATES), 'utf8')) as { world: unknown };
  const r = validateWorld(raw.world);
  if (!r.ok) throw new Error(`${slug}: invalid`);
  return r.world;
}

const PLAY_HTML = '<!doctype html><html><head><meta charset="UTF-8" /><meta name="description" content="x" /><title>p</title></head><body></body></html>';

function fakeFetch(): (path: string) => Promise<Uint8Array> {
  return async (path) => {
    const enc = new TextEncoder();
    if (path === 'play-manifest.json') return enc.encode(JSON.stringify({ version: 1, entry: 'play.html', files: ['assets/play.js', 'play.html'] }));
    if (path === 'play.html') return enc.encode(PLAY_HTML);
    return enc.encode(`file:${path}`);
  };
}

describe('the world hash survives publishing', () => {
  it('every bundled template hashes identically after game.json and after a share link round trip', async () => {
    const slugs = readdirSync(TEMPLATES)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
    expect(slugs.length).toBeGreaterThan(20);
    for (const slug of slugs) {
      const world = template(slug);
      const want = worldHash(world);
      const game = parseGameManifest(JSON.parse(gameJson({ title: slug, description: '', author: '', controls: '', music: null, world })));
      expect(game.ok, slug).toBe(true);
      if (game.ok) expect(worldHash(game.game.world), `${slug} via game.json`).toBe(want);
      const enc = await encodeShare(world);
      const dec = await decodeShare(enc.value);
      expect(dec.ok, slug).toBe(true);
      if (dec.ok) expect(worldHash(dec.payload.world), `${slug} via share link`).toBe(want);
    }
  });
});

describe('sealed game builds', () => {
  it('ships the proof in game.json, proof.json, the page meta and the share card, and the viewer verifies it', async () => {
    const world = template('domino-run');
    const proof = await createProof(world);
    const stamps: Array<string | undefined> = [];
    const b = await buildGame({
      world,
      title: 'Domino run',
      description: '',
      author: '',
      controls: 'x',
      music: null,
      cover: new Blob([new Uint8Array([1])], { type: 'image/png' }),
      proof,
      fetchFile: fakeFetch(),
      images: { crop: async (_i, w, h, stamp) => (stamps.push(stamp), new Uint8Array([w & 255, h & 255])) },
      now: 1,
    });
    expect(b.files).toContain('proof.json');
    const zip = await readZip(b.zip);
    if (!zip.ok) throw new Error('unreadable zip');
    const text = (name: string): string => new TextDecoder().decode(zip.entries.find((e) => e.name === name)?.data);
    const parsed = parseGameManifest(JSON.parse(text('game.json')));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.game.proof).toEqual(JSON.parse(JSON.stringify(proof)));
    expect(JSON.parse(text('proof.json'))).toEqual(JSON.parse(JSON.stringify(proof)));
    expect(text('index.html')).toContain(`<meta name="aether:proof" content="${proof.hash}"`);
    expect(text('README.md')).toMatch(/not a formal proof/);
    expect(stamps[0]).toBe(`Replay-sealed · ${proof.hash.slice(7, 15)}`);
    expect(stamps.slice(0, 2).every((s) => s === stamps[0])).toBe(true);
    // What the player does on "Check it yourself":
    const check = await checkProof(parsed.game.proof, parsed.game.world);
    expect(check.status).toBe('verified');
    expect(stateOfCheck(check)).toBe('verified');
  });

  it('an unsealed build is unchanged: no proof file, no meta, no stamp', async () => {
    const world = template('coin-rush');
    const stamps: Array<string | undefined> = [];
    const b = await buildGame({ world, title: 't', description: '', author: '', controls: 'x', music: null, cover: new Blob([new Uint8Array([1])]), fetchFile: fakeFetch(), images: { crop: async (_i, _w, _h, s) => (stamps.push(s), new Uint8Array([1])) } });
    expect(b.files).not.toContain('proof.json');
    expect(stamps.every((s) => s === undefined)).toBe(true);
    const zip = await readZip(b.zip);
    if (!zip.ok) throw new Error('unreadable zip');
    expect(new TextDecoder().decode(zip.entries.find((e) => e.name === 'index.html')?.data)).not.toContain('aether:proof');
  });

  it('a build edited after sealing fails the viewer check', async () => {
    const world = template('domino-bell');
    const proof = await createProof(world);
    const edited = JSON.parse(JSON.stringify(world)) as WorldDoc;
    edited.name = `${edited.name} (edited)`;
    const parsed = parseGameManifest(JSON.parse(gameJson({ title: 't', description: '', author: '', controls: '', music: null, world: edited, proof })));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const check = await checkProof(parsed.game.proof, parsed.game.world);
    expect(check.status).toBe('world-mismatch');
    expect(stateOfCheck(check)).toBe('mismatch');
  });

  it('only a passing proof earns a stamp or page meta', () => {
    const bad = { hash: `sha256:${'a'.repeat(64)}`, claim: { passed: false } };
    expect(sealStamp(bad)).toBeUndefined();
    expect(sealStamp(undefined)).toBeUndefined();
    expect(publishedIndexHtml(PLAY_HTML, { title: 't', description: 'd', proof: bad })).not.toContain('aether:proof');
    expect(publishedIndexHtml(PLAY_HTML, { title: 't', description: 'd', proof: { hash: 'sha256:<script>', claim: { passed: true } } })).not.toContain('aether:proof');
  });
});

describe('sealed share links', () => {
  it('carries the proof in the fragment and the receiving page can verify it', async () => {
    const world = template('domino-run');
    const proof = await createProof(world);
    const enc = await encodeShare(world, { title: 'Run' }, proof);
    expect(enc.sealed).toBe(true);
    const url = shareUrl('https://example.test/play', enc.value);
    const value = shareValueFromHash(new URL(url).hash);
    const dec = await decodeShare(value ?? '');
    expect(dec.ok).toBe(true);
    if (!dec.ok) return;
    expect(claimedPlayable(dec.payload.proof)).toBe(true);
    expect((await checkProof(dec.payload.proof, dec.payload.world)).playable).toBe(true);
  });

  it('a proof too large for a link is left out, and a link without one decodes without one', async () => {
    const world = template('coin-rush');
    const huge = { format: 'aether-proof', pad: 'x'.repeat(MAX_LINK_PROOF_CHARS + 1) };
    const enc = await encodeShare(world, {}, huge);
    expect(enc.sealed).toBe(false);
    const dec = await decodeShare(enc.value);
    expect(dec.ok && dec.payload.proof === undefined).toBe(true);
  });

  it('a forged proof inside a link is reported, not trusted', async () => {
    const world = template('domino-bell');
    const proof = (await createProof(world)) as Proof;
    const forged = JSON.parse(JSON.stringify(proof)) as Proof;
    forged.claim.passed = true;
    forged.claim.simulatedSeconds = 99;
    const enc = await encodeShare(world, {}, forged);
    const dec = await decodeShare(enc.value);
    expect(dec.ok).toBe(true);
    if (!dec.ok) return;
    const check = await checkProof(dec.payload.proof, dec.payload.world);
    expect(check.ok).toBe(false);
    expect(['tampered', 'invalid']).toContain(check.status);
  });
});

describe('badge helpers', () => {
  it('claimedPlayable reads only the cheap claim', () => {
    expect(claimedPlayable({ claim: { passed: true } })).toBe(true);
    expect(claimedPlayable({ claim: { passed: false } })).toBe(false);
    expect(claimedPlayable(null)).toBe(false);
    expect(claimedPlayable('x')).toBe(false);
    expect(claimedPlayable({ claim: 3 })).toBe(false);
  });
});
