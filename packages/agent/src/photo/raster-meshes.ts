/**
 * REAL MESHES FOR THE INSTANCE RASTER. The built room is compared with the photo through a per-piece id buffer; drawing every piece
 * as a few boxes capped a perfect build at IoU 0.67. Here each floor, surface and ceiling piece gets the mesh the renderer draws: the
 * library model (the `lite` GLB, else the lowest level of detail) or the built-in generator's output for a procedural piece. The mesh
 * is normalised to a unit box (x and z in -0.5..0.5, y in 0..1) so it fills exactly the piece's own width, height and depth, whatever
 * the origin or unit convention of the file. Loaded once per model (cached) before a measured comparison; the raster itself stays
 * synchronous. A piece whose mesh cannot be had keeps its box parts.
 */
import { catalogEntry, effectiveAssetId, libraryUrl, loadCatalog } from '@aether/assets';
import { readScene, type UnitMesh } from '@aether/arch';
import { PHOTO_BUILDING_ID } from '@aether/arch/photo';
import { generateBuiltinSync } from '@aether/procgen';
import type { Json, WorldDoc } from '@aether/core';
import { glbTriangles, type MeshoptLike, type Triangles } from './glb-geometry';

export type LibraryReader = (libraryPath: string) => Promise<Uint8Array | null>;
let reader: LibraryReader | null = null;
let meshopt: MeshoptLike | null | undefined;

/** Where library files come from (default: fetch in a browser, the `assets/lib` folder in Node). */
export function setLibraryReader(r: LibraryReader | null): void {
  reader = r;
}

async function defaultRead(path: string): Promise<Uint8Array | null> {
  try {
    if (typeof window !== 'undefined' || typeof process === 'undefined') {
      const res = await fetch(libraryUrl(path));
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    }
    const spec = 'node:fs/promises';
    const fs = (await import(/* @vite-ignore */ spec)) as typeof import('node:fs/promises');
    const dir = process.env['AETHER_LIB_DIR'] ?? `${process.cwd()}/assets/lib`;
    if (path.includes('..')) return null;
    return new Uint8Array(await fs.readFile(`${dir}/${path}`));
  } catch {
    return null;
  }
}

async function decoder(): Promise<MeshoptLike | null> {
  if (meshopt !== undefined) return meshopt;
  try {
    const spec = 'three/examples/jsm/libs/meshopt_decoder.module.js';
    const m = (await import(/* @vite-ignore */ spec)) as { MeshoptDecoder?: MeshoptLike };
    meshopt = m.MeshoptDecoder ?? null;
  } catch {
    meshopt = null;
  }
  return meshopt;
}

const cache = new Map<string, UnitMesh | null>();
/** Triangles beyond this are thinned (every n-th triangle) when the mesh is normalised: the raster is 256 px wide. */
const MAX_TRIS = 12_000;

/** Normalise triangles to the unit box (centre of the footprint at the origin, base at y = 0). */
export function toUnitMesh(t: Triangles): UnitMesh | null {
  const p = t.positions;
  if (p.length < 9) return null;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { const v = p[i + k] as number; if (v < (lo[k] as number)) lo[k] = v; if (v > (hi[k] as number)) hi[k] = v; }
  const ext = [0, 1, 2].map((k) => Math.max(1e-4, (hi[k] as number) - (lo[k] as number)));
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    out[i] = ((p[i] as number) - ((lo[0] as number) + (hi[0] as number)) / 2) / (ext[0] as number);
    out[i + 1] = ((p[i + 1] as number) - (lo[1] as number)) / (ext[1] as number);
    out[i + 2] = ((p[i + 2] as number) - ((lo[2] as number) + (hi[2] as number)) / 2) / (ext[2] as number);
  }
  const tris = t.indices.length / 3;
  const step = Math.max(1, Math.ceil(tris / MAX_TRIS));
  const idx: number[] = [];
  for (let i = 0; i < tris; i += step) idx.push(t.indices[i * 3] as number, t.indices[i * 3 + 1] as number, t.indices[i * 3 + 2] as number);
  return { positions: out, indices: Uint32Array.from(idx) };
}

function concat(parts: ReadonlyArray<{ positions: Float32Array; indices: Uint32Array }>): Triangles | null {
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.positions.length; ni += p.indices.length; }
  if (ni < 3) return null;
  const positions = new Float32Array(nv);
  const indices = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const p of parts) {
    positions.set(p.positions, ov);
    for (let i = 0; i < p.indices.length; i++) indices[oi + i] = (p.indices[i] as number) + ov / 3;
    ov += p.positions.length;
    oi += p.indices.length;
  }
  return { positions, indices };
}

async function loadKey(world: WorldDoc, entityId: string): Promise<{ key: string; mesh: UnitMesh | null } | null> {
  const e = world.entities[entityId];
  if (!e) return null;
  const shape = e.shape as { kind: string; id?: string; variant?: string; generator?: string; params?: Record<string, Json> };
  if (shape.kind === 'asset' && shape.id) {
    const id = effectiveAssetId({ id: shape.id, ...(shape.variant ? { variant: shape.variant } : {}) });
    const key = `asset:${id}`;
    if (cache.has(key)) return { key, mesh: cache.get(key) ?? null };
    const entry = catalogEntry(id);
    const file = entry ? (entry.lite ?? entry.lods[entry.lods.length - 1]?.file ?? entry.file) : null;
    let mesh: UnitMesh | null = null;
    if (file) {
      const bytes = await (reader ?? defaultRead)(file);
      const tri = bytes ? await glbTriangles(bytes, await decoder()) : null;
      mesh = tri ? toUnitMesh(tri) : null;
    }
    cache.set(key, mesh);
    return { key, mesh };
  }
  if (shape.kind === 'procedural' && shape.generator) {
    const key = `proc:${shape.generator}:${JSON.stringify(shape.params ?? {})}`;
    if (cache.has(key)) return { key, mesh: cache.get(key) ?? null };
    let mesh: UnitMesh | null = null;
    try {
      const out = generateBuiltinSync(shape.generator, (shape.params ?? {}) as Record<string, Json>, 1);
      const tri = concat(out.parts.filter((p) => !/glass|mirror/i.test(String((p.material as { name?: string } | undefined)?.name ?? ''))));
      mesh = tri ? toUnitMesh(tri) : null;
    } catch {
      mesh = null;
    }
    cache.set(key, mesh);
    return { key, mesh };
  }
  return null;
}

/** Unit meshes (by entity id) of the pieces of the photo room, loading what is not cached yet. */
export async function warmMeshes(world: WorldDoc, building: string = PHOTO_BUILDING_ID): Promise<Map<string, UnitMesh>> {
  const out = new Map<string, UnitMesh>();
  const scene = readScene(world, building);
  if (!scene) return out;
  await loadCatalog().catch(() => null);
  for (const it of scene.items) {
    if (it.mount === 'wall' || it.footprint.length !== 4) continue;
    const got = await loadKey(world, it.id);
    if (got?.mesh) out.set(it.id, got.mesh);
  }
  return out;
}

export function clearMeshCache(): void {
  cache.clear();
}
