/**
 * Why the automatic tier is what it is (pure, unit-tested): one short phrase for Settings, next to the GPU line, so a person
 * whose fast GPU runs on low can see the cause ("Firefox cautious start", "stepped down: 18 fps", "integrated GPU").
 */
import type { GpuTier } from './budget';
import type { RenderTier } from './finishing';
import { hardwareTierCap, type HardwareHints } from './performance';

export interface TierReasonInput {
  gpu: GpuTier;
  /** The tier in effect. */
  tier: RenderTier;
  /** The tier the GPU class and memory budget give before hardware hints and the ladder. */
  base: RenderTier;
  lowMemory: boolean;
  hardware: HardwareHints;
  /** How the ladder began: Firefox's cautious start, a heavy world on a weak GPU, or nothing. */
  start: 'gecko' | 'heavy' | null;
  /** Steps of the ladder given up now. */
  level: number;
  /** Frame rate of the last step down (0: none since the start). */
  stepFps: number;
  /** The measured probe raised the tier above the hardware hint. */
  probed: boolean;
}

const GPU_NAME: Record<GpuTier, string> = { discrete: 'discrete GPU', integrated: 'integrated GPU', software: 'software renderer', unknown: 'unrecognised GPU' };

/** The phrase (never empty). */
export function autoTierReason(i: TierReasonInput): string {
  const climbs = i.level > 0 ? ', climbs while frames are fast' : '';
  if (i.level > 0 && i.stepFps > 0) return `stepped down: ${Math.round(i.stepFps)} fps`;
  if (i.level > 0 && i.start === 'gecko') return `Firefox cautious start${climbs}`;
  if (i.level > 0 && i.start === 'heavy') return `heavy world on an ${GPU_NAME[i.gpu]}${climbs}`;
  if (i.gpu === 'software') return GPU_NAME.software;
  if (i.lowMemory) return 'low memory mode';
  const cap = hardwareTierCap(i.hardware, i.gpu);
  if (cap !== null && cap === i.tier && i.base !== cap) {
    const { cores, memoryGB } = i.hardware;
    const fewCores = cores !== undefined && cores <= 4;
    return fewCores ? `${cores}-core CPU` : `${memoryGB} GB memory`;
  }
  if (i.probed) return 'measured: frames are fast';
  // A laptop with two GPUs often gives the browser the integrated one.
  if (i.gpu === 'integrated') return 'integrated GPU (on a laptop with two GPUs, set the browser to the discrete one)';
  return GPU_NAME[i.gpu];
}
