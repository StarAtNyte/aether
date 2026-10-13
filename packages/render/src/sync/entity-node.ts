/**
 * Per-entity render bookkeeping owned by {@link SceneSync}.
 */
import { Group, type InstancedBufferAttribute, type Mesh, type MeshStandardMaterial } from 'three';
import type { Entity, EntityId, MaterialSpec } from '@aether/core';
import type { KeyedOutput } from '../types';
import type { EntityLight } from './lights';
import type { MeshGeometryBundle } from '../geometry/mesh-asset';
import type { MaterialVariant } from '../materials/presets';
import type { ScatterField } from '../virtual/scatter-field';

/** Key under `Object3D.userData` holding the owning entity id. */
export const ENTITY_ID_KEY = 'aetherId';

/** A mesh whose material is derived from a generator part + the entity material. */
export interface MeshBinding {
  mesh: Mesh;
  partMaterial: MaterialSpec;
  hasColors: boolean;
  doubleSided: boolean;
  materialKey: string;
  /** Resolved transparency (transparent meshes do not cast shadows). */
  seeThrough: boolean;
  /**
   * Private material clone owned by this binding while runtime material
   * overrides (e.g. a pulsing glow) are active. Its uniforms are mutated in
   * place so per-tick changes never create or dispose GPU materials. The
   * cached `materialKey` stays retained underneath and is rebound on reset.
   */
  ownedMaterial: MeshStandardMaterial | null;
  /** Material variant of this binding when it differs from the sync's (foliage wind). */
  variant?: MaterialVariant;
}

/**
 * Scene-graph node of one entity:
 *
 * ```
 * object (Group, entity transform, userData.aetherId)
 *  ├─ content (Group: meshes / instanced meshes / model / placeholder)
 *  ├─ light (+ target), when entity.light is set
 *  └─ child entity objects
 * ```
 */
export interface EntityNode {
  readonly id: EntityId;
  /** Current effective entity (document value, or a runtime override). */
  entity: Entity;
  /** Runtime spawn that is not part of the document. */
  transient: boolean;
  /** Runtime property overrides are active. */
  overridden: boolean;
  readonly object: Group;
  readonly content: Group;
  light: EntityLight | null;
  /** Mounted generator output (for scatter: the output of `shape.of`). */
  keyed: KeyedOutput | null;
  partCount: number;
  bindings: MeshBinding[];
  geometryKeys: string[];
  modelUrl: string | null;
  /** Geometry of a mounted editable mesh (`mesh` shapes), owned by this node. */
  meshBundle: MeshGeometryBundle | null;
  instanceMatrix: InstancedBufferAttribute | null;
  instances: number;
  /** Culled, LOD'd instance field (huge scatter layers) instead of one instanced mesh. */
  field: ScatterField | null;
  /**
   * Virtual-geometry stand-ins of high-poly parts: `source` stays for picking
   * (raycast-only layer), `mesh` draws the view-dependent cluster cut.
   */
  virtual: Array<{ key: string; mesh: Mesh; source: Mesh }>;
  /** Triangles drawn by this node's scatter instances (render-cost budget). */
  scatterTriangles: number;
  /** Incremented on every content rebuild; stale async results are dropped. */
  token: number;
  /** Settles when the current content build finished. */
  ready: Promise<void>;
  /** A content build is in flight. */
  pending: boolean;
  placeholder: boolean;
  /** Fallback content is shown because generation/loading failed. */
  failed: boolean;
}

/** Create an empty node for an entity. */
export function createEntityNode(entity: Entity, transient: boolean): EntityNode {
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
  };
}
