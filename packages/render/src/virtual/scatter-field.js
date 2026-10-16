/**
 * ScatterField — a huge instanced layer (forests, grass, boulders) drawn
 * through {@link FieldCuller}: chunk culling, automatic QEM LOD levels and a
 * per-frame triangle budget. One `InstancedMesh` per (level, part) whose
 * instance buffer holds only the instances that level draws this frame.
 *
 * Works identically on the WebGPU and WebGL2 backends: the GPU only ever
 * sees ordinary instanced draws.
 */
import { Box3, Group, InstancedBufferAttribute, InstancedMesh, Sphere, Vector3 } from 'three';
import { FieldCuller } from './field-culler';
/** Instances at or above which a scatter layer becomes a field. */
export const FIELD_MIN_INSTANCES = 2_000;
function noRaycast() {
    // Fields are picked through their bounds (SceneSync.pickScatter), never per instance.
}
/** See the module docs. */
export class ScatterField {
    group = new Group();
    /** Meshes in level-major order: `meshes[level * parts + part]`. */
    meshes = [];
    culler;
    attributes = [];
    parts;
    /**
     * @param chunks packed, chunk-sorted instances (field-local space)
     * @param levels LOD levels, finest first; every level has one geometry per part
     * @param materials one material per part
     * @param radius instance bounding radius at scale 1
     * @param budgetTriangles triangle budget per frame for this field
     */
    constructor(chunks, levels, materials, radius, budgetTriangles) {
        this.group.name = 'field';
        this.group.matrixAutoUpdate = false;
        this.parts = materials.length;
        this.culler = new FieldCuller(chunks, { lodTriangles: levels.map((l) => Math.max(1, l.triangles)), radius, budgetTriangles });
        // Whole-field bounds (picking, framing); instances are culled per chunk on the CPU.
        const box = new Box3();
        for (let c = 0; c < chunks.chunkCount; c++) {
            const b = c * 6;
            box.expandByPoint(_p.set(chunks.boxes[b], chunks.boxes[b + 1], chunks.boxes[b + 2]));
            box.expandByPoint(_p.set(chunks.boxes[b + 3], chunks.boxes[b + 4], chunks.boxes[b + 5]));
        }
        const sphere = box.isEmpty() ? new Sphere() : box.getBoundingSphere(new Sphere());
        for (let l = 0; l < levels.length; l++) {
            const level = levels[l];
            // Static usage on purpose: three re-uploads DynamicDrawUsage buffers on every draw;
            // re-plans upload through version bumps with update ranges instead.
            const attr = new InstancedBufferAttribute(this.culler.buffers[l], 16);
            this.attributes.push(attr);
            for (let p = 0; p < this.parts; p++) {
                const geometry = level.geometries[p];
                const mesh = new InstancedMesh(geometry, materials[p], 0);
                mesh.instanceMatrix = attr;
                mesh.count = 0;
                mesh.visible = false;
                mesh.frustumCulled = false;
                mesh.boundingBox = box.clone();
                mesh.boundingSphere = sphere.clone();
                mesh.raycast = noRaycast;
                mesh.matrixAutoUpdate = false;
                mesh.name = `field:l${l}:p${p}`;
                this.meshes.push(mesh);
                this.group.add(mesh);
            }
        }
    }
    /** Number of LOD levels. */
    get levels() {
        return this.attributes.length;
    }
    /**
     * Re-plan for a camera given in field-local space. Uploads only the level
     * buffers whose membership changed. Returns true when anything changed.
     */
    update(view) {
        const dirty = this.culler.update(view);
        if (dirty === 0)
            return false;
        for (let l = 0; l < this.attributes.length; l++) {
            const count = this.culler.counts[l];
            for (let p = 0; p < this.parts; p++) {
                const mesh = this.meshes[l * this.parts + p];
                mesh.count = count;
                // An empty level is not submitted at all.
                mesh.visible = count > 0;
            }
            if (!(dirty & (1 << l)))
                continue;
            const from = Math.min(count, this.culler.dirtyFrom[l]);
            if (from >= count)
                continue;
            const attr = this.attributes[l];
            // Ranges accumulate until uploaded (the renderer clears them), so two re-plans before one draw stay correct.
            attr.addUpdateRange(from * 16, (count - from) * 16);
            attr.needsUpdate = true;
        }
        return true;
    }
    /** Release the instanced meshes (geometries and materials belong to the caches). */
    dispose() {
        for (const m of this.meshes)
            m.dispose();
        this.group.clear();
    }
}
const _p = new Vector3();
