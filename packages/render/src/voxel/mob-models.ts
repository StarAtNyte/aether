/**
 * Blocky mob models (sheep, pig, chicken, zombie, spider) built from boxes,
 * with walk-cycle limbs, a turning head and a red hurt flash. Geometries
 * and materials are shared by every mob of a kind; a mob is one Group of a
 * handful of meshes, posed in place every frame without allocating.
 */
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, type Material } from 'three';

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

/** Shared geometries / materials of the mob models (one set per layer). */
export class MobKit {
  private readonly geometries = new Map<string, BoxGeometry>();
  private readonly materials = new Map<string, MeshStandardMaterial>();

  geometry(size: readonly [number, number, number], limbTop: boolean): BoxGeometry {
    const key = `${size.join(',')}|${limbTop ? 1 : 0}`;
    let g = this.geometries.get(key);
    if (!g) {
      g = new BoxGeometry(size[0], size[1], size[2]);
      // Limbs pivot at their top edge.
      if (limbTop) g.translate(0, -size[1] / 2, 0);
      this.geometries.set(key, g);
    }
    return g;
  }

  material(color: string, emissive?: string): MeshStandardMaterial {
    const key = `${color}|${emissive ?? ''}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, flatShading: true, ...(emissive ? { emissive, emissiveIntensity: 1.4 } : {}) });
      this.materials.set(key, m);
    }
    return m;
  }

  dispose(): void {
    for (const g of this.geometries.values()) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.geometries.clear();
    this.materials.clear();
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

  constructor(
    readonly kind: MobModelKind,
    kit: MobKit,
  ) {
    this.group.name = `aether:mob-${kind}`;
    for (const p of PARTS[kind]) {
      const limb = p.swing !== undefined;
      // Each mob owns its materials' clones so a hurt flash tints only this mob.
      const base = kit.material(p.color, p.emissive);
      const mat = base.clone();
      this.own.push(mat);
      const mesh = new Mesh(kit.geometry(p.size, limb), mat);
      mesh.position.set(p.at[0], p.at[1] + (limb ? p.size[1] / 2 : 0), p.at[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      this.group.add(mesh);
      if (limb) this.limbs.push({ mesh, swing: p.swing as number, arm: kind === 'zombie' && Math.abs(p.swing as number) < 0.5 });
      if (p.head) this.heads.push(mesh);
    }
  }

  /**
   * Pose: feet position, body yaw (radians, 0 faces −Z), walk phase
   * (radians, advancing with distance walked), walk amount 0…1, head pitch
   * offset and hurt flash.
   */
  pose(x: number, y: number, z: number, yaw: number, phase: number, amount: number, hurt: boolean): void {
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
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
    for (const m of this.own) m.dispose();
    this.group.removeFromParent();
  }
}
