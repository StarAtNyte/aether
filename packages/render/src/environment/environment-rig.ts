/**
 * Environment rig: procedural sky, sun (directional, shadow-casting, fitted
 * to the content), hemisphere ambient, fog, ground plane and weather — all
 * driven by `world.environment`. Pure three.js core (no renderer access).
 */
import {
  BufferAttribute,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  Mesh,
  PlaneGeometry,
  type Box3,
  type Camera,
  type Scene,
} from 'three';
import { stableStringify, type Environment, type MaterialSpec } from '@aether/core';
import type { MaterialCache } from '../materials/material-cache';
import { computeSkyState, type SkyState } from './sky-state';
import { SkyDome } from './sky-dome';
import { WeatherSystem } from './weather';
import { fitShadowCamera } from './shadow-fit';

/** Max fog density honored (higher values turn the screen into a wall). */
export const MAX_FOG_DENSITY = 0.25;
const GROUND_SEGMENTS = 64;

/** Deterministic, cheap ground tint variation in [0.88, 1.06]. */
export function groundTint(x: number, z: number): number {
  const a = Math.sin(x * 0.043 + z * 0.021) * 0.5 + Math.sin(x * 0.011 - z * 0.037 + 1.7) * 0.5;
  const b = Math.sin(x * 0.17 + 2.3) * Math.sin(z * 0.13 + 0.7);
  return 0.97 + a * 0.06 + b * 0.03;
}

function createGroundGeometry(size: number): PlaneGeometry {
  const g = new PlaneGeometry(size, size, GROUND_SEGMENTS, GROUND_SEGMENTS);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = groundTint(pos.getX(i), pos.getZ(i));
    colors[i * 3] = t;
    colors[i * 3 + 1] = t;
    colors[i * 3 + 2] = t;
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}

/** Owns every environment object; add {@link group} to the scene. */
export class EnvironmentRig {
  readonly group = new Group();
  readonly sun = new DirectionalLight('#ffffff', 2.5);
  readonly hemi = new HemisphereLight('#bcd4f0', '#3b3326', 0.8);
  readonly sky = new SkyDome();
  readonly weather: WeatherSystem;
  private readonly fog = new FogExp2('#c4def4', 0);
  private ground: Mesh | null = null;
  private groundKey = '';
  private groundMaterialKey = '';
  private state: SkyState;
  private env: Environment | null = null;
  /** Upper bound on the sun shadow map resolution (lowered in low-power mode). */
  shadowMapCap = 4096;

  constructor(
    private readonly materials: MaterialCache,
    shadows: boolean,
  ) {
    this.group.name = 'aether:environment';
    this.sun.name = 'sun';
    this.sun.castShadow = shadows;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.group.add(this.sun, this.sun.target, this.hemi, this.sky.group);
    this.weather = new WeatherSystem(this.group);
    this.state = computeSkyState({ sky: 'day', sunIntensity: 2.5, ambientIntensity: 0.4 });
  }

  /** Current computed sky state. */
  get skyState(): SkyState {
    return this.state;
  }

  /** The ground mesh (null when hidden/absent). */
  get groundMesh(): Mesh | null {
    return this.ground;
  }

  /** Apply an environment (sky, lights, fog on `scene`, ground, weather). */
  apply(env: Environment, scene: Scene): void {
    this.env = env;
    const s = computeSkyState(env);
    this.state = s;
    this.sky.apply(s);
    this.sun.color.set(s.lightColor);
    this.sun.intensity = s.lightIntensity;
    this.hemi.color.set(s.hemiSky);
    this.hemi.groundColor.set(s.hemiGround);
    this.hemi.intensity = s.hemiIntensity;

    if (env.fog && env.fog.density > 0) {
      this.fog.color.set(env.fog.color);
      this.fog.density = Math.min(MAX_FOG_DENSITY, env.fog.density);
      scene.fog = this.fog;
    } else if (s.hazeDensity > 0 && s.showGround && env.ground) {
      this.fog.color.set(s.fogColor);
      this.fog.density = s.hazeDensity * (400 / Math.max(100, env.ground.size));
      scene.fog = this.fog;
    } else {
      scene.fog = null;
    }
    this.syncGround(s.showGround ? env.ground : null);
    this.weather.set(env.weather);
  }

  private syncGround(spec: { material: MaterialSpec; size: number } | null): void {
    const key = spec ? stableStringify(spec) : '';
    if (key === this.groundKey) return;
    this.groundKey = key;
    if (this.ground) {
      this.ground.removeFromParent();
      this.ground.geometry.dispose();
      this.materials.release(this.groundMaterialKey);
      this.ground = null;
      this.groundMaterialKey = '';
    }
    if (!spec) return;
    const size = Math.max(1, Math.min(20_000, Number.isFinite(spec.size) ? spec.size : 400));
    const handle = this.materials.acquire(spec.material, { hasVertexColors: true });
    this.groundMaterialKey = handle.key;
    const ground = new Mesh(createGroundGeometry(size), handle.material);
    ground.name = 'aether:ground';
    ground.receiveShadow = true;
    ground.castShadow = false;
    ground.matrixAutoUpdate = false;
    this.ground = ground;
    this.group.add(ground);
  }

  /** Fit the sun's shadow frustum to world-space content bounds (call when the world changes). */
  fitShadows(bounds: Box3): void {
    const empty = bounds.isEmpty();
    const fit = fitShadowCamera(
      empty ? null : { min: [bounds.min.x, bounds.min.y, bounds.min.z], max: [bounds.max.x, bounds.max.y, bounds.max.z] },
      this.state.lightDirection,
    );
    this.sun.target.position.set(fit.center[0], fit.center[1], fit.center[2]);
    this.sun.target.updateMatrixWorld();
    this.sun.position.set(fit.position[0], fit.position[1], fit.position[2]);
    const cam = this.sun.shadow.camera;
    cam.left = -fit.halfSize;
    cam.right = fit.halfSize;
    cam.top = fit.halfSize;
    cam.bottom = -fit.halfSize;
    cam.near = fit.near;
    cam.far = fit.far;
    cam.updateProjectionMatrix();
    const mapSize = Math.min(fit.mapSize, this.shadowMapCap);
    if (this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      // Force the shadow map to be reallocated at the new size.
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  /** Per-frame update (sky follows the camera, weather animates). Zero allocations. */
  update(dt: number, camera: Camera): void {
    this.sky.update(camera);
    this.weather.update(dt, camera);
  }

  /** True when the environment animates by itself (weather particles) and needs continuous frames. */
  get animating(): boolean {
    return this.weather.animating;
  }

  /** Bloom strength requested by the environment. */
  get bloom(): number {
    return this.env?.bloom ?? 0.4;
  }

  /** Exposure requested by the environment. */
  get exposure(): number {
    return this.env?.exposure ?? 1;
  }

  /** Release everything. */
  dispose(): void {
    this.syncGround(null);
    this.sky.dispose();
    this.weather.dispose();
    this.sun.shadow.map?.dispose();
    this.sun.dispose();
    this.hemi.dispose();
    this.group.removeFromParent();
  }
}
