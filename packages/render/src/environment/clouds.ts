/**
 * Procedural cloud layer for the sky dome: a tileable fractal cloud texture (generated in plain
 * TypeScript, deterministic, identical on WebGPU and WebGL2) projected onto an upper hemisphere with
 * the classic cloud-plane mapping, so clouds converge towards the horizon with correct perspective.
 *
 * The layer is a classic unlit material: its colour comes from per-vertex sun lighting (sunlit tops,
 * shaded bellies, silver linings and golden under-lighting near the sun) and fades into the horizon
 * haze, so it works with every sky preset and costs one small vertex-colour upload per environment
 * change. No per-frame work.
 */
import { BackSide, BufferAttribute, Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, NoColorSpace, RGBAFormat, RepeatWrapping, SphereGeometry, Vector3 } from 'three';
import { rng } from '@aether/core';
import type { SkyState } from './sky-state';

/** Cloud texture edge in pixels (power of two, tileable). */
export const CLOUD_TEXTURE_SIZE = 256;
/** Cloud cover is quantised to this step, so the texture is only rebuilt for a visible change. */
export const COVER_STEP = 0.05;
/** Texture repeats per unit of the cloud-plane projection. */
const PLANE_SCALE = 0.55;
/** Lifts the projection's denominator, so the zenith does not blow up into one huge tile. */
const PLANE_LIFT = 0.08;
const CLOUD_SEED = 0xc10d5;
/** Octaves of the fractal noise and the lattice period of the first one. */
const OCTAVES = 6;
const BASE_PERIOD = 4;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Quantised cloud cover in [0, 1]. */
export function quantiseCover(cover: number): number {
  const c = Number.isFinite(cover) ? Math.max(0, Math.min(1, cover)) : 0;
  return Math.round(c / COVER_STEP) * COVER_STEP;
}

/** Cloud-plane texture coordinates of a unit view direction above the horizon. */
export function cloudUv(dx: number, dy: number, dz: number, out: [number, number]): [number, number] {
  const k = PLANE_SCALE / (Math.max(0, dy) + PLANE_LIFT);
  out[0] = dx * k;
  out[1] = dz * k;
  return out;
}

/** Tileable fractal noise in [0, 1], `OCTAVES` octaves starting at `BASE_PERIOD` lattice cells per tile. */
function fractalNoise(size: number, seed: number): Float32Array {
  const random = rng(seed);
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < OCTAVES; o++) {
    const period = BASE_PERIOD << o;
    const lattice = new Float32Array(period * period);
    for (let i = 0; i < lattice.length; i++) lattice[i] = random();
    const at = (i: number, j: number): number => lattice[(((j % period) + period) % period) * period + (((i % period) + period) % period)] as number;
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * period;
      const yi = Math.floor(fy);
      const ty = fy - yi;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * period;
        const xi = Math.floor(fx);
        const tx = fx - xi;
        const sx = tx * tx * (3 - 2 * tx);
        const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
        const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
        const k = y * size + x;
        out[k] = (out[k] as number) + amp * (a + (b - a) * sy);
      }
    }
    total += amp;
    amp *= 0.52;
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) / total;
  return out;
}

/**
 * RGBA8 pixels of the cloud texture for a cloud `cover` in [0, 1]. R = G = B is the cloud's own
 * brightness (thick cores are darker, thin edges lit), A its opacity (soft-edged, `cover` moves the
 * threshold). Deterministic; `fbm` is the noise from {@link fractalNoise} (cached per size).
 */
export function cloudPixels(size: number, cover: number, fbm: Float32Array): Uint8Array {
  const c = quantiseCover(cover);
  const out = new Uint8Array(size * size * 4);
  // Cover 0 → threshold at the top of the noise range (clear sky); cover 1 → everything is cloud.
  const threshold = 1 - c * 1.1;
  for (let i = 0; i < fbm.length; i++) {
    const d = fbm[i] as number;
    const alpha = smoothstep(threshold, threshold + 0.16, d);
    const core = smoothstep(threshold + 0.04, threshold + 0.4, d);
    const shade = 1 - 0.5 * core;
    out[i * 4] = Math.round(shade * 255);
    out[i * 4 + 1] = Math.round(shade * 255);
    out[i * 4 + 2] = Math.round(shade * 255);
    out[i * 4 + 3] = Math.round(alpha * 255);
  }
  return out;
}

const _d = new Vector3();
const _sun = new Vector3();
const _lit = new Color();
const _shade = new Color();
const _glow = new Color();
const _c = new Color();
const _haze = new Color();
const _uv: [number, number] = [0, 0];

/** The cloud layer: add {@link mesh} to the sky group. */
export class CloudLayer {
  readonly mesh: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly texture: DataTexture;
  private fbm: Float32Array | null = null;
  private cover = -1;

  constructor(radius: number) {
    const geometry = new SphereGeometry(radius, 64, 20, 0, Math.PI * 2, 0, Math.PI / 2);
    const pos = geometry.getAttribute('position');
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      _d.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      cloudUv(_d.x, _d.y, _d.z, _uv);
      uvs[i * 2] = _uv[0];
      uvs[i * 2 + 1] = _uv[1];
    }
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(pos.count * 3), 3));
    this.texture = new DataTexture(new Uint8Array(CLOUD_TEXTURE_SIZE * CLOUD_TEXTURE_SIZE * 4), CLOUD_TEXTURE_SIZE, CLOUD_TEXTURE_SIZE, RGBAFormat);
    this.texture.colorSpace = NoColorSpace;
    this.texture.wrapS = RepeatWrapping;
    this.texture.wrapT = RepeatWrapping;
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.anisotropy = 8;
    this.mesh = new Mesh(geometry, new MeshBasicMaterial({ map: this.texture, vertexColors: true, transparent: true, side: BackSide, fog: false, depthWrite: false }));
    this.mesh.name = 'aether:clouds';
    this.mesh.renderOrder = -9.5;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Current (quantised) cloud cover of the texture, −1 before the first {@link apply}. */
  get coverage(): number {
    return this.cover;
  }

  /**
   * Light the clouds for `state` and blend them into `horizon` (the dome's horizon colour) near the
   * ground line. Rebuilds the texture only when the quantised cover changed.
   */
  apply(state: SkyState, horizon: Color): void {
    const cover = state.moon ? Math.min(0.5, quantiseCover(state.clouds)) : quantiseCover(state.clouds);
    this.mesh.visible = cover > 0.01;
    if (!this.mesh.visible) return;
    if (cover !== this.cover) {
      this.fbm ??= fractalNoise(CLOUD_TEXTURE_SIZE, CLOUD_SEED);
      (this.texture.image.data as Uint8Array).set(cloudPixels(CLOUD_TEXTURE_SIZE, cover, this.fbm));
      this.texture.needsUpdate = true;
      this.cover = cover;
    }
    _sun.set(state.lightDirection[0], state.lightDirection[1], state.lightDirection[2]).normalize();
    _haze.copy(horizon);
    // Lit tops carry the key light's colour; bellies the sky's. Night clouds are faint moonlit silhouettes.
    const brightness = state.moon ? 0.12 : 0.9 + 0.35 * Math.min(1, state.lightIntensity / 3);
    _lit.set('#ffffff').lerp(_c.set(state.lightColor), state.moon ? 0.4 : 0.5).multiplyScalar(brightness);
    _shade.set(state.hemiSky).lerp(_c.set(state.zenith), 0.3).multiplyScalar(state.moon ? 0.16 : 0.62 + 0.12 * Math.min(1, state.lightIntensity / 3));
    _glow.set(state.sunGlow);
    const glow = state.moon ? 0 : state.sunGlowStrength;
    const geometry = this.mesh.geometry;
    const pos = geometry.getAttribute('position');
    const col = geometry.getAttribute('color') as BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      _d.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      const k = Math.max(0, _d.dot(_sun));
      _c.copy(_shade).lerp(_lit, 0.3 + 0.7 * k * k);
      // Silver lining and golden under-lighting around the sun.
      const g = (Math.pow(k, 5) * 0.55 + Math.pow(k, 24) * 0.7) * glow;
      _c.r += _glow.r * g;
      _c.g += _glow.g * g;
      _c.b += _glow.b * g;
      // Melt into the horizon haze.
      _c.lerp(_haze, 1 - smoothstep(0.015, 0.26, _d.y));
      col.setXYZ(i, _c.r, _c.g, _c.b);
    }
    col.needsUpdate = true;
  }

  /** Release GPU resources. */
  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
    this.mesh.removeFromParent();
  }
}
