/**
 * The AI half of reading a photo steadily: after the independent reads are merged by majority (`consensusDescription`
 * in `@aether/arch/photo`), one call looks at the photo and the CONTESTED entries only (seen by some reads but not a
 * majority, or kept without every read) and decides on each, with a reason it can point to in the photo. It cannot
 * invent pieces (only clusters some read saw can be added) and it cannot touch what every read agreed on. A decision
 * without a usable reason is ignored; with no usable answer the majority stands.
 */
import { contested, type ClusterReport, type ConsensusChoice, type ConsensusReport, type RoomDescription } from '@aether/arch/photo';
import { z } from 'zod';
import type { CompletionRequest, CompletionResponse, ContentBlock, ToolDef } from '../types';

export const RECONCILE_TOOL_NAME = 'reconcile_room';
/** Seed of the reconciliation call (advisory, like the judges'). */
export const RECONCILE_SEED = 9151;

export const RECONCILE_SYSTEM =
  'You are a careful surveyor checking an inventory of a room against its photograph. Several independent readings of the same photo disagree on a few entries; you look at the photo and settle each disputed entry on the evidence you can see. You never add what the photo does not show, you never remove what it does show, and you answer only by calling the reconcile_room tool.';

const Decision = z.object({ key: z.string().min(1).max(40), reason: z.string().trim().min(12).max(300) });
const ReconcileInput = z.object({
  add: z.array(z.unknown()).max(80).default([]),
  remove: z.array(z.unknown()).max(80).default([]),
  summary: z.string().max(400).optional(),
});

export const RECONCILE_TOOL: ToolDef = {
  name: RECONCILE_TOOL_NAME,
  description: 'Settle the disputed entries of the merged inventory: which candidates to add and which kept entries to remove, each with the evidence in the photo.',
  inputSchema: {
    type: 'object',
    properties: {
      add: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, reason: { type: 'string', description: 'What you see in the photo at that place that makes it real.' } }, required: ['key', 'reason'] } },
      remove: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, reason: { type: 'string', description: 'Why it is not in the photo (nothing there, or the same object as another entry).' } }, required: ['key', 'reason'] } },
      summary: { type: 'string' },
    },
    required: ['add', 'remove'],
    additionalProperties: false,
  },
};

const pct = (b: readonly number[] | undefined): string => (b ? `[${b.map((v) => v.toFixed(2)).join(', ')}]` : 'no box');
const line = (c: ClusterReport, n: number): string => `- ${c.key}: ${c.kind}${c.label ? ` "${c.label.slice(0, 90)}"` : ''}, seen by ${c.support} of ${n} readings, at ${pct(c.box)} in the photo (${c.where})`;

/** The user turn of the reconciliation call (null: nothing is contested). */
export function reconcileText(report: ConsensusReport, d: RoomDescription): string | null {
  const c = contested(report);
  if (c.add.length === 0 && c.remove.length === 0) return null;
  const kept = [...report.openings, ...report.items].filter((x) => x.kept && x.support === report.reads);
  return [
    `${report.reads} independent readings of the attached photo were merged: an entry seen by most of them was kept. Boxes are [x0, y0, x1, y1] as fractions of the photo (origin top-left).`,
    `Room: ${d.summary || d.roomType}`,
    kept.length > 0 ? `Agreed by every reading (not in dispute):\n${kept.map((x) => line(x, report.reads)).join('\n')}` : '',
    c.remove.length > 0 ? `Kept, but not every reading saw it (remove only if it is NOT in the photo, or is the same object as another entry):\n${c.remove.map((x) => line(x, report.reads)).join('\n')}` : '',
    c.add.length > 0 ? `Left out, seen by too few readings (add only if you can clearly see it in the photo at that box and it is not already listed):\n${c.add.map((x) => line(x, report.reads)).join('\n')}` : '',
    'Look at the photo, then call reconcile_room once: "add" lists the keys to bring back, "remove" the keys to drop, each with the evidence you see. Leave out anything you are not sure about (the majority stands). Empty lists are a fine answer.',
  ]
    .filter((l) => l.length > 0)
    .join('\n\n');
}

/** Parse the answer against what may be decided. Unknown keys and decisions without a reason are dropped. */
export function parseReconcile(input: unknown, report: ConsensusReport): ConsensusChoice & { reasons: string[] } {
  const p = ReconcileInput.safeParse(input);
  if (!p.success) return { add: [], remove: [], reasons: [] };
  const c = contested(report);
  const canAdd = new Set(c.add.map((x) => x.key));
  const canRemove = new Set(c.remove.map((x) => x.key));
  const add: string[] = [];
  const remove: string[] = [];
  const reasons: string[] = [];
  for (const raw of p.data.add) {
    const d = Decision.safeParse(raw);
    if (d.success && canAdd.has(d.data.key) && !add.includes(d.data.key)) {
      add.push(d.data.key);
      reasons.push(`added ${d.data.key}: ${d.data.reason.slice(0, 160)}`);
    }
  }
  for (const raw of p.data.remove) {
    const d = Decision.safeParse(raw);
    if (d.success && canRemove.has(d.data.key) && !remove.includes(d.data.key)) {
      remove.push(d.data.key);
      reasons.push(`removed ${d.data.key}: ${d.data.reason.slice(0, 160)}`);
    }
  }
  return { add, remove, reasons };
}

/** Ask once (one retry when the tool was not called). Returns null when nothing usable came back. */
export async function runReconcile(complete: (req: CompletionRequest) => Promise<CompletionResponse>, photo: string, report: ConsensusReport, d: RoomDescription, maxTokens: number): Promise<(ConsensusChoice & { reasons: string[] }) | null> {
  const text = reconcileText(report, d);
  if (!text) return null;
  const req: CompletionRequest = {
    role: 'planner',
    system: RECONCILE_SYSTEM,
    messages: [{ role: 'user', content: [{ type: 'text', text }, { type: 'text', text: 'The PHOTO:' }, { type: 'image', dataUrl: photo }] }],
    tools: [RECONCILE_TOOL],
    maxTokens,
    temperature: 0,
    seed: RECONCILE_SEED,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await complete(req);
    const call = res.content.find((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use' && b.name === RECONCILE_TOOL_NAME);
    if (call) return parseReconcile(call.input, report);
    req.messages = [...req.messages, { role: 'assistant', content: res.content.length > 0 ? res.content : [{ type: 'text', text: '(no answer)' }] }, { role: 'user', content: [{ type: 'text', text: 'Call reconcile_room now (empty lists are fine).' }] }];
  }
  return null;
}
