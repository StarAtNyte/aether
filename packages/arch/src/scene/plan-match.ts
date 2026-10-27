/**
 * Which things in the world stand for the pieces of the design record.
 *
 * A planned piece is found by its handle (the entity `<building>-<handle>`), by what the model declared for it, or by
 * what it is: the same part kind, or a crafted part of that kind (planned "screen" of kind cinema-screen is the free
 * shape `furn-cinema-screen` however it is named), preferring the one inside the planned room. Nothing here judges: it
 * reports what it matched to what, and the nearest candidates when it found nothing, so the model decides.
 */
import type { EntityId, Patch, WorldDoc } from '@aether/core';
import type { DesignRecord } from '../design-record';
import { findCrafted, furnitureByKind, furnitureById, resolveFurnitureKind } from '../furniture/index';
import { worldToPlan } from '../plan2d';
import { itemEntityId, resolveBuilding, type EditResult } from './edit';
import type { Scene, SceneItem } from './types';

type Planned = DesignRecord['furniture'][number];

/** How a planned piece was found. */
export type MatchVia = 'id' | 'declared' | 'kind' | 'not-built';

/** What one planned piece matched. */
export interface PlanMatch {
  item: Planned;
  via: MatchVia;
  /** Entities standing for it (for `kind` / `declared`, ids as in the world). */
  entities: EntityId[];
  /** Scene pieces among them (relations are measured on these). */
  sceneItems: SceneItem[];
  /** One line saying what was matched to what (empty for an exact id match). */
  note: string;
  /** Best guesses when nothing matched. */
  candidates: string[];
}

interface Cand {
  id: EntityId;
  kind: string;
  name: string;
  /** Plan frame (x, z). */
  at: [number, number];
  /** Key of the room the piece belongs to, when the scene knows it. */
  roomKey: string | null;
  scene: SceneItem | null;
}

const MAX_SCAN = 6000;
/** A crafted part on a wall can sit just outside the room polygon; this much is still "in" the room. */
const ZONE_MARGIN = 1.5;

function canon(kind: string): string {
  return furnitureByKind(kind)?.kind ?? kind;
}

function exactItems(scene: Scene, handle: string): SceneItem[] {
  const id = itemEntityId(scene.building, handle);
  const exact = scene.items.filter((i) => i.id === id);
  return exact.length > 0 ? exact : scene.items.filter((i) => i.id === `${id}-l` || i.id === `${id}-r`);
}

function candidatesOf(world: WorldDoc, scene: Scene): Cand[] {
  const out: Cand[] = [];
  const inScene = new Set<string>();
  for (const it of scene.items) {
    inScene.add(it.id);
    out.push({ id: it.id, kind: canon(it.kind), name: it.name, at: [it.pos[0], it.pos[2]], roomKey: scene.rooms.find((r) => r.id === it.room)?.key ?? null, scene: it });
  }
  const b = Object.hasOwn(world.entities, scene.building) ? world.entities[scene.building] : undefined;
  const origin: [number, number] = [b?.transform.position[0] ?? 0, b?.transform.position[2] ?? 0];
  const yaw = b?.transform.rotation[1] ?? 0;
  let n = 0;
  for (const e of Object.values(world.entities)) {
    if (++n > MAX_SCAN) break;
    if (inScene.has(e.id) || e.arch) continue;
    let kind: string | null = null;
    const gen = e.shape.kind === 'procedural' ? e.shape.generator : e.shape.kind === 'scatter' && e.shape.of.kind === 'procedural' ? e.shape.of.generator : null;
    if (gen !== null) kind = furnitureById(gen)?.kind ?? null;
    if (kind === null) continue;
    const at = worldToPlan(origin, yaw, [e.transform.position[0], e.transform.position[2]]);
    out.push({ id: e.id, kind: canon(kind), name: e.name ?? e.id, at, roomKey: null, scene: null });
  }
  return out;
}

function inRoom(scene: Scene, roomKey: string, c: Cand): boolean | null {
  const room = scene.rooms.find((r) => r.key === roomKey || r.id === roomKey);
  if (!room) return null;
  if (c.roomKey !== null) return c.roomKey === room.key;
  const [x0, z0, x1, z1] = room.bbox;
  const k = ZONE_MARGIN;
  return c.at[0] >= x0 - k && c.at[0] <= x1 + k && c.at[1] >= z0 - k && c.at[1] <= z1 + k;
}

function wantKinds(item: Planned): Set<string> {
  const out = new Set<string>();
  for (const w of [item.kind, item.id, item.id.replace(/-\d+$/, '')]) {
    const k = resolveFurnitureKind(w);
    if (k) out.add(canon(k));
  }
  out.add(canon(item.kind));
  return out;
}

function describeCand(scene: Scene, c: Cand, roomKey: string): string {
  const where = inRoom(scene, roomKey, c);
  return `${c.id} (kind ${c.kind}${c.name && c.name !== c.id ? `, "${c.name.slice(0, 40)}"` : ''}${where === false ? `, outside ${roomKey}` : ''})`;
}

/**
 * Match every planned piece. `declared` entries of the record win over the kind match; an entry naming entities that no
 * longer exist is ignored (and said so), so the finding comes back.
 */
export function matchPlan(world: WorldDoc | undefined, scene: Scene, design: DesignRecord): PlanMatch[] {
  const cands = world ? candidatesOf(world, scene) : candidatesOf({ entities: {} } as unknown as WorldDoc, scene);
  const used = new Set<string>();
  const out = new Map<string, PlanMatch>();
  // Pass 1: exact handles claim their entities first, so a kind match never steals them.
  for (const item of design.furniture) {
    const mine = exactItems(scene, item.id);
    if (mine.length > 0) {
      for (const m of mine) used.add(m.id);
      out.set(item.id, { item, via: 'id', entities: mine.map((m) => m.id), sceneItems: mine, note: '', candidates: [] });
    }
  }
  // Pass 2: what the model declared.
  const stale: Record<string, string> = {};
  for (const item of design.furniture) {
    if (out.has(item.id)) continue;
    const d = design.declared?.[item.id];
    if (!d) continue;
    if (d.entities.length === 0) {
      out.set(item.id, { item, via: 'not-built', entities: [], sceneItems: [], note: `planned ${item.id} is declared not built: ${d.reason || 'no reason given'}`, candidates: [] });
      continue;
    }
    const alive = d.entities.filter((id) => world !== undefined && Object.hasOwn(world.entities, id));
    if (alive.length === 0) {
      stale[item.id] = `its declared entities (${d.entities.join(', ')}) are gone`;
      continue;
    }
    for (const id of alive) used.add(id);
    out.set(item.id, { item, via: 'declared', entities: alive, sceneItems: scene.items.filter((i) => alive.includes(i.id)), note: `planned ${item.id} = ${alive.join(', ')} (declared${d.reason ? `: ${d.reason}` : ''})`, candidates: [] });
  }
  // Pass 3: by what it is, inside its room first.
  for (const item of design.furniture) {
    if (out.has(item.id)) continue;
    const kinds = wantKinds(item);
    const same = cands.filter((c) => !used.has(c.id) && kinds.has(c.kind));
    const inside = same.filter((c) => inRoom(scene, item.room, c) !== false).sort((a, b) => a.id.localeCompare(b.id));
    const hit = inside[0];
    if (hit) {
      used.add(hit.id);
      out.set(item.id, { item, via: 'kind', entities: [hit.id], sceneItems: hit.scene ? [hit.scene] : [], note: `planned ${item.id} (${item.kind}) = ${hit.id} (same kind ${hit.kind}${hit.name && hit.name !== hit.id ? `, "${hit.name.slice(0, 40)}"` : ''}, inside ${item.room})`, candidates: [] });
      continue;
    }
    const guesses = same.slice(0, 3).map((c) => describeCand(scene, c, item.room));
    // Weaker guesses: crafted parts the planned words point at, present anywhere.
    const weak = findCrafted(`${item.id.replace(/-/g, ' ')} ${item.kind.replace(/-/g, ' ')}`, 3).map((d) => canon(d.kind));
    for (const c of cands) {
      if (guesses.length >= 4) break;
      if (!used.has(c.id) && !kinds.has(c.kind) && weak.includes(c.kind)) guesses.push(`${describeCand(scene, c, item.room)}, a nearby kind`);
    }
    const why = stale[item.id];
    out.set(item.id, { item, via: 'not-built', entities: [], sceneItems: [], note: why ? `declared mapping ignored: ${why}` : '', candidates: guesses });
  }
  return design.furniture.map((i) => out.get(i.id) as PlanMatch);
}

/** The matched pieces that were not found by their own handle, as the lines the model reads. */
export function matchEvidence(matches: readonly PlanMatch[]): string[] {
  return matches.filter((m) => (m.via === 'kind' || m.via === 'declared') || (m.via === 'not-built' && m.note.startsWith('planned'))).map((m) => m.note);
}

/**
 * The model's statement about a planned piece: `entities` stand for it, or (no entities) it is not built, with the
 * reason. Stored in the design record of the building; every later check honours it. Entities must exist.
 */
export function declarePlanned(world: WorldDoc, building: string | undefined, handle: string, entities: readonly string[] | undefined, reason: string | undefined): EditResult {
  const b = resolveBuilding(world, building);
  if ('error' in b) return { ok: false, error: b.error };
  const root = world.entities[b.id];
  const plan = root?.arch?.plan as { design?: Record<string, unknown> } | undefined;
  if (!root || !root.arch || !plan || typeof plan !== 'object' || !plan.design) return { ok: false, error: `building ${b.id} has no design record: declare_plan applies to a building made with design_plan` };
  const design = plan.design as DesignRecord;
  const planned = design.furniture.find((f) => f.id === handle);
  if (!planned) return { ok: false, error: `no planned piece "${handle.slice(0, 40)}"; the plan has: ${design.furniture.map((f) => f.id).slice(0, 40).join(', ')}` };
  const ids = [...new Set(entities ?? [])];
  const missing = ids.filter((id) => !Object.hasOwn(world.entities, id));
  if (missing.length > 0) return { ok: false, error: `no entity ${missing.slice(0, 5).join(', ')} in the world (query_scene {q:"list"} or inspect names them)` };
  if (ids.length === 0 && !(reason && reason.trim().length > 0)) return { ok: false, error: 'give entities that stand for the piece, or a reason it is not built' };
  const declared = { ...(design.declared ?? {}), [handle]: { entities: ids, reason: (reason ?? '').slice(0, 240) } };
  const next = { ...root.arch, plan: { ...plan, design: { ...design, declared } } };
  const patches: Patch[] = [{ op: 'update', id: b.id, set: { arch: next } } as Patch];
  const text = ids.length > 0 ? `declared: planned ${handle} = ${ids.join(', ')}; the plan check now counts it as placed${reason ? ` (${reason})` : ''}` : `declared: planned ${handle} is not built (${reason})`;
  return { ok: true, patches, message: `Declare plan piece ${handle}`.slice(0, 120), text, ids: [b.id], warnings: [] };
}
