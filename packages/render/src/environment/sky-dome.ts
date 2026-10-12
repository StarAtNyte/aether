/**
 * Procedural sky: a camera-centered dome colored per vertex (zenith → horizon
 * → nadir gradient with a sun halo), a billboarded sun/moon disc and a star
 * field. Plain classic materials, so it renders identically on the WebGPU and
 * WebGL2 backends; updating it costs one small vertex-color upload and only
 * happens when the environment changes.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
  Vector3,
  type Camera,
} from 'three';
import { rng } from '@aether/core';
import type { SkyState } from './sky-state';

/** Dome radius in meters (camera far plane must exceed it). */
export const SKY_RADIUS = 900;
const STAR_COUNT = 1800;
const STAR_SEED = 0x5ca1ab1e;

const _zenith = new Color();
const _horizon = new Color();
const _nadir = new Color();
const _glow = new Color();
const _c = new Color();
const _d = new Vector3();
const _sun = new Vector3();

/** Camera-following procedural sky. */
export class SkyDome {
  readonly group = new Group();
  private readonly dome: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly disc: Mesh<CircleGeometry, MeshBasicMaterial>;
  private readonly stars: Points<BufferGeometry, PointsMaterial>;
  private readonly sunDir = new Vector3(0, 1, 0);

  constructor() {
    this.group.name = 'aether:sky';
    const geometry = new SphereGeometry(SKY_RADIUS, 48, 24);
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(count * 3), 3));
    this.dome = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false, toneMapped: false }));
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;

    this.disc = new Mesh(new CircleGeometry(SKY_RADIUS * 0.035, 32), new MeshBasicMaterial({ color: '#ffffff', fog: false, depthWrite: false, transparent: true }));
    this.disc.renderOrder = -9;
    this.disc.frustumCulled = false;

    this.stars = new Points(createStarGeometry(), new PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: AdditiveBlending }));
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.group.add(this.dome, this.stars, this.disc);
  }

  /** Recolor the dome and place the sun/moon disc. */
  apply(state: SkyState): void {
    _zenith.set(state.zenith);
    _horizon.set(state.horizon);
    _nadir.set(state.nadir);
    _glow.set(state.sunGlow);
    this.sunDir.set(state.lightDirection[0], state.lightDirection[1], state.lightDirection[2]).normalize();
    const pos = this.dome.geometry.getAttribute('position');
    const col = this.dome.geometry.getAttribute('color') as BufferAttribute;
    const glow = state.sunGlowStrength;
    for (let i = 0; i < pos.count; i++) {
      _d.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      const t = _d.y;
      if (t >= 0) _c.copy(_horizon).lerp(_zenith, Math.pow(t, 0.55));
      else _c.copy(_horizon).lerp(_nadir, Math.min(1, Math.pow(-t, 0.4) * 1.4));
      if (glow > 0) {
        const k = Math.max(0, _d.dot(this.sunDir));
        const g = (Math.pow(k, 48) * 0.9 + Math.pow(k, 6) * 0.25) * glow * (t > -0.1 ? 1 : 0);
        _c.r += _glow.r * g;
        _c.g += _glow.g * g;
        _c.b += _glow.b * g;
      }
      col.setXYZ(i, _c.r, _c.g, _c.b);
    }
    col.needsUpdate = true;

    const above = state.lightDirection[1] > -0.02;
    this.disc.visible = above && (glow > 0 || state.moon);
    this.disc.material.color.set(state.moon ? '#dfe6ff' : state.lightColor).multiplyScalar(state.moon ? 1.2 : 6);
    this.disc.material.opacity = state.moon ? 0.9 : 1;
    this.disc.scale.setScalar(state.moon ? 0.7 : 1);
    this.stars.material.opacity = state.stars;
    this.stars.visible = state.stars > 0.01;
  }

  /** Keep the dome centered on the camera and the disc facing it (allocation-free). */
  update(camera: Camera): void {
    this.group.position.copy(camera.position);
    _sun.copy(this.sunDir).multiplyScalar(SKY_RADIUS * 0.92);
    this.disc.position.copy(_sun);
    this.disc.lookAt(camera.position);
  }

  /** Release GPU resources. */
  dispose(): void {
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.disc.geometry.dispose();
    this.disc.material.dispose();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
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
