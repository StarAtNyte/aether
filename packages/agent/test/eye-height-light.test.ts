import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { runDesignTool } from '@aether/arch';
import { WorldAgent } from '../src/agent';
import { EYE_HEIGHT_LIGHT_CHECK, reviewTurnText, snapshotForReview } from '../src/review';
import { estimatePhotoGrade } from '../src/photo/grade';
import type { CompletionRequest, CompletionResponse, ContentBlock, Provider } from '../src/types';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';

let n = 0;
const call = (name: string, input: unknown): ContentBlock => ({ type: 'tool_use', id: `e${++n}`, name, input });
const isReview = (req: CompletionRequest): boolean => {
  const last = req.messages.at(-1)?.content;
  return Array.isArray(last) && last.some((b) => b.type === 'text' && b.text.startsWith('REVIEW round'));
};

const PLAN = {
  id: 'home', name: 'Home', style: 'modern', brief: 'A flat with a corridor.',
  levels: [{ height: 2.7, rooms: [{ id: 'bed', type: 'bedroom', rect: [0, 0, 4, 3.6] }, { id: 'hall', type: 'hall', rect: [0, 3.6, 4, 5.2] }],
    openings: [{ kind: 'door', room: 'bed', wall: 'south', to: 'hall', along: 3.2, width: 0.9 }, { kind: 'door', room: 'hall', wall: 'south', to: 'outside', along: 1.4, width: 1, main: true }] }],
  furniture: [],
};

describe('lighting from walking height', () => {
  it('puts the eye-height checklist in the review turn text', () => {
    let w = createWorld({});
    w = applyPatches(w, runDesignTool(w, 'design_plan', { plan: PLAN }).patches).world;
    const text = reviewTurnText(1, snapshotForReview(w, null, { maxViews: 4, withViews: false }), { hasImages: false, lastEdited: false });
    expect(text).toContain(EYE_HEIGHT_LIGHT_CHECK);
    for (const word of ['1.6-1.7 m', 'too dark', 'blown out', 'visibly lights', 'flat ambient', 'flicker', 'tune_look', 'look again']) expect(text).toContain(word);
    expect(text).toContain('advisory');
  });

  it('gives an advisory eye-height luminance summary from pixels', () => {
    const data = new Uint8ClampedArray(16 * 16 * 4).fill(255);
    for (let i = 0; i < 16 * 16 / 2; i++) data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 40;
    const g = estimatePhotoGrade({ width: 16, height: 16, data })!;
    expect(g.mean).toBeGreaterThan(0.2);
    expect(g.clipped).toBeGreaterThan(0.3);
  });

  it('a scripted "corridor too dark, lamp flat" verdict leads to a tune_look fix and a re-look', async () => {
    const requests: CompletionRequest[] = [];
    let reviews = 0;
    let first = 0;
    const provider: Provider = {
      name: 'scripted',
      async complete(req): Promise<CompletionResponse> {
        requests.push(JSON.parse(JSON.stringify(req)) as CompletionRequest);
        let content: ContentBlock[];
        if (isReview(req)) {
          reviews++;
          content = reviews === 1
            ? [{ type: 'text', text: 'Corridor too dark, lamp flat: it lights nothing around it.' }, call('tune_look', { exposure: 1.25, ambientIntensity: 0.6, message: 'corridor too dark from eye height, lifting exposure and ambient' })]
            : [call('finish', { message: 'Corridor reads lit now.' })];
        } else {
          first++;
          content = first === 1 ? [call('design_plan', { plan: PLAN })] : [call('finish', { message: 'built' })];
        }
        return { content, stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end' };
      },
    };
    const host = new MemoryHost();
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, review: {} }).run('a flat with a corridor', host));
    const reviewReqs = requests.filter(isReview);
    expect(JSON.stringify(reviewReqs[0]!.messages.at(-1))).toContain('LIGHTING FROM WALKING HEIGHT');
    expect(host.world.environment.exposure).toBeCloseTo(1.25, 2);
    // The fix was followed by a second review round that says the building changed: the re-look.
    expect(reviewReqs.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(reviewReqs[1]!.messages.at(-1))).toContain('You changed the building');
  });
});
