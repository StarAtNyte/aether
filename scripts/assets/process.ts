/**
 * glTF processing steps for the library build (Node only, via
 * glTF-Transform core + meshoptimizer):
 *
 * - {@link normaliseAndMerge}: bake every node transform plus the
 *   normalisation (metres, base on y = 0, centred on X/Z) into the vertex
 *   data and merge primitives that share a material, so a static model is a
 *   handful of draw calls. Skinned / animated models keep their hierarchy
 *   and get a normalising root node instead.
 * - {@link simplifyDocument}: meshoptimizer simplification for LOD files.
 * - {@link colliderFor}: box, capsule or 26-direction support-point hull.
 */
import { Document, Primitive, getBounds, type Accessor, type Material, type Node } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';

type Vec3 = [number, number, number];
type Mat4 = number[];

/** Bounds of every mesh in the default scene (node transforms applied). */
export function sceneBounds(doc: Document): { min: Vec3; max: Vec3 } {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) throw new Error('document has no scene');
  const b = getBounds(scene);
  return { min: [b.min[0], b.min[1], b.min[2]], max: [b.max[0], b.max[1], b.max[2]] };
}

/** True when the model must keep its node hierarchy (skins or animations). */
export function isAnimated(doc: Document): boolean {
  return doc.getRoot().listSkins().length > 0 || doc.getRoot().listAnimations().length > 0;
}

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
    o[c * 4 + r] = s;
  }
  return o;
}

/** Normal matrix (inverse transpose of the upper 3×3), column-major 3×3. */
function normalMatrix(m: Mat4): number[] {
  const a = m[0]!, b = m[1]!, c = m[2]!, d = m[4]!, e = m[5]!, f = m[6]!, g = m[8]!, h = m[9]!, i = m[10]!;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const inv = Math.abs(det) > 1e-20 ? 1 / det : 0;
  // inverse transpose == cofactor matrix / det
  return [A * inv, B * inv, C * inv, -(b * i - c * h) * inv, (a * i - c * g) * inv, -(a * h - b * g) * inv, (b * f - c * e) * inv, -(a * f - c * d) * inv, (a * e - b * d) * inv];
}

interface Bucket {
  material: Material | null;
  hasUv: boolean;
  hasColor: boolean;
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
}

function readElement(acc: Accessor, i: number, out: number[]): number[] {
  acc.getElement(i, out);
  return out;
}

/**
 * Bake transforms + normalisation into the geometry and merge by material.
 * Returns the number of triangles. Only for static models.
 */
export function normaliseAndMerge(doc: Document, scale: number, offset: Vec3, flip = false): number {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0]!;
  // Optional 180° turn about Y (front +Z → −Z) folded into the uniform scale.
  const f = flip ? -scale : scale;
  const norm: Mat4 = [f, 0, 0, 0, 0, scale, 0, 0, 0, 0, f, 0, flip ? -offset[0] : offset[0], offset[1], flip ? -offset[2] : offset[2], 1];
  const buckets = new Map<string, Bucket>();
  const tmp: number[] = [0, 0, 0, 0];
  const nodes: Node[] = [];
  scene.traverse((n) => nodes.push(n));
  for (const node of nodes) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = mul(norm, node.getWorldMatrix() as unknown as Mat4);
    const nm = normalMatrix(m);
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== Primitive.Mode.TRIANGLES) continue;
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const nor = prim.getAttribute('NORMAL');
      const uv = prim.getAttribute('TEXCOORD_0');
      const col = prim.getAttribute('COLOR_0');
      const mat = prim.getMaterial();
      const key = `${mat ? root.listMaterials().indexOf(mat) : -1}|${uv ? 1 : 0}|${col ? 1 : 0}`;
      let b = buckets.get(key);
      if (!b) {
        b = { material: mat, hasUv: !!uv, hasColor: !!col, positions: [], normals: [], uvs: [], colors: [], indices: [] };
        buckets.set(key, b);
      }
      const base = b.positions.length / 3;
      const count = pos.getCount();
      for (let i = 0; i < count; i++) {
        const p = readElement(pos, i, tmp);
        const x = p[0]!, y = p[1]!, z = p[2]!;
        b.positions.push(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!);
        if (nor) {
          const q = readElement(nor, i, tmp);
          const nx = nm[0]! * q[0]! + nm[3]! * q[1]! + nm[6]! * q[2]!;
          const ny = nm[1]! * q[0]! + nm[4]! * q[1]! + nm[7]! * q[2]!;
          const nz = nm[2]! * q[0]! + nm[5]! * q[1]! + nm[8]! * q[2]!;
          const l = Math.hypot(nx, ny, nz) || 1;
          b.normals.push(nx / l, ny / l, nz / l);
        } else b.normals.push(0, 1, 0);
        if (uv) {
          const t = readElement(uv, i, tmp);
          b.uvs.push(t[0]!, t[1]!);
        }
        if (col) {
          const c = readElement(col, i, tmp);
          b.colors.push(c[0]!, c[1]!, c[2]!, col.getElementSize() === 4 ? c[3]! : 1);
        }
      }
      const idx = prim.getIndices();
      const flip = det3(m) < 0;
      if (idx) {
        const n = idx.getCount();
        for (let i = 0; i + 2 < n; i += 3) {
          const a = idx.getScalar(i) + base, c = idx.getScalar(i + 1) + base, d = idx.getScalar(i + 2) + base;
          if (flip) b.indices.push(a, d, c);
          else b.indices.push(a, c, d);
        }
      } else {
        for (let i = 0; i + 2 < count; i += 3) {
          if (flip) b.indices.push(base + i, base + i + 2, base + i + 1);
          else b.indices.push(base + i, base + i + 1, base + i + 2);
        }
      }
    }
  }
  // Drop the old graph.
  for (const child of scene.listChildren()) scene.removeChild(child);
  for (const n of root.listNodes()) n.dispose();
  for (const m of root.listMeshes()) m.dispose();
  for (const a of root.listAccessors()) a.dispose();
  for (const c of root.listCameras()) c.dispose();
  const buffer = root.listBuffers()[0] ?? doc.createBuffer();
  for (const extra of root.listBuffers().slice(1)) extra.dispose();
  const mesh = doc.createMesh('model');
  let tris = 0;
  for (const b of buckets.values()) {
    if (b.indices.length === 0) continue;
    const vcount = b.positions.length / 3;
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(b.positions)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(b.normals)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(vcount > 65535 ? new Uint32Array(b.indices) : new Uint16Array(b.indices)).setBuffer(buffer));
    if (b.hasUv) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(b.uvs)).setBuffer(buffer));
    if (b.hasColor) prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(new Float32Array(b.colors)).setBuffer(buffer));
    if (b.material) prim.setMaterial(b.material);
    mesh.addPrimitive(prim);
    tris += b.indices.length / 3;
  }
  scene.addChild(doc.createNode('model').setMesh(mesh));
  // Unused materials / textures (e.g. from dropped non-triangle primitives).
  const used = new Set(mesh.listPrimitives().map((p) => p.getMaterial()));
  for (const m of root.listMaterials()) if (!used.has(m)) m.dispose();
  const usedTex = new Set<unknown>();
  for (const m of root.listMaterials()) for (const t of [m.getBaseColorTexture(), m.getNormalTexture(), m.getMetallicRoughnessTexture(), m.getOcclusionTexture(), m.getEmissiveTexture()]) if (t) usedTex.add(t);
  for (const t of root.listTextures()) if (!usedTex.has(t)) t.dispose();
  return tris;
}

function det3(m: Mat4): number {
  return m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) - m[4]! * (m[1]! * m[10]! - m[2]! * m[9]!) + m[8]! * (m[1]! * m[6]! - m[2]! * m[5]!);
}

/** Wrap an animated / skinned model in a normalising root node. Returns its triangle count. */
export function normaliseAnimated(doc: Document, scale: number, offset: Vec3, flip = false): number {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0]!;
  const wrapper = doc
    .createNode('asset-root')
    .setScale([scale, scale, scale])
    .setRotation(flip ? [0, 1, 0, 0] : [0, 0, 0, 1])
    .setTranslation(flip ? [-offset[0], offset[1], -offset[2]] : offset);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    wrapper.addChild(child);
  }
  scene.addChild(wrapper);
  for (const c of root.listCameras()) c.dispose();
  let tris = 0;
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) tris += Math.floor((p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3);
  return tris;
}

/**
 * Simplify every primitive to about `ratio` of its triangles (meshoptimizer,
 * attribute-blind). Returns the new triangle count.
 */
export async function simplifyDocument(doc: Document, ratio: number, maxError = 0.05): Promise<number> {
  await MeshoptSimplifier.ready;
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      if (!pos || !idx) continue;
      const positions = new Float32Array(pos.getCount() * 3);
      const t: number[] = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, t);
        positions.set(t, i * 3);
      }
      const indices = new Uint32Array(idx.getCount());
      for (let i = 0; i < indices.length; i++) indices[i] = idx.getScalar(i);
      const target = Math.max(3, Math.floor((indices.length / 3) * ratio) * 3);
      // UV / normal seams split vertices, so locking borders would freeze most edges; LOD files are
      // only drawn when small on screen, where a hairline seam is invisible.
      let [out] = MeshoptSimplifier.simplify(indices, positions, 3, target, maxError, []);
      // Photoscanned meshes with a vertex per triangle (UV seams everywhere) stall far above the target: for the
      // outdoor set (`maxError` raised) fall back to the topology-free simplifier, which keeps original vertices.
      if (maxError > 0.05 && out.length > target * 1.25) [out] = MeshoptSimplifier.simplifySloppy(indices, positions, 3, null, target, 1);
      tris += out.length / 3;
      // Drop the vertices no triangle uses any more (and renumber), or the file keeps the source's full vertex buffers.
      const used = new Int32Array(pos.getCount()).fill(-1);
      let kept = 0;
      for (let i = 0; i < out.length; i++) if (used[out[i]!] === -1) used[out[i]!] = kept++;
      const remapped = new Uint32Array(out.length);
      for (let i = 0; i < out.length; i++) remapped[i] = used[out[i]!]!;
      for (const semantic of prim.listSemantics()) {
        const acc = prim.getAttribute(semantic)!;
        const size = acc.getElementSize();
        const old = acc.getArray()!;
        const next = new (old.constructor as new (n: number) => typeof old)(kept * size);
        for (let v = 0; v < used.length; v++) {
          const to = used[v]!;
          if (to !== -1) for (let k = 0; k < size; k++) next[to * size + k] = old[v * size + k]!;
        }
        acc.setArray(next);
      }
      idx.setArray(kept > 65535 ? remapped : new Uint16Array(remapped));
    }
  }
  return tris;
}

/** 26 directions: cube faces, edges and corners. */
const DIRS: Vec3[] = [];
for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) {
  const l = Math.hypot(x, y, z);
  DIRS.push([x / l, y / l, z / l]);
}

/** Every vertex position of the default scene in final (normalised) space. */
export function scenePositions(doc: Document): Float32Array {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0]!;
  const out: number[] = [];
  const t: number[] = [0, 0, 0];
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const m = node.getWorldMatrix() as unknown as Mat4;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, t);
        const x = t[0]!, y = t[1]!, z = t[2]!;
        out.push(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!);
      }
    }
  });
  return new Float32Array(out);
}

/** Support points (one per direction, deduplicated) as centimetre integers. */
export function hullPoints(positions: Float32Array): number[] {
  const picked = new Set<number>();
  for (const d of DIRS) {
    let best = -Infinity;
    let bi = -1;
    for (let i = 0; i < positions.length; i += 3) {
      const s = positions[i]! * d[0] + positions[i + 1]! * d[1] + positions[i + 2]! * d[2];
      if (s > best) {
        best = s;
        bi = i;
      }
    }
    if (bi >= 0) picked.add(bi);
  }
  const out: number[] = [];
  const seen = new Set<string>();
  for (const i of picked) {
    const p = [Math.round(positions[i]! * 100), Math.round(positions[i + 1]! * 100), Math.round(positions[i + 2]! * 100)];
    const k = p.join(',');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(...p);
  }
  return out;
}
