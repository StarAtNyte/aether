/** Reusable visibility snapshots for auxiliary passes. Nested draws get independent scratch frames. */
type Visible = { visible: boolean };
interface Snapshot {
  objects: Array<Visible | null>;
  values: boolean[];
  count: number;
}

export class PassVisibility {
  private readonly frames: Snapshot[] = [];
  private depth = 0;

  hide(objects: readonly Visible[]): void {
    const frame = this.frames[this.depth] ?? { objects: [], values: [], count: 0 };
    this.frames[this.depth++] = frame;
    const count = objects.length;
    frame.count = count;
    // Snapshot before changing anything: the same material may occur more than once.
    for (let i = 0; i < count; i++) {
      const object = objects[i]!;
      frame.objects[i] = object;
      frame.values[i] = object.visible;
    }
    for (let i = 0; i < count; i++) frame.objects[i]!.visible = false;
  }

  restore(): void {
    if (this.depth === 0) return;
    const frame = this.frames[--this.depth]!;
    for (let i = 0; i < frame.count; i++) {
      frame.objects[i]!.visible = frame.values[i]!;
      frame.objects[i] = null; // Scratch storage must not retain disposed scene resources.
    }
    frame.count = 0;
  }
}
