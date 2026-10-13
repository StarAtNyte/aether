/**
 * Component-level mesh editing (vertex / edge / face): picking components
 * in the viewport, the component gizmo (move / rotate / scale with soft
 * selection, previewed live and committed once), and mesh operations run in
 * the compute worker (extrude, inset, subdivide, smooth, merge, flip,
 * recompute normals, UV unwrap, delete). Every edit is one `setMesh` patch.
 */
import { decodeMeshCached, encodeMeshUpdate, getEntity, hasOwn, type EntityId, type MeshAsset, type MeshData, type WorldDoc } from '@aether/core';
import { ComputeClient, coplanarFaces, copiesOf, buildTopology, faceEdges, nearestComponent, softWeights, transformVerticesInto, type MeshOpInput, type Topology } from '@aether/procgen';
import type { MeshEditState } from '../../state/store';
import type { ToolPointer } from '../Simulation';
import { gizmoModeOf } from '../Simulation';
import { label, type EditorHost } from './host';
import { gizmoOptionsOf } from './gizmoOptions';

/** Mesh operations offered in the mesh toolbar. */
export type MeshAction =
  | { kind: 'extrude'; distance: number }
  | { kind: 'inset'; amount: number }
  | { kind: 'subdivide'; smooth: boolean }
  | { kind: 'smooth'; iterations: number; factor: number }
  | { kind: 'merge'; distance: number }
  | { kind: 'flip' }
  | { kind: 'orient' }
  | { kind: 'unwrap'; mode: 'box' | 'planar' }
  | { kind: 'delete' };

/** The asset and decoded data of a mesh entity, or null. */
export function meshOf(world: WorldDoc, id: EntityId): { asset: MeshAsset; data: MeshData } | null {
  const e = getEntity(world, id);
  if (!e || e.shape.kind !== 'mesh' || !hasOwn(world.meshes, e.shape.mesh)) return null;
  const asset = world.meshes[e.shape.mesh] as MeshAsset;
  try {
    return { asset, data: decodeMeshCached(asset) };
  } catch {
    return null;
  }
}

/** Selected vertex indices (with every split copy) of a component selection. */
export function selectedVertexSet(state: MeshEditState, data: MeshData, topo: Topology): Set<number> {
  const out = new Set<number>();
  const add = (v: number): void => {
    if (v >= 0 && v < data.positions.length / 3) for (const c of copiesOf(topo, v)) out.add(c);
  };
  if (state.mode === 'face') for (const t of state.faces) for (let k = 0; k < 3; k++) add(data.indices[t * 3 + k] as number);
  else if (state.mode === 'edge') for (const v of state.edges) add(v);
  else for (const v of state.vertices) add(v);
  return out;
}

/** Component editing controller (one per studio). */
export class MeshEditor {
  readonly compute: ComputeClient;
  private topo: { data: MeshData; topo: Topology } | null = null;
  private edges: { data: MeshData; edges: Uint32Array } | null = null;
  /** Drag state of the component gizmo. */
  private drag: { id: EntityId; asset: MeshAsset; data: MeshData; start: Float32Array; out: Float32Array; weights: Float32Array } | null = null;

  constructor(private readonly host: EditorHost) {
    this.compute = new ComputeClient();
  }

  private topology(data: MeshData): Topology {
    if (this.topo?.data !== data) this.topo = { data, topo: buildTopology(data) };
    return this.topo.topo;
  }

  private edgeList(data: MeshData): Uint32Array {
    if (this.edges?.data !== data) this.edges = { data, edges: faceEdges(data) };
    return this.edges.edges;
  }

  /** Enter component editing on a mesh entity. */
  enter(id: EntityId, mode: MeshEditState['mode'] = 'face'): boolean {
    if (!meshOf(this.host.history.current, id)) return false;
    this.host.store.getState().setMeshEdit({ id, mode, vertices: [], edges: [], faces: [], soft: 0 });
    this.host.store.getState().select([id]);
    this.refresh();
    return true;
  }

  /** Leave component editing. */
  exit(): void {
    const st = this.host.store.getState();
    if (!st.meshEdit) return;
    st.setMeshEdit(null);
    this.drag = null;
    const sim = this.host.simulation;
    if (sim) {
      sim.renderer.showMeshComponents(null);
      void sim.renderer.setComponentGizmo(null, [0, 0, 0], null, {});
      sim.suspendEntityGizmo(false);
    }
  }

  /** Switch vertex / edge / face mode (converting the selection where it is cheap). */
  setMode(mode: MeshEditState['mode']): void {
    const st = this.host.store.getState();
    const me = st.meshEdit;
    if (!me || me.mode === mode) return;
    st.setMeshEdit({ ...me, mode, vertices: [], edges: [], faces: [] });
    this.refresh();
  }

  /** Soft-selection radius (metres, 0 = off). */
  setSoft(radius: number): void {
    const st = this.host.store.getState();
    const me = st.meshEdit;
    if (!me) return;
    st.setMeshEdit({ ...me, soft: Math.min(50, Math.max(0, Number.isFinite(radius) ? radius : 0)) });
  }

  /** Select every component of the current mode (or clear with `none`). */
  selectAll(none = false): void {
    const st = this.host.store.getState();
    const me = st.meshEdit;
    if (!me) return;
    const m = meshOf(this.host.history.current, me.id);
    if (!m) return;
    if (none) st.setMeshEdit({ ...me, vertices: [], edges: [], faces: [] });
    else if (me.mode === 'face') st.setMeshEdit({ ...me, faces: Array.from({ length: m.data.indices.length / 3 }, (_, i) => i), vertices: [], edges: [] });
    else if (me.mode === 'edge') st.setMeshEdit({ ...me, edges: [...this.edgeList(m.data)], vertices: [], faces: [] });
    else st.setMeshEdit({ ...me, vertices: [...this.topology(m.data).reps], edges: [], faces: [] });
    this.refresh();
  }

  /** Click in the viewport while editing: pick a component (Shift/Ctrl toggles). Always consumes the click. */
  click(p: ToolPointer, additive: boolean): boolean {
    const st = this.host.store.getState();
    const me = st.meshEdit;
    const sim = this.host.simulation;
    if (!me || !sim) return false;
    const m = meshOf(this.host.history.current, me.id);
    if (!m) {
      this.exit();
      return false;
    }
    const hit = sim.renderer.raycastEntity(p.ndcX, p.ndcY, { only: me.id });
    if (!hit || hit.triangle === null) {
      if (!additive) st.setMeshEdit({ ...me, vertices: [], edges: [], faces: [] });
      this.refresh();
      return true;
    }
    const toggle = (list: readonly number[], items: readonly number[]): number[] => {
      if (!additive) return [...items];
      const set = new Set(list);
      const allIn = items.every((i) => set.has(i));
      for (const i of items) {
        if (allIn) set.delete(i);
        else set.add(i);
      }
      return [...set];
    };
    if (me.mode === 'face') {
      st.setMeshEdit({ ...me, faces: toggle(me.faces, coplanarFaces(m.data, hit.triangle, 1)) });
    } else {
      const c = nearestComponent(m.data, hit.triangle, hit.localPoint);
      if (!c) return true;
      if (me.mode === 'vertex') {
        const w = this.topology(m.data).weld[c.vertex] as number;
        st.setMeshEdit({ ...me, vertices: toggle(me.vertices, [w]) });
      } else {
        const topo = this.topology(m.data);
        const a = topo.weld[c.edge[0]] as number;
        const b = topo.weld[c.edge[1]] as number;
        const pairs = me.edges;
        const exists = pairs.findIndex((_, i) => i % 2 === 0 && ((pairs[i] === a && pairs[i + 1] === b) || (pairs[i] === b && pairs[i + 1] === a)));
        let next: number[];
        if (!additive) next = [a, b];
        else if (exists >= 0) next = [...pairs.slice(0, exists), ...pairs.slice(exists + 2)];
        else next = [...pairs, a, b];
        st.setMeshEdit({ ...me, edges: next });
      }
    }
    this.refresh();
    return true;
  }

  /** Re-draw component overlays and re-attach the component gizmo (after selection, tool or world changes). */
  refresh(): void {
    const st = this.host.store.getState();
    const me = st.meshEdit;
    const sim = this.host.simulation;
    if (!sim) return;
    if (!me) {
      sim.renderer.showMeshComponents(null);
      return;
    }
    const m = meshOf(this.host.history.current, me.id);
    if (!m) {
      this.exit();
      return;
    }
    const vertices = me.mode === 'vertex' ? me.vertices : [];
    const ok = sim.renderer.showMeshComponents({
      id: me.id,
      mode: me.mode,
      edges: this.edgeList(m.data),
      selectedVertices: vertices,
      selectedEdges: me.mode === 'edge' ? me.edges : [],
      selectedFaces: me.mode === 'face' ? me.faces : [],
      // One marker per position: split copies of a vertex would overdraw each other.
      ...(me.mode === 'vertex' ? { markerVertices: this.topology(m.data).reps } : {}),
    });
    // The mesh is still being (re)built: the next sync calls refresh again.
    if (!ok) return;
    sim.suspendEntityGizmo(true);
    const mode = gizmoModeOf(st.tool);
    const verts = selectedVertexSet(me, m.data, this.topology(m.data));
    if (!mode || verts.size === 0 || st.mode === 'play') {
      void sim.renderer.setComponentGizmo(null, [0, 0, 0], null, {});
      return;
    }
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const v of verts) {
      cx += m.data.positions[v * 3] as number;
      cy += m.data.positions[v * 3 + 1] as number;
      cz += m.data.positions[v * 3 + 2] as number;
    }
    const n = verts.size;
    const id = me.id;
    void sim.renderer.setComponentGizmo(
      id,
      [cx / n, cy / n, cz / n],
      mode,
      gizmoOptionsOf(st.gizmo, false),
      (matrix) => this.preview(id, verts, matrix),
      (matrix) => this.commitTransform(id, verts, matrix, mode),
    );
  }

  private beginDrag(id: EntityId, verts: ReadonlySet<number>): NonNullable<MeshEditor['drag']> | null {
    const m = meshOf(this.host.history.current, id);
    if (!m) return null;
    const soft = this.host.store.getState().meshEdit?.soft ?? 0;
    const weights = softWeights(m.data, verts, soft);
    this.drag = { id, asset: m.asset, data: m.data, start: m.data.positions, out: new Float32Array(m.data.positions.length), weights };
    return this.drag;
  }

  private preview(id: EntityId, verts: ReadonlySet<number>, matrix: Float32Array): void {
    const sim = this.host.simulation;
    if (!sim) return;
    const d = this.drag && this.drag.id === id ? this.drag : this.beginDrag(id, verts);
    if (!d) return;
    transformVerticesInto(d.out, d.start, d.weights, matrix);
    sim.renderer.previewMesh(id, d.out, null);
  }

  private commitTransform(id: EntityId, verts: ReadonlySet<number>, matrix: Float32Array, mode: 'translate' | 'rotate' | 'scale'): void {
    const d = this.drag && this.drag.id === id ? this.drag : this.beginDrag(id, verts);
    this.drag = null;
    if (!d) return;
    const positions = new Float32Array(d.start.length);
    transformVerticesInto(positions, d.start, d.weights, matrix);
    const next = encodeMeshUpdate(d.asset, d.data, { ...d.data, positions });
    const verb = mode === 'rotate' ? 'Rotate' : mode === 'scale' ? 'Scale' : 'Move';
    const me = this.host.store.getState().meshEdit;
    const what = me?.mode === 'face' ? `${me.faces.length} face${me.faces.length === 1 ? '' : 's'}` : me?.mode === 'edge' ? 'edges' : 'vertices';
    if (this.host.commitUser([{ op: 'setMesh', mesh: next }], `${verb} ${what} of ${label(this.host, id)}`) !== null) this.host.simulation?.renderer.rebuildEntity(id);
  }

  /** Run a mesh operation on the current selection in the compute worker and commit it. */
  async run(action: MeshAction): Promise<string | null> {
    const st = this.host.store.getState();
    const me = st.meshEdit;
    if (!me || st.meshBusy) return null;
    const m = meshOf(this.host.history.current, me.id);
    if (!m) return 'The mesh no longer exists.';
    const topo = this.topology(m.data);
    const faces = me.mode === 'face' ? me.faces : facesOfVertices(m.data, selectedVertexSet(me, m.data, topo));
    const verts = [...selectedVertexSet(me, m.data, topo)];
    let op: MeshOpInput;
    switch (action.kind) {
      case 'extrude':
        if (faces.length === 0) return 'Select faces to extrude.';
        op = { kind: 'extrude', faces, distance: action.distance };
        break;
      case 'inset':
        if (faces.length === 0) return 'Select faces to inset.';
        op = { kind: 'inset', faces, amount: action.amount };
        break;
      case 'subdivide':
        op = { kind: 'subdivide', faces: faces.length > 0 ? faces : null, smooth: action.smooth && faces.length === 0 };
        break;
      case 'smooth':
        op = { kind: 'smooth', vertices: verts.length > 0 ? verts : null, iterations: action.iterations, factor: action.factor, radius: me.soft };
        break;
      case 'merge':
        op = { kind: 'merge', distance: action.distance };
        break;
      case 'flip':
        op = { kind: 'flip', faces: faces.length > 0 ? faces : null };
        break;
      case 'orient':
        op = { kind: 'orient' };
        break;
      case 'unwrap':
        op = { kind: 'unwrap', mode: action.mode, scale: 1 };
        break;
      case 'delete':
        if (faces.length === 0) return 'Select faces to delete.';
        op = { kind: 'delete', faces };
        break;
    }
    st.setMeshBusy(true);
    try {
      const result = await this.compute.meshOp(op, m.data);
      // The world may have moved on while the worker ran: only apply to the same mesh data.
      const now = meshOf(this.host.history.current, me.id);
      if (!now || now.asset !== m.asset) return 'The mesh changed while the operation ran; try again.';
      const next = encodeMeshUpdate(m.asset, m.data, result.mesh);
      const names: Record<MeshAction['kind'], string> = { extrude: 'Extrude', inset: 'Inset', subdivide: 'Subdivide', smooth: 'Smooth', merge: 'Merge by distance', flip: 'Flip normals', orient: 'Recompute normals', unwrap: 'UV unwrap', delete: 'Delete faces' };
      const err = this.host.commitUser([{ op: 'setMesh', mesh: next }], `${names[action.kind]} ${label(this.host, me.id)}`);
      if (err) return err;
      // Operations that keep triangle order keep the face selection (extrude twice in a row).
      const keeps = action.kind === 'extrude' || action.kind === 'inset' || action.kind === 'flip' || action.kind === 'orient' || action.kind === 'unwrap' || action.kind === 'smooth';
      const cur = this.host.store.getState().meshEdit;
      if (cur && !keeps) this.host.store.getState().setMeshEdit({ ...cur, vertices: [], edges: [], faces: [] });
      if (result.note) this.host.store.getState().toast(result.note, 'info', 3);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    } finally {
      this.host.store.getState().setMeshBusy(false);
    }
  }

  /** Release the worker. */
  dispose(): void {
    this.compute.dispose();
  }
}

/** Faces whose three vertices are all selected. */
function facesOfVertices(data: MeshData, verts: ReadonlySet<number>): number[] {
  const out: number[] = [];
  if (verts.size === 0) return out;
  for (let t = 0; t < data.indices.length / 3; t++) {
    if (verts.has(data.indices[t * 3] as number) && verts.has(data.indices[t * 3 + 1] as number) && verts.has(data.indices[t * 3 + 2] as number)) out.push(t);
  }
  return out;
}
