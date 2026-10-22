import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorld, type WorldDoc } from '@aether/core';
import { partKinds } from '@aether/arch';
import { deriveBuild, memoryCaller, parseRoomDescription, runBuild, type RoomDescription } from '@aether/arch/photo';
import { rng } from '@aether/procgen/photo-texture';
import { MemoryHost } from './helpers';
import { MAKE_TEXTURE_TOOL, makeTextureTool, resolveTarget as resolveTextureTarget } from '../src/textures';
import type { ExecutorContext } from '../src/executor';
import type { ImageGenerator } from '../src/images';
import { texturePass, texturePassLine, textureSource } from '../src/photo/texture-pass';
import { createMockProvider } from '../src/providers/mock/index';

const FIXTURE = resolve(__dirname, '../../../tests/fixtures/photo/hotel.description.json');

async function room(): Promise<{ world: WorldDoc; desc: RoomDescription }> {
  const p = parseRoomDescription(JSON.parse(readFileSync(FIXTURE, 'utf8')) as unknown, partKinds());
  if (!p.ok) throw new Error(p.error);
  const mem = memoryCaller(createWorld());
  const built = await runBuild(mem.world(), deriveBuild(p.value), mem.call);
  if (!built.shellOk) throw new Error('shell');
  return { world: mem.world(), desc: p.value };
}

/** A noisy stand-in for a photograph (the geometry and boxes are what the tool needs; real photos run in the example rooms). */
function noisePhoto(w = 640, h = 427): { width: number; height: number; data: Uint8ClampedArray } {
  const r = rng(5);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = 150 + Math.round(r() * 40);
    data[i * 4] = v;
    data[i * 4 + 1] = v - 10;
    data[i * 4 + 2] = v - 25;
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

function ctxFor(host: MemoryHost, extra: Partial<ExecutorContext> = {}): { ctx: ExecutorContext; stored: string[] } {
  const stored: string[] = [];
  host.storeTexture = async (set) => {
    stored.push(set.id);
    return { ok: true };
  };
  host.encodeTextureMap = (_rgba, size) => new Uint8Array(Math.max(16, Math.floor(size / 2)));
  (host as unknown as { decodeImage: unknown }).decodeImage = async () => noisePhoto(256, 256);
  const ctx: ExecutorContext = { host, provider: createMockProvider(), coderSystem: '', builtinGenerators: new Set(), usage: { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0 } as never, ...extra };
  return { ctx, stored };
}

describe('make_texture', () => {
  it('is described for the model with its sources and its honesty rule', () => {
    expect(MAKE_TEXTURE_TOOL.description).toContain('procedural');
    expect(MAKE_TEXTURE_TOOL.description).toContain('photographed');
    expect(MAKE_TEXTURE_TOOL.description.length).toBeLessThan(2600);
  });

  it('resolves floors, walls and pieces, and refuses what it cannot find', async () => {
    const { world } = await room();
    expect(resolveTextureTarget(world, 'floor')).toMatchObject([{ kind: 'floor' }]);
    expect((resolveTextureTarget(world, 'walls') as unknown[]).length).toBe(4);
    expect(resolveTextureTarget(world, 'wall:north')).toMatchObject([{ kind: 'wall', compass: 'north' }]);
    expect(resolveTextureTarget(world, 'bed')).toMatchObject([{ kind: 'piece' }]);
    expect(typeof resolveTextureTarget(world, 'chandelier')).toBe('string');
  });

  it('falls back to the procedural library with no photo and no image model, and says so', async () => {
    const { world } = await room();
    const host = new MemoryHost(world);
    const { ctx, stored } = ctxFor(host, { textures: {} });
    const out = await makeTextureTool(ctx, { target: 'floor', prompt: 'dark walnut boards' });
    expect(out.isError).toBe(false);
    expect(stored).toEqual([]);
    expect(out.content).toContain('procedural');
    expect(out.content).toContain('no image model is connected');
    expect(JSON.stringify(host.world.entities['room-photo-l0-room']?.shape)).toContain('walnut');
  });

  it('samples a described piece from the photo and keeps it as a skin, labelled photographed', async () => {
    const { world, desc } = await room();
    const host = new MemoryHost(world);
    const { ctx, stored } = ctxFor(host, { textures: { photo: { raster: noisePhoto(), description: desc, name: 'hotel.jpg' } } });
    const out = await makeTextureTool(ctx, { target: 'bed', from_photo_region: true });
    expect(out.content).toContain('photographed');
    expect(stored.length).toBe(1);
    const bed = host.world.entities['room-photo-bed'];
    const skins = bed?.arch?.skins ?? {};
    expect(Object.values(skins)[0]?.id).toBe(stored[0]);
    expect(host.world.textures?.[stored[0] as string]?.provenance).toBe('photographed');
  });

  it('puts a photographed wall on the plan so it survives a recompile', async () => {
    const { world, desc } = await room();
    const host = new MemoryHost(world);
    const { ctx, stored } = ctxFor(host, { textures: { photo: { raster: noisePhoto(), description: desc } } });
    const out = await makeTextureTool(ctx, { target: 'wall:north', from_photo_region: true });
    // The noise photo has no readable wall pattern: either the wall was textured (and stored) or the reason is given.
    expect(out.content).toMatch(/photographed|not used/);
    if (stored.length > 0) expect(JSON.stringify(host.world.entities['room-photo']?.arch?.plan)).toContain(stored[0] as string);
  });

  it('draws from the prompt when an image model is connected and labels it AI-generated', async () => {
    const { world, desc } = await room();
    const host = new MemoryHost(world);
    const images: ImageGenerator = { id: 'fake', label: 'fake', generate: async () => ({ dataUrl: 'data:image/png;base64,AAAA', model: 'fake-1', via: 'fake' }) };
    const { ctx, stored } = ctxFor(host, { textures: { images, photo: { raster: noisePhoto(), description: desc } } });
    const out = await makeTextureTool(ctx, { target: 'floor', prompt: 'wide oak planks, matte' });
    expect(out.content).toContain('AI-generated');
    expect(stored.length).toBe(1);
    const def = host.world.textures?.[stored[0] as string];
    expect(def?.provenance).toBe('ai-generated');
    expect(def?.source?.prompt).toContain('oak');
    // The plan carries the set on the floor; the colour is the generated picture's mean.
    expect(JSON.stringify(host.world.entities['room-photo-l0-room']?.shape)).toContain(stored[0] as string);
  });

  it('falls back to the photo, then the library, when the image model fails', async () => {
    const { world, desc } = await room();
    const host = new MemoryHost(world);
    const images: ImageGenerator = { id: 'down', label: 'down', generate: async () => { throw new Error('usage limit'); } };
    const { ctx } = ctxFor(host, { textures: { images, photo: { raster: noisePhoto(), description: desc } } });
    const out = await makeTextureTool(ctx, { target: 'bed', prompt: 'white linen duvet' });
    expect(out.content).toContain('the image model failed');
    expect(out.content).toMatch(/photographed|procedural/);
  });

  it('source procedural removes a texture again', async () => {
    const { world, desc } = await room();
    const host = new MemoryHost(world);
    const { ctx } = ctxFor(host, { textures: { photo: { raster: noisePhoto(), description: desc } } });
    await makeTextureTool(ctx, { target: 'bed', from_photo_region: true });
    const out = await makeTextureTool(ctx, { target: 'bed', source: 'procedural' });
    expect(out.content).toContain('procedural');
    expect(Object.values(host.world.entities['room-photo-bed']?.arch?.skins ?? {})).toEqual([]);
  });

  it('the first texture pass skips cleanly without a store and states what it did with one', async () => {
    const { world, desc } = await room();
    const bare = new MemoryHost(world);
    const none = ctxFor(bare, { textures: {} }).ctx;
    bare.storeTexture = undefined;
    expect(await textureSource(none, 'data:image/png;base64,AA==', desc)).toBeNull();
    const host = new MemoryHost(world);
    const { ctx } = ctxFor(host, { textures: {} });
    const src = await textureSource(ctx, 'data:image/png;base64,AA==', desc);
    expect(src).not.toBeNull();
    const events: unknown[] = [];
    const gen = texturePass(ctx, { ...(src as NonNullable<typeof src>), raster: noisePhoto() });
    let r = await gen.next();
    while (!r.done) {
      events.push(r.value);
      r = await gen.next();
    }
    expect(events.length).toBeGreaterThan(0);
    expect(texturePassLine(r.value)).toMatch(/photograph|No surface|procedural/);
  });
});
