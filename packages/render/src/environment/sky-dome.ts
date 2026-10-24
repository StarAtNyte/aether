/**
 * Procedural sky: a camera-centered dome colored per vertex (zenith → horizon
 * → nadir gradient with a sun halo, plus a nebula / galactic band in space
 * and on clear nights), a billboarded sun/moon disc and a star field. Plain classic materials, so it renders identically on the WebGPU and
 * WebGL2 backends; updating it costs one small vertex-color upload and only
 * happens when the environment changes.
 */
import { bakeFlipY } from '../gpu/gecko-safe';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  Points,
  PlaneGeometry,
  PointsMaterial,
  RGBAFormat,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
  type Camera,
} from 'three';
import { rng } from '@aether/core';
import { SKY_GRADIENT_POWER, type SkyState } from './sky-state';
import { nebulaAt } from './nebula';
import { skyDisplay } from './atmosphere';
import { BODY_TEXTURE_SIZE, moonPixels, sunRaysPixels, sunSpritePixels } from './sky-bodies';
import { CloudLayer } from './clouds';

/** Dome radius in meters (camera far plane must exceed it). */
export const SKY_RADIUS = 900;
const STAR_COUNT = 1800;
/** Share of the fog color mixed into the dome's horizon band. */
const HORIZON_FOG_BLEND = 0.85;
const STAR_SEED = 0x5ca1ab1e;
/** Lit fraction of the moon (a waxing gibbous: bright enough to read as moonlight, shaped enough to read as the moon). */
export const MOON_PHASE = 0.78;
const NoColor = '';

const _zenith = new Color();
const _horizon = new Color();
const _nadir = new Color();
const _glow = new Color();
const _c = new Color();
const _p = new Color();
const _d = new Vector3();
const _sun = new Vector3();
const _neb: [number, number, number] = [0, 0, 0];
const _phys: [number, number, number] = [0, 0, 0];
const _fog = new Color();

/**
 * Strength (0..0.55) of the sun's rays for a sun elevation in degrees: full near the horizon, fading out by
 * 40°, none under overcast or in the studio and space presets.
 */
export function raysStrength(elevationDeg: number, preset: string): number {
  if (preset === 'overcast' || preset === 'space' || preset === 'studio' || !Number.isFinite(elevationDeg)) return 0;
  return 0.55 * (1 - smooth(4, 42, elevationDeg)) * smooth(-4, 2, elevationDeg);
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Camera-following procedural sky. */
export class SkyDome {
  readonly group = new Group();
  private readonly dome: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly disc: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly moonDisc: Mesh<PlaneGeometry, MeshBasicMaterial>;
  /** Crepuscular rays around the sun (strong with a low sun, gone at noon and at night). */
  private readonly rays: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly bodyTextures: DataTexture[] = [];
  /** Sun, rays and moon share one billboard frame: positioned toward the light, facing the camera. */
  private readonly bodies = new Group();
  private readonly stars: Points<BufferGeometry, PointsMaterial>;
  /** Procedural cloud cover (follows the sky preset). */
  readonly clouds = new CloudLayer(SKY_RADIUS * 0.985);
  /** High veil of thin wisps above the cumulus deck. */
  readonly cirrus = new CloudLayer(SKY_RADIUS * 0.99, 'cirrus');
  private readonly sunDir = new Vector3(0, 1, 0);
  private detail = true;
  private brightness = 1;
  private last: { state: SkyState; fogColor: string | undefined } | null = null;

  constructor() {
    this.group.name = 'aether:sky';
    const geometry = new SphereGeometry(SKY_RADIUS, 96, 48);
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(count * 3), 3));
    this.dome = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;

    const sunTex = this.bodyTexture(sunSpritePixels(), NoColor);
    this.disc = new Mesh(new PlaneGeometry(SKY_RADIUS * 0.28, SKY_RADIUS * 0.28), new MeshBasicMaterial({ map: sunTex, color: '#ffffff', fog: false, depthWrite: false, transparent: true, blending: AdditiveBlending }));
    this.disc.renderOrder = -8;
    this.disc.frustumCulled = false;
    const raysTex = this.bodyTexture(sunRaysPixels(), NoColor);
    this.rays = new Mesh(new PlaneGeometry(SKY_RADIUS * 1.5, SKY_RADIUS * 1.5), new MeshBasicMaterial({ map: raysTex, color: '#ffffff', fog: false, depthWrite: false, transparent: true, blending: AdditiveBlending }));
    this.rays.renderOrder = -8.5;
    this.rays.frustumCulled = false;
    this.rays.visible = false;
    const moonTex = this.bodyTexture(moonPixels(MOON_PHASE), SRGBColorSpace);
    this.moonDisc = new Mesh(new PlaneGeometry(SKY_RADIUS * 0.06, SKY_RADIUS * 0.06), new MeshBasicMaterial({ map: moonTex, color: '#ffffff', fog: false, depthWrite: false, transparent: true }));
    this.moonDisc.renderOrder = -8;
    this.moonDisc.frustumCulled = false;
    this.moonDisc.visible = false;

    this.stars = new Points(createStarGeometry(), new PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: AdditiveBlending }));
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.bodies.add(this.rays, this.disc, this.moonDisc);
    this.group.add(this.dome, this.cirrus.mesh, this.clouds.mesh, this.stars, this.bodies);
  }

  /**
   * Recolor the dome and place the sun/moon disc. With `fogColor`, the
   * horizon band blends into the fog and the lower hemisphere takes the fog
   * color, so fogged scenery and the ground's far edge melt into the sky.
   */
  apply(state: SkyState, fogColor?: string): void {
    this.last = { state, fogColor };
    _zenith.set(state.zenith);
    _horizon.set(state.horizon);
    _nadir.set(state.nadir);
    if (fogColor) {
      _c.set(fogColor);
      _horizon.lerp(_c, HORIZON_FOG_BLEND);
      _nadir.copy(_c);
    }
    _glow.set(state.sunGlow);
    this.sunDir.set(state.lightDirection[0], state.lightDirection[1], state.lightDirection[2]).normalize();
    const pos = this.dome.geometry.getAttribute('position');
    const col = this.dome.geometry.getAttribute('color') as BufferAttribute;
    const glow = state.sunGlowStrength;
    const phys = state.physical;
    if (fogColor) _fog.set(fogColor);
    for (let i = 0; i < pos.count; i++) {
      _d.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      const t = _d.y;
      if (t >= 0) _c.copy(_horizon).lerp(_zenith, Math.pow(t, SKY_GRADIENT_POWER));
      else _c.copy(_horizon).lerp(_nadir, Math.min(1, Math.pow(-t, 0.4) * 1.4));
      if (phys && t > 0) {
        // Physically based colour per direction, melting into the fog colour toward the horizon.
        skyDisplay(_d.x, _d.y, _d.z, phys.sunDirection[0], phys.sunDirection[1], phys.sunDirection[2], phys.turbidity, _phys);
        _p.setRGB(_phys[0], _phys[1], _phys[2]);
        if (fogColor) _p.lerp(_fog, HORIZON_FOG_BLEND * 0.8 * (1 - smooth(0, 0.18, t)));
        _c.lerp(_p, phys.weight);
      }
      if (glow > 0 && !(phys && t > 0 && phys.weight > 0.5)) {
        const k = Math.max(0, _d.dot(this.sunDir));
        const g = (Math.pow(k, 48) * 0.9 + Math.pow(k, 6) * 0.25) * glow * (t > -0.1 ? 1 : 0);
        _c.r += _glow.r * g;
        _c.g += _glow.g * g;
        _c.b += _glow.b * g;
      }
      // Over a ground the nebula fades out just above the horizon (no band meeting the ground line).
      const nebulaFade = state.showGround ? Math.max(0, Math.min(1, (t - 0.04) * 5)) : Math.min(1, Math.max(0, (t + 0.2) * 4));
      if (state.nebula > 0 && nebulaFade > 0) {
        nebulaAt(_d.x, _d.y, _d.z, state.nebula * nebulaFade, _neb);
        _c.r += _neb[0];
        _c.g += _neb[1];
        _c.b += _neb[2];
      }
      col.setXYZ(i, _c.r, _c.g, _c.b);
    }
    col.needsUpdate = true;
    this.clouds.apply(state, _horizon);
    this.cirrus.apply(state, _horizon);
    if (!this.detail) this.cirrus.mesh.visible = false;

    const above = state.lightDirection[1] > -0.02;
    this.disc.visible = above && !state.moon && glow > 0;
    this.disc.material.color.set(state.lightColor).lerp(_c.set('#ffffff'), 0.35).multiplyScalar(7 * this.brightness);
    // Rays: strongest as the sun nears the horizon (a long path through haze), gone high up and in daylight's glare.
    const rayStrength = above && !state.moon ? raysStrength(state.elevation, state.preset) : 0;
    this.rays.visible = this.detail && rayStrength > 0.01;
    this.rays.material.color.set(state.lightColor).multiplyScalar(rayStrength * this.brightness);
    this.moonDisc.visible = above && state.moon;
    this.moonDisc.material.color.set('#ffffff').multiplyScalar(1.5 * this.brightness);
    this.stars.material.opacity = state.stars;
    this.stars.visible = state.stars > 0.01;
  }

  /**
   * Quality tier of the sky: `false` (the low tier, software rasterisers) drops the two layers that cost
   * a full-screen blended pass each, the high cirrus veil and the sun's rays. The dome, the cumulus deck,
   * the sun/moon and the stars stay, so the sky keeps its physical colours everywhere. Reapplies the last
   * state.
   */
  setDetail(on: boolean): void {
    if (this.detail === on) return;
    this.detail = on;
    if (this.last) this.apply(this.last.state, this.last.fogColor);
  }

  /** Multiply the dome's and the sun disc's brightness (the eye's exposure boost indoors is partly taken back, see the rig). */
  setBrightness(scale: number): void {
    const k = scale / this.brightness;
    this.brightness = scale;
    this.dome.material.color.setScalar(scale);
    // Sun, rays and moon carry the same factor (rescaled in place; the next apply builds them with it).
    for (const m of [this.disc, this.rays, this.moonDisc]) m.material.color.multiplyScalar(k);
  }

  /** Whether the full sky (cirrus and rays) is drawn. */
  get detailed(): boolean {
    return this.detail;
  }

  private bodyTexture(pixels: Uint8Array, space: string): DataTexture {
    const tex = new DataTexture(pixels, BODY_TEXTURE_SIZE, BODY_TEXTURE_SIZE, RGBAFormat);
    if (space) tex.colorSpace = SRGBColorSpace;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    tex.generateMipmaps = false;
    // Rows flipped here, not by the driver: a pixel-store flip on a typed-array upload is deprecated in Firefox.
    tex.flipY = true;
    bakeFlipY(tex);
    tex.needsUpdate = true;
    this.bodyTextures.push(tex);
    return tex;
  }

  /** Keep the dome centered on the camera and the disc facing it (allocation-free). */
  update(camera: Camera): void {
    this.group.position.copy(camera.position);
    _sun.copy(this.sunDir).multiplyScalar(SKY_RADIUS * 0.92);
    this.bodies.position.copy(_sun);
    this.bodies.lookAt(camera.position);
  }

  /** Release GPU resources. */
  dispose(): void {
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.disc.geometry.dispose();
    this.disc.material.dispose();
    this.rays.geometry.dispose();
    this.rays.material.dispose();
    this.moonDisc.geometry.dispose();
    this.moonDisc.material.dispose();
    for (const t of this.bodyTextures) t.dispose();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.clouds.dispose();
    this.cirrus.dispose();
    this.group.removeFromParent();
  }
}

function createStarGeometry(): BufferGeometry {
  const random = rng(STAR_SEED);
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  const r = SKY_RADIUS * 0.95;
  for (let i = 0; i < STAR_COUNT; i++) {
    // Uniform on the sphere, biased to the upper hemisphere.
    const y = Math.pow(random(), 0.7) * 2 - 1;
    const a = random() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - y * y));
    positions[i * 3] = Math.cos(a) * s * r;
    positions[i * 3 + 1] = Math.abs(y) * r * (y < -0.6 ? -1 : 1);
    positions[i * 3 + 2] = Math.sin(a) * s * r;
    const b = 0.45 + random() * 0.55;
    const warm = random();
    colors[i * 3] = b * (warm > 0.8 ? 1 : 0.85);
    colors[i * 3 + 1] = b * 0.9;
    colors[i * 3 + 2] = b * (warm < 0.2 ? 0.8 : 1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}
