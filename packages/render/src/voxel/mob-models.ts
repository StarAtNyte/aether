/**
 * Mob models: animals (sheep, pig, chicken) and the spider are soft, rounded forms (boxes with their
 * corners pulled onto spheres) with a fur or skin noise as bump and tone, walk-cycle limbs, a turning
 * head and a red hurt flash. Zombies are people: when the renderer's character system is available
 * (`MobContext`) a zombie is a rigged, animated human from the cast in dark ragged clothes that shambles
 * with the same rig as every NPC (a rounded stand-in shows while it loads, or if the files are missing).
 * Geometries and materials are shared by every mob of a kind; a mob is one Group, posed in place every
 * frame without allocating.
 */
import { BoxGeometry, Color, DataTexture, Group, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, RedFormat, RepeatWrapping, UnsignedByteType, Vector3, type BufferGeometry, type Material } from 'three';
import { resolveLook } from '@aether/assets';
import type { CharacterSystem } from '../characters/system';

/** Mob kinds that have a model. */
export type MobModelKind = 'sheep' | 'pig' | 'chicken' | 'zombie' | 'spider';

interface Part {
  size: [number, number, number];
  at: [number, number, number];
  color: string;
  /** Limb: swings around its top edge with the walk cycle (sign = phase). */
  swing?: number;
  head?: boolean;
  emissive?: string;
}

const W = '#eeeae2';
const PARTS: Readonly<Record<MobModelKind, readonly Part[]>> = {
  sheep: [
    { size: [0.62, 0.56, 0.95], at: [0, 0.78, 0], color: W },
    { size: [0.36, 0.36, 0.42], at: [0, 1.02, -0.6], color: '#d9cfc2', head: true },
    { size: [0.28, 0.26, 0.06], at: [0, 1.0, -0.82], color: '#6e5b4c', head: true },
    { size: [0.18, 0.5, 0.18], at: [-0.18, 0.5, -0.3], color: '#d9cfc2', swing: 1 },
    { size: [0.18, 0.5, 0.18], at: [0.18, 0.5, -0.3], color: '#d9cfc2', swing: -1 },
    { size: [0.18, 0.5, 0.18], at: [-0.18, 0.5, 0.3], color: '#d9cfc2', swing: -1 },
    { size: [0.18, 0.5, 0.18], at: [0.18, 0.5, 0.3], color: '#d9cfc2', swing: 1 },
  ],
  pig: [
    { size: [0.6, 0.5, 0.9], at: [0, 0.62, 0], color: '#f0a3a4' },
    { size: [0.5, 0.46, 0.46], at: [0, 0.78, -0.62], color: '#f0a3a4', head: true },
    { size: [0.26, 0.18, 0.08], at: [0, 0.72, -0.88], color: '#e07f86', head: true },
    { size: [0.08, 0.08, 0.02], at: [-0.13, 0.86, -0.86], color: '#2a1b1b', head: true },
    { size: [0.08, 0.08, 0.02], at: [0.13, 0.86, -0.86], color: '#2a1b1b', head: true },
    { size: [0.18, 0.38, 0.18], at: [-0.17, 0.38, -0.28], color: '#e8949a', swing: 1 },
    { size: [0.18, 0.38, 0.18], at: [0.17, 0.38, -0.28], color: '#e8949a', swing: -1 },
    { size: [0.18, 0.38, 0.18], at: [-0.17, 0.38, 0.28], color: '#e8949a', swing: -1 },
    { size: [0.18, 0.38, 0.18], at: [0.17, 0.38, 0.28], color: '#e8949a', swing: 1 },
  ],
  chicken: [
    { size: [0.36, 0.34, 0.48], at: [0, 0.5, 0], color: '#f6f3ec' },
    { size: [0.24, 0.34, 0.2], at: [0, 0.8, -0.24], color: '#f6f3ec', head: true },
    { size: [0.18, 0.08, 0.12], at: [0, 0.82, -0.4], color: '#f2a93b', head: true },
    { size: [0.08, 0.12, 0.06], at: [0, 0.7, -0.36], color: '#d9342b', head: true },
    { size: [0.06, 0.32, 0.06], at: [-0.08, 0.24, 0], color: '#f2a93b', swing: 1 },
    { size: [0.06, 0.32, 0.06], at: [0.08, 0.24, 0], color: '#f2a93b', swing: -1 },
    { size: [0.04, 0.24, 0.32], at: [-0.2, 0.54, 0.02], color: '#e6e1d6' },
    { size: [0.04, 0.24, 0.32], at: [0.2, 0.54, 0.02], color: '#e6e1d6' },
  ],
  zombie: [
    { size: [0.5, 0.72, 0.26], at: [0, 1.12, 0], color: '#2f8f9a' },
    { size: [0.48, 0.48, 0.48], at: [0, 1.74, 0], color: '#5f9a4a', head: true },
    { size: [0.1, 0.06, 0.02], at: [-0.11, 1.76, -0.245], color: '#151d12', head: true, emissive: '#1b0a0a' },
    { size: [0.1, 0.06, 0.02], at: [0.11, 1.76, -0.245], color: '#151d12', head: true, emissive: '#1b0a0a' },
    // Arms reach forward (rotated at pose time).
    { size: [0.22, 0.7, 0.22], at: [-0.37, 1.13, 0], color: '#5f9a4a', swing: 0.25 },
    { size: [0.22, 0.7, 0.22], at: [0.37, 1.13, 0], color: '#5f9a4a', swing: -0.25 },
    { size: [0.23, 0.76, 0.24], at: [-0.12, 0.38, 0], color: '#3b3f8c', swing: 1 },
    { size: [0.23, 0.76, 0.24], at: [0.12, 0.38, 0], color: '#3b3f8c', swing: -1 },
  ],
  spider: [
    { size: [0.62, 0.42, 0.56], at: [0, 0.48, 0.32], color: '#2b2523' },
    { size: [0.42, 0.36, 0.42], at: [0, 0.46, -0.16], color: '#352d2a' },
    { size: [0.4, 0.36, 0.34], at: [0, 0.5, -0.5], color: '#2b2523', head: true },
    { size: [0.08, 0.06, 0.02], at: [-0.1, 0.56, -0.68], color: '#ff2a1f', head: true, emissive: '#ff2a1f' },
    { size: [0.08, 0.06, 0.02], at: [0.1, 0.56, -0.68], color: '#ff2a1f', head: true, emissive: '#ff2a1f' },
    ...[-0.3, -0.12, 0.06, 0.24].flatMap((z, i): Part[] => [
      { size: [0.7, 0.08, 0.08], at: [-0.5, 0.48, z - 0.16], color: '#1f1a19', swing: i % 2 === 0 ? 0.6 : -0.6 },
      { size: [0.7, 0.08, 0.08], at: [0.5, 0.48, z - 0.16], color: '#1f1a19', swing: i % 2 === 0 ? -0.6 : 0.6 },
    ]),
  ],
};

/** What a mob needs to be a person: the renderer's character system and a unique id. */
export interface MobContext {
  system: CharacterSystem;
  id: string;
}

/**
 * A box of `size` whose edges and corners are rounded with `radius`: every vertex of a subdivided box is
 * pushed to `radius` from the inner box, which gives soft animal forms with correct normals.
 */
export function roundedBox(size: readonly [number, number, number], radius: number, segments = 5): BoxGeometry {
  const g = new BoxGeometry(size[0], size[1], size[2], segments, segments, segments);
  const r = Math.max(0, Math.min(radius, Math.min(size[0], size[1], size[2]) / 2 - 1e-4));
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const hx = size[0] / 2 - r;
  const hy = size[1] / 2 - r;
  const hz = size[2] / 2 - r;
  const d = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ix = Math.max(-hx, Math.min(hx, x));
    const iy = Math.max(-hy, Math.min(hy, y));
    const iz = Math.max(-hz, Math.min(hz, z));
    d.set(x - ix, y - iy, z - iz);
    const len = d.length();
    if (len > 1e-6) {
      d.multiplyScalar(1 / len);
      pos.setXYZ(i, ix + d.x * r, iy + d.y * r, iz + d.z * r);
      nor.setXYZ(i, d.x, d.y, d.z);
    }
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Tileable value noise (greyscale, `size`² texels, `cells` lattice cells) for fur and skin bump. */
export function noiseTexture(size: number, cells: number, seed: number, contrast = 1): DataTexture {
  const lattice = new Float32Array(cells * cells);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < lattice.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    lattice[i] = (s >>> 0) / 4294967296;
  }
  const data = new Uint8Array(size * size);
  const at = (x: number, y: number): number => lattice[(((y % cells) + cells) % cells) * cells + (((x % cells) + cells) % cells)] as number;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cells;
      const gy = (y / size) * cells;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = gx - x0;
      const ty = gy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      const v = a + (b - a) * sy;
      data[y * size + x] = Math.round(Math.max(0, Math.min(1, 0.5 + (v - 0.5) * contrast)) * 255);
    }
  }
  const t = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Fur / skin look per mob kind: bump texture lattice, bump strength and roughness. */
const SURFACE: Readonly<Record<MobModelKind, { cells: number; bump: number; rough: number; radius: number }>> = {
  sheep: { cells: 14, bump: 2.4, rough: 0.97, radius: 0.5 },
  pig: { cells: 28, bump: 0.5, rough: 0.7, radius: 0.42 },
  chicken: { cells: 20, bump: 1.1, rough: 0.9, radius: 0.45 },
  zombie: { cells: 20, bump: 0.8, rough: 0.85, radius: 0.3 },
  spider: { cells: 24, bump: 1.4, rough: 0.55, radius: 0.4 },
};

/** Shared geometries / materials of the mob models (one set per layer). */
export class MobKit {
  private readonly geometries = new Map<string, BufferGeometry>();
  private readonly materials = new Map<string, MeshStandardMaterial>();
  private readonly textures = new Map<string, DataTexture>();

  geometry(size: readonly [number, number, number], limbTop: boolean, kind: MobModelKind = 'pig'): BufferGeometry {
    const key = `${size.join(',')}|${limbTop ? 1 : 0}|${kind}`;
    let g = this.geometries.get(key);
    if (!g) {
      const r = (SURFACE[kind].radius * Math.min(size[0], size[1], size[2])) / (limbTop ? 1.6 : 1) ;
      g = roundedBox(size, r, size[1] > 0.6 || size[2] > 0.6 ? 6 : 4);
      // Limbs pivot at their top edge.
      if (limbTop) g.translate(0, -size[1] / 2, 0);
      this.geometries.set(key, g);
    }
    return g;
  }

  private noise(kind: MobModelKind): DataTexture {
    let t = this.textures.get(kind);
    if (!t) {
      const s = SURFACE[kind];
      t = noiseTexture(64, s.cells, 0x9e3779b1 ^ (kind.length * 7919), 1.7);
      this.textures.set(kind, t);
    }
    return t;
  }

  material(color: string, emissive?: string, kind: MobModelKind = 'pig'): MeshStandardMaterial {
    const key = `${color}|${emissive ?? ''}|${kind}`;
    let m = this.materials.get(key);
    if (!m) {
      const s = SURFACE[kind];
      const n = this.noise(kind);
      m = new MeshStandardMaterial({
        color,
        roughness: s.rough,
        metalness: 0,
        map: null,
        bumpMap: n,
        bumpScale: s.bump,
        ...(emissive ? { emissive, emissiveIntensity: 1.4 } : {}),
      });
      this.materials.set(key, m);
    }
    return m;
  }

  dispose(): void {
    for (const g of this.geometries.values()) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    for (const t of this.textures.values()) t.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
  }
}

const HURT = new Color('#ff3b30');

/** One posed mob instance. */
export class MobModel {
  readonly group = new Group();
  private readonly limbs: Array<{ mesh: Mesh; swing: number; arm: boolean }> = [];
  private readonly heads: Mesh[] = [];
  private readonly own: Material[] = [];
  private hurt = false;

  private person: { system: CharacterSystem; id: string } | null = null;
  private readonly standIn = new Group();

  constructor(
    readonly kind: MobModelKind,
    kit: MobKit,
    context?: MobContext,
  ) {
    this.group.name = `aether:mob-${kind}`;
    this.group.add(this.standIn);
    for (const p of PARTS[kind]) {
      const limb = p.swing !== undefined;
      // Each mob owns its materials' clones so a hurt flash tints only this mob.
      const base = kit.material(p.color, p.emissive, kind);
      const mat = base.clone();
      this.own.push(mat);
      const mesh = new Mesh(kit.geometry(p.size, limb, kind), mat);
      mesh.position.set(p.at[0], p.at[1] + (limb ? p.size[1] / 2 : 0), p.at[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      this.standIn.add(mesh);
      if (limb) this.limbs.push({ mesh, swing: p.swing as number, arm: kind === 'zombie' && Math.abs(p.swing as number) < 0.5 });
      if (p.head) this.heads.push(mesh);
    }
    if (kind === 'zombie' && context) void this.mountPerson(context);
  }

  /** Replace the stand-in with a rigged person: dark ragged clothes, a hurt, shambling gait, the rig tracks the group's motion. */
  private async mountPerson(context: MobContext): Promise<void> {
    const id = `aether:mob:${context.id}`;
    try {
      const look = resolveLook({ wardrobe: 'bandit', mood: 'hurt', top: '#4a5a3c', bottom: '#26282e', hair: '#241f1b', scale: 1.04 }, id);
      const rig = await context.system.add(id, look, this.group, { footOffset: 0, track: this.group, castShadow: true, autoMotion: true });
      if (!rig) return;
      if (this.disposed) {
        context.system.remove(id);
        return;
      }
      this.person = { system: context.system, id };
      this.standIn.visible = false;
      this.limbs.length = 0;
      this.heads.length = 0;
    } catch {
      // The stand-in stays.
    }
  }

  private disposed = false;

  /**
   * Pose: feet position, body yaw (radians, 0 faces −Z), walk phase
   * (radians, advancing with distance walked), walk amount 0…1, head pitch
   * offset and hurt flash.
   */
  pose(x: number, y: number, z: number, yaw: number, phase: number, amount: number, hurt: boolean): void {
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    if (this.person) return;
    const s = Math.sin(phase) * 0.7 * amount;
    for (let i = 0; i < this.limbs.length; i++) {
      const l = this.limbs[i] as { mesh: Mesh; swing: number; arm: boolean };
      if (this.kind === 'spider') l.mesh.rotation.y = s * l.swing * 0.6;
      else if (l.arm) l.mesh.rotation.x = -Math.PI / 2 + s * 0.15 * Math.sign(l.swing);
      else l.mesh.rotation.x = s * l.swing;
    }
    for (let i = 0; i < this.heads.length; i++) (this.heads[i] as Mesh).rotation.x = Math.sin(phase * 0.5) * 0.05 * amount;
    if (hurt !== this.hurt) {
      this.hurt = hurt;
      for (const m of this.own) {
        const sm = m as MeshStandardMaterial;
        if (hurt) {
          sm.userData['base'] ??= sm.emissive.getHex();
          sm.emissive.copy(HURT);
          sm.emissiveIntensity = 0.9;
        } else {
          sm.emissive.setHex((sm.userData['base'] as number | undefined) ?? 0);
          sm.emissiveIntensity = sm.userData['base'] ? 1.4 : 1;
        }
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.person?.system.remove(this.person.id);
    this.person = null;
    for (const m of this.own) m.dispose();
    this.group.removeFromParent();
  }
}
