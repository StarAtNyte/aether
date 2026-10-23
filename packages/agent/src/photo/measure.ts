/**
 * `measure_room`: advisory room size from a monocular depth network (see `@aether/arch/photo` depth.ts for the method and
 * depth-model.ts for the model). The numbers are shown next to the model's own reading in the first compare round, and the
 * model can call the tool itself, naming a thing of known size with its box to pin the scale. Nothing here decides a
 * verdict or edits the room; when the model is unavailable (offline, runtime missing, turned off) the text says so.
 */
import { depthAdvisoryText, estimateRoomFromDepth, type DepthAnchor, type RoomDescription, type RoomDepthEstimate } from '@aether/arch/photo';
import { z } from 'zod';
import type { ContentBlock, ToolDef } from '../types';
import { estimateDepthMap, type DepthRaster, type DepthResult } from './depth-model';

export const MEASURE_TOOL_NAME = 'measure_room';

export const MEASURE_TOOL: ToolDef = {
  name: MEASURE_TOOL_NAME,
  description:
    'Estimate the real size of the room from the photo with a depth network (advisory: you decide). Returns width, depth and height in metres with a low-high range, what fixed the scale, and a depth picture (warm = near, cool = far). Without arguments the scale comes from a standard ceiling (2.4 to 2.7 m); to pin it name something of known size that is fully in the photo: {anchor:{name:"door", size_m:2.05, axis:"height"|"width", box:[x0,y0,x1,y1] in 0..1 of the photo (origin top-left)}}: a door leaf about 2.05 m high, a single bed about 0.9 m wide, a table about 0.75 m high, a kitchen counter about 0.9 m high. Width is the span seen across the photo (a lower bound when the side walls are out of frame). Read-only, about a second on the CPU.',
  inputSchema: {
    type: 'object',
    properties: {
      anchor: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          size_m: { type: 'number' },
          axis: { type: 'string', enum: ['height', 'width'] },
          box: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
        },
        required: ['name', 'size_m', 'axis', 'box'],
      },
    },
    additionalProperties: false,
  },
};

const Input = z.object({
  anchor: z
    .object({ name: z.string().max(40), size_m: z.number().min(0.2).max(4), axis: z.enum(['height', 'width']), box: z.tuple([z.number(), z.number(), z.number(), z.number()]) })
    .optional(),
});

/** Door leaf height used when the photo shows a whole door (standard 2.04 m leaf in a 2.1 m opening). */
export const DOOR_HEIGHT_M = 2.05;

/** A door the description places in the photo, fully inside the frame and tall enough to measure: the automatic anchor. */
export function autoAnchor(desc: RoomDescription): DepthAnchor | undefined {
  for (const o of desc.openings) {
    if (o.kind !== 'door' || o.visible === false || !o.box) continue;
    const [x0, y0, x1, y1] = o.box;
    if (y0 < 0.03 || y1 > 0.97 || y1 - y0 < 0.25 || x1 - x0 < 0.03) continue;
    return { name: 'door', sizeM: DOOR_HEIGHT_M, axis: 'height', box: [x0, y0, x1, y1], tolerance: 0.04 };
  }
  return undefined;
}

export interface MeasureDeps {
  /** The photo as RGBA, long side about 518 (null when the host cannot decode). */
  raster: () => Promise<DepthRaster | null>;
  /** Replaces the network (tests). */
  estimate?: (r: DepthRaster) => Promise<DepthResult>;
}

export interface Measured {
  text: string;
  blocks: ContentBlock[];
  isError: boolean;
  estimate: RoomDepthEstimate | null;
}

/** Run the depth network on the photo and word the result; `guess` is the model's own reading, shown next to it. */
export async function measureRoom(deps: MeasureDeps, anchor: DepthAnchor | undefined, guess?: { width: number; depth: number; ceiling?: number }): Promise<Measured> {
  const raster = await deps.raster().catch(() => null);
  if (!raster) return { text: 'measure_room: the host could not decode the photo, so no depth estimate.', blocks: [], isError: true, estimate: null };
  const res = await (deps.estimate ?? estimateDepthMap)(raster);
  if (!res.ok) return { text: `measure_room: not available (${res.reason}). Nothing changed; use your own reading.`, blocks: [], isError: true, estimate: null };
  const est = estimateRoomFromDepth(res.map, anchor ? { anchor } : {});
  const blocks: ContentBlock[] = [{ type: 'text', text: 'Depth picture of the photo (warm = near, cool = far; relative, not metres)' }, { type: 'image', dataUrl: res.image }];
  if (!est) return { text: 'measure_room: the depth map holds no usable room structure (no floor or walls found), so no numbers.', blocks, isError: true, estimate: null };
  return { text: `${depthAdvisoryText(est, guess)}\nThe depth picture follows this reply.`, blocks, isError: false, estimate: est };
}

/**
 * The estimate as evidence for the FIRST reading of the photo (before any shell exists, so no door anchor and no guess to
 * compare with): numbers, range, what fixed the scale, the lower-bound label for the width, and the licence to override.
 */
export function analysisDepthText(m: Measured): string {
  const body = m.text.replace('\nThe depth picture follows this reply.', '').replace(/^measure_room: /, '');
  return `Depth evidence for sizing the room (computed from this photo by a depth network, advisory only: your own reading of the known-size things decides, and you may override it, saying why in assumptions). The second image is its depth picture (warm = near, cool = far).\n${body}\nThe width is a LOWER BOUND whenever a side wall is out of frame: the room is at least this wide, and wider when a wall is not visible. Depth and height are usually closer.`;
}

/** Tool input to an anchor (null when it is not valid). */
export function parseMeasureInput(input: unknown): { anchor?: DepthAnchor } | null {
  const p = Input.safeParse(input ?? {});
  if (!p.success) return null;
  const a = p.data.anchor;
  if (!a) return {};
  const [x0, y0, x1, y1] = a.box;
  const box: [number, number, number, number] = [Math.max(0, Math.min(x0, x1)), Math.max(0, Math.min(y0, y1)), Math.min(1, Math.max(x0, x1)), Math.min(1, Math.max(y0, y1))];
  if (box[2] - box[0] < 0.02 || box[3] - box[1] < 0.02) return null;
  return { anchor: { name: a.name, sizeM: a.size_m, axis: a.axis, box, tolerance: 0.05 } };
}
