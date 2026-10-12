/**
 * Selection highlight that works identically on both backends and costs one
 * line draw per selected entity: a bright, always-on-top bounding box that
 * tracks the object (re-fitted each frame, allocation-free).
 */
import { BoxHelper, Group, type Object3D } from 'three';
import type { EntityId } from '@aether/core';

/** Max simultaneously highlighted entities. */
export const MAX_HIGHLIGHTS = 256;
const COLOR = 0x4cc9ff;

/** Selection outline manager. */
export class Highlighter {
  readonly group = new Group();
  private readonly helpers = new Map<EntityId, { helper: BoxHelper; target: Object3D }>();

  constructor() {
    this.group.name = 'aether:highlight';
  }

  /** Highlighted ids. */
  get ids(): EntityId[] {
    return [...this.helpers.keys()];
  }

  /** Replace the highlighted set. `resolve` maps ids to scene objects. */
  set(ids: readonly EntityId[], resolve: (id: EntityId) => Object3D | undefined): void {
    const wanted = new Set(ids.slice(0, MAX_HIGHLIGHTS));
    for (const [id, h] of this.helpers) {
      if (wanted.has(id) && resolve(id) === h.target) continue;
      this.remove(id);
    }
    for (const id of wanted) {
      if (this.helpers.has(id)) continue;
      const target = resolve(id);
      if (!target) continue;
      const helper = new BoxHelper(target, COLOR);
      helper.name = `highlight:${id}`;
      helper.raycast = () => undefined;
      const mat = helper.material;
      if (!Array.isArray(mat)) {
        mat.depthTest = false;
        mat.transparent = true;
      }
      helper.renderOrder = 10;
      this.helpers.set(id, { helper, target });
      this.group.add(helper);
    }
  }

  private remove(id: EntityId): void {
    const h = this.helpers.get(id);
    if (!h) return;
    h.helper.removeFromParent();
    h.helper.dispose();
    this.helpers.delete(id);
  }

  /** Re-fit boxes to (possibly moving) targets. Drops targets that left the scene. */
  update(): void {
    for (const [id, h] of this.helpers) {
      if (!h.target.parent) {
        this.remove(id);
        continue;
      }
      h.helper.update();
    }
  }

  /** Remove all highlights. */
  clear(): void {
    for (const id of [...this.helpers.keys()]) this.remove(id);
  }

  /** Release resources. */
  dispose(): void {
    this.clear();
    this.group.removeFromParent();
  }
}
