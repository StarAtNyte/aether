/**
 * Per-entity render bookkeeping owned by {@link SceneSync}.
 */
import { Group } from 'three';
/** Key under `Object3D.userData` holding the owning entity id. */
export const ENTITY_ID_KEY = 'aetherId';
/** Create an empty node for an entity. */
export function createEntityNode(entity, transient) {
    const object = new Group();
    object.name = entity.id;
    object.userData[ENTITY_ID_KEY] = entity.id;
    object.matrixAutoUpdate = false;
    const content = new Group();
    content.name = 'content';
    content.matrixAutoUpdate = false;
    object.add(content);
    return {
        id: entity.id,
        entity,
        transient,
        overridden: false,
        object,
        content,
        light: null,
        keyed: null,
        partCount: 0,
        bindings: [],
        geometryKeys: [],
        modelUrl: null,
        meshBundle: null,
        instanceMatrix: null,
        instances: 0,
        field: null,
        virtual: [],
        scatterTriangles: 0,
        token: 0,
        ready: Promise.resolve(),
        pending: false,
        placeholder: false,
        failed: false,
        releases: [],
        characterBody: null,
        charToken: 0,
    };
}
