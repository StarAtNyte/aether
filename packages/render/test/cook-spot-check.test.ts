import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateBuiltinSync, validateOutput, type GeneratorOutput } from '@aether/procgen';
import { parseCookManifest, type LaneCookConfig } from '../src/cook/format';
import { prepareOutputParts, preparePart } from '../src/geometry/buffer-geometry';
import { ddcKey } from '../src/geometry/ddc';
import { codecReady, decodeInner, encodeInner, packEntry } from '../src/geometry/ddc-codec';
import { geometryFingerprint } from '../src/geometry/fingerprint';
import { parseGenReply } from '../src/geometry/gen-protocol';
import { prepareSoft } from '../src/geometry/soften';

/** A boulder as a lane prepares it. */
function boulder(seed: number): GeneratorOutput {
  const v = validateOutput(generateBuiltinSync('boulder', {}, seed));
  if (!v.ok) throw new Error(v.error);
  prepareOutputParts(v.output.parts);
  for (const p of v.output.parts) prepareSoft(p, preparePart);
  return v.output;
}

/** The stored entry of an output (ddc-codec format 2) and the fingerprint of what it decodes to. */
async function entryOf(out: GeneratorOutput): Promise<{ bytes: Uint8Array; fingerprint: string }> {
  await codecReady();
  const inner = encodeInner(out);
  const fingerprint = geometryFingerprint(decodeInner(inner.inner));
  return { bytes: new Uint8Array(await (await packEntry(inner)).blob.arrayBuffer()), fingerprint };
}

describe('geometry fingerprints', () => {
  it('ignore the generation time and last-bit noise, and change with the geometry', () => {
    const a = boulder(3);
    const fp = geometryFingerprint(a);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(geometryFingerprint({ ...a, stats: { ...a.stats, ms: a.stats.ms + 50 } })).toBe(fp);
    const noisy = boulder(3);
    const p = noisy.parts[0]!.positions;
    for (let i = 0; i < p.length; i++) p[i] = p[i]! * (1 + 1e-7);
    expect(geometryFingerprint(noisy)).toBe(fp);
    const moved = boulder(3);
    moved.parts[0]!.positions[0]! += 0.05;
    expect(geometryFingerprint(moved)).not.toBe(fp);
    expect(geometryFingerprint(boulder(4))).not.toBe(fp);
  });

  it('travel in the manifest, checked like the rest of it', () => {
    const base = { format: 2, irHash: 'a'.repeat(64), genVersion: 'x.p3.e2', dir: '0123456789abcdef/', cookedAt: '', world: { id: 'w', name: 'W', entities: 1 }, opening: null, startMode: 'orbit', profile: 'showcase', partition: null, cells: [{ key: 'p', bounds: null, entries: 1, bytes: 64, packs: [0] }], packs: [{ file: 'packs/0000.bin', bytes: 64 }], entries: { ['b'.repeat(64)]: [0, 0, 64, 0] }, programs: {}, lightmap: null };
    const ok = parseCookManifest({ ...base, fingerprints: { ['b'.repeat(64)]: '0123456789abcdef' } });
    expect(ok.ok && ok.manifest.fingerprints).toEqual({ ['b'.repeat(64)]: '0123456789abcdef' });
    expect(parseCookManifest({ ...base, fingerprints: { ['c'.repeat(64)]: '0123456789abcdef' } }).ok).toBe(false);
    expect(parseCookManifest({ ...base, fingerprints: { ['b'.repeat(64)]: 'nothex' } }).ok).toBe(false);
    expect(parseCookManifest(base).ok).toBe(true);
  });
});

interface LaneHarness {
  post(msg: unknown): void;
  notices: Array<Record<string, unknown>>;
  replies: Array<Record<string, unknown>>;
}

/** The real generation lane (gen.worker.ts) in this process: no geometry cache (no Cache Storage in Node), packs from `pack`. */
async function lane(pack: Uint8Array): Promise<LaneHarness> {
  vi.resetModules();
  const notices: Array<Record<string, unknown>> = [];
  const replies: Array<Record<string, unknown>> = [];
  const scope = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    location: { href: 'http://lane.test/' },
    postMessage(m: Record<string, unknown>) {
      if (m.type === 'result') replies.push(m);
      else if (m.type !== 'ready') notices.push(m);
    },
  };
  vi.stubGlobal('self', scope);
  vi.stubGlobal('fetch', async () => new Response(pack.slice().buffer));
  await import('../src/geometry/gen.worker');
  return { post: (data) => scope.onmessage?.({ data } as MessageEvent), notices, replies };
}

async function until(cond: () => boolean, ms = 6000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Serve one boulder request from a package holding `entry`, and wait past the spot check. */
async function serve(entry: { bytes: Uint8Array; fingerprint?: string }, spotChecks?: number): Promise<LaneHarness> {
  const key = await ddcKey('boulder-key');
  const pad = new Uint8Array(Math.ceil(entry.bytes.byteLength / 8) * 8);
  pad.set(entry.bytes);
  const l = await lane(pad);
  const config: LaneCookConfig = {
    index: { packs: ['http://pack.test/0000.bin'], entries: { [key]: [0, 0, entry.bytes.byteLength, 0] }, ...(entry.fingerprint ? { fingerprints: { [key]: entry.fingerprint } } : {}) },
    ...(spotChecks !== undefined ? { spotChecks } : {}),
  };
  l.post({ type: 'cook', config });
  l.post({ type: 'gen', id: 1, key: 'boulder-key', generator: 'boulder', params: {}, seed: 3 });
  await until(() => l.replies.length > 0);
  expect(l.replies[0]).toMatchObject({ ok: true, hit: true, cooked: true });
  await new Promise((r) => setTimeout(r, 2500));
  return l;
}

describe('the spot check of a cooked package', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes when the package holds what the generator makes now', async () => {
    const l = await serve(await entryOf(boulder(3)));
    expect(l.notices).toEqual([]);
  });

  it('reports a package whose geometry the generator no longer makes (the code version missed a change)', async () => {
    // The package was cooked from other geometry under the same key: what a too-narrow version would serve.
    const stale = await entryOf(boulder(9));
    const l = await serve(stale);
    expect(l.notices).toHaveLength(1);
    const m = parseGenReply(l.notices[0]);
    expect(m).toMatchObject({ type: 'cook-mismatch', generator: 'boulder', expected: stale.fingerprint });
    expect(m && 'got' in m && m.got).toBe((await entryOf(boulder(3))).fingerprint);
    // The lane stopped reading the package: the same request now generates.
    l.post({ type: 'gen', id: 2, key: 'boulder-key', generator: 'boulder', params: {}, seed: 3 });
    await until(() => l.replies.length > 1);
    expect(l.replies[1]).toMatchObject({ ok: true, hit: false });
  });

  it('compares against the served entry when the manifest has no fingerprints', async () => {
    const { bytes } = await entryOf(boulder(9));
    const l = await serve({ bytes });
    expect(l.notices.map((n) => n.type)).toEqual(['cook-mismatch']);
  });

  it('runs no check when spot checks are off', async () => {
    const { bytes } = await entryOf(boulder(9));
    const l = await serve({ bytes }, 0);
    expect(l.notices).toEqual([]);
  });
});
