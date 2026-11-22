/**
 * Progressive library models: a model with a light copy (`lite` in the catalog: the same meshes with 256-512 px textures,
 * a tenth of the bytes) mounts that copy first, so the first view waits for kilobytes, not megabytes; the full file (KTX2
 * textures up to 4096 px) is loaded afterwards and swapped in. This queue decides when: never while the host holds it (a
 * load screen is up: the full files would compete with what the first view needs), at most {@link UPGRADE_CONCURRENCY}
 * files at a time, the file whose nearest copy is closest to the eye first (copies in view count as
 * {@link IN_VIEW_FACTOR} times nearer), and files whose copies are all farther than {@link UPGRADE_NEAR_M} and out of view
 * only while the view rests. Copies of one file upgrade together (one download, one swap per copy).
 *
 * The swap itself belongs to SceneSync (`loadUpgrade`): it keeps the light copy on screen until the full content is
 * loaded, transcoded (KTX2 transcoding runs in the transcoder's workers) and prepared, then replaces it, at the same
 * transform and scale, in the same task as the file's other copies.
 */
import { Frustum, Matrix4, Sphere, Vector3, type PerspectiveCamera } from 'three';

/** Full files downloading / transcoding at once. */
export const UPGRADE_CONCURRENCY = 2;
/** Beyond this distance (m), a file none of whose copies is in view waits for the view to rest. */
export const UPGRADE_NEAR_M = 30;
/** A copy in view counts as this much of its distance. */
export const IN_VIEW_FACTOR = 0.25;

/** One copy waiting for its upgrade. */
export interface UpgradeItem {
  /** False once the copy was rebuilt or removed (the upgrade is dropped). */
  live(): boolean;
  /** World-space bounding sphere of the copy (written into `out`), or null when unknown. */
  bounds(out: Sphere): Sphere | null;
  /**
   * Load and prepare the full content; resolves to the swap (run synchronously, together with the swaps of the file's
   * other copies, so the scene regroups once), or null when there is nothing to swap. Never rejects.
   */
  load(): Promise<(() => void) | null>;
}

export interface ModelUpgradesOptions {
  /** False holds every upgrade (load screen up, host hold). */
  allowed: () => boolean;
  /** The view is at rest (far upgrades start only then). Omitted: always. */
  resting?: () => boolean;
  concurrency?: number;
}

const _sphere = new Sphere();
const _m = new Matrix4();

export class ModelUpgrades {
  private readonly groups = new Map<string, Set<UpgradeItem>>();
  private running = 0;
  private readonly eye = new Vector3();
  private readonly frustum = new Frustum();
  private hasView = false;
  private disposed = false;
  /** Copies ever queued, and those settled (swapped in, failed, dropped): {@link progress}. */
  private requested = 0;
  private settled = 0;

  constructor(private readonly opts: ModelUpgradesOptions) {}

  /** Copies waiting (not yet started). */
  get waiting(): number {
    let n = 0;
    for (const g of this.groups.values()) n += g.size;
    return n;
  }

  /** Files downloading or being swapped in. */
  get active(): number {
    return this.running;
  }

  /**
   * Copies queued since the start (`total`) and those settled (`done`: swapped in, failed, or dropped as their copy went),
   * so `done === total` once nothing is waiting or loading. A host shows it as the full files' progress.
   */
  progress(): { done: number; total: number } {
    return { done: this.settled, total: this.requested };
  }

  /** Queue `item` under `key` (the full file's URL: copies of one file upgrade together). */
  request(key: string, item: UpgradeItem): void {
    if (this.disposed) return;
    let g = this.groups.get(key);
    if (!g) this.groups.set(key, (g = new Set()));
    if (g.has(item)) return;
    g.add(item);
    this.requested++;
  }

  /** Remember the eye (call once a frame, cheap) and start what may start. */
  update(camera: PerspectiveCamera | null): void {
    if (camera && this.groups.size > 0) {
      camera.updateMatrixWorld();
      this.eye.setFromMatrixPosition(camera.matrixWorld);
      this.frustum.setFromProjectionMatrix(_m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      this.hasView = true;
    }
    this.pump();
  }

  private pump(): void {
    const limit = this.opts.concurrency ?? UPGRADE_CONCURRENCY;
    while (!this.disposed && this.running < limit && this.groups.size > 0 && this.opts.allowed()) {
      const key = this.next();
      if (key === null) return;
      const all = [...(this.groups.get(key) ?? [])];
      const items = all.filter((i) => i.live());
      this.settled += all.length - items.length;
      this.groups.delete(key);
      if (items.length === 0) continue;
      this.running++;
      void Promise.all(items.map((i) => i.load().catch(() => null))).then((swaps) => {
        this.running--;
        this.settled += items.length;
        if (!this.disposed)
          for (const swap of swaps) {
            try {
              swap?.();
            } catch {
              // One copy failing to swap keeps its light copy; the others still swap.
            }
          }
        this.pump();
      });
    }
  }

  /** The file to upgrade next, or null when none may start now. Drops dead copies. */
  private next(): string | null {
    let best: string | null = null;
    let bestScore = Infinity;
    const resting = this.opts.resting?.() ?? true;
    for (const [key, items] of this.groups) {
      let score = Infinity;
      for (const item of items) {
        if (!item.live()) {
          items.delete(item);
          this.settled++;
          continue;
        }
        const s = this.hasView ? item.bounds(_sphere) : null;
        if (!s) {
          score = Math.min(score, UPGRADE_NEAR_M);
          continue;
        }
        const d = Math.max(0, this.eye.distanceTo(s.center) - s.radius);
        score = Math.min(score, this.frustum.intersectsSphere(s) ? d * IN_VIEW_FACTOR : d);
      }
      if (items.size === 0) {
        this.groups.delete(key);
        continue;
      }
      if (score > UPGRADE_NEAR_M && !resting) continue;
      if (score < bestScore) {
        bestScore = score;
        best = key;
      }
    }
    return best;
  }

  dispose(): void {
    this.disposed = true;
    this.groups.clear();
  }
}
