/**
 * `material.surface` layers and `material.shader` expressions: node graphs that really generate WGSL and GLSL (built
 * headless with three's node builders, no GPU), the tier subsets, the program cap and unchanged plain materials.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene } from 'three';
import { context } from 'three/tsl';
import { GLSLNodeBuilder, Lighting, StandardNodeLibrary, WGSLNodeBuilder } from 'three/webgpu';
import { SURFACE_LAYER_KINDS, type MaterialSpec } from '@aether/core';
import { applyShading, shadedCap, SHADED_CAP_HIGH, SHADED_CAP_LOW, SHADED_CAP_MEDIUM, SHADED_CAP_ULTRA } from '../src/materials/shading';
import { materialKey, mergeMaterial, resolveMaterial } from '../src/materials/presets';
import { MaterialCache } from '../src/materials/material-cache';
import { LAYER_NOISE_PLANES } from '../src/materials/surface-layers';
import type { ShadeTier } from '../src/materials/shader-nodes';
import { log } from '../src/log';

type Slots = { colorNode?: unknown; roughnessNode?: unknown; metalnessNode?: unknown; emissiveNode?: unknown; normalNode?: unknown; opacityNode?: unknown; positionNode?: unknown };

/** Generate the shaders of a material with a node builder against a minimal renderer stand-in. */
function shaders(m: MeshStandardMaterial, glsl = false): { vertex: string; fragment: string } {
  const library = new StandardNodeLibrary();
  const nodeMat = library.fromMaterial(m);
  const geo = new BoxGeometry(1, 1, 1);
  geo.setAttribute('color', geo.getAttribute('position').clone());
  const mesh = new Mesh(geo, nodeMat);
  const renderer = {
    library,
    lighting: new Lighting(),
    contextNode: context(),
    backend: { isWebGPUBackend: !glsl, compatibilityMode: false, capabilities: {}, utils: { getTextureSampleData: () => ({ primarySamples: 1 }) } },
    getRenderTarget: () => null,
    getMRT: () => null,
    getOutputRenderTarget: () => null,
    _currentRenderContext: null,
    debug: { diagnostics: { keywords: false } },
    toneMapping: 0,
    outputColorSpace: 'srgb',
    shadowMap: { enabled: false },
    getColorBufferType: () => 1016,
    hasFeature: () => false,
    coordinateSystem: 2000,
  };
  const Builder = (glsl ? GLSLNodeBuilder : WGSLNodeBuilder) as unknown as new (mesh: Mesh, r: unknown) => {
    scene: Scene;
    camera: PerspectiveCamera;
    material: unknown;
    lightsNode: unknown;
    build(): void;
    vertexShader: string;
    fragmentShader: string;
  };
  const b = new Builder(mesh, renderer);
  b.scene = new Scene();
  b.camera = new PerspectiveCamera();
  b.material = nodeMat;
  b.lightsNode = renderer.lighting.getNode(b.scene);
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}

function shaded(spec: MaterialSpec, tier: ShadeTier = 'high', opts = {}): MeshStandardMaterial {
  const m = new MeshStandardMaterial();
  const r = resolveMaterial(spec, opts);
  if (r.vertexColors) m.vertexColors = true;
  applyShading(m, r, tier);
  return m;
}

const EXPRESSIONS: MaterialSpec['shader'][] = [
  { color: 'mix(base, #ff5a10, smoothstep(0.4, 0.6, fbm(p * 2, 4)))', emissive: '#ff4000 * pow(1 - cells(p * 3), 4) * (0.8 + 0.2 * sin(t * 2))' },
  { emissive: '#40c0ff * pow(1 - abs(dot(n, v)), 3)', opacity: 'clamp(0.2 + 0.6 * pow(1 - abs(dot(n, v)), 2), 0, 1)' },
  { displace: '0.1 * sin(o.x * 4 - t * 3) * o.x', roughness: '0.3 + 0.4 * ridged(p.xz, 3)', metalness: 'step(0.5, hash(cellId(p * 2)))' },
  { color: 'vcol * (0.9 + 0.2 * hash(seed)) + vec3(uv, 0) * 0.01', bump: '0.004 * noise(p * 20) + 0.002 * fbm(vec2(p.x, t), 2)' },
  { color: 'cross(n, normalize(v)) * length(p.xz) + vec3(min(max(t, 0), 1)) * saturate(sign(pi))', emissive: 't' },
];

afterEach(() => vi.restoreAllMocks());

describe('surface layers and shader expressions', () => {
  it('every layer kind, with every mask, generates WGSL and GLSL at every tier', () => {
    const kinds = [...SURFACE_LAYER_KINDS];
    for (let i = 0; i < kinds.length; i += 7) {
      const layers = kinds.slice(i, i + 7).map((kind, j) => ({
        kind,
        amount: 0.6,
        ...(j % 2 === 0 ? { color: '#557733' } : {}),
        mask: [{ up: 0.4 }, { down: 0.3 }, { slope: [30, 80] as [number, number] }, { slope: [0, 40] as [number, number] }, { height: [1, 9] as [number, number] }, { noise: 0.4, invert: true }, {}][j],
      }));
      for (const tier of ['low', 'medium', 'high'] as const) {
        const spec: MaterialSpec = { preset: 'stone', surface: { layers, scale: 1.3 } };
        const wgsl = shaders(shaded(spec, tier));
        expect(wgsl.fragment.length, `${kinds.slice(i, i + 7).join()} ${tier}`).toBeGreaterThan(500);
        expect(shaders(shaded(spec, tier), true).fragment.length).toBeGreaterThan(500);
      }
    }
  });

  it('expressions on every channel generate WGSL and GLSL', () => {
    for (const shader of EXPRESSIONS) {
      for (const glsl of [false, true]) {
        const m = shaded({ preset: 'plastic', vertexColors: true, shader }, 'high', { hasVertexColors: true });
        const out = shaders(m, glsl);
        expect(out.fragment.length, JSON.stringify(shader)).toBeGreaterThan(500);
      }
    }
    const voronoi = shaders(shaded({ shader: { emissive: 'vec3(cellId(p))' } })).fragment;
    // A float widened to a colour is splatted, not evaluated three times.
    expect(voronoi.match(/aetherVoronoi\s*\(/g)?.length).toBe(2); // the declaration and one call
  });

  it('builds the nodes it should, on top of the finish setup', () => {
    const m = shaded({ preset: 'stone', surface: { layers: [{ kind: 'moss' }, { kind: 'cracks' }, { kind: 'glowCracks' }] } }) as unknown as Slots;
    expect(m.colorNode).toBeTruthy();
    expect(m.roughnessNode).toBeTruthy();
    expect(m.normalNode).toBeTruthy();
    expect(m.emissiveNode).toBeTruthy();
    expect(m.positionNode ?? null).toBeNull();
    const d = shaded({ shader: { displace: '0.1 * sin(t)', opacity: '0.5' } });
    expect((d as unknown as Slots).positionNode).toBeTruthy();
    expect(d.transparent).toBe(true);
    // Vertex colours are folded into the base so a layer colour is not tinted by them afterwards.
    const vc = shaded({ preset: 'stone', vertexColors: true, surface: { layers: [{ kind: 'snow' }] } }, 'high', { hasVertexColors: true });
    expect(vc.vertexColors).toBe(false);
  });

  it('the low tier keeps two layers, no relief, colour and emission expressions only', () => {
    const spec: MaterialSpec = { preset: 'stone', surface: { layers: [{ kind: 'tone' }, { kind: 'moss' }, { kind: 'cracks' }] }, shader: { roughness: '0.2', displace: '0.1', bump: 'noise(p)', emissive: '#ff0000' } };
    const low = shaded(spec, 'low') as unknown as Slots;
    expect(low.colorNode).toBeTruthy();
    expect(low.emissiveNode).toBeTruthy();
    expect(low.normalNode ?? null).toBeNull();
    expect(low.positionNode ?? null).toBeNull();
    const lowCode = shaders(shaded(spec, 'low')).fragment;
    const highCode = shaders(shaded(spec, 'high')).fragment;
    expect(lowCode.length).toBeLessThan(highCode.length);
    const high = shaded(spec, 'high') as unknown as Slots;
    expect(high.normalNode).toBeTruthy();
    expect(high.positionNode).toBeTruthy();
  });

  it('the medium tier caps fbm octaves at three; low uses the noise texture only', () => {
    const count = (tier: ShadeTier): number => (shaders(shaded({ shader: { color: 'vec3(fbm(p, 6))' } }, tier)).fragment.match(/mx_perlin_noise_float\w*\(/g) ?? []).length;
    expect(count('medium')).toBeLessThan(count('high'));
    expect(count('low')).toBe(0);
  });
});

describe('material cache', () => {
  it('plain specs keep their exact resolution and cache key, and no nodes', () => {
    const cache = new MaterialCache();
    const h = cache.acquire({ preset: 'stone', color: '#887766' });
    expect(h.key).toBe(
      'standard|{"color":"#887766","doubleSided":false,"emissive":"#000000","emissiveIntensity":0,"finish":"rock","flatShading":false,"foliage":null,"metalness":0,"opacity":1,"roughness":0.92,"splat":false,"surface":null,"transparent":false,"vertexColors":false,"water":null}',
    );
    expect('layers' in h.resolved || 'shader' in h.resolved).toBe(false);
    const plain = cache.acquire({ preset: 'plastic' }).material as unknown as Slots;
    expect(plain.colorNode ?? null).toBeNull();
    expect(plain.normalNode ?? null).toBeNull();
    expect(cache.shadedProgramCount).toBe(0);
    cache.dispose();
  });

  it('shaded materials with the same slots compile to their own programs (the layers name the program)', () => {
    // three keys a classic material's program without looking into its node slots: without a key of its own, an olive crate
    // with scratches drew with the rust of the first drum compiled.
    const crate: MaterialSpec = { color: '#56602f', surface: { layers: [{ kind: 'scratches', amount: 0.7 }, { kind: 'edgeWear', amount: 0.4 }] } };
    const drum: MaterialSpec = { color: '#3d5a2e', surface: { layers: [{ kind: 'rust', amount: 0.6 }, { kind: 'scratches', amount: 0.5 }] } };
    const lighter: MaterialSpec = { color: '#3d5a2e', surface: { layers: [{ kind: 'rust', amount: 0.2 }, { kind: 'scratches', amount: 0.5 }] } };
    const keys = [crate, drum, lighter].map((s) => shaded(s).customProgramCacheKey());
    expect(new Set(keys).size).toBe(3);
    // The same layers on another colour share the program (the colour is a uniform).
    expect(shaded({ ...crate, color: '#808080' }).customProgramCacheKey()).toBe(keys[0]);
    expect(shaded(crate, 'low').customProgramCacheKey()).not.toBe(keys[0]);
    expect(new MeshStandardMaterial().customProgramCacheKey()).not.toBe(keys[0]);
  });

  it('layer noise reads each face at its own metric (no skewed projection that streaks walls)', () => {
    // A face along axis i samples the plane of the two other axes, one world metre per noise metre: rust on the side of a
    // container is patchy instead of the diagonal bands a height-skewed 2D lookup squeezed it into.
    LAYER_NOISE_PLANES.forEach(([u, v], axis) => {
      expect(u).not.toBe(axis);
      expect(v).not.toBe(axis);
      expect(u).not.toBe(v);
    });
    // Walls keep height as their second coordinate, so a stretch along it (streaks) runs down them.
    expect(LAYER_NOISE_PLANES[0]![1]).toBe(1);
    expect(LAYER_NOISE_PLANES[2]![1]).toBe(1);
    const glsl = shaders(shaded({ color: '#2f5a7a', surface: { layers: [{ kind: 'rust' }] } }), true).fragment;
    // Three projections of the shared noise texture per octave.
    expect((glsl.match(/texture\(/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('the key changes with the layers, the expressions and the shading tier', () => {
    const base = materialKey(resolveMaterial({ preset: 'stone' }));
    const moss = materialKey(resolveMaterial({ preset: 'stone', surface: { layers: [{ kind: 'moss' }] } }));
    const moss2 = materialKey(resolveMaterial({ preset: 'stone', surface: { layers: [{ kind: 'moss', amount: 0.9 }] } }));
    const lava = materialKey(resolveMaterial({ preset: 'stone', shader: { emissive: '#ff4000' } }));
    expect(new Set([base, moss, moss2, lava]).size).toBe(4);
    const cache = new MaterialCache();
    const high = cache.acquire({ preset: 'stone', surface: { layers: [{ kind: 'moss' }] } });
    cache.shadeTier = 'low';
    const low = cache.acquire({ preset: 'stone', surface: { layers: [{ kind: 'moss' }] } });
    expect(high.key).not.toBe(low.key);
    expect(high.key.endsWith('|shade:high')).toBe(true);
    cache.dispose();
  });

  it('entity layers and expressions cover every part of a multi-part object', () => {
    const merged = mergeMaterial({ preset: 'bark', color: '#553322' }, { surface: { layers: [{ kind: 'moss' }] }, shader: { emissive: '#000000' } }, 3);
    expect(merged.surface?.layers[0]?.kind).toBe('moss');
    expect(merged.shader?.emissive).toBe('#000000');
    expect(merged.preset).toBe('bark');
  });

  it('caps distinct shaded programs per tier and world budget', () => {
    expect([shadedCap('low', 'hero'), shadedCap('medium', 'hero'), shadedCap('high', 'hero'), shadedCap('ultra', 'hero')]).toEqual([SHADED_CAP_LOW, SHADED_CAP_MEDIUM, SHADED_CAP_HIGH, SHADED_CAP_ULTRA]);
    expect([shadedCap('low'), shadedCap('medium'), shadedCap('high'), shadedCap('ultra')]).toEqual([8, 12, 24, 48]);
    expect([SHADED_CAP_LOW, SHADED_CAP_MEDIUM, SHADED_CAP_HIGH, SHADED_CAP_ULTRA]).toEqual([8, 24, 48, 96]);
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    for (const [tier, budget, cap] of [['low', 'normal', 8], ['medium', 'normal', 12], ['medium', 'hero', 24]] as const) {
      const cache = new MaterialCache();
      cache.shadeTier = tier;
      cache.shaderBudget = budget;
      const handles = Array.from({ length: cap + 3 }, (_, i) => cache.acquire({ preset: 'stone', surface: { layers: [{ kind: 'tone', amount: (i + 1) / 100 }] } }));
      const isShaded = (h: (typeof handles)[number]): boolean => h.material.userData['aetherShaded'] !== undefined;
      expect(handles.filter(isShaded).length, `${tier} ${budget}`).toBe(cap);
      expect(cache.shadedProgramCount).toBe(cap);
      // The same program again shares the slot (and the cached material).
      expect(isShaded(cache.acquire({ preset: 'stone', surface: { layers: [{ kind: 'tone', amount: 0.01 }] } }))).toBe(true);
      // A freed slot is taken by the next new program.
      cache.release(handles[1]!.key);
      expect(cache.shadedProgramCount).toBe(cap - 1);
      expect(isShaded(cache.acquire({ preset: 'stone', surface: { layers: [{ kind: 'tone', amount: 0.99 }] } }))).toBe(true);
      cache.dispose();
    }
    expect(warn).toHaveBeenCalled();
  });

  it('a bad expression draws the plain material and logs once', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const cache = new MaterialCache();
    const bad = { preset: 'stone', shader: { color: 'base * glow' } } as MaterialSpec;
    const a = cache.acquire(bad);
    expect(a.material.userData['aetherShaded']).toBeUndefined();
    cache.release(a.key);
    cache.acquire(bad);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('unknown name "glow"');
    expect(cache.shadedProgramCount).toBe(0);
    cache.dispose();
  });
});
