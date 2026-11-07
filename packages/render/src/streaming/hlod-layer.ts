/**
 * The HLOD proxies of a streamed world on screen (hlod.ts; docs/ARCHITECTURE-STREAMING.md §3.3): one mesh per cell, drawn
 * while the cell's full detail is not, and swapped with it under a dithered cross-fade.
 *
 * - A proxy draws with one material of its own, a plain lit vertex-colour material with `alphaHash` (dithered
 *   transparency: no sorting, no blending), so every proxy draws with one program whatever its fade, and that program
 *   is in the cooked program set (the cook's recording draws {@link warmMesh}).
 * - The swap: when a cell's full detail has been built and shown, its proxy dithers out over {@link FADE_MS}; before a
 *   cell's full detail is taken down, its proxy dithers in over it first. The proxy draws slightly in front of the full
 *   detail (a polygon offset toward the eye), so as it thins the full detail shows through it, and as it thickens it covers.
 * - The geometry's CPU copies go once uploaded (gpu/cpu-release.ts).
 */
import { BufferAttribute, BufferGeometry, Group, Mesh, type MeshStandardMaterial } from 'three';
import type { HlodProxy } from './hlod';
import { releaseAfterUpload } from '../gpu/cpu-release';

/** Length of the dithered cross-fade between a proxy and its cell's full detail (ms). */
export const FADE_MS = 450;

interface Shown {
  mesh: Mesh;
  material: MeshStandardMaterial;
  /** Current opacity 0..1 and where it goes. */
  opacity: number;
  target: number;
  triangles: number;
}

/** The proxy material: plain lit vertex colours, dithered fade, drawn a little toward the eye. */
export type ProxyMaterialFactory = () => MeshStandardMaterial;

/** Prepare a proxy material made by the factory (shared by the proxies and {@link HlodLayer.warmMesh}). */
function configure(m: MeshStandardMaterial): MeshStandardMaterial {
  m.alphaHash = true;
  m.transparent = false;
  m.opacity = 1;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -4;
  m.userData['aetherProxy'] = true;
  return m;
}

/** A proxy's geometry: float positions, normals and colours (the attribute layout of the generated meshes). */
function proxyGeometry(p: Pick<HlodProxy, 'positions' | 'normals' | 'colors' | 'indices'>): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(p.positions, 3));
  g.setAttribute('normal', new BufferAttribute(p.normals, 3));
  g.setAttribute('color', new BufferAttribute(p.colors, 3));
  const v = p.positions.length / 3;
  g.setIndex(new BufferAttribute(v <= 65536 ? Uint16Array.from(p.indices) : p.indices, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** The proxies of one world, by cell. */
export class HlodLayer {
  readonly group = new Group();
  private readonly cells = new Map<string, Shown>();
  private warm: Mesh | null = null;

  constructor(private readonly material: ProxyMaterialFactory) {
    this.group.name = 'hlod';
  }

  /** Add the proxy of `p.cell` (hidden). Replaces an earlier one. */
  add(p: HlodProxy): void {
    this.remove(p.cell);
    const geometry = proxyGeometry(p);
    const material = configure(this.material());
    material.opacity = 0;
    const mesh = new Mesh(geometry, material);
    mesh.name = `hlod ${p.cell}`;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.userData['aetherProxyCell'] = p.cell;
    this.group.add(mesh);
    releaseAfterUpload(geometry);
    this.cells.set(p.cell, { mesh, material, opacity: 0, target: 0, triangles: p.indices.length / 3 });
  }

  /** Whether cell `key` has a proxy. */
  has(key: string): boolean {
    return this.cells.has(key);
  }

  /** Cells with a proxy. */
  keys(): IterableIterator<string> {
    return this.cells.keys();
  }

  /** Show the proxy of `key`: dithered in over {@link FADE_MS}, or at once. */
  show(key: string, instant = false): void {
    const s = this.cells.get(key);
    if (!s) return;
    s.target = 1;
    s.mesh.visible = true;
    if (instant) this.set(s, 1);
  }

  /** Hide the proxy of `key`: dithered out over {@link FADE_MS}, or at once. */
  hide(key: string, instant = false): void {
    const s = this.cells.get(key);
    if (!s) return;
    s.target = 0;
    if (instant) this.set(s, 0);
  }

  /** Whether the proxy of `key` is fully shown (true also for a cell without a proxy). */
  covered(key: string): boolean {
    const s = this.cells.get(key);
    return !s || (s.target === 1 && s.opacity >= 1);
  }

  /** Whether the proxy of `key` shows at all (fading or not). */
  shown(key: string): boolean {
    const s = this.cells.get(key);
    return !!s && s.mesh.visible;
  }

  /** Step the fades by `dtMs`. Returns whether any proxy is still fading. */
  update(dtMs: number): boolean {
    let busy = false;
    const step = Math.max(0, dtMs) / FADE_MS;
    for (const s of this.cells.values()) {
      if (s.opacity === s.target) continue;
      const next = s.target > s.opacity ? Math.min(s.target, s.opacity + step) : Math.max(s.target, s.opacity - step);
      this.set(s, next);
      if (next !== s.target) busy = true;
    }
    return busy;
  }

  private set(s: Shown, opacity: number): void {
    s.opacity = opacity;
    s.material.opacity = opacity;
    s.mesh.visible = opacity > 0;
  }

  /** Counts for diagnostics. */
  stats(): { proxies: number; shown: number; fading: number; triangles: number; shownTriangles: number } {
    let shown = 0, fading = 0, triangles = 0, shownTriangles = 0;
    for (const s of this.cells.values()) {
      triangles += s.triangles;
      if (s.mesh.visible) {
        shown++;
        shownTriangles += s.triangles;
      }
      if (s.opacity !== s.target) fading++;
    }
    return { proxies: this.cells.size, shown, fading, triangles, shownTriangles };
  }

  /**
   * A mesh that draws with the proxy program and shows nothing (one degenerate triangle at `at`, never culled): the cook's
   * recording draws it, so the proxy program is in the cooked program set and a viewer links it before its first picture.
   */
  warmMesh(at: readonly [number, number, number]): Mesh {
    if (this.warm) return this.warm;
    const z = new Float32Array([at[0], at[1], at[2], at[0], at[1], at[2], at[0], at[1], at[2]]);
    const g = proxyGeometry({ positions: z, normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), colors: new Float32Array(9).fill(0.5), indices: new Uint32Array([0, 1, 2]) });
    const mesh = new Mesh(g, configure(this.material()));
    mesh.name = 'hlod warm-up';
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.warm = mesh;
    return mesh;
  }

  private remove(key: string): void {
    const s = this.cells.get(key);
    if (!s) return;
    this.group.remove(s.mesh);
    s.mesh.geometry.dispose();
    s.material.dispose();
    this.cells.delete(key);
  }

  dispose(): void {
    for (const key of [...this.cells.keys()]) this.remove(key);
    if (this.warm) {
      this.group.remove(this.warm);
      this.warm.geometry.dispose();
      (this.warm.material as MeshStandardMaterial).dispose();
      this.warm = null;
    }
    this.group.removeFromParent();
  }
}
