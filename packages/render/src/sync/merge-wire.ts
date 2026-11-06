import { PIECE_ORIGIN } from './merge-geometries';
import { Box3, BufferAttribute, BufferGeometry, Float16BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute, Sphere, Vector3, type TypedArray } from 'three';

interface AttributeWire { array: TypedArray; itemSize: number; normalized: boolean; count: number; stride?: number; offset?: number; half?: boolean }
interface GeometryWire { attributes: Record<string, AttributeWire>; index: AttributeWire | null }
export interface MergeRequest { geometries: GeometryWire[]; members: Array<{ geometry: number; rel: Float64Array; origin?: number[] | null }>; lightmap: Float32Array[] | null }
export interface MergeOutput { attributes: Record<string, { array: Float32Array; itemSize: number }>; index: Uint16Array | Uint32Array | null; box: number[]; sphere: number[] }

function attributeWire(attribute: BufferAttribute | InterleavedBufferAttribute): AttributeWire | null {
  const interleaved = attribute instanceof InterleavedBufferAttribute;
  const half = attribute instanceof Float16BufferAttribute;
  const prototype = interleaved ? InterleavedBufferAttribute.prototype : half ? Float16BufferAttribute.prototype : BufferAttribute.prototype;
  // A custom accessor can encode arbitrary semantics; retain its original inline path.
  if (attribute.getX !== prototype.getX || attribute.getY !== prototype.getY || attribute.getZ !== prototype.getZ) return null;
  return { array: attribute.array, itemSize: attribute.itemSize, normalized: attribute.normalized, count: attribute.count,
    ...(interleaved ? { stride: attribute.data.stride, offset: attribute.offset } : half ? { half: true } : {}) };
}

/** Pack descriptors, not per-vertex copies. postMessage clones each shared source buffer once. */
export function mergeRequest(members: readonly { geometry: BufferGeometry; rel: Float64Array; origin?: ArrayLike<number> | null }[], lightmap: Float32Array[] | null): MergeRequest | null {
  const geometries: GeometryWire[] = [], ids = new Map<BufferGeometry, number>(), entries: MergeRequest['members'] = [];
  for (const member of members) {
    let id = ids.get(member.geometry);
    if (id === undefined) {
      const attributes: GeometryWire['attributes'] = {};
      for (const name of ['position', 'normal', 'uv', 'color']) {
        const source = member.geometry.getAttribute(name);
        if (!source) continue;
        const wire = attributeWire(source); if (!wire) return null;
        attributes[name] = wire;
      }
      if (!attributes.position || !attributes.normal) return null;
      const index = member.geometry.index ? attributeWire(member.geometry.index) : null;
      if (member.geometry.index && !index) return null;
      id = geometries.length; ids.set(member.geometry, id); geometries.push({ attributes, index });
    }
    entries.push({ geometry: id, rel: member.rel, origin: member.origin ? Array.from(member.origin) : null });
  }
  return { geometries, members: entries, lightmap };
}

export function readMergeGeometry(wire: GeometryWire): BufferGeometry {
  const geometry = new BufferGeometry();
  function read(a: AttributeWire): BufferAttribute | InterleavedBufferAttribute {
    if (a.stride !== undefined) {
      const buffer = new InterleavedBuffer(a.array, a.stride); buffer.count = a.count;
      return new InterleavedBufferAttribute(buffer, a.itemSize, a.offset!, a.normalized);
    }
    const attribute = a.half ? new Float16BufferAttribute(a.array, a.itemSize, a.normalized) : new BufferAttribute(a.array, a.itemSize, a.normalized);
    // Three copies this writable runtime field too; preserve views whose active count is smaller than capacity.
    (attribute as { count: number }).count = a.count; return attribute;
  }
  for (const [name, a] of Object.entries(wire.attributes)) geometry.setAttribute(name, read(a));
  if (wire.index) geometry.setIndex(read(wire.index) as BufferAttribute);
  return geometry;
}

export function writeMergeOutput(geometry: BufferGeometry): MergeOutput {
  const attributes: MergeOutput['attributes'] = {};
  for (const [name, a] of Object.entries(geometry.attributes)) attributes[name] = { array: a.array as Float32Array, itemSize: a.itemSize };
  const box = geometry.boundingBox!, sphere = geometry.boundingSphere!;
  return { attributes, index: geometry.index?.array as Uint16Array | Uint32Array | null ?? null,
    box: [...box.min.toArray(), ...box.max.toArray()], sphere: [...sphere.center.toArray(), sphere.radius] };
}

/** Validate dimensions without rescanning world-sized buffers on the page. The worker is our own module. */
export function readMergeOutput(raw: unknown, request: MergeRequest): BufferGeometry | null {
  if (!raw || typeof raw !== 'object') return null;
  const output = raw as MergeOutput;
  const vertices = request.members.reduce((n, m) => n + request.geometries[m.geometry]!.attributes.position!.count, 0);
  const indices = request.members.reduce((n, m) => n + (request.geometries[m.geometry]!.index?.count ?? 0), 0);
  const lit = request.lightmap !== null && request.lightmap.reduce((n, uv) => n + uv.length, 0) === indices * 2;
  const count = lit ? indices : vertices;
  if (!output.attributes || !Array.isArray(output.box) || output.box.length !== 6 || !Array.isArray(output.sphere) || output.sphere.length !== 4
    || !output.box.every(value => typeof value === 'number') || !output.sphere.every(value => typeof value === 'number')) return null;
  const expected: Record<string, number> = { position: 3, normal: 3 };
  const first = request.geometries[request.members[0]?.geometry ?? 0];
  if (first?.attributes.uv) expected.uv = 2;
  if (first?.attributes.color) expected.color = 3;
  if (lit) expected.aetherLM = 2;
  if (request.members.length > 0 && request.members.every((m) => m.origin && m.origin.length === 3)) expected[PIECE_ORIGIN] = 3;
  if (Object.keys(output.attributes).length !== Object.keys(expected).length) return null;
  for (const [name, size] of Object.entries(expected)) {
    const a = output.attributes[name]; if (!a || a.itemSize !== size || !(a.array instanceof Float32Array) || a.array.length !== count * size) return null;
  }
  if (lit ? output.index !== null : !(output.index instanceof (vertices > 65535 ? Uint32Array : Uint16Array)) || output.index.length !== indices) return null;
  const geometry = new BufferGeometry();
  for (const [name, a] of Object.entries(output.attributes)) geometry.setAttribute(name, new BufferAttribute(a.array, a.itemSize));
  if (output.index) geometry.setIndex(new BufferAttribute(output.index, 1));
  geometry.boundingBox = new Box3(new Vector3().fromArray(output.box), new Vector3().fromArray(output.box, 3));
  geometry.boundingSphere = new Sphere(new Vector3().fromArray(output.sphere), output.sphere[3]);
  return geometry;
}

/** A queued result may only replace geometry whose attributes retain their captured identity and values. */
export function mergeGeometryStamp(geometries: readonly BufferGeometry[]): () => boolean {
  const tests: Array<() => boolean> = [];
  for (const geometry of new Set(geometries)) {
    for (const name of ['position', 'normal', 'uv', 'color', 'index']) {
      const a = name === 'index' ? geometry.index : geometry.getAttribute(name);
      const array = a?.array, version = a instanceof InterleavedBufferAttribute ? a.data.version : a?.version;
      const count = a?.count, itemSize = a?.itemSize, normalized = a?.normalized;
      const getters = a ? [a.getX, a.getY, a.getZ] : [];
      const stride = a instanceof InterleavedBufferAttribute ? a.data.stride : 0, offset = a instanceof InterleavedBufferAttribute ? a.offset : 0;
      tests.push(() => {
        const current = name === 'index' ? geometry.index : geometry.getAttribute(name);
        return current === a && (!a || (a.array === array && a.count === count && a.itemSize === itemSize && a.normalized === normalized
          && a.getX === getters[0] && a.getY === getters[1] && a.getZ === getters[2]
          && (a instanceof InterleavedBufferAttribute ? a.data.version === version && a.data.stride === stride && a.offset === offset : a.version === version)));
      });
    }
  }
  return () => tests.every(test => test());
}
