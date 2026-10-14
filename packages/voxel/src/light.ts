/**
 * Light propagation over a 3 × 3-chunk region (48 × 48 × 128 cells).
 *
 * Sky light falls straight down from the top of the world at level 15
 * (filtered by leaves and water), then floods sideways and into caves,
 * losing one level per block. Block light floods out from emissive blocks
 * (torches, glowstone, lava) the same way. Light reaches at most 15 blocks,
 * so the values computed for the centre chunk and its one-block border are
 * exact: no seams between chunks meshed in different jobs.
 *
 * All buffers are allocated once per {@link LightVolume} and reused: a
 * worker computes light for chunk after chunk without allocating.
 */
import type { BlockRegistry } from './blocks';
import { CHUNK, HEIGHT } from './constants';

/** Region edge in cells (3 chunks). */
export const REGION = CHUNK * 3;
/** Cells in one horizontal layer of the region. */
export const REGION_LAYER = REGION * REGION;
/** Cells in the region. */
export const REGION_VOLUME = REGION_LAYER * HEIGHT;

const QUEUE_SIZE = 1 << 20;
const QUEUE_MASK = QUEUE_SIZE - 1;

/** Region index of (x, y, z) in region coordinates. */
export function regionIndex(x: number, y: number, z: number): number {
  return x + z * REGION + y * REGION_LAYER;
}

/** Reusable dense region + light buffers. */
export class LightVolume {
  /** Block ids, `regionIndex` order. */
  readonly blocks = new Uint16Array(REGION_VOLUME);
  /** Sky light 0–15. */
  readonly sky = new Uint8Array(REGION_VOLUME);
  /** Block light 0–15. */
  readonly block = new Uint8Array(REGION_VOLUME);
  private readonly queue = new Int32Array(QUEUE_SIZE);
  /** Highest y holding a non-air block anywhere in the region (−1 when empty). */
  top = -1;

  /**
   * Compute sky and block light for the current {@link blocks}. `top` must
   * be set (cells above it are air). `emitters` false skips the emissive scan.
   */
  compute(reg: BlockRegistry, emitters = true): void {
    const blocks = this.blocks;
    const sky = this.sky;
    const light = this.block;
    const cost = reg.lightCost;
    const opaque = reg.opaque;
    const top = Math.min(HEIGHT - 1, this.top + 1);
    // 1. Direct sky light: columns from the top down.
    sky.fill(15, (top + 1) * REGION_LAYER);
    light.fill(0);
    for (let c = 0; c < REGION_LAYER; c++) {
      let cur = 15;
      for (let y = top, i = c + top * REGION_LAYER; y >= 0; y--, i -= REGION_LAYER) {
        const b = blocks[i] as number;
        if (cur > 0) {
          if (opaque[b] === 1) cur = 0;
          else if (cost[b] as number > 1) cur = Math.max(0, cur - ((cost[b] as number) - 1));
        }
        sky[i] = cur;
      }
    }
    // 2. Spread sideways and into caves: seed cells brighter than a neighbour can receive.
    const q = this.queue;
    let head = 0;
    let tail = 0;
    const maxY = top;
    for (let y = 0; y <= maxY; y++) {
      const base = y * REGION_LAYER;
      for (let z = 0; z < REGION; z++) {
        for (let x = 0; x < REGION; x++) {
          const i = base + x + z * REGION;
          const l = sky[i] as number;
          if (l < 2) continue;
          if (
            (x > 0 && sky[i - 1]! < l - 1 && opaque[blocks[i - 1]!] === 0) ||
            (x < REGION - 1 && sky[i + 1]! < l - 1 && opaque[blocks[i + 1]!] === 0) ||
            (z > 0 && sky[i - REGION]! < l - 1 && opaque[blocks[i - REGION]!] === 0) ||
            (z < REGION - 1 && sky[i + REGION]! < l - 1 && opaque[blocks[i + REGION]!] === 0) ||
            (y > 0 && sky[i - REGION_LAYER]! < l - 1 && opaque[blocks[i - REGION_LAYER]!] === 0)
          ) {
            q[tail] = i;
            tail = (tail + 1) & QUEUE_MASK;
          }
        }
      }
    }
    this.flood(sky, q, head, tail, cost, opaque, blocks);
    // 3. Block light from emitters.
    if (!emitters) return;
    const emit = reg.emissive;
    head = 0;
    tail = 0;
    for (let i = 0, end = (maxY + 1) * REGION_LAYER; i < end; i++) {
      const e = emit[blocks[i] as number] as number;
      if (e > 0) {
        light[i] = e;
        q[tail] = i;
        tail = (tail + 1) & QUEUE_MASK;
      }
    }
    if (tail > 0) this.flood(light, q, head, tail, cost, opaque, blocks);
  }

  /** Breadth-first flood from the queued cells. */
  private flood(level: Uint8Array, q: Int32Array, head: number, tail: number, cost: Uint8Array, opaque: Uint8Array, blocks: Uint16Array): void {
    while (head !== tail) {
      const i = q[head] as number;
      head = (head + 1) & QUEUE_MASK;
      const l = level[i] as number;
      if (l <= 1) continue;
      const x = i % REGION;
      const rest = (i - x) / REGION;
      const z = rest % REGION;
      const y = (rest - z) / REGION;
      for (let d = 0; d < 6; d++) {
        let j: number;
        switch (d) {
          case 0: if (x === 0) continue; j = i - 1; break;
          case 1: if (x === REGION - 1) continue; j = i + 1; break;
          case 2: if (z === 0) continue; j = i - REGION; break;
          case 3: if (z === REGION - 1) continue; j = i + REGION; break;
          case 4: if (y === 0) continue; j = i - REGION_LAYER; break;
          default: if (y === HEIGHT - 1) continue; j = i + REGION_LAYER; break;
        }
        const b = blocks[j] as number;
        if (opaque[b] === 1) continue;
        const nl = l - (cost[b] as number);
        if (nl > (level[j] as number)) {
          level[j] = nl;
          // A full ring drops the update rather than overwriting pending cells (never hit in practice).
          if (((tail + 1) & QUEUE_MASK) === head) continue;
          q[tail] = j;
          tail = (tail + 1) & QUEUE_MASK;
        }
      }
    }
  }
}
