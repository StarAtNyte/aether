/**
 * How steady is the judge? Judge ONE fixed room against its photo several times, the old way and the new way, and
 * report the spread. The room, the render and the checklist stay the same; only the judge varies, so the spread is
 * the judge's own noise (an end-to-end run also varies in how the photo is read).
 *
 *   npx tsx scripts/photo-judge-noise.ts --run=DIR [--repeats=3] [--judges=3] [--backend=claude-code|codex] [--effort=medium]
 *
 * DIR is a run folder written by scripts/eval-photo.ts (photo.jpg, world.json, views.json, transcript.json).
 * - single: the conversation judge as it was (compare intro, photo + marked render, report_verdicts), a fresh call
 *   each time; its pass rate.
 * - panel: `runPanel` with `--judges` seats on the clean render; the median pass rate and the median rubric score.
 * - pair: the panel shown the same render as A and B; it should find no difference (votes for "same", a tie).
 * Writes judge-noise.json into DIR.
 */
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateWorld, type WorldDoc } from '@aether/core';
import { PHOTO_BUILDING_ID, buildChecklist, parseRoomDescription, scoreVerdicts, ItemVerdict, type RoomDescription } from '@aether/arch/photo';
import { legendText, markIndex, partKinds } from '@aether/arch';
import { TranscriptSchema, type ContentBlock, type Provider, type ReviewViewRequest } from '@aether/agent';
import { createNodeSandbox } from '@aether/procgen/node';
import { createHeadlessProvider } from '../apps/bridge/src/headless';
import { captureReviewHeadless } from '../apps/cli/src/mcp/review';
import { VERDICT_TOOL, VERDICT_TOOL_NAME, compareIntroText } from '../packages/agent/src/photo/prompt';
import { runPanel } from '../packages/agent/src/photo/judge';
import { GENERATOR_DRY_RUN_MS } from './lib/headless-world';

const PHOTO_LIGHT = { ambientIntensity: 1.4, exposure: 2.0 } as const;

function arg(k: string): string | undefined {
  return process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
}

const stats = (xs: readonly number[]): { values: number[]; mean: number; sd: number; range: number } => {
  const mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length));
  return { values: xs.map((x) => Math.round(x * 1000) / 1000), mean: Math.round(mean * 1000) / 1000, sd: Math.round(sd * 1000) / 1000, range: Math.round((Math.max(...xs) - Math.min(...xs)) * 1000) / 1000 };
};

function descriptionOf(dir: string): RoomDescription {
  const t = TranscriptSchema.parse(JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf8')));
  for (const r of t.responses) {
    const call = r.content.find((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use' && b.name === 'describe_room');
    if (!call) continue;
    const input = call.input as { description?: unknown };
    const p = parseRoomDescription(input.description, partKinds());
    if (p.ok) return p.value;
  }
  throw new Error('no valid describe_room call in the transcript');
}

async function main(): Promise<void> {
  const dir = arg('run');
  if (!dir) throw new Error('--run=DIR is required');
  const repeats = Math.max(1, Math.min(10, Number(arg('repeats') ?? 3)));
  const judges = Math.max(1, Math.min(7, Number(arg('judges') ?? 3)));
  const backend = arg('backend') === 'codex' ? 'codex' : 'claude-code';
  const effort = (['low', 'medium', 'high'] as const).find((e) => e === arg('effort')) ?? 'medium';
  const desc = descriptionOf(dir);
  const checklist = buildChecklist(desc);
  const parsed = validateWorld(JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8')));
  if (!parsed.ok) throw new Error('world.json is not a valid world');
  const world: WorldDoc = parsed.world;
  const views = JSON.parse(readFileSync(join(dir, 'views.json'), 'utf8')) as { last: ReviewViewRequest | null };
  const view = views.last;
  if (!view) throw new Error('views.json has no photo-camera view');
  const photo = `data:image/jpeg;base64,${readFileSync(join(dir, 'photo.jpg')).toString('base64')}`;
  const sandbox = createNodeSandbox({ timeoutMs: GENERATOR_DRY_RUN_MS });
  const shots = await captureReviewHeadless(world, [view, { ...view, name: 'photo-camera-clean', marks: [] }], { sandbox, width: 800, environment: PHOTO_LIGHT });
  sandbox.dispose();
  const marked = shots.find((s) => s.name === view.name)?.dataUrl;
  const clean = shots.find((s) => s.name === 'photo-camera-clean')?.dataUrl;
  if (!marked || !clean) throw new Error('render failed');
  const shown = new Set(view.marks.map((m) => m.n));
  const legend = legendText(markIndex(world, PHOTO_BUILDING_ID), shown);
  const provider: Provider = createHeadlessProvider(backend, { effort, timeoutMs: 600_000 });
  let calls = 0;
  const complete: Provider['complete'] = async (req) => {
    calls++;
    return provider.complete(req);
  };

  // The old judge: the conversation's first compare turn, fresh each time.
  const single: number[] = [];
  for (let k = 0; k < repeats; k++) {
    const res = await complete({
      role: 'planner',
      system: 'You rebuild rooms from photographs with the design tools and judge renders of them against the photo.',
      messages: [{ role: 'user', content: [{ type: 'text', text: compareIntroText({ summary: desc.summary || desc.roomType, checklist, notes: [], hasObjective: true }) }, { type: 'text', text: 'Image 1: the PHOTO' }, { type: 'image', dataUrl: photo }, { type: 'text', text: 'Image 2: RENDER, from the photo camera' }, { type: 'image', dataUrl: marked }, { type: 'text', text: `Legend of the numbers:\n${legend}\nJudge only: call report_verdicts for every id (no fixes in this reply).` }] }],
      tools: [VERDICT_TOOL],
      maxTokens: 8000,
    });
    const call = res.content.find((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use' && b.name === VERDICT_TOOL_NAME);
    const raw = call && typeof call.input === 'object' && call.input !== null ? (call.input as { verdicts?: unknown }).verdicts : undefined;
    const verdicts = Array.isArray(raw) ? raw.flatMap((v) => { const p = ItemVerdict.safeParse(v); return p.success ? [p.data] : []; }) : [];
    if (verdicts.length === 0) {
      console.log(`  single ${k + 1}: no verdicts`);
      continue;
    }
    const sb = scoreVerdicts(checklist, verdicts);
    single.push(sb.rate);
    console.log(`  single ${k + 1}: ${sb.passed}/${sb.total} (${Math.round(sb.rate * 100)}%)`);
  }

  // The new judge: the panel on the clean render.
  const panelRate: number[] = [];
  const panelJudge: number[] = [];
  for (let k = 0; k < repeats; k++) {
    const r = await runPanel(complete, { photo, current: clean, previous: null, checklist, judges, maxTokens: 8000 });
    if (!r.consensus) {
      console.log(`  panel ${k + 1}: no answer (${r.failures.join('; ').slice(0, 200)})`);
      continue;
    }
    panelRate.push(r.consensus.score.rate);
    panelJudge.push(r.consensus.judge);
    console.log(`  panel ${k + 1}: ${r.consensus.score.passed}/${r.consensus.score.total} (${Math.round(r.consensus.score.rate * 100)}%), rubric ${Math.round(r.consensus.judge * 100)}%, spread ${Math.round(r.consensus.spread * 100)}%`);
  }

  // The relative judgement on two identical renders: it should see no difference.
  const pair = await runPanel(complete, { photo, current: clean, previous: clean, checklist, judges, maxTokens: 8000 });
  console.log(`  pair (same render twice): preference ${pair.consensus?.preference ?? 'none'}, votes ${JSON.stringify(pair.consensus?.votes ?? {})}`);

  const out = { run: dir, backend, effort, judges, repeats, checklist: checklist.length, calls, single: stats(single), panelRate: stats(panelRate), panelJudge: stats(panelJudge), pair: pair.consensus ? { preference: pair.consensus.preference, votes: pair.consensus.votes } : null };
  await writeFile(join(dir, 'judge-noise.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(out));
}

await main();
