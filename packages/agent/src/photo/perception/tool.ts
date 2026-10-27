/**
 * The `perceive_photo` tool: the model names the objects it wants measured (the nouns of its own inventory, or anything it
 * suspects the readings missed) and gets back numbers, a text summary and an annotated picture. Read-only and advisory.
 */
import { z } from 'zod';
import type { ContentBlock, ToolDef } from '../../types';
import { APPLY_COLOUR_TOOL_NAME, PERCEIVE_TOOL_NAME } from './names';
import { DEFAULT_NOUNS, perceptionText, type Perceiver, type PerceptionReport } from './perceive';

export { PERCEIVE_TOOL_NAME };

export const PERCEIVE_TOOL: ToolDef = {
  name: PERCEIVE_TOOL_NAME,
  description:
    'Measure the photo with specialised vision models (advisory: you decide, and each number can be wrong). Give `find`: the object nouns to look for ("bed", "nightstand", "desk", "curtain", "rug", "lamp", "painting", "luggage"); the open detector also lists objects you did not name. Returns, per object: label, confidence, box, mask quality, measured colour (CIELAB median, palette, plain words and hex, robust to glare), pattern (plain, stripes, check), finish (matte or glossy), and its place in metres (on the floor or wall, size, height, which wall it is against, its neighbours); plus the room box from metric depth (width, depth, height with a range and a confidence), the camera height and field of view, and the floor, wall and ceiling colours. An annotated picture follows (numbered boxes, masks, colour chips). Objects already found are kept; a second call only adds the nouns not yet asked. Read-only, about 10 to 20 seconds on the CPU the first time.',
  inputSchema: {
    type: 'object',
    properties: {
      find: { type: 'array', items: { type: 'string' }, description: 'Object nouns to look for, singular.' },
      generic: { type: 'boolean', description: 'Also run the open detection pass that lists objects nobody named (done on the first call).' },
    },
    additionalProperties: false,
  },
};

const Input = z.object({ find: z.array(z.string().max(40)).max(40).optional(), generic: z.boolean().optional() });

export function parsePerceiveInput(input: unknown): { find: string[]; generic?: boolean } | null {
  const p = Input.safeParse(input ?? {});
  if (!p.success) return null;
  return { find: p.data.find ?? [], ...(p.data.generic !== undefined ? { generic: p.data.generic } : {}) };
}

export interface Perceived {
  text: string;
  blocks: ContentBlock[];
  isError: boolean;
  report: PerceptionReport | null;
}

/** Run the perceiver and word the result; `defaults` makes an empty `find` ask the room nouns. */
export async function perceivePhoto(p: Perceiver, input: { find: string[]; generic?: boolean }, defaults = false): Promise<Perceived> {
  const find = input.find.length === 0 && defaults ? DEFAULT_NOUNS : input.find;
  const rep = await p.run({ find, ...(input.generic !== undefined ? { generic: input.generic } : {}) }).catch((e: unknown) => {
    void e;
    return null;
  });
  if (!rep) return { text: 'perceive_photo: the host could not decode the photo or the measuring failed, so there are no measurements. Nothing changed; use your own reading.', blocks: [], isError: true, report: null };
  const none = rep.objects.length === 0 && !rep.room;
  if (none) return { text: `perceive_photo: not available (${rep.unavailable.join(' | ') || 'no model ran'}). Nothing changed; use your own reading.`, blocks: [], isError: true, report: rep };
  const overlay = await p.overlay().catch(() => null);
  const blocks: ContentBlock[] = overlay ? [{ type: 'text', text: 'Annotated photo from perceive_photo (numbered boxes, masks, measured colour chips)' }, { type: 'image', dataUrl: overlay }] : [];
  return { text: `${perceptionText(rep)}${overlay ? '\nThe annotated picture follows this reply.' : ''}`, blocks, isError: false, report: rep };
}

export { APPLY_COLOUR_TOOL_NAME };
export const APPLY_COLOUR_TOOL: ToolDef = {
  name: APPLY_COLOUR_TOOL_NAME,
  description:
    'Set a built piece\'s colour from the colour MEASURED on the photo, in one step (no hex to copy by hand). `object`: the inventory object id or the perceived id (p3) whose photo colour is used; `ref`: the built entity to colour (default: the object\'s first linked piece); `source`: "seen" (the colour as the photo shows it, default) or "lit-like-white" (the cast and exposure removed with the ceiling or a whitish wall as the white reference: use it when the photo is under- or over-exposed and the preview light is neutral); `param`: which colour parameter of the piece (default: color, else the first of linen, upholstery, shade, headboard, seat, body, top that holds a hex). Goes through edit_items (resize with params), so it is one measured, validated, undoable edit; pieces whose colour is a named finish cannot take a hex and are refused with the reason. Advisory: look at the next render and say if it is better.',
  inputSchema: {
    type: 'object',
    properties: {
      object: { type: 'string', description: 'Inventory object id or perceived object id.' },
      ref: { type: 'string', description: 'Built entity id to colour.' },
      source: { type: 'string', enum: ['seen', 'lit-like-white'] },
      param: { type: 'string' },
    },
    required: ['object'],
    additionalProperties: false,
  },
};
const ColourInput = z.object({ object: z.string().min(1).max(60), ref: z.string().max(80).optional(), source: z.enum(['seen', 'lit-like-white']).optional(), param: z.string().max(40).optional() });
export function parseApplyColourInput(input: unknown): z.infer<typeof ColourInput> | null {
  const p = ColourInput.safeParse(input);
  return p.success ? p.data : null;
}
export const COLOUR_PARAMS = ['color', 'linen', 'upholstery', 'shade', 'headboard', 'seat', 'body', 'top'] as const;
