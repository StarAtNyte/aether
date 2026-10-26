/**
 * Runs the brief step: one model call that writes the brief, the user's optional edit, and the optional generated
 * reference image. Never throws for a model or image failure: the build goes on without what could not be made, and the run
 * record says so.
 */
import { ReferenceLook, BRIEF_TOOL, BRIEF_TOOL_NAME, briefRequestText, briefSystem, parseBrief, type Brief, type BriefView, type ReferenceRecord } from './brief';
import { isImageDataUrl } from './context';
import { raceAbort } from './executor';
import { errorMessage } from './providers/errors';
import type { ImageGenerator } from './images';
import { cropBox } from './photo/closer';
import type { AgentEvent, AgentHost, ChatMessage, ContentBlock, Provider, UsageTotals } from './types';

/** What the user may do with the plan before the build: return an edited brief and/or notes; null or undefined: carry on. */
export type BriefReviewer = (view: BriefView) => Promise<{ brief?: unknown; notes?: string } | null | undefined>;

export interface BriefStageResult {
  brief: Brief;
  notes?: string;
  /** The generated reference picture (a data URL; held for this run only, never stored in the project). */
  reference?: { dataUrl: string; label: string };
  record: ReferenceRecord;
}

export interface BriefStageArgs {
  provider: Provider;
  request: string;
  usage: UsageTotals;
  maxTokens: number;
  signal?: AbortSignal;
  webSearch?: boolean;
  images?: ImageGenerator | null;
  review?: BriefReviewer;
}

/** The text of the picture request: a wide, realistic, text-free view for the model to study. */
export function referencePrompt(brief: Brief): string {
  const what = (brief.reference.prompt?.trim() || `${brief.kind}: ${brief.summary}`).slice(0, 500);
  return `A single realistic, well-lit wide view of: ${what} Show the typical fittings, materials and layout of this kind of place. No text, no logos, no watermark.`;
}

/** Generator: yields `status`, `brief` and `step` events; returns the result, or null when no brief could be made. */
export async function* briefStage(a: BriefStageArgs): AsyncGenerator<AgentEvent, BriefStageResult | null> {
  yield { type: 'status', text: 'Writing the brief…' };
  const messages: ChatMessage[] = [{ role: 'user', content: [{ type: 'text', text: briefRequestText(a.request) }] }];
  let brief: Brief | null = null;
  for (let attempt = 0; attempt < 2 && !brief; attempt++) {
    let res;
    try {
      res = await raceAbort(a.provider.complete({ role: 'planner', system: briefSystem({ ...(a.webSearch ? { webSearch: true } : {}) }), messages, tools: [BRIEF_TOOL], maxTokens: Math.min(a.maxTokens, 6000) }, a.signal), a.signal);
    } catch (e) {
      if (a.signal?.aborted) throw e;
      // One more try: a provider that fails once (a dropped connection, a stray tool call from a CLI) usually answers the second time.
      if (attempt === 0) continue;
      yield { type: 'step', tool: BRIEF_TOOL_NAME, label: `Brief unavailable (${errorMessage(e).slice(0, 80)})`, ok: false };
      return null;
    }
    a.usage.calls += 1;
    a.usage.inputTokens += res.usage?.inputTokens ?? 0;
    a.usage.outputTokens += res.usage?.outputTokens ?? 0;
    messages.push({ role: 'assistant', content: res.content });
    const call = res.content.find((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use' && b.name === BRIEF_TOOL_NAME);
    if (!call) {
      messages.push({ role: 'user', content: [{ type: 'text', text: 'Call submit_brief now with the brief.' }] });
      continue;
    }
    const parsed = parseBrief(call.input);
    if (parsed.ok) brief = parsed.brief;
    else messages.push({ role: 'user', content: [{ type: 'tool_result', toolUseId: call.id, content: parsed.error, isError: true }] });
  }
  if (!brief) {
    yield { type: 'step', tool: BRIEF_TOOL_NAME, label: 'Brief could not be written; building without it', ok: false };
    return null;
  }
  yield { type: 'step', tool: BRIEF_TOOL_NAME, label: 'Writing the brief', ok: true };

  // The reference picture: the model decided whether it wants one; the host decides whether it can make one.
  let record: ReferenceRecord = { decision: 'skipped', reason: brief.reference.reason.slice(0, 240) };
  let reference: BriefStageResult['reference'];
  if (brief.reference.generate) {
    const prompt = referencePrompt(brief);
    if (!a.images) {
      record = { decision: 'unavailable', reason: `${brief.reference.reason} (no image model is connected, so it was built from the brief alone)`.slice(0, 300), prompt };
    } else {
      yield { type: 'status', text: 'Making a reference image…' };
      try {
        const img = await raceAbort(a.images.generate({ prompt, size: 1024, ...(a.signal ? { signal: a.signal } : {}) }), a.signal);
        if (!isImageDataUrl(img.dataUrl)) throw new Error('the image service returned something that is not a picture');
        record = { decision: 'generated', reason: brief.reference.reason.slice(0, 240), prompt, provenance: 'generated reference', via: img.via, model: img.model };
        reference = { dataUrl: img.dataUrl, label: 'Generated reference image (AI-made, for ideas)' };
        yield { type: 'step', tool: 'reference_image', label: 'Made a reference image', ok: true, looked: [{ label: reference.label, dataUrl: img.dataUrl }] };
      } catch (e) {
        if (a.signal?.aborted) throw e;
        record = { decision: 'failed', reason: `${brief.reference.reason} (the image could not be made: ${errorMessage(e).slice(0, 120)})`.slice(0, 300), prompt };
        yield { type: 'step', tool: 'reference_image', label: 'Reference image unavailable', ok: false };
      }
    }
  }

  // The plan is shown; the user may edit it when the host asked for that. Default: carry on.
  let notes: string | undefined;
  const view: BriefView = { brief, editable: a.review !== undefined, reference: record };
  yield { type: 'brief', view };
  if (a.review) {
    yield { type: 'status', text: 'Waiting for you to review the plan…' };
    const edited = await raceAbort(a.review(view), a.signal).catch((e: unknown) => {
      if (a.signal?.aborted) throw e;
      return null;
    });
    if (edited) {
      if (edited.brief !== undefined) {
        const again = parseBrief(edited.brief);
        if (again.ok) brief = again.brief;
      }
      if (typeof edited.notes === 'string' && edited.notes.trim()) notes = edited.notes.trim().slice(0, 1000);
      yield { type: 'brief', view: { brief, editable: false, reference: record, ...(notes ? { notes } : {}) } };
    }
  }
  return { brief, ...(notes ? { notes } : {}), ...(reference ? { reference } : {}), record };
}

/** `look_closer` for the reference picture: the text of the tool result and the crops to show after it. */
export async function lookReference(ref: { dataUrl: string }, host: Pick<AgentHost, 'composeImages'>, rawInput: unknown): Promise<{ text: string; blocks: ContentBlock[]; isError: boolean }> {
  const p = ReferenceLook.safeParse(rawInput);
  if (!p.success) return { text: 'look_closer needs {"regions":[{"box":[x0,y0,x1,y1]}]} or {"whole":true}.', blocks: [], isError: true };
  const { regions = [], whole = false } = p.data;
  if (regions.length === 0 && !whole) return { text: 'look_closer: ask for regions or whole.', blocks: [], isError: true };
  const blocks: ContentBlock[] = [];
  const lines: string[] = [];
  if (whole) {
    blocks.push({ type: 'text', text: 'look_closer: the whole reference image' }, { type: 'image', dataUrl: ref.dataUrl });
    lines.push('- whole picture shown below.');
  }
  for (const r of regions) {
    const box = cropBox(r.box);
    const img = host.composeImages ? await host.composeImages([{ dataUrl: ref.dataUrl, box }], { maxSide: 1024 }).catch(() => null) : null;
    if (!img) {
      lines.push(`- region [${box.join(', ')}]: this host cannot crop; use {"whole":true}.`);
      continue;
    }
    lines.push(`- region [${box.join(', ')}]${r.note ? ` (${r.note})` : ''}: shown below.`);
    blocks.push({ type: 'text', text: `look_closer region [${box.join(', ')}] of the generated reference` }, { type: 'image', dataUrl: img });
  }
  return { text: `Reference image (AI-made, for ideas):\n${lines.join('\n')}`, blocks, isError: blocks.length === 0 };
}
