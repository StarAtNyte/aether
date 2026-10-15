import { describe, expect, it } from 'vitest';
import { BoxGeometry, Color, DirectionalLight, Group, HemisphereLight, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PerspectiveCamera, PointLight, RectAreaLight, Scene, SpotLight, Texture } from 'three';
import {
  buildTraceScene,
  clampPathTrace,
  copyLight,
  MAX_PATH_TRACE_SIZE,
  MAX_SAMPLES,
  PATH_TRACE_SAMPLES,
  pathTraceMaterial,
  sampleFraction,
  tilePlan,
  traceKind,
} from '../src/view/pathtrace';

describe('clampPathTrace', () => {
  it('keeps sane requests and clamps absurd ones, preserving the aspect', () => {
    expect(clampPathTrace({ width: 1920, height: 1080, samples: 128 })).toEqual({ width: 1920, height: 1080, samples: 128, bounces: 5 });
    const big = clampPathTrace({ width: 20_000, height: 10_000, samples: 1e9, bounces: 99 });
    expect(Math.max(big.width, big.height)).toBeLessThanOrEqual(MAX_PATH_TRACE_SIZE);
    expect(big.width / big.height).toBeCloseTo(2, 1);
    expect(big.samples).toBe(MAX_SAMPLES);
    expect(big.bounces).toBe(12);
    const small = clampPathTrace({ width: 1, height: 1, samples: 0, bounces: 0 });
    expect(small.width).toBeGreaterThanOrEqual(16);
    expect(small.samples).toBe(1);
    expect(small.bounces).toBe(1);
  });
  it('survives NaN and infinity', () => {
    const r = clampPathTrace({ width: Number.NaN, height: Number.POSITIVE_INFINITY, samples: Number.NaN, bounces: Number.NaN });
    for (const v of Object.values(r)) expect(Number.isFinite(v)).toBe(true);
    expect(r.samples).toBe(128);
  });
  it('offers three sample presets, ascending, within the limit', () => {
    expect([...PATH_TRACE_SAMPLES]).toEqual([...PATH_TRACE_SAMPLES].sort((a, b) => a - b));
    expect(Math.max(...PATH_TRACE_SAMPLES)).toBeLessThanOrEqual(MAX_SAMPLES);
    expect(PATH_TRACE_SAMPLES.length).toBe(3);
  });
});

describe('tilePlan and progress', () => {
  it('splits bigger frames into more, smaller passes', () => {
    expect(tilePlan(640, 360)).toEqual({ x: 1, y: 1 });
    expect(tilePlan(1280, 720).x).toBeGreaterThanOrEqual(2);
    expect(tilePlan(3840, 2160).x).toBeGreaterThan(tilePlan(1280, 720).x);
    expect(tilePlan(0, 0)).toEqual({ x: 1, y: 1 });
  });
  it('turns sample counts into a fraction in [0, 1]', () => {
    expect(sampleFraction(0, 100)).toBe(0);
    expect(sampleFraction(50, 100)).toBe(0.5);
    expect(sampleFraction(500, 100)).toBe(1);
    expect(sampleFraction(-5, 100)).toBe(0);
    expect(sampleFraction(5, 0)).toBe(0);
    expect(sampleFraction(Number.NaN, 10)).toBe(0);
  });
});

function std(opts: ConstructorParameters<typeof MeshStandardMaterial>[0]): MeshStandardMaterial {
  return new MeshStandardMaterial(opts);
}

describe('material conversion', () => {
  it('classifies see-through smooth surfaces as glass or water and everything else as opaque', () => {
    expect(traceKind(std({ color: '#cfe8f2', roughness: 0.03, transparent: true, opacity: 0.18 }))).toBe('glass');
    expect(traceKind(std({ color: '#2a7fb8', roughness: 0.06, transparent: true, opacity: 0.72 }))).toBe('water');
    expect(traceKind(std({ color: '#cc8844', roughness: 0.06, transparent: true, opacity: 0.72 }))).toBe('glass');
    expect(traceKind(std({ color: '#ffffff', roughness: 0.9, transparent: true, opacity: 0.4 }))).toBe('opaque');
    expect(traceKind(std({ color: '#ffffff', roughness: 0.1, transparent: false, opacity: 1 }))).toBe('opaque');
    expect(traceKind(std({ color: '#ffffff', roughness: 0.1, transparent: true, opacity: 1 }))).toBe('opaque');
  });
  it('turns glass into clear transmissive glass and water into an opaque dark mirror; keeps opaque materials', () => {
    const glass = pathTraceMaterial(std({ color: '#9fd3ff', roughness: 0.04, transparent: true, opacity: 0.3 }));
    expect(glass).toBeInstanceOf(MeshPhysicalMaterial);
    expect(glass!.transmission).toBe(1);
    expect(glass!.transparent).toBe(false);
    expect(glass!.ior).toBeGreaterThan(1.3);
    const water = pathTraceMaterial(std({ color: '#2a7fb8', roughness: 0.06, transparent: true, opacity: 0.72 }));
    expect(water!.transmission).toBe(0);
    expect(water!.opacity).toBe(1);
    expect(water!.color.b).toBeGreaterThan(water!.color.r);
    expect(water!.roughness).toBeLessThan(0.1);
    expect(pathTraceMaterial(std({ color: '#887766', roughness: 0.8 }))).toBeNull();
  });
});

describe('lights', () => {
  it('copies directional, spot, point and area lights with their world transforms baked in', () => {
    const scene = new Scene();
    const parent = new Group();
    parent.position.set(10, 0, 0);
    parent.updateMatrixWorld(true);
    const spot = new SpotLight('#ffeedd', 5, 12, 0.6, 0.3, 2);
    spot.position.set(1, 3, 0);
    spot.target.position.set(1, 0, 0);
    parent.add(spot, spot.target);
    scene.add(parent);
    scene.updateMatrixWorld(true);
    const out = new Scene();
    const copy = copyLight(spot, out) as SpotLight;
    expect(copy).toBeInstanceOf(SpotLight);
    expect(copy.position.x).toBeCloseTo(11);
    expect(copy.target.position.x).toBeCloseTo(11);
    expect(copy.target.position.y).toBeCloseTo(0);
    expect(copy.intensity).toBe(5);
    expect(copy.angle).toBeCloseTo(0.6);
    expect(copy.parent).toBe(out);
    expect(spot.parent).toBe(parent);

    const sun = new DirectionalLight('#fff', 3);
    sun.position.set(10, 20, 5);
    sun.target.position.set(0, 0, 0);
    const sunCopy = copyLight(sun, out) as DirectionalLight;
    expect(sunCopy.position.y).toBeCloseTo(20);
    expect(sunCopy.intensity).toBe(3);

    const point = new PointLight('#fa0', 2, 9, 2);
    point.position.set(0, 2, 0);
    expect(copyLight(point, out)).toBeInstanceOf(PointLight);

    const area = new RectAreaLight('#fff', 4, 2, 0.5);
    area.rotation.x = -Math.PI / 2;
    area.position.set(0, 3, 0);
    area.updateMatrixWorld(true);
    const areaCopy = copyLight(area, out) as RectAreaLight;
    expect(areaCopy.width).toBe(2);
    expect(areaCopy.height).toBe(0.5);
    expect(areaCopy.quaternion.x).toBeCloseTo(area.quaternion.x);
  });
  it('leaves out ambient and hemisphere light (the sky lights the trace)', () => {
    expect(copyLight(new HemisphereLight('#fff', '#000', 1), new Scene())).toBeNull();
  });
});

describe('buildTraceScene', () => {
  it('swaps glass for transmissive glass, shares one replacement per source material, copies the lights and sets the sky', () => {
    const glassMat = std({ color: '#9fd3ff', roughness: 0.04, transparent: true, opacity: 0.3 });
    const wall = std({ color: '#cccccc', roughness: 0.9 });
    const content = new Group();
    const a = new Mesh(new BoxGeometry(1, 1, 1), glassMat);
    const b = new Mesh(new BoxGeometry(1, 1, 1), glassMat);
    const c = new Mesh(new BoxGeometry(1, 1, 1), wall);
    content.add(a, b, c);
    const sun = new DirectionalLight('#fff', 2);
    sun.position.set(5, 9, 3);
    const env = new Texture();
    const built = buildTraceScene({
      content,
      lights: [sun, new HemisphereLight('#fff', '#000', 1)],
      camera: new PerspectiveCamera(),
      environment: env,
      skyColor: '#88aaff',
      environmentIntensity: 0.6,
      environmentRotationY: 0.5,
      toneMapping: 'agx',
      exposure: 1,
    });
    expect(a.material).toBeInstanceOf(MeshPhysicalMaterial);
    expect(a.material).toBe(b.material);
    expect(c.material).toBe(wall);
    expect(built.replaced).toHaveLength(1);
    expect(built.lights).toBe(1);
    expect(built.scene.environment).toBe(env);
    expect(built.scene.background).toBe(env);
    expect(built.scene.environmentIntensity).toBeCloseTo(0.6);
    expect(built.scene.environmentRotation.y).toBeCloseTo(0.5);
    expect(content.parent).toBe(built.scene);
  });
  it('falls back to a flat sky colour without an environment map', () => {
    const built = buildTraceScene({ content: new Group(), lights: [], camera: new PerspectiveCamera(), environment: null, skyColor: '#112233', environmentIntensity: 1, environmentRotationY: 0, toneMapping: 'aces', exposure: 1 });
    expect(built.scene.environment).toBeNull();
    expect((built.scene.background as Color).getHexString()).toBe('112233');
  });
});
