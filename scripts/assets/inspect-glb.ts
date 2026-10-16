/** Dev helper: load a library GLB in Node and print its skinned bounds at rest and at a clip time. `npx tsx scripts/assets/inspect-glb.ts <file.glb> [clip] [t]` */
import { readFileSync } from 'node:fs';
import { AnimationMixer, Box3, SkinnedMesh, Vector3, type Object3D } from 'three';
(globalThis as unknown as { self: unknown }).self = globalThis;
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');

const buf = readFileSync(process.argv[2] as string);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
const bounds = (label: string): void => {
  gltf.scene.updateMatrixWorld(true);
  const box = new Box3();
  const v = new Vector3();
  gltf.scene.traverse((o: Object3D) => {
    if (o instanceof SkinnedMesh) {
      o.skeleton.update();
      const p = o.geometry.attributes['position']!;
      for (let i = 0; i < p.count; i++) box.expandByPoint(o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld));
    }
  });
  console.log(label, box.min.toArray().map((x) => x.toFixed(2)).join(','), '->', box.max.toArray().map((x) => x.toFixed(2)).join(','));
};
bounds('rest');
const name = process.argv[3] ?? 'idle';
const clip = gltf.animations.find((c) => c.name === name);
const names: string[] = [];
gltf.scene.traverse((o: Object3D) => names.push(o.name));
console.log('nodes', names.length, 'duplicates', names.filter((n, i) => names.indexOf(n) !== i).slice(0, 5).join(','));
if (clip) {
  let bad = 0;
  for (const t of clip.tracks) if (!gltf.scene.getObjectByName(t.name.split('.')[0] as string)) bad++;
  console.log('tracks', clip.tracks.length, 'unmatched', bad, 'first', clip.tracks.slice(0, 3).map((t) => t.name).join(' '));
  for (const t of clip.tracks) {
    const [nodeName, prop] = t.name.split('.');
    const o = gltf.scene.getObjectByName(nodeName as string);
    if (!o) continue;
    const rest = prop === 'quaternion' ? o.quaternion.toArray() : prop === 'position' ? o.position.toArray() : o.scale.toArray();
    const first = Array.from(t.values).slice(0, rest.length);
    const d = Math.max(...rest.map((x, i) => Math.abs(x - (first[i] as number))));
    if (d > 0.3) console.log(' differs', t.name, 'rest', rest.map((x) => x.toFixed(2)).join(','), 'first', first.map((x) => x.toFixed(2)).join(','));
  }
  const m = new AnimationMixer(gltf.scene);
  m.clipAction(clip).play();
  m.update(Number(process.argv[4] ?? 0.4));
  bounds(`${name}@${process.argv[4] ?? 0.4}`);
}
console.log('clips', gltf.animations.map((c) => `${c.name}:${c.duration.toFixed(2)}`).join(' '));
