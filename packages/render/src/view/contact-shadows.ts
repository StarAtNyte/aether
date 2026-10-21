/**
 * Contact shadows under furniture: a soft dark footprint on the floor beneath every sofa, bed, table and cabinet,
 * the darkening a path tracer shows where a piece meets the floor and that the light volume (0.45 m probes) is too
 * coarse to resolve. Tiers without screen-space AO had nothing there, so pieces floated on the floor.
 *
 * One instanced draw for the whole building: a unit quad with a rounded, feathered footprint texture, one instance
 * per piece (its floor box, a little wider), drawn as a darkening blend just above the floor. Footprints are
 * planned purely ({@link planContactShadows}, tested) from the pieces' world boxes when the light volume bakes.
 */
import { DataTexture, DoubleSide, InstancedMesh, LinearFilter, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, RGBAFormat, Vector3, type Box3 } from 'three';

/** A footprint: centre on the floor, size (x, z) in metres and darkness (0..1). */
export interface ContactFootprint {
  x: number;
  y: number;
  z: number;
  sx: number;
  sz: number;
  strength: number;
}

/** Most footprints drawn. */
export const MAX_CONTACT_SHADOWS = 256;
/** Metres a footprint reaches past the piece's box on each side. */
export const CONTACT_SPREAD = 0.12;
/** Height above the floor a piece may start and still touch it (legs, plinths). */
export const CONTACT_REACH = 0.25;

/**
 * Footprints of pieces given as world boxes, on the floors at heights `floors`: pieces whose bottom is within
 * {@link CONTACT_REACH} above a floor (wall-hung frames and shelves get none), not huge, not tiny. The darkness
 * grows with the piece's footprint (a bed darkens more than a stool). Pure.
 */
export function planContactShadows(boxes: readonly Box3[], floors: readonly number[]): ContactFootprint[] {
  const out: ContactFootprint[] = [];
  for (const b of boxes) {
    if (out.length >= MAX_CONTACT_SHADOWS) break;
    if (b.isEmpty()) continue;
    const { min, max } = b;
    if (![min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite)) continue;
    const sx = max.x - min.x;
    const sz = max.z - min.z;
    const sy = max.y - min.y;
    if (sx < 0.15 || sz < 0.15 || sy < 0.1 || sx > 8 || sz > 8) continue;
    let floor = Number.NaN;
    for (const f of floors) if (Number.isFinite(f) && min.y >= f - 0.05 && min.y <= f + CONTACT_REACH && !(Math.abs(min.y - f) > Math.abs(min.y - floor))) floor = f;
    if (!Number.isFinite(floor)) continue;
    const area = sx * sz;
    // On the floor, or on whatever the piece stands on just above it (a rug).
    out.push({ x: (min.x + max.x) / 2, y: Math.max(floor, Math.min(min.y, floor + 0.04)), z: (min.z + max.z) / 2, sx: sx + 2 * CONTACT_SPREAD, sz: sz + 2 * CONTACT_SPREAD, strength: Math.min(0.8, 0.45 + 0.15 * Math.sqrt(area)) });
  }
  return out;
}

/** The footprint alpha map: 1 in a rounded core, feathering to 0 at the edge. */
function footprintTexture(n = 64): DataTexture {
  const px = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = ((x + 0.5) / n) * 2 - 1;
      const v = ((y + 0.5) / n) * 2 - 1;
      // A superellipse: a box with round corners; the dark core covers the piece, the rim feathers out.
      const d = (Math.abs(u) ** 4 + Math.abs(v) ** 4) ** 0.25;
      const t = Math.max(0, Math.min(1, (1 - d) / 0.42));
      const a = t * t * (3 - 2 * t);
      // three reads an alpha map from its green channel.
      const k = (y * n + x) * 4;
      px[k] = px[k + 1] = px[k + 2] = Math.round(a * 255);
      px[k + 3] = 255;
    }
  }
  const tex = new DataTexture(px, n, n, RGBAFormat);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const _m = new Matrix4();
const _q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
const _p = new Vector3();
const _s = new Vector3();

/** The instanced footprints of a building (add {@link mesh} to the scene). */
export class ContactShadows {
  readonly mesh: InstancedMesh;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly texture = footprintTexture();
  private readonly material: MeshBasicMaterial;

  constructor() {
    this.material = new MeshBasicMaterial({ color: 0x000000, alphaMap: this.texture, transparent: true, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.material.name = 'aether:contact-shadow';
    this.mesh = new InstancedMesh(this.geometry, this.material, MAX_CONTACT_SHADOWS);
    this.mesh.name = 'aether:contact-shadows';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 1;
  }

  /** Show `prints` (replaces the previous set). Opacity is per set: `strength` is averaged into it. */
  set(prints: readonly ContactFootprint[], opacity = 1): void {
    const n = Math.min(MAX_CONTACT_SHADOWS, prints.length);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const p = prints[i] as ContactFootprint;
      _p.set(p.x, p.y + 0.004, p.z);
      _s.set(p.sx, p.sz, 1);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      sum += p.strength;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.material.opacity = n > 0 ? Math.max(0, Math.min(1, (sum / n) * opacity)) : 0;
    this.mesh.visible = n > 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.texture.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
