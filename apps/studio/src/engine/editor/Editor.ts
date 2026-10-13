/**
 * Editor — everything the user does by hand to a world, as World IR patches
 * (so every edit is undoable, branchable and visible to the agent):
 * selection operations (duplicate, copy / paste across projects, delete,
 * group, re-parent, align, distribute, hide, lock), the transform gizmo
 * options, box selection, mesh baking and component editing, sculpt / paint /
 * scatter brushes, materials (presets, eyedropper, drag and drop) and live
 * generator-parameter previews computed in a worker.
 */
import { getEntity, hasOwn, type EntityId, type Json, type MaterialSpec, type Patch, type ProceduralShape, type Vec3, type WorldDoc } from '@aether/core';
import type { GizmoCommit } from '@aether/render';
import type { Simulation, ToolPointer, ViewportTool } from '../Simulation';
import { gizmoModeOf } from '../Simulation';
import { label, type EditorHost } from './host';
import { BoxSelectTool, MeshBrushTool, ScatterBrushTool } from './brushes';
import { MeshEditor } from './meshEditor';
import { gizmoOptionsOf } from './gizmoOptions';
import { alignPatches, distributePatches, dropToGroundPatches, duplicatePatches, flagPatches, groupPatches, reparentPatches, selectableIds, topLevel, ungroupPatches, type AlignMode, type Box } from '../../editor/model/selectionOps';
import { copyPayload, parsePayload, pastePatches, serializePayload } from '../../editor/model/clipboard';
import { bakePatches, isBakeable, regeneratePatches } from '../../editor/model/bake';
import { browserStorage, type StorageLike } from '../../lib/storage';

/** localStorage key mirroring the entity clipboard (works across projects without clipboard permissions). */
export const CLIPBOARD_KEY = 'aether.clipboard.v1';
/** Debounce of live generator-parameter previews (ms). */
export const PARAM_PREVIEW_MS = 90;

/** Editor controller. One per studio. */
export class Editor {
  readonly mesh: MeshEditor;
  private sim: Simulation | null = null;
  private tool: (ViewportTool & { dispose?(): void }) | null = null;
  private readonly unsubscribe: Array<() => void> = [];
  private readonly storage: StorageLike | null;
  private paramTimer: ReturnType<typeof setTimeout> | null = null;
  private paramToken = 0;
  /** Ctrl held during a drag inverts snapping. */
  private snapInverted = false;

  constructor(private readonly host: EditorHost, opts: { storage?: StorageLike | null } = {}) {
    this.storage = opts.storage === undefined ? browserStorage() : opts.storage;
    this.mesh = new MeshEditor(host);
    let prev = host.store.getState();
    this.unsubscribe.push(
      host.store.subscribe((s) => {
        const was = prev;
        prev = s;
        if (s.tool !== was.tool || s.meshEdit !== was.meshEdit || s.mode !== was.mode || s.materialPick !== was.materialPick) this.applyTool();
        if (s.gizmo !== was.gizmo) this.applyGizmoOptions();
        if (s.meshEdit !== was.meshEdit || (s.meshEdit && s.tool !== was.tool) || (s.meshEdit && s.gizmo !== was.gizmo)) this.mesh.refresh();
        if (s.selection !== was.selection) this.showJoint();
      }),
    );
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onModifier);
      window.addEventListener('keyup', this.onModifier);
      window.addEventListener('blur', this.onBlur);
    }
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  /** Attach to (or detach from) the running simulation. */
  attach(sim: Simulation | null): void {
    this.tool?.dispose?.();
    this.tool = null;
    this.sim = sim;
    if (!sim) return;
    sim.setPickFilter((id) => {
      const e = this.host.history.current.entities[id];
      return !e || e.locked === true;
    });
    this.applyGizmoOptions();
    this.applyTool();
  }

  /** The renderer finished a sync: overlays that reference rendered geometry refresh. */
  onSynced(): void {
    if (this.host.store.getState().meshEdit) this.mesh.refresh();
    this.showJoint();
  }

  private applyGizmoOptions(): void {
    this.sim?.setGizmoOptions(gizmoOptionsOf(this.host.store.getState().gizmo, this.snapInverted));
  }

  /** Install the viewport tool and click handler for the current tool / mode. */
  private applyTool(): void {
    const sim = this.sim;
    if (!sim) return;
    const st = this.host.store.getState();
    this.tool?.dispose?.();
    this.tool = null;
    if (st.mode === 'play') {
      sim.setViewportTool(null);
      sim.setClickHandler(null);
      return;
    }
    switch (st.tool) {
      case 'box':
        this.tool = new BoxSelectTool(this.host);
        break;
      case 'sculpt':
        this.tool = new MeshBrushTool(this.host, 'sculpt', (id) => this.ensureMesh(id, 'Sculpting'));
        break;
      case 'paint':
        this.tool = new MeshBrushTool(this.host, 'paint', (id) => this.ensureMesh(id, 'Painting'));
        break;
      case 'scatter':
        this.tool = new ScatterBrushTool(this.host);
        break;
      default:
        break;
    }
    sim.setViewportTool(this.tool);
    if (st.materialPick) sim.setClickHandler((p) => this.pickMaterial(p));
    else if (st.meshEdit) sim.setClickHandler((p, additive) => this.mesh.click(p, additive));
    else sim.setClickHandler(null);
    if (!st.meshEdit) sim.suspendEntityGizmo(false);
  }

  private readonly onModifier = (e: KeyboardEvent): void => {
    const inverted = e.ctrlKey || e.metaKey;
    if (inverted === this.snapInverted) return;
    this.snapInverted = inverted;
    this.applyGizmoOptions();
  };

  private readonly onBlur = (): void => {
    if (!this.snapInverted) return;
    this.snapInverted = false;
    this.applyGizmoOptions();
  };

  /** Commit a finished gizmo drag (one undoable edit for every moved entity). */
  commitGizmo(commit: GizmoCommit): void {
    const world = this.host.history.current;
    const same = (a: readonly number[], b: readonly number[]): boolean => a.every((v, i) => Math.abs(v - (b[i] ?? 0)) < 1e-4);
    const patches: Patch[] = [];
    for (const c of commit.changes) {
      const e = getEntity(world, c.id);
      if (!e || e.locked) continue;
      const t = e.transform;
      if (same(t.position, c.position) && same(t.rotation, c.rotation) && same(t.scale, c.scale)) continue;
      patches.push({ op: 'update', id: c.id, set: { transform: { position: c.position, rotation: c.rotation, scale: c.scale } } });
    }
    if (patches.length === 0) return;
    const verb = commit.mode === 'rotate' ? 'Rotate' : commit.mode === 'scale' ? 'Scale' : 'Move';
    const first = (patches[0] as { id: string }).id;
    this.host.commitUser(patches, patches.length === 1 ? `${verb} ${label(this.host, first)}` : `${verb} ${patches.length} objects`);
  }

  // ---------------------------------------------------------------------------
  // Selection operations
  // ---------------------------------------------------------------------------

  private selection(): EntityId[] {
    const world = this.host.history.current;
    return this.host.store.getState().selection.filter((id) => hasOwn(world.entities, id));
  }

  private editable(ids: readonly EntityId[]): EntityId[] {
    const world = this.host.history.current;
    return ids.filter((id) => getEntity(world, id)?.locked !== true);
  }

  private guard(): boolean {
    if (this.host.store.getState().mode === 'play') {
      this.host.store.getState().toast('Stop the simulation before editing.', 'info');
      return false;
    }
    return true;
  }

  /** Duplicate the selection (Ctrl+D) and select the copies. */
  duplicate(): void {
    const ids = this.selection();
    if (ids.length === 0 || !this.guard()) return;
    const step = this.host.store.getState().gizmo.grid;
    const r = duplicatePatches(this.host.history.current, ids, [Math.max(0.5, step * 2), 0, 0]);
    if (this.host.commitUser(r.patches, ids.length === 1 ? `Duplicate ${label(this.host, ids[0] as string)}` : `Duplicate ${ids.length} objects`) === null) {
      this.host.store.getState().select(r.ids);
    }
  }

  /** Copy the selection to the clipboard (system clipboard + local mirror). Returns the number of copied roots. */
  copy(): number {
    const ids = this.selection();
    const payload = copyPayload(this.host.history.current, ids);
    if (!payload) return 0;
    const text = serializePayload(payload);
    try {
      this.storage?.setItem(CLIPBOARD_KEY, text);
    } catch {
      /* quota: the system clipboard may still work */
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) void navigator.clipboard.writeText(text).catch(() => undefined);
    const n = topLevel(this.host.history.current, ids).length;
    this.host.store.getState().toast(`Copied ${n} ${n === 1 ? 'object' : 'objects'}`, 'success', 2);
    return n;
  }

  /** Cut = copy + delete. */
  cut(): void {
    if (this.copy() > 0) this.deleteSelection();
  }

  /**
   * Paste entities from `text` (the system clipboard) or the local mirror.
   * Pasted objects land offset from the originals and are selected.
   */
  paste(text?: string): string | null {
    if (!this.guard()) return null;
    let source = text ?? null;
    let parsed = source ? parsePayload(source) : null;
    if (!parsed) {
      try {
        source = this.storage?.getItem(CLIPBOARD_KEY) ?? null;
      } catch {
        source = null;
      }
      parsed = source ? parsePayload(source) : null;
    }
    if (!parsed) return 'Nothing to paste.';
    if (!parsed.ok) {
      this.host.store.getState().toast(parsed.error, 'error', 5);
      return parsed.error;
    }
    const step = this.host.store.getState().gizmo.grid;
    const r = pastePatches(this.host.history.current, parsed.payload, [Math.max(0.5, step * 2), 0, Math.max(0.5, step * 2)]);
    const err = this.host.commitUser(r.patches, r.ids.length === 1 ? 'Paste object' : `Paste ${r.ids.length} objects`);
    if (err === null) this.host.store.getState().select(r.ids);
    return err;
  }

  /** Delete the selection (locked entities are kept). */
  deleteSelection(): void {
    const ids = this.editable(this.selection());
    if (ids.length === 0 || !this.guard()) return;
    const roots = topLevel(this.host.history.current, ids);
    if (this.host.commitUser(roots.map((id) => ({ op: 'remove', id, recursive: true })), roots.length === 1 ? `Delete ${label(this.host, roots[0] as string)}` : `Delete ${roots.length} objects`) === null) {
      this.host.store.getState().select([]);
    }
  }

  /** World bounds of entities from the renderer (falls back to the origin for non-rendered ones). */
  private bounds(ids: readonly EntityId[]): Map<EntityId, Box> {
    const out = new Map<EntityId, Box>();
    for (const id of ids) {
      const b = this.sim?.entityBounds(id);
      if (b) out.set(id, b);
    }
    return out;
  }

  /** Group the selection (Ctrl+G) under a new empty at its centre. */
  group(): void {
    const ids = this.editable(this.selection());
    if (ids.length === 0 || !this.guard()) return;
    const b = [...this.bounds(ids).values()];
    const center: Vec3 = b.length > 0
      ? [(Math.min(...b.map((x) => x.min[0])) + Math.max(...b.map((x) => x.max[0]))) / 2, Math.min(...b.map((x) => x.min[1])), (Math.min(...b.map((x) => x.min[2])) + Math.max(...b.map((x) => x.max[2]))) / 2]
      : [0, 0, 0];
    const r = groupPatches(this.host.history.current, ids, roundVec(center));
    if (!r) return;
    if (this.host.commitUser(r.patches, `Group ${ids.length} ${ids.length === 1 ? 'object' : 'objects'}`) === null) this.host.store.getState().select([r.id]);
  }

  /** Ungroup the selected groups (Ctrl+Shift+G). */
  ungroup(): void {
    const ids = this.editable(this.selection());
    if (ids.length === 0 || !this.guard()) return;
    const patches: Patch[] = [];
    const children: EntityId[] = [];
    let world = this.host.history.current;
    for (const id of ids) {
      const r = ungroupPatches(world, id);
      if (!r || r.children.length === 0) continue;
      patches.push(...r.patches);
      children.push(...r.children);
    }
    if (patches.length === 0) {
      this.host.store.getState().toast('The selection has no children to ungroup.', 'info', 3);
      return;
    }
    world = this.host.history.current;
    if (this.host.commitUser(patches, 'Ungroup') === null) this.host.store.getState().select(children);
  }

  /** Re-parent entities (outliner drag and drop), keeping their world poses. */
  reparent(ids: readonly EntityId[], parent: EntityId | null): string | null {
    if (!this.guard()) return null;
    const movable = this.editable(ids);
    const r = reparentPatches(this.host.history.current, movable, parent);
    if ('error' in r) {
      this.host.store.getState().toast(r.error, 'error', 4);
      return r.error;
    }
    if (r.patches.length === 0) return null;
    return this.host.commitUser(r.patches, parent ? `Move ${movable.length === 1 ? label(this.host, movable[0] as string) : `${movable.length} objects`} into ${label(this.host, parent)}` : 'Move to top level');
  }

  /** Align the selection on an axis. */
  align(axis: 0 | 1 | 2, mode: AlignMode): void {
    const ids = this.editable(this.selection());
    if (ids.length < 2 || !this.guard()) return;
    const patches = alignPatches(this.host.history.current, this.bounds(ids), axis, mode);
    if (patches.length > 0) this.host.commitUser(patches, `Align ${'XYZ'[axis]} ${mode}`);
  }

  /** Distribute the selection evenly on an axis. */
  distribute(axis: 0 | 1 | 2): void {
    const ids = this.editable(this.selection());
    if (ids.length < 3 || !this.guard()) return;
    const patches = distributePatches(this.host.history.current, this.bounds(ids), axis);
    if (patches.length > 0) this.host.commitUser(patches, `Distribute along ${'XYZ'[axis]}`);
  }

  /** Drop the selection onto the ground plane. */
  dropToGround(): void {
    const ids = this.editable(this.selection());
    if (ids.length === 0 || !this.guard()) return;
    const patches = dropToGroundPatches(this.host.history.current, this.bounds(ids));
    if (patches.length > 0) this.host.commitUser(patches, ids.length === 1 ? `Drop ${label(this.host, ids[0] as string)} to the ground` : 'Drop to the ground');
  }

  /** Hide / show entities (H toggles the selection). */
  setHidden(ids: readonly EntityId[], hidden: boolean): void {
    if (!this.guard()) return;
    const patches = flagPatches(this.host.history.current, ids, 'visible', !hidden);
    if (patches.length > 0) this.host.commitUser(patches, `${hidden ? 'Hide' : 'Show'} ${ids.length === 1 ? label(this.host, ids[0] as string) : `${ids.length} objects`}`);
  }

  /** Toggle visibility of the selection. */
  toggleHidden(): void {
    const ids = this.selection();
    if (ids.length === 0) return;
    const world = this.host.history.current;
    const anyVisible = ids.some((id) => world.entities[id]?.visible);
    this.setHidden(ids, anyVisible);
  }

  /** Show every hidden entity (Alt+H). */
  unhideAll(): void {
    const world = this.host.history.current;
    const hidden = Object.values(world.entities).filter((e) => !e.visible && !e.template).map((e) => e.id);
    if (hidden.length > 0) this.setHidden(hidden, false);
  }

  /** Lock / unlock entities: locked ones cannot be picked, moved or changed by the agent. */
  setLocked(ids: readonly EntityId[], locked: boolean): void {
    if (!this.guard()) return;
    const patches = flagPatches(this.host.history.current, ids, 'locked', locked);
    if (patches.length === 0) return;
    if (this.host.commitUser(patches, `${locked ? 'Lock' : 'Unlock'} ${ids.length === 1 ? label(this.host, ids[0] as string) : `${ids.length} objects`}`) === null && locked) {
      const st = this.host.store.getState();
      st.select(st.selection.filter((id) => !ids.includes(id)));
    }
  }

  /** Toggle the lock of the selection. */
  toggleLocked(): void {
    const ids = this.selection();
    if (ids.length === 0) return;
    const world = this.host.history.current;
    this.setLocked(ids, !ids.every((id) => world.entities[id]?.locked === true));
  }

  /** Select every visible, unlocked entity (Ctrl+A). */
  selectAll(): void {
    this.host.store.getState().select(selectableIds(this.host.history.current));
  }

  // ---------------------------------------------------------------------------
  // Mesh: bake, regenerate, component editing
  // ---------------------------------------------------------------------------

  /** Bake a procedural / primitive entity to an editable mesh. Returns error text or null. */
  bake(id: EntityId): string | null {
    if (!this.guard()) return null;
    const world = this.host.history.current;
    const e = getEntity(world, id);
    if (!e) return 'The object no longer exists.';
    if (e.locked) return 'Unlock the object first.';
    const r = bakePatches(world, id, this.sim?.renderer.getGeneratorOutput(id));
    if ('error' in r) {
      this.host.store.getState().toast(r.error, 'error', 5);
      return r.error;
    }
    return this.host.commitUser(r.patches, `Convert ${label(this.host, id)} to an editable mesh`);
  }

  /** Rebuild a baked mesh from its generator (discards hand edits; undoable). */
  regenerate(id: EntityId): string | null {
    if (!this.guard()) return null;
    const r = regeneratePatches(this.host.history.current, id);
    if ('error' in r) return r.error;
    if (this.host.store.getState().meshEdit?.id === id) this.mesh.exit();
    return this.host.commitUser(r.patches, `Regenerate ${label(this.host, id)} from its generator`);
  }

  /**
   * Make sure `id` is an editable mesh (baking it when needed, with a
   * notice) and mounted. Resolves false when that is impossible.
   */
  async ensureMesh(id: EntityId, why: string): Promise<boolean> {
    const e = getEntity(this.host.history.current, id);
    if (!e || e.locked) return false;
    if (e.shape.kind !== 'mesh') {
      if (!isBakeable(e)) {
        this.host.store.getState().toast(`${why} works on shapes and generated objects.`, 'info', 4);
        return false;
      }
      if (this.bake(id) !== null) return false;
      this.host.store.getState().toast(`${label(this.host, id)} is now an editable mesh (undo to restore the generator).`, 'info', 5);
    }
    await this.sim?.whenSynced();
    return !!this.sim?.renderer.meshBundle(id);
  }

  /** Toggle component editing (Tab) on the selected entity. */
  async toggleMeshEdit(): Promise<void> {
    const st = this.host.store.getState();
    if (st.meshEdit) {
      this.mesh.exit();
      return;
    }
    const id = this.selection()[0];
    if (!id || !this.guard()) return;
    if (!(await this.ensureMesh(id, 'Mesh editing'))) return;
    this.mesh.enter(id);
    if (gizmoModeOf(this.host.store.getState().tool) === null && st.tool !== 'select') this.host.store.getState().setTool('select');
  }

  // ---------------------------------------------------------------------------
  // Materials
  // ---------------------------------------------------------------------------

  /** Apply a material (merged over the current one) to entities. */
  applyMaterial(ids: readonly EntityId[], material: MaterialSpec, message?: string): string | null {
    if (!this.guard()) return null;
    const targets = this.editable(ids).filter((id) => {
      const e = getEntity(this.host.history.current, id);
      return !!e && e.shape.kind !== 'none';
    });
    if (targets.length === 0) return null;
    const set: Record<string, Json> = { material: material as Record<string, Json> };
    return this.host.commitUser(targets.map((id) => ({ op: 'update', id, set })), message ?? `Set material of ${targets.length === 1 ? label(this.host, targets[0] as string) : `${targets.length} objects`}`);
  }

  /** Drop a material preset at a viewport position (drag from the assets panel). */
  dropMaterial(ndcX: number, ndcY: number, material: MaterialSpec, name: string): boolean {
    const world = this.host.history.current;
    const id = this.sim?.renderer.pick(ndcX, ndcY, (x) => world.entities[x]?.locked === true);
    if (!id) return false;
    // A preset replaces the look: clear colour overrides that would tint it.
    return this.applyMaterial([id], { ...material, color: null, roughness: null, metalness: null } as unknown as MaterialSpec, `Apply ${name} to ${label(this.host, id)}`) === null;
  }

  /** Arm the eyedropper: the next click copies that object's material onto the selection. */
  armEyedropper(on = true): void {
    this.host.store.getState().setMaterialPick(on);
  }

  private pickMaterial(p: ToolPointer): boolean {
    const st = this.host.store.getState();
    st.setMaterialPick(false);
    const world = this.host.history.current;
    const source = this.sim?.renderer.pick(p.ndcX, p.ndcY);
    const e = source ? getEntity(world, source) : undefined;
    if (!e) {
      st.toast('Click an object to copy its material.', 'info', 3);
      return true;
    }
    const targets = this.selection().filter((id) => id !== e.id);
    if (targets.length === 0) {
      st.toast('Select the objects to receive the material first.', 'info', 3);
      return true;
    }
    const m: MaterialSpec = e.material ?? (e.shape.kind === 'mesh' ? (world.meshes[e.shape.mesh]?.materials[0] ?? {}) : {});
    // Replace (not merge): unset fields of the source are cleared on the targets.
    const keys: Array<keyof MaterialSpec> = ['preset', 'color', 'roughness', 'metalness', 'emissive', 'emissiveIntensity', 'opacity', 'flatShading', 'vertexColors'];
    const full: Record<string, Json> = {};
    for (const k of keys) full[k] = (m[k] as Json | undefined) ?? null;
    this.applyMaterial(targets, full as unknown as MaterialSpec, `Copy material from ${label(this.host, e.id)}`);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Procedural parameters
  // ---------------------------------------------------------------------------

  /**
   * Live preview of generator parameters while a slider is dragged: the
   * output is computed in the compute worker (debounced, latest wins), primed
   * into the renderer's generator cache and shown through a runtime
   * override — no document change until {@link commitParams}.
   */
  previewParams(id: EntityId, params: Record<string, Json>, seed?: number): void {
    if (this.paramTimer !== null) clearTimeout(this.paramTimer);
    const token = ++this.paramToken;
    this.paramTimer = setTimeout(() => {
      this.paramTimer = null;
      const sim = this.sim;
      const e = getEntity(this.host.history.current, id);
      if (!sim || !e || e.shape.kind !== 'procedural') return;
      const shape: ProceduralShape = { ...e.shape, params: { ...e.shape.params, ...params }, ...(seed !== undefined ? { seed } : {}) };
      const custom = hasOwn(this.host.history.current.generators, shape.generator);
      const show = (): void => {
        if (token !== this.paramToken) return;
        sim.renderer.setEntityProperty(id, 'shape', shape as unknown as Json);
      };
      if (custom) {
        show();
        return;
      }
      void this.mesh.compute
        .generate(shape.generator, shape.params, shape.seed ?? 1)
        .then((out) => {
          if (token !== this.paramToken) return;
          sim.renderer.primeGeneratorOutput(shape, out);
          show();
        })
        .catch(() => show());
    }, PARAM_PREVIEW_MS);
  }

  /** Commit parameter changes (one undoable edit). */
  commitParams(id: EntityId, params: Record<string, Json>, message: string, seed?: number): string | null {
    this.paramToken++;
    if (this.paramTimer !== null) clearTimeout(this.paramTimer);
    this.paramTimer = null;
    const set: Record<string, Json> = { shape: { params, ...(seed !== undefined ? { seed } : {}) } };
    const err = this.host.commitUser([{ op: 'update', id, set }], message);
    if (err) this.sim?.renderer.clearRuntimeOverrides();
    return err;
  }

  /** New random seed for a procedural or scatter shape. */
  reroll(id: EntityId): void {
    const e = getEntity(this.host.history.current, id);
    if (!e || (e.shape.kind !== 'procedural' && e.shape.kind !== 'scatter')) return;
    const seed = 1 + Math.floor(Math.random() * 999_999);
    this.host.commitUser([{ op: 'update', id, set: { shape: { seed } } }], `Reroll ${label(this.host, id)}`);
  }

  // ---------------------------------------------------------------------------
  // Joints
  // ---------------------------------------------------------------------------

  private showJoint(): void {
    const sim = this.sim;
    if (!sim) return;
    const st = this.host.store.getState();
    const id = st.selection.length === 1 ? st.selection[0] : undefined;
    const world: WorldDoc = this.host.history.current;
    sim.renderer.showJoint(id && st.mode === 'edit' && world.entities[id]?.joint ? id : null);
  }

  /** Release workers, listeners and tools. */
  dispose(): void {
    for (const u of this.unsubscribe.splice(0)) u();
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onModifier);
      window.removeEventListener('keyup', this.onModifier);
      window.removeEventListener('blur', this.onBlur);
    }
    if (this.paramTimer !== null) clearTimeout(this.paramTimer);
    this.tool?.dispose?.();
    this.tool = null;
    this.mesh.dispose();
  }
}

function roundVec(v: Vec3): Vec3 {
  return [Math.round(v[0] * 1000) / 1000, Math.round(v[1] * 1000) / 1000, Math.round(v[2] * 1000) / 1000];
}
