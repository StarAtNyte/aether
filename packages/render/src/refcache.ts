/**
 * Reference-counted cache: values are created on first `acquire`, shared by
 * every later `acquire` with the same key and disposed when the last holder
 * calls `release`.
 */
export class RefCache<V> {
  private readonly entries = new Map<string, { value: V; refs: number }>();

  /**
   * @param disposeValue called exactly once when a value's refcount drops to zero
   *   (or on {@link clear}).
   */
  constructor(private readonly disposeValue: (value: V) => void) {}

  /** Get (and retain) the value for `key`, creating it with `create` if missing. */
  acquire(key: string, create: () => V): V {
    const hit = this.entries.get(key);
    if (hit) {
      hit.refs++;
      return hit.value;
    }
    const value = create();
    this.entries.set(key, { value, refs: 1 });
    return value;
  }

  /** Retain an existing value. Returns false when the key is unknown. */
  retain(key: string): boolean {
    const hit = this.entries.get(key);
    if (!hit) return false;
    hit.refs++;
    return true;
  }

  /** Peek without retaining. */
  peek(key: string): V | undefined {
    return this.entries.get(key)?.value;
  }

  /** Release one reference; disposes the value at zero. Unknown keys are ignored. */
  release(key: string): void {
    const hit = this.entries.get(key);
    if (!hit) return;
    hit.refs--;
    if (hit.refs <= 0) {
      this.entries.delete(key);
      this.disposeValue(hit.value);
    }
  }

  /** Current reference count of `key` (0 when absent). */
  refs(key: string): number {
    return this.entries.get(key)?.refs ?? 0;
  }

  /** Number of live entries. */
  get size(): number {
    return this.entries.size;
  }

  /** Dispose every value regardless of refcount. */
  clear(): void {
    for (const { value } of this.entries.values()) this.disposeValue(value);
    this.entries.clear();
  }
}
