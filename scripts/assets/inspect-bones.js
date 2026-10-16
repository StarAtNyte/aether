/** Dev helper: print bone local transforms and the first clip frame of an FBX. */
import { Bone, Vector3 } from 'three';
import { readFbx } from '../characters/fbx-node';
const g = readFbx(process.argv[2]);
g.updateMatrixWorld(true);
let n = 0;
g.traverse((o) => {
    if (o instanceof Bone && n++ < 12) {
        const ws = new Vector3().setFromMatrixScale(o.matrixWorld);
        console.log(o.name, 'parent', o.parent?.name, 'pos', o.position.toArray().map((x) => x.toFixed(3)).join(','), 'scale', o.scale.toArray().map((x) => x.toFixed(2)).join(','), 'worldScale', ws.x.toFixed(2), 'rotQ', o.quaternion.toArray().map((x) => x.toFixed(2)).join(','));
    }
});
const clip = g.animations.find((c) => /Idle/.test(c.name));
for (const t of clip?.tracks.slice(0, 9) ?? [])
    console.log(t.name, Array.from(t.times).slice(0, 3).join(','), Array.from(t.values).slice(0, 8).map((x) => x.toFixed(3)).join(','));
