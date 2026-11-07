/** Read the Biped bones (names, parents, rest transforms) of a library body. */
import { NodeIO, type Node } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import type { SourceBone } from './skeleton';

export async function gltfIO(): Promise<NodeIO> {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  return new NodeIO().registerExtensions([EXTMeshoptCompression, EXTTextureWebP]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
}

/** Bones of the body at `file`, parents first. */
export async function readBones(file: string): Promise<SourceBone[]> {
  const doc = await (await gltfIO()).read(file);
  const top = doc.getRoot().listScenes()[0]?.listChildren().find((n) => n.getName() === 'Bip01');
  if (!top) throw new Error(`no Bip01 in ${file}`);
  const out: SourceBone[] = [];
  const walk = (n: Node, parent: string | null): void => {
    const t = n.getTranslation();
    const r = n.getRotation();
    out.push({ name: n.getName(), parent, t: [t[0], t[1], t[2]], r: [r[0], r[1], r[2], r[3]] });
    for (const c of n.listChildren()) walk(c, n.getName());
  };
  walk(top, null);
  return out;
}
