/**
 * "Bake to mesh": turn a procedural / primitive / AI-generated object into an
 * editable mesh asset (keeping a link to its source so it can be
 * re-generated), and the reverse. Pure: returns patches.
 */
import { encodeMesh, getEntity, hasOwn, meshUsers, type Entity, type EntityId, type MaterialSpec, type Patch, type PrimitiveShape, type ProceduralShape, type WorldDoc } from '@aether/core';
import { bakeOutput, primitiveOutput, type GeneratorOutput } from '@aether/procgen';
import { freeMeshId } from './selectionOps';

/** True when the entity's shape can be baked (primitives and procedural generators). */
export function isBakeable(e: Entity | undefined): e is Entity & { shape: PrimitiveShape | ProceduralShape } {
  return !!e && (e.shape.kind === 'primitive' || e.shape.kind === 'procedural');
}

/**
 * Patches that bake `id`. `output` is the geometry currently shown (the
 * renderer's generator output); primitives are generated here when absent.
 */
export function bakePatches(world: WorldDoc, id: EntityId, output: GeneratorOutput | undefined): { patches: Patch[]; meshId: string } | { error: string } {
  const e = getEntity(world, id);
  if (!isBakeable(e)) return { error: 'Only primitives and generated objects can be converted to an editable mesh.' };
  const source = e.shape;
  const geometry = output ?? (source.kind === 'primitive' ? primitiveOutput(source) : undefined);
  if (!geometry) return { error: 'The object is still being generated; try again in a moment.' };
  let baked: ReturnType<typeof bakeOutput>;
  try {
    baked = bakeOutput(geometry);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'This object cannot be converted.' };
  }
  const meshId = freeMeshId(world, id);
  // Primitive parts carry no material: the entity material keeps styling the mesh.
  const materials: MaterialSpec[] = baked.materials.length > 0 ? baked.materials : [{}];
  const mesh = encodeMesh(meshId, baked.data, { materials, source: { shape: source } });
  const set: Record<string, unknown> = { shape: { kind: 'mesh', mesh: meshId } };
  // A heightfield collider needs a heightfield shape: meshes use exact triangles instead.
  if (e.physics?.collider === 'heightfield') set['physics'] = { collider: 'auto' };
  return { patches: [{ op: 'setMesh', mesh }, { op: 'update', id, set: set as Extract<Patch, { op: 'update' }>['set'] }], meshId };
}

/** Patches that turn a baked mesh back into its source generator (discarding hand edits). */
export function regeneratePatches(world: WorldDoc, id: EntityId): { patches: Patch[] } | { error: string } {
  const e = getEntity(world, id);
  if (!e || e.shape.kind !== 'mesh') return { error: 'This object is not an editable mesh.' };
  const asset = hasOwn(world.meshes, e.shape.mesh) ? world.meshes[e.shape.mesh] : undefined;
  const src = asset?.source?.shape;
  if (!src) return { error: 'This mesh has no generator to rebuild it from.' };
  const patches: Patch[] = [{ op: 'update', id, set: { shape: src } }];
  // The asset goes with its last user (duplicates own their own copies, but stay safe).
  if (meshUsers(world.entities, e.shape.mesh).length <= 1) patches.push({ op: 'removeMesh', id: e.shape.mesh });
  return { patches };
}
