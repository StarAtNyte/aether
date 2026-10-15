import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main } from '../src/cli';
import { splitBundle, stringifyBundle, createProof, type Proof } from '../src/index';
import { failingWorld, passingWorld } from './fixtures';

let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aether-verify-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  return main(args, { out: (t) => out.push(t), err: (t) => err.push(t) }).then((code) => ({ code, out: out.join('\n'), err: err.join('\n') }));
}

describe('aether-verify CLI', () => {
  it('prints usage and exits 2 without arguments, 0 for --help', async () => {
    expect((await run([])).code).toBe(2);
    const h = await run(['--help']);
    expect(h.code).toBe(0);
    expect(h.out).toMatch(/not a formal proof/);
  });

  it('keygen, seal and verify round-trip with exit status 0', async () => {
    const keyFile = join(dir, 'key.json');
    const worldFile = join(dir, 'world.json');
    const proofFile = join(dir, 'proof.json');
    await writeFile(worldFile, JSON.stringify(passingWorld()));
    expect((await run(['keygen', keyFile])).code).toBe(0);
    const sealed = await run(['seal', worldFile, '--out', proofFile, '--key', keyFile]);
    expect(sealed.code).toBe(0);
    expect(sealed.out).toMatch(/signed/);
    const r = await run(['--json', proofFile]);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.out) as { status: string; playable: boolean; signature: { valid: boolean } };
    expect(parsed.status).toBe('verified');
    expect(parsed.playable).toBe(true);
    expect(parsed.signature.valid).toBe(true);
    const text = await run([proofFile]);
    expect(text.out).toMatch(/VERIFIED/);
    expect(text.out).toMatch(/not tied to an identity/);
  });

  it('a tampered proof file exits 1 and says so', async () => {
    const worldFile = join(dir, 'w2.json');
    const proofFile = join(dir, 'p2.json');
    await writeFile(worldFile, JSON.stringify(failingWorld()));
    expect((await run(['seal', worldFile, '--out', proofFile])).code).toBe(0);
    const bundle = JSON.parse(await readFile(proofFile, 'utf8')) as Proof & { world: unknown };
    bundle.claim.passed = true;
    await writeFile(proofFile, JSON.stringify(bundle));
    const r = await run([proofFile]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/NOT VERIFIED \(tampered\)/);
  });

  it('verifies against a separate world file and rejects a different one', async () => {
    const wA = join(dir, 'a.json');
    const wB = join(dir, 'b.json');
    const proofFile = join(dir, 'ab.json');
    await writeFile(wA, JSON.stringify(passingWorld()));
    await writeFile(wB, JSON.stringify(failingWorld()));
    const proof = await createProof(passingWorld());
    await writeFile(proofFile, stringifyBundle(proof));
    expect((await run([proofFile, '--world', wA])).code).toBe(0);
    const bad = await run([proofFile, '--world', wB]);
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/world-mismatch/);
  });

  it('reads a game.json (world and proof inside) and a build directory', async () => {
    const world = passingWorld();
    const proof = await createProof(world);
    await writeFile(join(dir, 'game.json'), JSON.stringify({ format: 'aether-game', v: 1, title: 'T', world, proof }));
    expect((await run([join(dir, 'game.json')])).code).toBe(0);
    expect((await run([dir])).code).toBe(0);
  });

  it('exits 2 for unreadable input and for files without a proof', async () => {
    expect((await run([join(dir, 'missing.json')])).code).toBe(2);
    await writeFile(join(dir, 'junk.json'), '{ nope');
    expect((await run([join(dir, 'junk.json')])).code).toBe(2);
    await writeFile(join(dir, 'noproof.json'), JSON.stringify({ hello: 1 }));
    expect((await run([join(dir, 'noproof.json')])).code).toBe(2);
  });

  it('--no-replay checks integrity only and says so', async () => {
    const world = passingWorld();
    await writeFile(join(dir, 'ip.json'), stringifyBundle(await createProof(world), world));
    const r = await run([join(dir, 'ip.json'), '--no-replay']);
    expect(r.out).toMatch(/INTACT/);
    expect(r.out).toMatch(/not re-simulated/);
  });
});

describe('splitBundle', () => {
  it('separates the world from a proof, and finds proofs in games and share payloads', () => {
    expect(splitBundle({ format: 'aether-proof', worldDoc: { a: 1 }, x: 2 })).toEqual({ proof: { format: 'aether-proof', x: 2 }, world: { a: 1 }, from: 'proof' });
    expect(splitBundle({ format: 'aether-game', world: 1, proof: 2 })?.from).toBe('game');
    expect(splitBundle({ format: 'aether-game', world: 1 })).toBeNull();
    expect(splitBundle({ world: 1, proof: 2 })?.from).toBe('share');
    expect(splitBundle([])).toBeNull();
    expect(splitBundle(null)).toBeNull();
  });
});
