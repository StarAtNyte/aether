import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, storyDuration, type Patch, type WorldDoc } from '@aether/core';
import { AGENT_TOOLS, ToolInputs } from '../src/tools';
import { authorStory, escalate, MAX_IMAGES_PER_CALL, reviewShots, type PresentHost } from '../src/presentation/director';
import { defaultPresentation, parseChoice, presentationSignals, wantsPresentation } from '../src/presentation/kind';
import { pointsOfInterest, type PresentationViews } from '../src/presentation/poi';
import { checkStory, fallbackPlan, moveEnd, planToStory, projectInFrame, repairStory, STORY_SECONDS } from '../src/presentation/story';
import { autoFixable, degenerateFrame, fixPatches, measuredIssues, parseReport, reviewFrames, spawnPose, yawToward } from '../src/presentation/review';
import type { CompletionRequest, CompletionResponse, Provider } from '../src/types';

const box = (id: string, p: [number, number, number], extra: Record<string, unknown> = {}): Patch => ({ op: 'add', entity: { id, shape: { kind: 'primitive', primitive: 'box', size: [2, 2, 2] }, transform: { position: p, rotation: [0, 0, 0], scale: [1, 1, 1] }, ...extra } } as Patch);

function world(patches: Patch[]): WorldDoc {
  return applyPatches(createWorld(), patches).world;
}

const scene = (): WorldDoc =>
  world([
    box('ground', [0, -0.5, 0], { tags: ['terrain'] }),
    box('tower', [0, 8, 0], { tags: ['landmark'], name: 'Old tower' }),
    box('rock-a', [12, 1, 6]),
    box('rock-b', [-14, 1, -4]),
    { op: 'add', entity: { id: 'walker', name: 'Mira', character: {}, transform: { position: [4, 0, 8], rotation: [0, 0, 0], scale: [1, 1, 1] } } } as Patch,
    { op: 'setEnvironment', set: { timeOfDay: 16 } },
  ]);

const VIEWS: PresentationViews = {
  opening: { position: [0, 3, 30], target: [0, 4, 0], fov: 55 },
  ranked: [
    { position: [25, 6, 20], target: [0, 4, 0] },
    { position: [-25, 5, 18], target: [0, 4, 0] },
    { position: [20, 4, -25], target: [0, 4, 0] },
  ],
  stops: [
    { position: [10, 2, 15], target: [12, 1, 6], name: 'Rocks' },
    { position: [-8, 2, 10], target: [-14, 1, -4] },
  ],
};

/** An in-memory host: probe says "near" for cameras inside the box at x in [-1,1] (the tower). */
function host(w: WorldDoc, opts: { badX?: number } = {}): PresentHost & { world: WorldDoc } {
  const h = {
    world: w,
    getWorld: () => h.world,
    applyPatches(patches: unknown[]) {
      const r = applyPatches(h.world, patches);
      h.world = r.world;
      return r;
    },
    presentationViews: async () => VIEWS,
    probeView: async (pose: { position: [number, number, number] }) => ({ near: opts.badX !== undefined && Math.abs(pose.position[0] - opts.badX) < 1.5 ? 0.2 : 3, underWater: false }),
    captureReview: async (views: ReadonlyArray<{ name: string }>) => views.map((v) => ({ name: v.name, dataUrl: 'data:image/png;base64,AAAA' })),
    decodeImage: async () => ({ width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 200)) }),
  };
  return h as unknown as PresentHost & { world: WorldDoc };
}

describe('presentation kind', () => {
  it('suggests by content, without a model', () => {
    expect(defaultPresentation(scene())).toMatchObject({ profile: 'showcase', startMode: 'story' });
    const game = world([box('coin', [0, 1, 0], { behaviors: [{ type: 'collectible' }] })]);
    expect(defaultPresentation(game)).toMatchObject({ profile: 'game', startMode: 'play' });
    const house = world([{ op: 'add', entity: { id: 'house', arch: { role: 'building' } } } as Patch]);
    expect(defaultPresentation(house)).toMatchObject({ profile: 'walkthrough', startMode: 'walkthrough' });
    const city = world([1, 2, 3, 4].map((i) => ({ op: 'add', entity: { id: `b${i}`, arch: { role: 'building' } } }) as Patch));
    expect(defaultPresentation(city)).toMatchObject({ profile: 'city', startMode: 'orbit' });
    const tale = applyPatches(scene(), [{ op: 'setMeta', description: 'A short film: a girl races up the hill to watch the sunset.' }]).world;
    expect(defaultPresentation(tale)).toMatchObject({ profile: 'story', startMode: 'story' });
    expect(presentationSignals(scene()).people).toBe(1);
  });

  it('stores the choice in the IR and undoes it', () => {
    const w = scene();
    const r = applyPatches(w, [{ op: 'setMeta', profile: 'story', startMode: 'story' }]);
    expect(r.world.profile).toBe('story');
    expect(r.world.startMode).toBe('story');
    expect(applyPatches(r.world, [{ op: 'setMeta', profile: null, startMode: null }]).world.profile).toBeUndefined();
    expect(wantsPresentation(createWorld(), w)).toBe(true);
    expect(wantsPresentation(createWorld(), r.world)).toBe(false);
    expect(parseChoice({ profile: 'city', startMode: 'orbit', reason: 'x' })).toEqual({ profile: 'city', startMode: 'orbit', reason: 'x' });
    expect(parseChoice({ profile: 'nope', startMode: 'orbit' })).toBeNull();
  });

  it('offers author_story and set_presentation as agent tools', () => {
    expect(AGENT_TOOLS.map((t) => t.name)).toEqual(expect.arrayContaining(['author_story', 'set_presentation']));
    expect(ToolInputs.author_story.safeParse({ op: 'auto' }).success).toBe(true);
  });
});

describe('story authoring', () => {
  it('lists points of interest from the views, the landmark, people and the spawn', () => {
    const pois = pointsOfInterest(scene(), VIEWS);
    const ids = pois.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['opening', 'view-1', 'stop-1', 'landmark', 'char-walker', 'spawn']));
  });

  it('writes a 45-90 s film by film grammar, with the title first and an end card', () => {
    const w = scene();
    const pois = pointsOfInterest(w, VIEWS);
    const plan = fallbackPlan(w, pois);
    const { story, subjects } = planToStory(w, plan, pois);
    const t = storyDuration(story);
    expect(t).toBeGreaterThanOrEqual(STORY_SECONDS[0]);
    expect(t).toBeLessThanOrEqual(STORY_SECONDS[1]);
    expect(story.shots[0]?.title).toBe(w.name);
    expect(story.shots[0]?.transition).toBe('fade');
    expect(story.endCard?.lines).toContain('Press P to play');
    // The subject (the person) is tracked and kept in frame.
    const subj = story.shots.findIndex((s) => s.track === 'walker');
    expect(subj).toBeGreaterThan(0);
    expect(subjects[subj]).not.toBeNull();
    // A held beat and moving shots.
    expect(story.shots.some((s) => !s.cameraTo)).toBe(true);
    expect(story.shots.filter((s) => s.cameraTo).length).toBeGreaterThan(3);
    // The sun moves on a little.
    const hours = story.shots.map((s) => s.hour ?? 0);
    expect((hours.at(-1) ?? 0) - (hours[0] ?? 0)).toBeGreaterThan(0.5);
    expect((hours.at(-1) ?? 0) - (hours[0] ?? 0)).toBeLessThan(2);
  });

  it('moves and projections', () => {
    const pose = { position: [0, 2, 10] as [number, number, number], target: [0, 2, 0] as [number, number, number], fov: 50 };
    expect(moveEnd(pose, 'hold')).toBeNull();
    expect(moveEnd(pose, 'push-in')?.position[2]).toBeLessThan(10);
    expect(projectInFrame(pose, [0, 2, 0])).toMatchObject({ x: 0, y: 0 });
    expect(projectInFrame(pose, [0, 2, 20])).toBeNull();
  });

  it('finds and repairs a camera in geometry and a subject out of frame', async () => {
    const w = scene();
    const pois = pointsOfInterest(w, VIEWS);
    const story = planToStory(w, { look: 'natural', letterbox: 1, shots: [
      { camera: { position: [0, 8, 6], target: [0, 8, 20] }, move: 'hold', amount: 1, duration: 20 },
      { poi: 'opening', move: 'push-in', amount: 1, duration: 30 },
    ] }, pois);
    story.subjects[0] = [0, 8, 0];
    const probe = async (p: { position: [number, number, number] }) => ({ near: Math.abs(p.position[0]) < 1 && Math.abs(p.position[2] - 6) < 1.5 ? 0.2 : 3, underWater: false });
    const before = await checkStory(story.story, probe, story.subjects);
    expect(before.map((i) => i.kind)).toEqual(expect.arrayContaining(['inside', 'subject']));
    const fixed = await repairStory(story, probe, pois);
    expect(fixed.fixed.join(' ')).toMatch(/aimed at its subject|clear of geometry/);
    expect(fixed.remaining.filter((i) => i.kind === 'inside' || i.kind === 'subject')).toEqual([]);
  });

  it('authorStory: the model writes the shot list, the tool repairs and stores it, and start mode becomes story', async () => {
    const h = host(scene());
    const calls: CompletionRequest[] = [];
    const provider: Provider = {
      async complete(req) {
        calls.push(req);
        return { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'author_story', input: { op: 'write', title: 'Tower', shots: [
          { poi: 'view-1', move: 'push-in', duration: 12, title: 'Tower' },
          { poi: 'stop-1', move: 'truck-left', duration: 10, caption: 'The rocks' },
          { poi: 'char-walker', move: 'orbit-left', duration: 12 },
          { poi: 'landmark', move: 'hold', duration: 10 },
          { poi: 'opening', move: 'pull-out', duration: 12 },
        ] } }] } as CompletionResponse;
      },
    } as Provider;
    const film = await authorStory(h, provider);
    expect(film.source).toBe('ai');
    expect(calls[0]?.messages[0]?.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'image' })]));
    expect(h.world.story?.shots.length).toBe(5);
    expect(h.world.startMode).toBe('story');
  });

  it('authorStory falls back to film grammar without a model', async () => {
    const h = host(scene());
    const film = await authorStory(h, null);
    expect(film.source).toBe('fallback');
    expect(h.world.story).toBeDefined();
  });
});

describe('shot review', () => {
  it('frames the opening, the film and the spawn', () => {
    const w = applyPatches(scene(), [{ op: 'setMeta', opening: VIEWS.opening as NonNullable<WorldDoc['opening']> }]).world;
    const frames = reviewFrames(w, VIEWS);
    expect(frames.map((f) => f.kind)).toEqual(['opening', 'tour', 'tour', 'detail', 'spawn']);
    // A stop at the opening view is not reviewed twice.
    expect(reviewFrames(w, { ...VIEWS, stops: [{ ...(VIEWS.opening as NonNullable<PresentationViews['opening']>) }, ...VIEWS.stops] }).filter((f) => f.kind === 'tour')).toHaveLength(2);
    const sp = spawnPose(w);
    expect(sp.position[1]).toBeGreaterThan(w.player.spawn[1]);
    expect(yawToward([0, 0, 0], [0, 0, -10])).toBe(0);
  });

  it('measured issues and fixes', () => {
    const f = { name: 'opening', label: '', kind: 'opening' as const, pose: VIEWS.opening as NonNullable<PresentationViews['opening']>, aspect: 16 / 9 };
    expect(measuredIssues(f, { dark: 0.8, bright: 0, mean: 5, centre: 1, spread: 1, top: 5 }, { near: 0.1, underWater: false }).map((x) => x.fix)).toContain('repick-opening');
    const rep = parseReport({ frames: [{ name: 'opening', ok: false, issues: [{ check: 'occluder', note: 'branch', fix: 'pull-back' }] }, { name: 'ghost', ok: true, issues: [] }], summary: 's' }, [f]);
    expect(rep.issues).toHaveLength(1);
    const plan = fixPatches(scene(), f, rep.issues[0]!, VIEWS);
    expect('patches' in plan && plan.patches[0]).toMatchObject({ op: 'setMeta' });
    const sp = fixPatches(scene(), { ...f, name: 'spawn', kind: 'spawn' }, { frame: 'spawn', check: 'spawn', note: 'faces a wall', fix: 'face-landmark', by: 'model' }, VIEWS);
    expect('patches' in sp && sp.patches[0]).toMatchObject({ op: 'setPlayer' });
  });

  it('reviewShots: re-picks a bad opening view the probe catches, and reports what is left', async () => {
    const w = applyPatches(scene(), [{ op: 'setMeta', opening: { position: [0, 3, 30], target: [0, 4, 0] } }]).world;
    const h = host(w, { badX: 0 });
    const r = await reviewShots(h, null);
    expect(r.fixed.join(' ')).toMatch(/re-picked the opening view/);
    expect(h.world.opening?.position[0]).not.toBe(0);
    expect(r.frames.find((f) => f.name === 'opening')?.fixed.length).toBe(1);
  });

  it('reviewShots: applies the judge\'s fix to a film shot', async () => {
    const h = host(scene());
    await authorStory(h, null);
    const first = h.world.story?.shots[0]?.camera.position[1] ?? 0;
    let n = 0;
    const seen: number[] = [];
    const provider: Provider = {
      async complete(req) {
        n++;
        seen.push(req.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === 'image').length);
        if (req.tools?.[0]?.name !== 'report_shots') return { stopReason: 'end', content: [] } as CompletionResponse;
        return { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 'r', name: 'report_shots', input: { summary: 'ok', frames: [{ name: 'story-1', ok: false, issues: n === 1 ? [{ check: 'framing', severity: 'high', confidence: 0.9, note: 'too low', fix: 'raise' }] : [] }] } }] } as CompletionResponse;
      },
    } as Provider;
    const r = await reviewShots(h, provider);
    expect(r.fixed).toContain('film shot 1: raise');
    expect(seen.every((k) => k <= MAX_IMAGES_PER_CALL)).toBe(true);
    expect(seen.length).toBeGreaterThan(1);
    expect(h.world.story?.shots[0]?.camera.position[1]).toBeGreaterThan(first);
    expect(r.judgedBy).toBe('model');
  });

  it('escalates a fix that did not cure the frame, then gives up', () => {
    const x = { frame: 'tour-2', check: 'occluder' as const, note: 'wall', fix: 'pull-back' as const, by: 'probe' as const };
    expect(escalate(x, [], 'tour')?.fix).toBe('pull-back');
    expect(escalate(x, ['pull-back'], 'tour')?.fix).toBe('raise');
    expect(escalate(x, ['pull-back', 'raise'], 'tour')?.fix).toBe('drop-shot');
    expect(escalate(x, ['pull-back', 'raise', 'drop-shot'], 'tour')).toBeNull();
  });

  it('undoes a fix that does not make its frame better', async () => {
    const h = host(scene());
    await authorStory(h, null);
    const first = h.world.story?.shots[0]?.camera.position[1] ?? 0;
    const provider: Provider = {
      async complete(req) {
        if (req.tools?.[0]?.name !== 'report_shots') return { stopReason: 'end', content: [] } as CompletionResponse;
        return { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 'r', name: 'report_shots', input: { summary: 'still low', frames: [{ name: 'story-1', ok: false, issues: [{ check: 'framing', severity: 'high', confidence: 0.9, note: 'too low', fix: 'raise' }] }] } }] } as CompletionResponse;
      },
    } as Provider;
    const r = await reviewShots(h, provider, { reviewRounds: 3 });
    expect(r.undone.length).toBeGreaterThan(0);
    expect(h.world.story?.shots[0]?.camera.position[1]).toBeCloseTo(first);
  });

  it('never judges or fixes a degenerate frame: black, flat, or a daytime sky come out black', async () => {
    const st = (mean: number, spread: number, top: number, dark = 0) => ({ dark, bright: 0, mean, centre: 5, spread, top });
    expect(degenerateFrame(st(2, 1, 0, 0.99))).toBe('near-black');
    expect(degenerateFrame(st(120, 1, 120))).toBe('one flat tone');
    expect(degenerateFrame(st(90, 30, 4), { skyExpected: true })).toMatch(/sky/);
    expect(degenerateFrame(st(90, 30, 4), { skyExpected: false })).toBeNull();
    // A host whose renders are all black: nothing is judged, nothing in the world changes (no hour moved to noon).
    const h = host(scene());
    (h as unknown as { decodeImage: unknown }).decodeImage = async () => ({ width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).map((_, i) => (i % 4 === 3 ? 255 : 0)) });
    const before = h.world;
    let judged = 0;
    const provider: Provider = {
      async complete() {
        judged++;
        return { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 'r', name: 'report_shots', input: { summary: 'dark', frames: [{ name: 'opening', ok: false, issues: [{ check: 'exposure', severity: 'high', confidence: 1, note: 'black', fix: 'time-of-day', hour: 12 }] }] } }] } as CompletionResponse;
      },
    } as unknown as Provider;
    const r = await reviewShots(h, provider);
    expect(judged).toBe(0);
    expect(h.world.environment).toBe(before.environment);
    expect(r.summary).toMatch(/nothing was judged/);
  });

  it('a calibrated judge: only sure, high-severity findings are fixed; the rest are ranked suggestions', async () => {
    const h = host(scene());
    await authorStory(h, null);
    const provider: Provider = {
      async complete(req) {
        if (req.tools?.[0]?.name !== 'report_shots') return { stopReason: 'end', content: [] } as CompletionResponse;
        return { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 'r', name: 'report_shots', input: { summary: 'mostly fine', frames: [
          { name: 'story-1', ok: false, issues: [{ check: 'framing', severity: 'medium', confidence: 0.9, note: 'a little low', fix: 'raise' }] },
          { name: 'spawn', ok: false, issues: [{ check: 'lighting', severity: 'low', confidence: 0.8, note: 'flat light', fix: 'time-of-day', hour: 12 }] },
          { name: 'opening', ok: false, issues: [{ check: 'occluder', severity: 'high', confidence: 0.4, note: 'maybe a branch', fix: 'repick-opening' }] },
        ] } }] } as CompletionResponse;
      },
    } as Provider;
    const story = h.world.story;
    const env = h.world.environment;
    const r = await reviewShots(h, provider, { reviewRounds: 2 });
    expect(r.fixed).toEqual([]);
    expect(h.world.story).toBe(story);
    expect(h.world.environment).toBe(env);
    expect(r.remaining.filter((x) => x.by === 'model').map((x) => x.severity)).toEqual(['high', 'medium', 'low']);
    expect(autoFixable({ fix: 'raise', by: 'model', severity: 'high', confidence: 0.8 })).toBe(true);
    expect(autoFixable({ fix: 'raise', by: 'probe' })).toBe(true);
  });

  it('replays the recorded Sanctuary Falls judgement (made on black-sky renders): nothing in it is fixed on its own now', async () => {
    // Verbatim from the live run of 7 November (the judge then gave no severities): it moved the hour to noon.
    const recorded = { summary: 'Tour-2, tour-3 and spawn all show a black void sky and are too dark.', frames: [
      { name: 'story-1', ok: false, issues: [{ check: 'exposure', note: 'The frame is dark overall; the right third is a black void and the sky is black.', fix: 'time-of-day', hour: 12 }] },
      { name: 'spawn', ok: false, issues: [{ check: 'sky', note: 'The sky is a flat black void with floating banners.', fix: 'time-of-day', hour: 12 }, { check: 'missing-geometry', note: 'The black void sits behind and between the arcades.', fix: 'none' }] },
    ] };
    const h = host(scene());
    await authorStory(h, null);
    const env = h.world.environment;
    const story = h.world.story;
    const provider = { name: 'replay', async complete(req: CompletionRequest) {
      if (req.tools?.[0]?.name !== 'report_shots') return { stopReason: 'end', content: [] } as unknown as CompletionResponse;
      return { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 'r', name: 'report_shots', input: recorded }] } as unknown as CompletionResponse;
    } } as unknown as Provider;
    const r = await reviewShots(h, provider, { reviewRounds: 2 });
    expect(h.world.environment).toBe(env);
    expect(h.world.story).toBe(story);
    expect(r.fixed.filter((f) => /time of day|at 12 h/.test(f))).toEqual([]);
    expect(r.remaining.some((x) => x.check === 'sky')).toBe(true);
  });
});
