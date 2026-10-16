/** Dev helper: print the structure of an FBX (meshes, bones, clips). `npx tsx scripts/assets/inspect-fbx.ts <file.fbx>` */
import { Bone, Box3, Mesh, SkinnedMesh, type BufferAttribute, type Material, type Object3D } from 'three';
import { readFbx } from '../characters/fbx-node';

if (process.argv.length < 3) throw new Error('usage: inspect-fbx <file.fbx>…');
for (const file of process.argv.slice(2)) inspect(file);

function inspect(file: string): void {
console.log('##', file.split('/').pop());
const g = readFbx(file);
g.updateMatrixWorld(true);
const box = new Box3().setFromObject(g);
console.log('bbox', box.min.toArray().map((x) => x.toFixed(2)), box.max.toArray().map((x) => x.toFixed(2)));
const bones: string[] = [];
g.traverse((o: Object3D) => {
  if (o instanceof Bone) bones.push(o.name);
  if (o instanceof Mesh) {
    const mats = (Array.isArray(o.material) ? o.material : [o.material]) as Material[];
    console.log(o instanceof SkinnedMesh ? 'skinned' : 'mesh', o.name, 'verts', o.geometry.attributes['position']?.count, 'attrs', Object.keys(o.geometry.attributes).join(','), 'mats', mats.map((m) => `${m.name}:${(m as unknown as { color?: { getHexString(): string } }).color?.getHexString()}`).join(' '), 'scale', o.scale.toArray().join(','));
    const col = o.geometry.attributes['color'] as BufferAttribute | undefined;
    if (col) {
      console.log('color itemSize', col.itemSize, 'first', [0, 1, 2].map((i) => [col.getX(i), col.getY(i), col.getZ(i)].map((x) => x.toFixed(2)).join('/')).join(' '));
      for (const gr of o.geometry.groups) {
        const vi = o.geometry.index ? o.geometry.index.getX(gr.start) : gr.start;
        console.log(' group mat', gr.materialIndex, 'count', gr.count, 'color', col.getX(vi).toFixed(2), col.getY(vi).toFixed(2), col.getZ(vi).toFixed(2));
      }
    }
  }
});
console.log('bones', bones.length, bones.slice(0, 40).join(' | '));
g.traverse((o: Object3D) => {
  if (o instanceof Bone && !(o.parent instanceof Bone)) console.log('root bone', o.name, 'parent', o.parent?.name, 'parent scale', o.parent?.scale.toArray().join(','), 'pos', o.position.toArray().join(','));
});
for (const c of g.animations) console.log('clip', c.name, c.duration.toFixed(2), 'tracks', c.tracks.length, c.tracks.slice(0, 3).map((t) => `${t.name}[${t.values.length}]`).join(','));
}
