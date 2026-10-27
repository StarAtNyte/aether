/**
 * Geometry of a library model (GLB, meshopt-compressed or plain) for the instance raster: world-space triangles of every mesh node,
 * no materials, textures or animation. Read in the Node/Chromium path of a photo run, where the raster has to draw the pieces the
 * way the renderer draws them (a pedestal table is a pedestal, not four legs). The bytes are untrusted data: every count and
 * offset is bounds-checked and a malformed file yields null.
 */
export interface Triangles {
  positions: Float32Array;
  indices: Uint32Array;
}

interface Json {
  buffers?: Array<{ byteLength: number }>;
  bufferViews?: Array<{ buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; extensions?: { EXT_meshopt_compression?: { buffer: number; byteOffset?: number; byteLength: number; byteStride: number; count: number; mode: string; filter?: string } } }>;
  accessors?: Array<{ bufferView?: number; byteOffset?: number; componentType: number; normalized?: boolean; count: number; type: string }>;
  meshes?: Array<{ primitives: Array<{ attributes: Record<string, number>; indices?: number; mode?: number }> }>;
  nodes?: Array<{ mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }>;
  scenes?: Array<{ nodes?: number[] }>;
  scene?: number;
}

export interface MeshoptLike {
  ready?: Promise<void>;
  decodeGltfBuffer(target: Uint8Array, count: number, size: number, source: Uint8Array, mode: string, filter?: string): void;
}

const MAX_TRIS = 400_000;
const COMPONENT: Record<number, { size: number; read: (dv: DataView, o: number) => number; norm: number }> = {
  5120: { size: 1, read: (d, o) => d.getInt8(o), norm: 127 },
  5121: { size: 1, read: (d, o) => d.getUint8(o), norm: 255 },
  5122: { size: 2, read: (d, o) => d.getInt16(o, true), norm: 32767 },
  5123: { size: 2, read: (d, o) => d.getUint16(o, true), norm: 65535 },
  5125: { size: 4, read: (d, o) => d.getUint32(o, true), norm: 1 },
  5126: { size: 4, read: (d, o) => d.getFloat32(o, true), norm: 1 },
};
const TYPE_N: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

type M4 = number[];
const mul = (a: M4, b: M4): M4 => {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += (a[k * 4 + r] as number) * (b[c * 4 + k] as number); o[c * 4 + r] = s; }
  return o;
};
const IDENT: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function nodeMatrix(n: NonNullable<Json['nodes']>[number]): M4 {
  if (n.matrix && n.matrix.length === 16) return n.matrix.map(Number);
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const x2 = qx! + qx!, y2 = qy! + qy!, z2 = qz! + qz!;
  const xx = qx! * x2, xy = qx! * y2, xz = qx! * z2, yy = qy! * y2, yz = qy! * z2, zz = qz! * z2, wx = qw! * x2, wy = qw! * y2, wz = qw! * z2;
  return [(1 - (yy + zz)) * sx!, (xy + wz) * sx!, (xz - wy) * sx!, 0, (xy - wz) * sy!, (1 - (xx + zz)) * sy!, (yz + wx) * sy!, 0, (xz + wy) * sz!, (yz - wx) * sz!, (1 - (xx + yy)) * sz!, 0, tx!, ty!, tz!, 1];
}

/** Triangles of a GLB (all mesh nodes of the default scene, in model space, metres). */
export async function glbTriangles(bytes: Uint8Array, meshopt: MeshoptLike | null): Promise<Triangles | null> {
  try {
    if (bytes.byteLength < 20) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) return null;
    let json: Json | null = null;
    let bin: Uint8Array | null = null;
    for (let o = 12; o + 8 <= bytes.byteLength;) {
      const len = dv.getUint32(o, true);
      const type = dv.getUint32(o + 4, true);
      if (o + 8 + len > bytes.byteLength) return null;
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(bytes.subarray(o + 8, o + 8 + len))) as Json;
      else if (type === 0x004e4942 && bin === null) bin = bytes.subarray(o + 8, o + 8 + len);
      o += 8 + len + ((4 - (len % 4)) % 4);
    }
    if (!json || !bin) return null;
    const views = json.bufferViews ?? [];
    const accessors = json.accessors ?? [];
    const cache = new Map<number, Uint8Array>();
    const viewBytes = async (i: number): Promise<Uint8Array | null> => {
      const hit = cache.get(i);
      if (hit) return hit;
      const v = views[i];
      if (!v) return null;
      const mo = v.extensions?.EXT_meshopt_compression;
      let out: Uint8Array;
      if (mo) {
        if (!meshopt) return null;
        await meshopt.ready;
        const off = mo.byteOffset ?? 0;
        if (off + mo.byteLength > bin!.byteLength || mo.count * mo.byteStride > 64 * 1024 * 1024) return null;
        out = new Uint8Array(mo.count * mo.byteStride);
        meshopt.decodeGltfBuffer(out, mo.count, mo.byteStride, bin!.subarray(off, off + mo.byteLength), mo.mode, mo.filter);
      } else {
        const off = v.byteOffset ?? 0;
        if (off + v.byteLength > bin!.byteLength) return null;
        out = bin!.subarray(off, off + v.byteLength);
      }
      cache.set(i, out);
      return out;
    };
    const readAccessor = async (ai: number): Promise<Float32Array | Uint32Array | null> => {
      const a = accessors[ai];
      if (!a || a.bufferView === undefined) return null;
      const comp = COMPONENT[a.componentType];
      const n = TYPE_N[a.type];
      const v = views[a.bufferView];
      const b = await viewBytes(a.bufferView);
      if (!comp || !n || !b || !v || a.count > 4_000_000) return null;
      const stride = v.byteStride && !v.extensions?.EXT_meshopt_compression ? v.byteStride : v.extensions?.EXT_meshopt_compression ? v.extensions.EXT_meshopt_compression.byteStride : comp.size * n;
      const base = a.byteOffset ?? 0;
      if (base + (a.count - 1) * stride + comp.size * n > b.byteLength) return null;
      const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const isIndex = a.type === 'SCALAR' && a.componentType !== 5126;
      const out = isIndex ? new Uint32Array(a.count) : new Float32Array(a.count * n);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) {
        const raw = comp.read(d, base + i * stride + k * comp.size);
        (out as Float32Array)[i * n + k] = a.normalized ? Math.max(-1, raw / comp.norm) : raw;
      }
      return out;
    };
    const pos: number[] = [];
    const idx: number[] = [];
    const nodes = json.nodes ?? [];
    const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, i) => i);
    let tris = 0;
    const visit = async (ni: number, parent: M4, depth: number): Promise<void> => {
      const n = nodes[ni];
      if (!n || depth > 32 || tris > MAX_TRIS) return;
      const m = mul(parent, nodeMatrix(n));
      if (n.mesh !== undefined) {
        for (const prim of json!.meshes?.[n.mesh]?.primitives ?? []) {
          if ((prim.mode ?? 4) !== 4) continue;
          const pa = prim.attributes['POSITION'];
          if (pa === undefined) continue;
          const p = (await readAccessor(pa)) as Float32Array | null;
          if (!p) continue;
          const count = p.length / 3;
          const ix = prim.indices !== undefined ? ((await readAccessor(prim.indices)) as Uint32Array | null) : Uint32Array.from({ length: count }, (_, i) => i);
          if (!ix) continue;
          const base = pos.length / 3;
          for (let i = 0; i < count; i++) {
            const x = p[i * 3]!, y = p[i * 3 + 1]!, z = p[i * 3 + 2]!;
            pos.push(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!);
          }
          for (let i = 0; i + 2 < ix.length; i += 3) { idx.push(base + ix[i]!, base + ix[i + 1]!, base + ix[i + 2]!); tris++; }
        }
      }
      for (const c of n.children ?? []) await visit(c, m, depth + 1);
    };
    for (const r of roots) await visit(r, IDENT, 0);
    if (idx.length < 3) return null;
    return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
  } catch {
    return null;
  }
}
