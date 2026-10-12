/**
 * Debug visualization: physics collider wireframes (from the same procgen
 * collider descriptions physics uses), entity bounds, and diagnostic markers
 * colored by severity. Collider wireframes are parented to their entity's
 * object, so they follow physics-driven bodies for free; they share a handful
 * of unit geometries scaled per collider. Rebuilds are incremental: an
 * entity's collider holder is reused while its generator output key is
 * unchanged, and trimesh wireframes are cached per output key + collider index.
 */
import {
  Box3,
  Box3Helper,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import type { EntityId } from '@aether/core';
import type { ColliderDesc, RenderDiagnostic } from '../types';
import type { SceneSync } from '../sync/scene-sync';

/** What to show. */
export interface DebugOptions {
  colliders?: boolean;
  bounds?: boolean;
  diagnostics?: readonly RenderDiagnostic[];
}

/** Max entities drawn per category (keeps huge worlds responsive). */
export const MAX_DEBUG_ITEMS = 2000;
/** Max trimesh triangles drawn as wireframe (bigger ones show their bounds). */
const MAX_TRIMESH_TRIS = 50_000;
const SEVERITY_COLOR: Readonly<Record<RenderDiagnostic['severity'], string>> = { error: '#ff3b4e', warning: '#ffb020', info: '#4ea8ff' };
const DEG = Math.PI / 180;
const _p = new Vector3();

function circlePoints(out: number[], radius: number, y: number, axis: 'xz' | 'xy' | 'yz', segments = 32): void {
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    for (const a of [a0, a1]) {
      const c = Math.cos(a) * radius;
      const s = Math.sin(a) * radius;
      if (axis === 'xz') out.push(c, y, s);
      else if (axis === 'xy') out.push(c, s + y, 0);
      else out.push(0, s + y, c);
    }
  }
}

function lineGeometry(points: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
  return g;
}

/** Unit wire sphere (3 great circles, radius 1). */
function unitSphere(): BufferGeometry {
  const p: number[] = [];
  circlePoints(p, 1, 0, 'xz');
  circlePoints(p, 1, 0, 'xy');
  circlePoints(p, 1, 0, 'yz');
  return lineGeometry(p);
}

/** Unit wire cylinder (radius 1, height 1, centered). */
function unitCylinder(): BufferGeometry {
  const p: number[] = [];
  circlePoints(p, 1, 0.5, 'xz');
  circlePoints(p, 1, -0.5, 'xz');
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    p.push(Math.cos(a), -0.5, Math.sin(a), Math.cos(a), 0.5, Math.sin(a));
  }
  return lineGeometry(p);
}

function noRaycast(o: Object3D): Object3D {
  o.raycast = () => undefined;
  return o;
}

/** Build trimesh edges straight into a pre-sized typed array (no boxed number[]). */
function trimeshWire(positions: ArrayLike<number>, idx: ArrayLike<number>): BufferGeometry {
  const triCount = Math.floor(idx.length / 3);
  const out = new Float32Array(triCount * 18);
  let o = 0;
  for (let t = 0; t < triCount * 3; t += 3) {
    const a = (idx[t] as number) * 3;
    const b = (idx[t + 1] as number) * 3;
    const c = (idx[t + 2] as number) * 3;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      out[o++] = positions[u] as number;
      out[o++] = positions[u + 1] as number;
      out[o++] = positions[u + 2] as number;
      out[o++] = positions[v] as number;
      out[o++] = positions[v + 1] as number;
      out[o++] = positions[v + 2] as number;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(out, 3));
  return g;
}

interface ColliderHolder {
  holder: Group;
  /** Generator output key the holder was built from. */
  key: string;
  object: Object3D;
  wireKeys: string[];
}

/** Debug overlay manager. */
export class DebugOverlay {
  /** World-space items (bounds, markers). */
  readonly group = new Group();
  private readonly holders = new Map<EntityId, ColliderHolder>();
  private readonly wires = new Map<string, BufferGeometry>();
  private readonly box = new EdgesGeometry(new BoxGeometry(1, 1, 1));
  private readonly sphere = unitSphere();
  private readonly cylinder = unitCylinder();
  private readonly marker = new OctahedronGeometry(0.18, 0);
  private readonly colliderMat = new LineBasicMaterial({ color: '#3dff8a', depthTest: false, transparent: true, opacity: 0.85 });
  private readonly hullMat = new LineBasicMaterial({ color: '#ffb347', depthTest: false, transparent: true, opacity: 0.85 });
  private readonly meshMat = new LineBasicMaterial({ color: '#3dd5ff', depthTest: false, transparent: true, opacity: 0.6 });
  private readonly severityLine = new Map<string, LineBasicMaterial>();
  private readonly severityFill = new Map<string, MeshBasicMaterial>();
  private options: DebugOptions = {};

  constructor() {
    this.group.name = 'aether:debug';
    for (const [sev, hex] of Object.entries(SEVERITY_COLOR)) {
      this.severityLine.set(sev, new LineBasicMaterial({ color: hex, depthTest: false, transparent: true }));
      this.severityFill.set(sev, new MeshBasicMaterial({ color: new Color(hex).multiplyScalar(2), depthTest: false, transparent: true, opacity: 0.9 }));
    }
  }

  /** True when anything is enabled. */
  get active(): boolean {
    const o = this.options;
    return o.colliders === true || o.bounds === true || (o.diagnostics?.length ?? 0) > 0;
  }

  /** Set options and rebuild from the current scene. */
  show(opts: DebugOptions, sync: SceneSync): void {
    this.options = { ...opts, ...(opts.diagnostics ? { diagnostics: opts.diagnostics.slice(0, MAX_DEBUG_ITEMS) } : {}) };
    this.rebuild(sync);
  }

  /** Rebuild with the last options (call after the world changed). */
  rebuild(sync: SceneSync): void {
    this.clearWorldSpace();
    const o = this.options;
    if (o.colliders) this.buildColliders(sync);
    else this.clearColliders();
    if (o.bounds) this.buildBounds(sync);
    if (o.diagnostics?.length) this.buildDiagnostics(sync, o.diagnostics);
  }

  /** Incremental collider pass: unchanged entities keep their holder; stale ones are removed. */
  private buildColliders(sync: SceneSync): void {
    let n = 0;
    const kept = new Set<EntityId>();
    const usedWires = new Set<string>();
    sync.forEachNode((node) => {
      if (n >= MAX_DEBUG_ITEMS || !node.keyed || node.entity.shape.kind === 'scatter') return;
      if (node.entity.physics?.collider === 'none') return;
      const key = node.keyed.key;
      const prev = this.holders.get(node.id);
      if (prev && prev.key === key && prev.object === node.object && prev.holder.parent === node.object) {
        for (const w of prev.wireKeys) usedWires.add(w);
        kept.add(node.id);
        n++;
        return;
      }
      prev?.holder.removeFromParent();
      const holder = noRaycast(new Group()) as Group;
      holder.name = 'debug:colliders';
      const wireKeys: string[] = [];
      node.keyed.output.colliders.forEach((c, i) => {
        const wireKey = `${key}#${i}`;
        const line = this.colliderLine(c, wireKey);
        if (!line) return;
        if (c.kind === 'trimesh') {
          wireKeys.push(wireKey);
          usedWires.add(wireKey);
        }
        holder.add(line);
      });
      node.object.add(holder);
      this.holders.set(node.id, { holder, key, object: node.object, wireKeys });
      kept.add(node.id);
      n++;
    });
    for (const [id, h] of this.holders) {
      if (kept.has(id)) continue;
      h.holder.removeFromParent();
      this.holders.delete(id);
    }
    for (const [k, g] of this.wires) {
      if (usedWires.has(k)) continue;
      g.dispose();
      this.wires.delete(k);
    }
  }

  private colliderLine(c: ColliderDesc, wireKey: string): LineSegments | null {
    let line: LineSegments;
    switch (c.kind) {
      case 'box':
        line = new LineSegments(this.box, this.colliderMat);
        line.scale.set(c.halfExtents[0] * 2, c.halfExtents[1] * 2, c.halfExtents[2] * 2);
        line.position.set(c.offset[0], c.offset[1], c.offset[2]);
        if (c.rotation) line.rotation.set(c.rotation[0] * DEG, c.rotation[1] * DEG, c.rotation[2] * DEG, 'XYZ');
        break;
      case 'sphere':
        line = new LineSegments(this.sphere, this.colliderMat);
        line.scale.setScalar(c.radius);
        line.position.set(c.offset[0], c.offset[1], c.offset[2]);
        break;
      case 'cylinder':
        line = new LineSegments(this.cylinder, this.colliderMat);
        line.scale.set(c.radius, c.halfHeight * 2, c.radius);
        line.position.set(c.offset[0], c.offset[1], c.offset[2]);
        break;
      case 'capsule': {
        line = new LineSegments(this.cylinder, this.colliderMat);
        line.scale.set(c.radius, c.halfHeight * 2, c.radius);
        line.position.set(c.offset[0], c.offset[1], c.offset[2]);
        for (const sign of [1, -1]) {
          const cap = new LineSegments(this.sphere, this.colliderMat);
          cap.scale.set(1, c.radius / Math.max(1e-6, c.halfHeight * 2), 1);
          cap.position.set(0, sign * 0.5, 0);
          line.add(cap);
        }
        break;
      }
      case 'hull': {
        const b = new Box3();
        const p = c.points;
        for (let i = 0; i + 2 < p.length; i += 3) b.expandByPoint(_p.set(p[i] as number, p[i + 1] as number, p[i + 2] as number));
        if (b.isEmpty()) return null;
        line = new LineSegments(this.box, this.hullMat);
        line.scale.set(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
        line.position.set((b.min.x + b.max.x) / 2 + c.offset[0], (b.min.y + b.max.y) / 2 + c.offset[1], (b.min.z + b.max.z) / 2 + c.offset[2]);
        break;
      }
      case 'trimesh': {
        if (c.indices.length / 3 > MAX_TRIMESH_TRIS) return null;
        let g = this.wires.get(wireKey);
        if (!g) {
          g = trimeshWire(c.positions, c.indices);
          this.wires.set(wireKey, g);
        }
        line = new LineSegments(g, this.meshMat);
        break;
      }
      case 'heightfield':
        line = new LineSegments(this.box, this.meshMat);
        line.scale.set(c.size[0], Math.max(0.01, c.size[1]), c.size[2]);
        line.position.set(0, c.size[1] / 2, 0);
        break;
      default:
        return null;
    }
    line.renderOrder = 20;
    noRaycast(line);
    return line;
  }

  private buildBounds(sync: SceneSync): void {
    let n = 0;
    sync.root.updateMatrixWorld(true);
    sync.forEachNode((node) => {
      if (n >= MAX_DEBUG_ITEMS || !node.object.visible) return;
      const b = new Box3().setFromObject(node.content);
      if (b.isEmpty()) return;
      const helper = new Box3Helper(b, '#f5e663');
      helper.renderOrder = 19;
      this.group.add(noRaycast(helper));
      n++;
    });
  }

  private buildDiagnostics(sync: SceneSync, diagnostics: readonly RenderDiagnostic[]): void {
    const seen = new Set<string>();
    sync.root.updateMatrixWorld(true);
    for (const d of diagnostics) {
      const sev = Object.hasOwn(SEVERITY_COLOR, d.severity) ? d.severity : 'info';
      for (const id of (Array.isArray(d.entities) ? d.entities : []).slice(0, 32) as EntityId[]) {
        const key = `${sev}|${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const b = sync.entityBounds(id, new Box3());
        if (b.isEmpty()) continue;
        const helper = new Box3Helper(b, SEVERITY_COLOR[sev]);
        (helper.material as Material).dispose();
        helper.material = this.severityLine.get(sev) as LineBasicMaterial;
        helper.renderOrder = 21;
        this.group.add(noRaycast(helper));
        const marker = new Mesh(this.marker, this.severityFill.get(sev) as MeshBasicMaterial);
        marker.position.set((b.min.x + b.max.x) / 2, b.max.y + 0.5, (b.min.z + b.max.z) / 2);
        marker.renderOrder = 22;
        marker.name = `diagnostic:${d.code}:${id}`;
        this.group.add(noRaycast(marker));
      }
    }
  }

  /** Remove every debug object (keeps options). */
  clear(): void {
    this.clearColliders();
    this.clearWorldSpace();
  }

  /** Number of cached trimesh wireframes (diagnostics/tests). */
  get cachedWireCount(): number {
    return this.wires.size;
  }

  private clearColliders(): void {
    for (const h of this.holders.values()) h.holder.removeFromParent();
    this.holders.clear();
    for (const g of this.wires.values()) g.dispose();
    this.wires.clear();
  }

  /** Remove the world-space helpers (bounds, diagnostic markers). */
  private clearWorldSpace(): void {
    for (const child of [...this.group.children]) {
      child.removeFromParent();
      // Box3Helper owns its geometry (and, for bounds, its material); shared materials are kept.
      if (child instanceof Box3Helper) {
        child.geometry.dispose();
        const m = child.material as Material;
        if (![...this.severityLine.values()].includes(m as LineBasicMaterial)) m.dispose();
      }
    }
  }

  /** Release everything. */
  dispose(): void {
    this.options = {};
    this.clear();
    this.box.dispose();
    this.sphere.dispose();
    this.cylinder.dispose();
    this.marker.dispose();
    this.colliderMat.dispose();
    this.hullMat.dispose();
    this.meshMat.dispose();
    for (const m of this.severityLine.values()) m.dispose();
    for (const m of this.severityFill.values()) m.dispose();
    this.group.removeFromParent();
  }
}
