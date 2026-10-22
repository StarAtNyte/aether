/**
 * `look_closer`: the compare turn's magnifier. The render is always taken from the photo's own solved camera, so a box in
 * 0..1 of the photo is the same place in the render. The model asks for what it wants to see and gets it as pictures:
 *
 * - `regions`: for each box a crop of the photo (left) next to the same crop of the render (right), to judge a curtain, a
 *   frame, a rug edge, a pendant or a material at a size the full picture cannot show.
 * - `side_by_side`: the whole photo and the whole render in one image, same camera, for proportion and position.
 * - `plan`: the room from above, ceiling removed, with the numbered pieces (the legend gives each id, position and size) and
 *   the room's measured width, depth and height, for what a flat picture hides (depth, spacing, what stands where).
 *
 * Pure helpers: the host draws (composeImages, captureReview); this file decides what is asked and words the answer.
 */
import { z } from 'zod';
import type { AgentHost, ContentBlock, ToolDef } from '../types';

export const CLOSER_TOOL_NAME = 'look_closer';
/** Most crops in one call. */
export const CLOSER_MAX_REGIONS = 4;
/** Smallest side of a crop (share of the picture): tinier boxes only show blur. */
const MIN_SIDE = 0.08;

export const CLOSER_TOOL: ToolDef = {
  name: CLOSER_TOOL_NAME,
  description:
    'Look closer at the photo and the render before you judge or fix. {regions:[{box:[x0,y0,x1,y1] in 0..1 of the photo (origin top-left), note?}] (up to 4)} returns, for each box, the photo crop and the SAME crop of the render side by side (same camera, so the same box is the same place): use it for a curtain, a frame, a rug edge, a pendant, a texture, anything too small in the full picture | {side_by_side:true} the whole photo and the whole render in one image | {plan:true} the room from above with every piece numbered (legend: id, position, size) and the room\'s width, depth and height, for depth, spacing and what stands where. Cheap and read-only: look first, then name the biggest difference.',
  inputSchema: {
    type: 'object',
    properties: {
      regions: {
        type: 'array',
        maxItems: CLOSER_MAX_REGIONS,
        items: {
          type: 'object',
          properties: { box: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 }, note: { type: 'string' } },
          required: ['box'],
        },
      },
      side_by_side: { type: 'boolean' },
      plan: { type: 'boolean' },
    },
    additionalProperties: false,
  },
};

const Input = z.object({
  regions: z.array(z.object({ box: z.tuple([z.number(), z.number(), z.number(), z.number()]), note: z.string().max(120).optional() })).max(CLOSER_MAX_REGIONS).optional(),
  side_by_side: z.boolean().optional(),
  plan: z.boolean().optional(),
});

/** A box clamped to the picture and widened to the smallest side that is worth looking at. */
export function cropBox(b: readonly [number, number, number, number]): [number, number, number, number] {
  let [x0, y0, x1, y1] = b;
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  const fit = (lo: number, hi: number): [number, number] => {
    let a = Math.max(0, Math.min(1, lo));
    let c = Math.max(0, Math.min(1, hi));
    if (c - a < MIN_SIDE) {
      const mid = (a + c) / 2;
      a = Math.max(0, Math.min(1 - MIN_SIDE, mid - MIN_SIDE / 2));
      c = a + MIN_SIDE;
    }
    return [a, c];
  };
  const [ax, cx] = fit(x0, x1);
  const [ay, cy] = fit(y0, y1);
  return [ax, ay, cx, cy].map((v) => Math.round(v * 1000) / 1000) as [number, number, number, number];
}

/** What {@link lookCloser} needs from the flow. */
export interface CloserDeps {
  photoUrl: string;
  /** The photo-camera render without marks (null when the host did not draw it). */
  renderUrl: string | null;
  compose: AgentHost['composeImages'] | undefined;
  /** The room from above with marks, and the legend of its numbers (null when the host cannot draw it). */
  plan: (() => Promise<{ dataUrl: string; legend: string } | null>) | undefined;
  /** The room's measured size in one line. */
  roomLine: string;
}

/** The text of the tool result and the picture blocks to show the model after it. */
export async function lookCloser(deps: CloserDeps, rawInput: unknown): Promise<{ text: string; blocks: ContentBlock[]; isError: boolean }> {
  const p = Input.safeParse(rawInput);
  if (!p.success) return { text: 'look_closer needs {"regions":[{"box":[x0,y0,x1,y1]}], "side_by_side":true, "plan":true} (any of them).', blocks: [], isError: true };
  const { regions = [], side_by_side: both = false, plan = false } = p.data;
  if (regions.length === 0 && !both && !plan) return { text: 'look_closer: ask for regions, side_by_side or plan.', blocks: [], isError: true };
  const blocks: ContentBlock[] = [];
  const lines: string[] = [];
  const pair = async (label: string, box?: [number, number, number, number]): Promise<void> => {
    if (!deps.renderUrl || !deps.compose) {
      lines.push(`- ${label}: not available (the host cannot draw the render here).`);
      return;
    }
    const tiles = box
      ? [{ dataUrl: deps.photoUrl, box }, { dataUrl: deps.renderUrl, box }]
      : [{ dataUrl: deps.photoUrl }, { dataUrl: deps.renderUrl }];
    const img = await deps.compose(tiles, { maxSide: 1024 }).catch(() => null);
    if (!img) {
      lines.push(`- ${label}: the host could not draw it.`);
      return;
    }
    lines.push(`- ${label}: PHOTO on the left, RENDER on the right, same camera.`);
    blocks.push({ type: 'text', text: `look_closer ${label} (PHOTO left, RENDER right)` }, { type: 'image', dataUrl: img });
  };
  if (both) await pair('whole picture');
  for (const r of regions) {
    const box = cropBox(r.box);
    await pair(`region [${box.join(', ')}]${r.note ? ` (${r.note})` : ''}`, box);
  }
  if (plan) {
    const shot = deps.plan ? await deps.plan().catch(() => null) : null;
    if (!shot) lines.push('- plan: not available (the host cannot draw the plan view).');
    else {
      lines.push(`- plan: room from above, north up. ${deps.roomLine}`);
      blocks.push({ type: 'text', text: `look_closer plan (top-down, ceiling removed, north is up). ${deps.roomLine}\nLegend:\n${shot.legend}` }, { type: 'image', dataUrl: shot.dataUrl });
    }
  }
  return { text: `${lines.join('\n')}\nThe pictures follow this reply.`, blocks, isError: blocks.length === 0 };
}
