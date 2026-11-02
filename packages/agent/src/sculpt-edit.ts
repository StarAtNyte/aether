/**
 * Finishing touches as an edit: the `sculpt` tool. The assistant places a library piece (or a generator it wrote) and then
 * works it by hand like a sculptor would: chips an edge, wears a step hollow, erodes a rock, carves a groove, sags a roof.
 * A procedural or primitive object is baked to an editable mesh first (the same result as the studio's "bake to mesh":
 * the asset keeps its `source`, so it can be regenerated), then brush dabs from @aether/procgen's SculptSession move its
 * vertices. Everything lands as one patch list: one undo step, visible in the diff, saved with the world.
 */
import { z } from 'zod';
import { decodeMesh, encodeMesh, encodeMeshUpdate, getEntity, hasOwn, meshUsers, rotateVec3, worldTransform, type Entity, type MaterialSpec, type MeshAsset, type MeshData, type Patch, type ProceduralShape, type Quat, type Vec3, type WorldDoc } from '@aether/core';
import { bakeOutput, primitiveOutput, SculptSession, type GeneratorOutput } from '@aether/procgen';

export const SCULPT_MODES = ['raise', 'lower', 'smooth', 'flatten', 'noise'] as const;
export const SCULPT_FALLOFFS = ['smooth', 'linear', 'constant', 'sharp'] as const;
export const SCULPT_LIMITS = Object.freeze({ MAX_STROKES: 64, MAX_DABS: 2000, MAX_REPEAT: 50 });

const V3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

/** One stroke: dabs at a point (repeated), or along a segment to `to`. Points and radius are world metres. */
export const SculptStroke = z.object({
  mode: z.enum(SCULPT_MODES),
  at: V3,
  radius: z.number().finite().positive().max(50),
  strength: z.number().finite().min(0).max(1),
  falloff: z.enum(SCULPT_FALLOFFS).optional(),
  /** Direction raise/lower/noise move along (world); default the surface normal near `at`. */
  normal: V3.optional(),
  repeat: z.number().int().min(1).max(SCULPT_LIMITS.MAX_REPEAT).optional(),
  to: V3.optional(),
});
export type SculptStroke = z.infer<typeof SculptStroke>;

/** Input of the `sculpt` tool. */
export const SculptInput = z.object({
  id: z.string().min(1).max(64),
  strokes: z.array(SculptStroke).min(1).max(SCULPT_LIMITS.MAX_STROKES),
  message: z.string().max(200).optional(),
});
export type SculptInput = z.infer<typeof SculptInput>;

/** Why an entity cannot be sculpted, or null. Procedural shapes of `arch-*` generators are rebuilt from the building plan. */
export function sculptRefusal(e: Entity | undefined, id: string): string | null {
  if (!e) return `No entity "${id.slice(0, 64)}".`;
  if (e.locked) return `"${id}" is locked by the user.`;
  if (e.character || e.npc) return `"${id}" is a character: people and creatures are rigged and animated, not sculpted. Sculpt props, rocks and buildings pieces instead.`;
  const k = e.shape.kind;
  if (k === 'asset' || k === 'model') return `"${id}" is an imported model (${k}) with no editable geometry here. To shape it by hand, rebuild it with write_generator (api.sdf or api.library) and sculpt that.`;
  if (k === 'scatter' || k === 'none') return `"${id}" has no single surface to sculpt (${k}).`;
  if (k === 'procedural' && /^arch-/.test(e.shape.generator)) return `"${id}" is a building part (${e.shape.generator}): it is rebuilt from the plan by build_architecture, so sculpting would be lost.`;
  if (k !== 'primitive' && k !== 'procedural' && k !== 'mesh') return `"${id}" cannot be sculpted (${k}).`;
  return null;
}

/** A mesh id derived from the entity id that is free in `world` (as the studio's bake). */
function freeMeshId(world: WorldDoc, base: string): string {
  const stem = base.replace(/[^a-z0-9_-]/g, '-').slice(0, 56) || 'mesh';
  for (let n = 1; n < 10_000; n++) {
    const id = n === 1 ? `${stem}-mesh` : `${stem}-mesh-${n}`;
    if (!hasOwn(world.meshes, id)) return id;
  }
  throw new Error('no free mesh id');
}

/** World point / direction / length into the entity's local frame (inverse of position, rotation, scale). */
function localFrame(world: WorldDoc, id: string): { point: (p: Vec3) => Vec3; dir: (d: Vec3) => Vec3; length: (r: number) => number } {
  const t = worldTransform(world, id);
  const q = t.quaternion;
  const inv: Quat = [-q[0], -q[1], -q[2], q[3]];
  const s = t.scale.map((v) => (Math.abs(v) > 1e-9 ? v : 1e-9)) as Vec3;
  const mean = (Math.abs(s[0]) + Math.abs(s[1]) + Math.abs(s[2])) / 3 || 1;
  return {
    point: (p) => {
      const r = rotateVec3(inv, [p[0] - t.position[0], p[1] - t.position[1], p[2] - t.position[2]]);
      return [r[0] / s[0], r[1] / s[1], r[2] / s[2]];
    },
    // A normal transforms by the inverse transpose: rotate back, then multiply by the scale.
    dir: (d) => {
      const r = rotateVec3(inv, d);
      return [r[0] * s[0], r[1] * s[1], r[2] * s[2]];
    },
    length: (r) => r / mean,
  };
}

/** Area-weighted normal of the triangles near `c` (centroid within `radius`), else of the nearest triangle. */
function surfaceNormal(data: MeshData, c: Vec3, radius: number): Vec3 {
  const p = data.positions;
  const idx = data.indices;
  let nx = 0, ny = 0, nz = 0;
  let best = Infinity;
  let bn: Vec3 = [0, 1, 0];
  const r2 = radius * radius;
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const a = (idx[i] as number) * 3, b = (idx[i + 1] as number) * 3, d = (idx[i + 2] as number) * 3;
    const ax = p[a] as number, ay = p[a + 1] as number, az = p[a + 2] as number;
    const ux = (p[b] as number) - ax, uy = (p[b + 1] as number) - ay, uz = (p[b + 2] as number) - az;
    const vx = (p[d] as number) - ax, vy = (p[d + 1] as number) - ay, vz = (p[d + 2] as number) - az;
    // Cross product length is twice the area: summing it weights by area.
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const mx = ax + (ux + vx) / 3 - c[0], my = ay + (uy + vy) / 3 - c[1], mz = az + (uz + vz) / 3 - c[2];
    const d2 = mx * mx + my * my + mz * mz;
    if (d2 < r2) {
      nx += cx;
      ny += cy;
      nz += cz;
    }
    if (d2 < best) {
      best = d2;
      bn = [cx, cy, cz];
    }
  }
  return Math.hypot(nx, ny, nz) > 1e-12 ? [nx, ny, nz] : bn;
}

/** Distance from `c` to the nearest vertex (to explain a stroke that touched nothing). */
function nearestVertex(data: MeshData, c: Vec3): number {
  const p = data.positions;
  let best = Infinity;
  for (let i = 0; i < p.length; i += 3) best = Math.min(best, Math.hypot((p[i] as number) - c[0], (p[i + 1] as number) - c[1], (p[i + 2] as number) - c[2]));
  return best;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Patches and words for a `sculpt` call. `output` is the generator's geometry for a procedural entity (the caller runs
 * the generator; primitives are generated here).
 */
export function sculptPatches(world: WorldDoc, input: SculptInput, output?: GeneratorOutput): { patches: Patch[]; summary: string } | { error: string } {
  const e = getEntity(world, input.id);
  const refused = sculptRefusal(e, input.id);
  if (refused || !e) return { error: refused ?? 'unknown entity' };
  const shape = e.shape;
  let base: MeshData;
  let prev: MeshAsset | null = null;
  let materials: MaterialSpec[];
  let source: { shape: Extract<Entity['shape'], { kind: 'primitive' | 'procedural' }> } | undefined;
  let meshId: string;
  if (shape.kind === 'mesh') {
    if (!hasOwn(world.meshes, shape.mesh)) return { error: `"${input.id}" points at a missing mesh "${shape.mesh}".` };
    prev = world.meshes[shape.mesh] as MeshAsset;
    base = decodeMesh(prev);
    materials = prev.materials;
    // A mesh shared with duplicates is copied, so sculpting one statue does not change its twins.
    meshId = meshUsers(world.entities, shape.mesh).length > 1 ? freeMeshId(world, input.id) : shape.mesh;
  } else if (shape.kind === 'primitive' || shape.kind === 'procedural') {
    const geometry = output ?? (shape.kind === 'primitive' ? primitiveOutput(shape) : undefined);
    if (!geometry) return { error: `"${input.id}" has no generated geometry yet.` };
    let baked: ReturnType<typeof bakeOutput>;
    try {
      baked = bakeOutput(geometry);
    } catch (err) {
      return { error: `"${input.id}" cannot be baked to a mesh: ${err instanceof Error ? err.message : 'unknown error'}` };
    }
    base = baked.data;
    // Primitive parts carry no material: the entity material keeps styling the mesh.
    materials = baked.materials.length > 0 ? baked.materials : [{}];
    source = { shape };
    meshId = freeMeshId(world, input.id);
  } else return { error: `"${input.id}" cannot be sculpted.` };

  const frame = localFrame(world, input.id);
  let session = new SculptSession(base, { seed: world.seed });
  let dabs = 0;
  let flattened = false;
  let capped = false;
  const notes: string[] = [];
  for (let si = 0; si < input.strokes.length; si++) {
    const s = input.strokes[si] as SculptStroke;
    if (dabs >= SCULPT_LIMITS.MAX_DABS) {
      capped = true;
      break;
    }
    // Flatten keeps the plane of a session's first dab: a later flatten stroke elsewhere starts a fresh session.
    if (s.mode === 'flatten') {
      if (flattened) session = new SculptSession(session.data, { seed: world.seed });
      flattened = true;
    }
    const from = frame.point(s.at as Vec3);
    const to = s.to ? frame.point(s.to as Vec3) : null;
    const radius = frame.length(s.radius);
    const normal = s.normal ? frame.dir(s.normal as Vec3) : surfaceNormal(session.data, from, radius);
    const reps = s.repeat ?? 1;
    // Along a segment: dabs every 0.3 radius (as the studio brush spaces a fast stroke), repeated `repeat` times.
    const steps = to ? Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) / (radius * 0.3))) : 1;
    let touched = 0;
    let n = normal;
    let nAt = from;
    for (let r = 0; r < reps && !capped; r++) {
      for (let i = 0; i < steps; i++) {
        if (dabs >= SCULPT_LIMITS.MAX_DABS) {
          capped = true;
          break;
        }
        const t = steps === 1 ? 0 : i / (steps - 1);
        const c: Vec3 = to ? [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t] : from;
        // Along a segment the surface turns (a worn edge round a corner): re-read the normal once per radius travelled,
        // not every dab (each read walks every triangle).
        if (to && !s.normal && Math.hypot(c[0] - nAt[0], c[1] - nAt[1], c[2] - nAt[2]) >= radius) {
          n = surfaceNormal(session.data, c, radius);
          nAt = c;
        }
        touched += session.sculpt(s.mode, { center: c, normal: n, radius, strength: s.strength, ...(s.falloff ? { falloff: s.falloff } : {}) });
        dabs++;
      }
    }
    if (touched === 0) notes.push(`stroke ${si + 1} (${s.mode}) touched nothing: the nearest surface is ${round2(nearestVertex(session.data, from) * (s.radius / radius))} m from "at", more than its radius ${s.radius} m`);
  }
  if (capped) notes.push(`stopped at ${SCULPT_LIMITS.MAX_DABS} dabs: send the rest in another call`);

  // What actually moved, measured against the starting mesh (world metres via the mean scale).
  const a = base.positions;
  const b = session.data.positions;
  let moved = 0;
  let maxMove = 0;
  for (let i = 0; i < a.length; i += 3) {
    const d = Math.hypot((b[i] as number) - (a[i] as number), (b[i + 1] as number) - (a[i + 1] as number), (b[i + 2] as number) - (a[i + 2] as number));
    if (d > 1e-7) {
      moved++;
      if (d > maxMove) maxMove = d;
    }
  }
  const tail = notes.length > 0 ? ` Notes: ${notes.join('; ')}.` : '';
  if (moved === 0) return { error: `Nothing moved on "${input.id}" (${base.positions.length / 3} vertices).${tail}` };

  let asset: MeshAsset;
  try {
    asset = prev && meshId === prev.id ? encodeMeshUpdate(prev, base, session.data) : encodeMesh(meshId, session.data, { materials, ...(source ? { source } : prev?.source ? { source: prev.source } : {}) });
  } catch (err) {
    return { error: `The sculpted mesh could not be stored: ${err instanceof Error ? err.message : 'unknown error'}` };
  }
  const patches: Patch[] = [{ op: 'setMesh', mesh: asset }];
  if (shape.kind !== 'mesh' || meshId !== shape.mesh) {
    const set: Record<string, unknown> = { shape: { kind: 'mesh', mesh: meshId } };
    // A heightfield collider needs a heightfield shape: meshes use exact triangles instead.
    if (e.physics?.collider === 'heightfield') set['physics'] = { collider: 'auto' };
    patches.push({ op: 'update', id: input.id, set: set as Extract<Patch, { op: 'update' }>['set'] });
  }
  const scale = frame.length(1) > 0 ? 1 / frame.length(1) : 1;
  const baked = shape.kind === 'mesh' ? '' : ` Baked from its ${shape.kind === 'procedural' ? `generator ${shape.generator}` : `${shape.primitive} primitive`} first (the generator is kept as the mesh source, so it can be regenerated).`;
  return {
    patches,
    summary: `Sculpted "${input.id}": ${input.strokes.length} stroke(s), ${dabs} dabs, ${moved} of ${base.positions.length / 3} vertices moved (up to ${Math.round(maxMove * scale * 1000) / 1000} m); mesh ${meshId}.${baked}${tail} Look at a close render to judge it.`,
  };
}

/** True when sculpting `e` needs its generator run first. */
export function needsGeneratorOutput(e: Entity | undefined): e is Entity & { shape: ProceduralShape } {
  return !!e && e.shape.kind === 'procedural';
}
