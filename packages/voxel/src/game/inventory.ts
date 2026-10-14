/**
 * Inventory with stacks: 36 slots, the first 9 are the hotbar. Adding fills
 * matching stacks first, then empty slots (hotbar first); everything is
 * bounded by each item's stack size. Slots are plain records so the UI and
 * saves read them directly.
 */
import type { ItemRegistry } from './items';

/** A stack in a slot. */
export interface Stack {
  item: string;
  count: number;
}

/** Slots in an inventory. */
export const INVENTORY_SLOTS = 36;
/** Hotbar slots (the first slots). */
export const HOTBAR_SLOTS = 9;

/** See the module docs. */
export class Inventory {
  readonly slots: Array<Stack | null> = new Array<Stack | null>(INVENTORY_SLOTS).fill(null);
  /** Selected hotbar slot (0–8). */
  selected = 0;
  /** Bumped on every change (UI refresh). */
  revision = 0;

  constructor(private readonly items: ItemRegistry) {}

  private max(item: string): number {
    return this.items.get(item)?.maxStack ?? 64;
  }

  /** The selected stack (null: empty hand). */
  get held(): Stack | null {
    return this.slots[this.selected] ?? null;
  }

  /** Select a hotbar slot (wraps). */
  select(slot: number): void {
    if (!Number.isFinite(slot)) return;
    const s = ((Math.trunc(slot) % HOTBAR_SLOTS) + HOTBAR_SLOTS) % HOTBAR_SLOTS;
    if (s !== this.selected) {
      this.selected = s;
      this.revision++;
    }
  }

  /** Add items; returns how many did not fit. Unknown items are refused. */
  add(item: string, count: number): number {
    if (!this.items.has(item) || !(count > 0)) return Math.max(0, Math.floor(count) || 0);
    let left = Math.floor(count);
    const max = this.max(item);
    for (let i = 0; i < INVENTORY_SLOTS && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.item === item && s.count < max) {
        const n = Math.min(left, max - s.count);
        s.count += n;
        left -= n;
      }
    }
    for (let i = 0; i < INVENTORY_SLOTS && left > 0; i++) {
      if (this.slots[i]) continue;
      const n = Math.min(left, max);
      this.slots[i] = { item, count: n };
      left -= n;
    }
    if (left !== count) this.revision++;
    return left;
  }

  /** Count of an item across all slots. */
  count(item: string): number {
    let n = 0;
    for (const s of this.slots) if (s && s.item === item) n += s.count;
    return n;
  }

  /** Remove up to `count` of an item (from the last slots first); returns how many were removed. */
  remove(item: string, count: number): number {
    let left = Math.max(0, Math.floor(count));
    for (let i = INVENTORY_SLOTS - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (!s || s.item !== item) continue;
      const n = Math.min(left, s.count);
      s.count -= n;
      left -= n;
      if (s.count === 0) this.slots[i] = null;
    }
    const removed = Math.max(0, Math.floor(count)) - left;
    if (removed > 0) this.revision++;
    return removed;
  }

  /** Take one item from a slot (placing a block, eating). Returns the item id or null. */
  takeOne(slot: number): string | null {
    const s = this.slots[slot];
    if (!s) return null;
    s.count--;
    if (s.count <= 0) this.slots[slot] = null;
    this.revision++;
    return s.item;
  }

  /**
   * Click-style move between slots: merge into a matching stack (up to its
   * maximum), otherwise swap. `half` moves half the source stack into an
   * empty or matching slot.
   */
  move(from: number, to: number, half = false): void {
    if (from === to || !this.valid(from) || !this.valid(to)) return;
    const a = this.slots[from];
    if (!a) return;
    const b = this.slots[to];
    const amount = half ? Math.ceil(a.count / 2) : a.count;
    if (!b || b.item === a.item) {
      const max = this.max(a.item);
      const room = b ? max - b.count : max;
      const n = Math.min(room, amount);
      if (n <= 0) {
        if (!half) this.swap(from, to);
        return;
      }
      if (b) b.count += n;
      else this.slots[to] = { item: a.item, count: n };
      a.count -= n;
      if (a.count <= 0) this.slots[from] = null;
      this.revision++;
      return;
    }
    if (!half) this.swap(from, to);
  }

  private swap(a: number, b: number): void {
    const t = this.slots[a] ?? null;
    this.slots[a] = this.slots[b] ?? null;
    this.slots[b] = t;
    this.revision++;
  }

  private valid(i: number): boolean {
    return Number.isInteger(i) && i >= 0 && i < INVENTORY_SLOTS;
  }

  /** Empty every slot. */
  clear(): void {
    this.slots.fill(null);
    this.revision++;
  }

  /** Replace all slots (loading a save; unknown items and bad counts are dropped). */
  load(slots: ReadonlyArray<Stack | null>, selected = 0): void {
    this.slots.fill(null);
    for (let i = 0; i < Math.min(INVENTORY_SLOTS, slots.length); i++) {
      const s = slots[i];
      if (!s || !this.items.has(s.item)) continue;
      const count = Math.max(1, Math.min(this.max(s.item), Math.floor(s.count)));
      this.slots[i] = { item: s.item, count };
    }
    this.selected = Math.max(0, Math.min(HOTBAR_SLOTS - 1, Math.floor(selected) || 0));
    this.revision++;
  }

  /** Plain copy of the slots (saves). */
  snapshot(): Array<Stack | null> {
    return this.slots.map((s) => (s ? { item: s.item, count: s.count } : null));
  }
}
