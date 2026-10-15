/**
 * Headless glTF 2.0 (GLB) export of a world: one node per entity, world
 * transforms baked into the vertices, PBR materials from the entity
 * materials, vertex colours where a generator painted them. Written with
 * `@gltf-transform/core` (MIT), no browser needed.
 */
import { Document, NodeIO, type Material } from '@gltf-transform/core';
import type { Scene } from './scene';

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** What {@link sceneToGlb} returns. */
export interface GlbResult {
  glb: Uint8Array;
  nodes: number;
  materials: number;
  triangles: number;
}

/** Write the scene as a binary glTF. */
export async function sceneToGlb(scene: Scene, name: string): Promise<GlbResult> {
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'Aether';
  const buffer = doc.createBuffer();
  const root = doc.createScene(name.slice(0, 64) || 'world');
  const materials = new Map<string, Material>();
  const byEntity = new Map<string, ReturnType<Document['createMesh']>>();
  let triangles = 0;
  for (const m of scene.meshes) {
    const key = [m.color.join(','), m.emissive?.join(',') ?? '', m.metalness, m.opacity].join('|');
    let mat = materials.get(key);
    if (!mat) {
      const a = m.opacity < 1 ? m.opacity : 1;
      mat = doc
        .createMaterial(`material-${materials.size + 1}`)
        .setBaseColorFactor([toLinear(m.color[0]), toLinear(m.color[1]), toLinear(m.color[2]), a])
        .setMetallicFactor(m.metalness)
        .setRoughnessFactor(Math.max(0.15, 0.85 - 0.5 * m.metalness))
        .setDoubleSided(true);
      if (a < 1) mat.setAlphaMode('BLEND');
      if (m.emissive) mat.setEmissiveFactor([toLinear(m.emissive[0]), toLinear(m.emissive[1]), toLinear(m.emissive[2])]);
      materials.set(key, mat);
    }
    const position = doc.createAccessor().setType('VEC3').setArray(m.positions as Float32Array<ArrayBuffer>).setBuffer(buffer);
    const normal = doc.createAccessor().setType('VEC3').setArray(m.normals as Float32Array<ArrayBuffer>).setBuffer(buffer);
    const indices = doc.createAccessor().setType('SCALAR').setArray(m.indices as Uint32Array<ArrayBuffer>).setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute('POSITION', position).setAttribute('NORMAL', normal).setIndices(indices).setMaterial(mat);
    if (m.vertexColors) {
      const lin = new Float32Array(m.vertexColors.length);
      for (let i = 0; i < lin.length; i++) lin[i] = Math.min(1, Math.max(0, m.vertexColors[i] as number));
      prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(lin).setBuffer(buffer));
    }
    let mesh = byEntity.get(m.id);
    if (!mesh) {
      mesh = doc.createMesh(m.id);
      byEntity.set(m.id, mesh);
      root.addChild(doc.createNode(m.id).setMesh(mesh));
    }
    mesh.addPrimitive(prim);
    triangles += m.indices.length / 3;
  }
  const glb = await new NodeIO().writeBinary(doc);
  return { glb, nodes: byEntity.size, materials: materials.size, triangles };
}
