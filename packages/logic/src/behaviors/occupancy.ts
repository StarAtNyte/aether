/**
 * Edge detection for "who is inside me" questions (pickups, goals, plates…).
 */
import type { EntityId } from '@aether/core';

/** Tracks which ids are inside a zone and reports enter/exit transitions. */
export class Occupancy {
  private readonly stamps = new Map<EntityId, number>();
  private generation = 0;

  /** Number of ids currently inside. */
  get count(): number {
    return this.stamps.size;
  }

  /**
   * Re-evaluate occupancy. `isInside` is called for every candidate; ids that
   * were inside but are no longer inside (or no longer candidates, e.g.
   * destroyed) are reported through `onExit`.
   */
  update(
    candidates: readonly EntityId[],
    isInside: (id: EntityId) => boolean,
    onEnter?: (id: EntityId) => void,
    onExit?: (id: EntityId) => void,
  ): void {
    const gen = ++this.generation;
    for (const id of candidates) {
      if (!isInside(id)) continue;
      const had = this.stamps.has(id);
      this.stamps.set(id, gen);
      if (!had) onEnter?.(id);
    }
    if (this.stamps.size === 0) return;
    for (const [id, stamp] of this.stamps) {
      if (stamp === gen) continue;
      this.stamps.delete(id);
      onExit?.(id);
    }
  }

  /** Forget everyone. */
  clear(): void {
    this.stamps.clear();
  }
}
