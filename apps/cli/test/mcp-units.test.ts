/**
 * Units of the MCP server: the project-folder guard, safe error text, the
 * loopback-only fetch, the software renderer, the PNG and glTF writers, the
 * playtest objective finder and the `aether mcp` arguments.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { NodeIO } from '@gltf-transform/core';
import { createWorld, applyPatches, type WorldDoc } from '@aether/core';
import { afterAll, describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args';
import { ToolError, safeMessage, scrub } from '../src/mcp/errors';
import { ProjectDir, safeFileName } from '../src/mcp/fsguard';
import { sceneToGlb } from '../src/mcp/gltf';
import { encodePng } from '../src/mcp/png';
import { findObjectives } from '../src/mcp/playtest';
import { loopbackFetch, offlineProvider, resolveProvider } from '../src/mcp/provider';
import { frameBounds, renderStill } from '../src/mcp/raster';
import { buildScene } from '../src/mcp/scene';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'aether-mcpu-'));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function world(patches: unknown[]): WorldDoc {
  const r = applyPatches(createWorld(), patches, { atomic: true });
  expect(r.errors).toEqual([]);
  return r.world;
}

const box = (id: string, p: [number, number, number], color = '#cc3333', extra: Record<string, unknown> = {}): unknown => ({
  op: 'add',
  entity: { id, shape: { kind: 'primitive', primitive: 'box', size: [2, 2, 2] }, transform: { position: p }, material: { color }, ...extra },
});

describe('file names and the project folder', () => {
  it('reduces any name to a short safe file name', () => {
    expect(safeFileName('../../etc/passwd', 'x')).toBe('passwd');
    expect(safeFileName('..\\..\\evil.GLB', 'x')).toBe('evil.glb');
    expect(safeFileName('My Cool World!!', 'x')).toBe('my-cool-world');
    expect(safeFileName('...', 'fallback')).toBe('fallback');
    expect(safeFileName('a'.repeat(200), 'x').length).toBeLessThanOrEqual(64);
    expect(safeFileName('con\u0000trol', 'x')).not.toContain('\u0000');
  });

  it('writes atomically inside the folder and reads back; size caps apply', () => {
    const p = new ProjectDir(join(tmp(), 'p'));
    expect(p.write('exports', 'a.txt', 'hello', 100)).toBe('exports/a.txt');
    expect(p.readText('exports', 'a.txt', 100)).toBe('hello');
    expect(p.readText('exports', 'missing.txt', 100)).toBeNull();
    expect(() => p.write('exports', 'big.txt', 'x'.repeat(101), 100)).toThrow(/limit/);
    expect(() => p.readText('exports', 'a.txt', 2)).toThrow(ToolError);
  });

  it('denies traversal and symbolic links', () => {
    const outside = tmp();
    const p = new ProjectDir(join(tmp(), 'p'));
    expect(() => p.write('exports', '../escape.txt', 'x', 100)).toThrow(/outside/);
    expect(() => p.write('exports', '/etc/escape.txt', 'x', 100)).toThrow(/outside/);
    mkdirSync(join(p.root, 'renders'));
    symlinkSync(outside, join(p.root, 'renders', 'linkdir'));
    expect(() => p.write('renders', 'linkdir/f.txt', 'x', 100)).toThrow(/outside/);
    writeFileSync(join(outside, 'target'), 'secret');
    symlinkSync(join(outside, 'target'), join(p.root, 'renders', 'file-link.txt'));
    expect(() => p.write('renders', 'file-link.txt', 'x', 100)).toThrow(/outside|symbolic link/);
    expect(readFileSync(join(outside, 'target'), 'utf8')).toBe('secret');
  });
});

describe('error text', () => {
  it('shows only ToolError messages, scrubbed of paths and control characters', () => {
    const m = safeMessage(new ToolError('not_found', 'no file /home/alice/secret/project/x.json\u0007 here'));
    expect(m.code).toBe('not_found');
    expect(m.message).not.toMatch(/alice|\u0007/);
    expect(safeMessage(new Error('ENOENT /home/alice/x/y/z leaked stack')).message).toBe('Internal error. The server logged the details to its stderr.');
    expect(safeMessage(Object.assign(new Error('x'), { name: 'TimeoutError' })).code).toBe('timeout');
  });

  it('hides the project folder and caps the length', () => {
    expect(scrub('failed in /work/proj-x/exports', ['/work/proj-x'])).toBe('failed in <project>/exports');
    expect(scrub('a'.repeat(5000)).length).toBeLessThan(700);
    expect(scrub('C:\\Users\\bob\\file.txt broke')).toContain('<path>');
  });
});

describe('local AI access', () => {
  it('only ever contacts the loopback Aether server, with the secret, and never follows redirects', async () => {
    const seen: Array<{ url: string; admin: string | null; redirect: string | undefined }> = [];
    const inner = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(input), admin: new Headers(init?.headers).get('x-aether-admin'), redirect: init?.redirect });
      return new Response('{}');
    }) as typeof fetch;
    const f = loopbackFetch(4280, 'S'.repeat(43), inner);
    await f('http://127.0.0.1:4280/api/local/status');
    expect(seen[0]).toEqual({ url: 'http://127.0.0.1:4280/api/local/status', admin: 'S'.repeat(43), redirect: 'error' });
    for (const bad of ['https://example.com/api/local/status', 'http://127.0.0.1:4281/api/local/status', 'http://127.0.0.1:4280/api/other', 'http://localhost:4280/api/local/x']) {
      await expect(f(bad)).rejects.toThrow(/local Aether server/);
    }
    expect(seen).toHaveLength(1);
  });

  it('falls back to the offline planner when no server runs (auto), and refuses in local mode with advice', async () => {
    const stateDir = tmp();
    expect((await resolveProvider('auto', { stateDir })).kind).toBe('offline');
    expect((await resolveProvider('offline', { stateDir })).label).toBe('offline planner');
    await expect(resolveProvider('local', { stateDir })).rejects.toThrow(/aether start/);
    expect(offlineProvider().provider.name).toBeTruthy();
  });
});

describe('objectives', () => {
  it('finds pickups, rule zones and goals; a named goal replaces them', () => {
    const w = world([
      box('coin-a', [3, 1, 0], '#ffcc00', { behaviors: [{ type: 'collectible', params: {} }] }),
      box('zone-a', [0, 1, 9], '#2288ff', { tags: ['zone'] }),
      box('flag', [0, 1, -9], '#ffffff', { behaviors: [{ type: 'goal', params: {} }] }),
      { op: 'addRule', rule: { id: 'enter-zone', when: { on: 'enter', zone: 'zone-a' }, then: [{ do: 'message', text: 'hi' }] } },
    ]);
    expect(findObjectives(w).map((o) => `${o.kind}:${o.id}`)).toEqual(['pickup:coin-a', 'zone:zone-a', 'goal:flag']);
    expect(findObjectives(w, 'flag').map((o) => `${o.kind}:${o.id}`)).toEqual(['target:flag']);
    expect(findObjectives(createWorld())).toEqual([]);
  });
});

describe('software renderer', () => {
  const w = world([box('a', [0, 1, 0]), box('b', [4, 1, 1], '#3366cc'), { op: 'setEnvironment', set: { sky: 'day' } }]);

  it('is deterministic and draws sky, ground and the objects', async () => {
    const scene = await buildScene(w, { maxTriangles: 100_000 });
    expect(scene.triangles).toBe(24);
    const a = renderStill(scene, w.environment, { width: 160, height: 100, pitchDeg: 4 });
    const b = renderStill(scene, w.environment, { width: 160, height: 100, pitchDeg: 4 });
    expect(Buffer.from(a.rgba).equals(Buffer.from(b.rgba))).toBe(true);
    const px = (x: number, y: number): number[] => Array.from(a.rgba.subarray((y * 160 + x) * 4, (y * 160 + x) * 4 + 3));
    const top = px(80, 2);
    const bottom = px(80, 97);
    expect(top[2]).toBeGreaterThan(top[0] as number); // blue-ish sky
    expect(bottom[1]).toBeGreaterThan(bottom[2] as number); // green-ish ground
    const colors = new Set<string>();
    for (let y = 0; y < 100; y += 3) for (let x = 0; x < 160; x += 3) colors.add(px(x, y).join(','));
    expect(colors.size).toBeGreaterThan(25);
  });

  it('shades by the sun: the sunlit side is brighter than the shadowed side', async () => {
    const one = world([box('c', [0, 1, 0], '#cccccc'), { op: 'setEnvironment', set: { sky: 'day', ground: null } }]);
    const scene = await buildScene(one, { maxTriangles: 100_000 });
    const lit = renderStill(scene, one.environment, { width: 120, height: 120, from: [6, 1, 6], lookAt: [0, 1, 0] }); // toward the sun (+x +z)
    const dark = renderStill(scene, one.environment, { width: 120, height: 120, from: [-6, 1, -6], lookAt: [0, 1, 0] });
    const mid = (s: { rgba: Uint8Array }): number => (s.rgba[(60 * 120 + 60) * 4] as number) + (s.rgba[(60 * 120 + 60) * 4 + 1] as number);
    expect(mid(lit)).toBeGreaterThan(mid(dark) + 40);
  });

  it('survives a camera inside the geometry and degenerate input', async () => {
    const scene = await buildScene(w, { maxTriangles: 100_000 });
    const inside = renderStill(scene, w.environment, { width: 64, height: 64, from: [0, 1, 0], lookAt: [4, 1, 1] });
    expect(inside.rgba.length).toBe(64 * 64 * 4);
    const empty = renderStill({ meshes: [], triangles: 0, bounds: null, skipped: [] }, createWorld().environment, { width: 64, height: 48 });
    expect(empty.rgba.length).toBe(64 * 48 * 4);
    expect(() => renderStill(scene, w.environment, { width: 64, height: 64, deadline: Date.now() - 1 })).toThrow(/out of time/);
  });

  it('frames the bulk of the world, ignoring a few far-away objects', async () => {
    const many = world([
      ...Array.from({ length: 20 }, (_, i) => box(`n-${i}`, [i % 5, 1, Math.floor(i / 5)])),
      box('far-cloud', [900, 200, 900]),
    ]);
    const scene = await buildScene(many, { maxTriangles: 100_000 });
    expect(frameBounds(scene).radius).toBeLessThan(60);
  });

  it('respects the triangle budget and lists what it skipped', async () => {
    const scene = await buildScene(w, { maxTriangles: 12 });
    expect(scene.triangles).toBeLessThanOrEqual(12);
    expect(scene.skipped.some((s) => /budget/.test(s.reason))).toBe(true);
    const model = world([{ op: 'add', entity: { id: 'm', shape: { kind: 'model', url: '/x.glb' } } }]);
    expect((await buildScene(model, { maxTriangles: 100 })).skipped[0]?.id).toBe('m');
  });
});

describe('PNG and glTF writers', () => {
  it('writes a valid PNG whose pixels round-trip', () => {
    const rgba = new Uint8Array(4 * 4 * 2);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37) & 255;
    const png = encodePng(rgba, 4, 2);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(4);
    expect(png.readUInt32BE(20)).toBe(2);
    const idatLen = png.readUInt32BE(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    expect(raw.length).toBe((4 * 4 + 1) * 2);
    expect(Array.from(raw.subarray(1, 17))).toEqual(Array.from(rgba.subarray(0, 16)));
    expect(() => encodePng(rgba, 5, 5)).toThrow(RangeError);
  });

  it('writes a glb that glTF tooling reads back: one node per entity, PBR colours', async () => {
    const w = world([box('red', [0, 1, 0], '#ff0000'), box('blue', [3, 1, 0], '#0000ff', { material: { color: '#0000ff', metalness: 0.9 } })]);
    const scene = await buildScene(w, { maxTriangles: 100_000 });
    const out = await sceneToGlb(scene, 'test');
    expect(out.nodes).toBe(2);
    const doc = await new NodeIO().readBinary(out.glb);
    const names = doc.getRoot().listNodes().map((n) => n.getName()).sort();
    expect(names).toEqual(['blue', 'red']);
    const mats = doc.getRoot().listMaterials();
    expect(mats).toHaveLength(2);
    const prim = doc.getRoot().listMeshes()[0]?.listPrimitives()[0];
    expect(prim?.getAttribute('POSITION')?.getCount()).toBeGreaterThan(7);
    expect(prim?.getAttribute('NORMAL')).toBeTruthy();
  });
});

describe('aether mcp arguments', () => {
  it('parses the project folder and provider; rejects bad values', () => {
    const r = parseArgs(['mcp', '--project-dir', '/work/p', '--provider', 'offline', '--player-dir=/x/dist']);
    expect(r.ok && r.options).toMatchObject({ command: 'mcp', projectDir: '/work/p', provider: 'offline', playerDir: '/x/dist' });
    expect(parseArgs(['mcp'], { AETHER_PROJECT_DIR: '/env/p' }).ok && (parseArgs(['mcp'], { AETHER_PROJECT_DIR: '/env/p' }) as { options: { projectDir: string } }).options.projectDir).toBe('/env/p');
    expect(parseArgs(['mcp', '--provider', 'cloud']).ok).toBe(false);
    expect(parseArgs(['mcp', '--project-dir']).ok).toBe(false);
    expect(parseArgs(['mcp']).ok && (parseArgs(['mcp']) as { options: { provider: string } }).options.provider).toBe('auto');
  });
});
