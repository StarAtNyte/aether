/**
 * Copy-on-write working copy of a world used while applying a patch batch.
 *
 * Each container (entities map, rules array, …) is shallow-copied at most once
 * per batch, so applying N patches costs O(N + size) rather than O(N × size),
 * and every untouched entity keeps its object identity (structural sharing).
 * The input document is never mutated.
 */
import type { Entity, Json, Rule, WorldDoc, WorldTest } from '../schema';
import { hasOwn } from '../json';
import { scatterCount } from '../validate';

type Container = 'entities' | 'rules' | 'tests' | 'state' | 'generators' | 'scripts' | 'meshes';

/** Mutable, copy-on-write view over a {@link WorldDoc}. */
export class Draft {
  private readonly doc: WorldDoc;
  private readonly copied = new Set<Container>();
  private dirty = false;
  private children: Map<string, Set<string>> | null = null;
  /** Ids of entities holding references to other entities (joint target, scatter surface); lazily built. */
  private holders: Set<string> | null = null;
  private scatter: number | null = null;
  private count: number | null = null;
  private stateKeys: number | null = null;
  private hintsLeft = HINT_BUDGET;

  constructor(readonly base: WorldDoc) {
    this.doc = { ...base };
  }

  /** Consume one "did you mean" hint from the per-batch budget. */
  takeHint(): boolean {
    return this.hintsLeft-- > 0;
  }

  /** The resulting document (the original object when nothing changed). */
  result(): WorldDoc {
    return this.dirty ? this.doc : this.base;
  }

  /** Current (read-only) view. */
  get world(): WorldDoc {
    return this.doc;
  }

  private writable<K extends Container>(key: K): WorldDoc[K] {
    this.dirty = true;
    if (!this.copied.has(key)) {
      this.copied.add(key);
      const cur = this.doc[key];
      (this.doc as Record<Container, unknown>)[key] = Array.isArray(cur) ? cur.slice() : { ...cur };
    }
    return this.doc[key];
  }

  // -- entities -------------------------------------------------------------

  /** Entity by id (own properties only). */
  entity(id: string): Entity | undefined {
    return hasOwn(this.doc.entities, id) ? this.doc.entities[id] : undefined;
  }

  /** True when an entity with this id exists. */
  has(id: string): boolean {
    return hasOwn(this.doc.entities, id);
  }

  /** Number of entities. */
  entityCount(): number {
    this.count ??= Object.keys(this.doc.entities).length;
    return this.count;
  }

  /** Total scatter instances (computed once, then maintained incrementally). */
  scatterTotal(): number {
    if (this.scatter === null) {
      let total = 0;
      for (const id of Object.keys(this.doc.entities)) total += scatterCount(this.doc.entities[id] as Entity);
      this.scatter = total;
    }
    return this.scatter;
  }

  private childIndex(): Map<string, Set<string>> {
    if (!this.children) {
      const idx = new Map<string, Set<string>>();
      for (const id of Object.keys(this.doc.entities)) {
        const p = (this.doc.entities[id] as Entity).parent;
        if (p !== null) addChild(idx, p, id);
      }
      this.children = idx;
    }
    return this.children;
  }

  /** Direct children ids of `id`. */
  childrenOf(id: string): ReadonlySet<string> {
    return this.childIndex().get(id) ?? EMPTY_SET;
  }

  /** `id` plus all of its descendants (breadth-first). */
  subtree(id: string): string[] {
    const out = [id];
    for (let i = 0; i < out.length; i++) for (const c of this.childrenOf(out[i] as string)) out.push(c);
    return out;
  }

  /** Number of levels below `id` (0 for a leaf). */
  subtreeHeight(id: string): number {
    let level = [id];
    let height = 0;
    for (;;) {
      const next: string[] = [];
      for (const n of level) for (const c of this.childrenOf(n)) next.push(c);
      if (next.length === 0) return height;
      height++;
      level = next;
    }
  }

  /** Depth of `id` (roots are 0). Bounded walk; returns Infinity on a corrupt cycle. */
  depthOf(id: string, bound: number): number {
    let d = 0;
    for (let cur = this.entity(id)?.parent ?? null; cur !== null; cur = this.entity(cur)?.parent ?? null) {
      if (++d > bound) return Number.POSITIVE_INFINITY;
    }
    return d;
  }

  /** True when `ancestor` is `id` or one of its ancestors. */
  isAncestorOrSelf(ancestor: string, id: string, bound: number): boolean {
    let steps = 0;
    for (let cur: string | null = id; cur !== null; cur = this.entity(cur)?.parent ?? null) {
      if (cur === ancestor) return true;
      if (++steps > bound) return true;
    }
    return false;
  }

  /**
   * Ids of entities that reference other entities through a joint target or
   * a scatter surface (what `remove` has to clean up). Maintained
   * incrementally, so removing many entities stays linear.
   */
  referenceHolders(): ReadonlySet<string> {
    if (!this.holders) {
      const set = new Set<string>();
      for (const id of Object.keys(this.doc.entities)) if (holdsRefs(this.doc.entities[id] as Entity)) set.add(id);
      this.holders = set;
    }
    return this.holders;
  }

  /** Insert or replace an entity (keeps document order for replacements). */
  setEntity(e: Entity): void {
    const prev = this.entity(e.id);
    if (prev === e) return;
    if (this.holders) {
      if (holdsRefs(e)) this.holders.add(e.id);
      else this.holders.delete(e.id);
    }
    if (this.scatter !== null) this.scatter += scatterCount(e) - (prev ? scatterCount(prev) : 0);
    if (!prev && this.count !== null) this.count++;
    if (this.children && prev?.parent !== e.parent) {
      if (prev && prev.parent !== null) this.children.get(prev.parent)?.delete(e.id);
      if (e.parent !== null) addChild(this.children, e.parent, e.id);
    }
    this.writable('entities')[e.id] = e;
  }

  /** Delete an entity (the caller handles references to it). */
  deleteEntity(id: string): void {
    const prev = this.entity(id);
    if (!prev) return;
    if (this.scatter !== null) this.scatter -= scatterCount(prev);
    if (this.count !== null) this.count--;
    this.holders?.delete(id);
    if (this.children) {
      if (prev.parent !== null) this.children.get(prev.parent)?.delete(id);
      this.children.delete(id);
    }
    delete this.writable('entities')[id];
  }

  /** Replace the whole entity map (rename, clear). Indexes are rebuilt lazily. */
  replaceEntities(entities: Record<string, Entity>): void {
    this.dirty = true;
    this.copied.add('entities');
    this.doc.entities = entities;
    this.children = null;
    this.holders = null;
    this.scatter = null;
    this.count = null;
  }

  // -- other containers -----------------------------------------------------

  /** Writable rules array. */
  rules(): Rule[] {
    return this.writable('rules');
  }

  /** Writable tests array. */
  tests(): WorldTest[] {
    return this.writable('tests');
  }

  /** Number of global state variables (cached). */
  stateKeyCount(): number {
    this.stateKeys ??= Object.keys(this.doc.state).length;
    return this.stateKeys;
  }

  /** Set (or with `undefined`, delete) a global state variable. */
  setStateVar(key: string, value: Json | undefined): void {
    const exists = hasOwn(this.doc.state, key);
    if (value === undefined) {
      if (!exists) return;
      delete this.writable('state')[key];
      if (this.stateKeys !== null) this.stateKeys--;
      return;
    }
    if (!exists && this.stateKeys !== null) this.stateKeys++;
    this.writable('state')[key] = value;
  }

  /** Writable generator map. */
  generators(): WorldDoc['generators'] {
    return this.writable('generators');
  }

  /** Writable script map. */
  scripts(): WorldDoc['scripts'] {
    return this.writable('scripts');
  }

  /** Writable mesh asset map. */
  meshes(): WorldDoc['meshes'] {
    return this.writable('meshes');
  }

  /** Set (or with `undefined`, remove) the voxel terrain. */
  setVoxel(value: WorldDoc['voxel']): void {
    if (value === this.doc.voxel) return;
    this.dirty = true;
    if (value === undefined) delete this.doc.voxel;
    else this.doc.voxel = value;
  }

  /** Set (or with `undefined`, remove) the title card. */
  setIntro(value: WorldDoc['intro']): void {
    if (value === this.doc.intro) return;
    this.dirty = true;
    if (value === undefined) delete this.doc.intro;
    else this.doc.intro = value;
  }

  /** Set (or with `undefined`, remove) the game feel. */
  setFeel(value: WorldDoc['feel']): void {
    if (value === this.doc.feel) return;
    this.dirty = true;
    if (value === undefined) delete this.doc.feel;
    else this.doc.feel = value;
  }

  /** Assign a top-level value-like field. */
  set<K extends 'environment' | 'player' | 'hud' | 'name' | 'description' | 'seed' | 'rules' | 'tests' | 'state'>(key: K, value: WorldDoc[K]): void {
    this.dirty = true;
    if (key === 'rules' || key === 'tests' || key === 'state') this.copied.add(key);
    if (key === 'state') this.stateKeys = null;
    this.doc[key] = value;
  }
}

const EMPTY_SET: ReadonlySet<string> = new Set();

function holdsRefs(e: Entity): boolean {
  return (e.joint !== undefined && e.joint.target !== 'world') || (e.shape.kind === 'scatter' && e.shape.onSurface !== undefined);
}
/** Max number of O(n) suggestion lookups per batch (DoS guard). */
const HINT_BUDGET = 16;

function addChild(idx: Map<string, Set<string>>, parent: string, child: string): void {
  let set = idx.get(parent);
  if (!set) {
    set = new Set();
    idx.set(parent, set);
  }
  set.add(child);
}
