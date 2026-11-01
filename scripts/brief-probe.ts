/**
 * Live probe of the generation brief: builds one prompt with the connected Claude Code or Codex login, with or without the
 * brief step, then renders an overview and eye-height stills with the software renderer and writes the counts.
 *
 *   npx tsx scripts/brief-probe.ts --id=cinema --prompt="make a cinema hall" --brief=on --out=probe-out/brief
 *   options: --backend=claude-code|codex --effort=low|medium|high --rounds=N --turns=N --tool-calls=N --gpu=1 --from=<template slug or world .json path> --keep=<dir> (default ~/.local/share/aether/gen-worlds; the run is copied to <dir>/<id>/)
 *
 * Single runs are noisy: read the counts as one sample, not a measurement.
 */
import { readFileSync } from 'node:fs';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { join, resolve } from 'node:path';
import { createWorld, type Entity, type PatchResult, type WorldDoc } from '@aether/core';
import { REVIEW_ASPECT, WorldAgent, richnessEvidence, type AgentEvent, type Provider, type ReviewViewRequest } from '@aether/agent';
import { initScripting } from '@aether/logic';
import { initPhysics } from '@aether/physics';
import { loadLibraryGenerator } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';
import { createHeadlessProvider } from './lib/live-provider';
import { captureReviewHeadless } from '../apps/cli/src/mcp/review';
import { CATALOGS, GENERATOR_DRY_RUN_MS, NodeAgentHost, nodeLevelTools } from './lib/headless-world';
import { GpuRoom } from './lib/gpu-room';

const arg = (n: string, d?: string): string | undefined => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const id = arg('id', 'probe') as string;
const prompt = arg('prompt') ?? '';
const withBrief = arg('brief', 'on') === 'on';
const backend = (arg('backend', 'claude-code') as 'claude-code' | 'codex');
const effort = (arg('effort', 'low') as 'low' | 'medium' | 'high');
const rounds = Number(arg('rounds', '4'));
// --gpu=1: the review views come from the studio's own renderer on the integrated GPU (what the model sees in the app) instead of the flat software one.
const useGpu = arg('gpu', '0') === '1';
// --from=<slug>: refine the bundled template world of that name (a chat edit over an existing world) instead of building a new one.
const from = arg('from');
const out = resolve(arg('out', 'probe-out/brief') as string, `${id}-${withBrief ? 'after' : 'before'}`);

function kindOf(e: Entity): string {
  return e.shape.kind === 'procedural' ? e.shape.generator : e.shape.kind === 'asset' ? e.shape.id : `${e.shape.kind}:${e.name.toLowerCase().replace(/[\d\W]+/g, ' ').trim()}`;
}

function views(world: WorldDoc): ReviewViewRequest[] {
  const xs: number[] = [];
  const zs: number[] = [];
  for (const e of Object.values(world.entities)) {
    const [x, , z] = e.transform.position;
    if (Math.abs(x) < 400 && Math.abs(z) < 400) {
      xs.push(x);
      zs.push(z);
    }
  }
  if (xs.length === 0) return [];
  xs.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);
  const q = (a: number[], p: number): number => a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * p)))] as number;
  const [x0, x1, z0, z1] = [q(xs, 0.02), q(xs, 0.98), q(zs, 0.02), q(zs, 0.98)];
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const w = Math.max(4, x1 - x0);
  const d = Math.max(4, z1 - z0);
  const mk = (name: string, label: string, position: [number, number, number], target: [number, number, number], fov: number, hideTops: boolean): ReviewViewRequest => ({ name, label, kind: 'corner', pose: { position, target, up: [0, 1, 0], fov }, hideTops, aspect: REVIEW_ASPECT, marks: [] });
  const r = Math.max(w, d);
  return [
    mk('overview', 'overview from above and outside', [cx + r * 0.7, r * 0.9, z1 + r * 0.7], [cx, 0.5, cz], 55, true),
    mk('eye-front', 'eye height from the near end', [cx, 1.6, z0 + 0.8], [cx, 1.5, z1], 70, false),
    mk('eye-back', 'eye height from the far end', [cx, 1.6, z1 - 0.8], [cx, 1.5, z0], 70, false),
    mk('eye-side', 'eye height from the left side', [x0 + 0.8, 1.6, cz], [x1, 1.5, cz], 70, false),
  ];
}

async function main(): Promise<void> {
  if (!prompt) throw new Error('--prompt is required');
  await mkdir(out, { recursive: true });
  await initPhysics();
  await initScripting().catch(() => undefined);
  const sandbox = createNodeSandbox({ timeoutMs: GENERATOR_DRY_RUN_MS });
  const base = createHeadlessProvider(backend, { effort });
  let calls = 0;
  const provider: Provider = {
    name: base.name,
    complete(req, signal) {
      calls++;
      return base.complete(req, signal);
    },
  };
  class Host extends NodeAgentHost {
    captureReview = async (v: readonly ReviewViewRequest[], o?: { signal?: AbortSignal }): Promise<Array<{ name: string; dataUrl: string }>> => {
      if (!gpuRoom) return captureReviewHeadless(this.getWorld(), v, { sandbox, width: 640, ...(o?.signal ? { signal: o.signal } : {}) });
      await gpuRoom.load(this.getWorld());
      const shots = await gpuRoom.capture(v.map((x) => ({ ...x.pose, hideTops: x.hideTops })), { width: 768, height: 512 });
      return v.flatMap((x, i) => (shots[i] ? [{ name: x.name, dataUrl: shots[i] as string }] : []));
    };
    override applyPatches(patches: unknown[], message: string): PatchResult {
      return super.applyPatches(patches, message);
    }
  }
  const gpuRoom: GpuRoom | null = useGpu ? await GpuRoom.open({}) : null;
  // A slug of a bundled template, or the path of a world file (a saved world or the bare world a probe run wrote).
  const fromRaw = from ? (JSON.parse(readFileSync(from.endsWith('.json') ? resolve(from) : resolve(`apps/studio/public/templates/worlds/${from}.json`), 'utf8')) as { world?: WorldDoc } & Record<string, unknown>) : undefined;
  const initial = fromRaw ? (createWorld((fromRaw.world ?? fromRaw) as WorldDoc) as WorldDoc) : undefined;
  const host = new Host(sandbox, initial);
  const events: AgentEvent[] = [];
  const t0 = performance.now();
  const agent = new WorldAgent({ provider, catalogs: CATALOGS, resolveGenerator: loadLibraryGenerator, maxRepairs: 2, maxTurns: Number(arg('turns', '40')), maxToolCalls: Number(arg('tool-calls', '300')), levelTools: nodeLevelTools(sandbox), textures: { images: null }, review: { vision: true, maxViews: 6, stallRounds: 3, maxRounds: rounds }, ...(withBrief ? { brief: {} } : {}) });
  for await (const ev of agent.run(prompt, host, { intent: from ? 'refine' : 'new' })) {
    events.push(ev);
    if (ev.type === 'status' || ev.type === 'brief' || ev.type === 'review') console.log(`[${Math.round((performance.now() - t0) / 1000)}s] ${ev.type}${'phase' in ev ? `:${ev.phase}` : ''} ${'text' in ev ? ev.text.slice(0, 120) : ''}`);
  }
  const ms = Math.round(performance.now() - t0);
  const world = host.getWorld();
  const kinds = new Set(Object.values(world.entities).map(kindOf));
  const imgs = await captureReviewHeadless(world, views(world), { sandbox, width: 960 });
  for (const im of imgs) await writeFile(join(out, `${im.name}.png`), Buffer.from(im.dataUrl.split(',')[1] as string, 'base64'));
  const briefEv = events.find((e) => e.type === 'brief');
  const reviews = events.filter((e) => e.type === 'review');
  const summary = {
    id,
    prompt,
    brief: withBrief,
    backend,
    seconds: Math.round(ms / 1000),
    modelCalls: calls,
    entities: Object.keys(world.entities).length,
    distinctKinds: kinds.size,
    instances: Object.values(world.entities).reduce((n, e) => n + (e.shape.kind === 'scatter' ? (e.shape.points ? e.shape.points.length : e.shape.count) : 1), 0),
    scatterEntities: Object.values(world.entities).filter((e) => e.shape.kind === 'scatter').length,
    craftedParts: [...new Set(Object.values(world.entities).map((e) => (e.shape.kind === 'procedural' ? e.shape.generator : e.shape.kind === 'scatter' && e.shape.of.kind === 'procedural' ? e.shape.of.generator : '')).filter((g) => g.startsWith('furn-')))],
    primitives: Object.values(world.entities).filter((e) => e.shape.kind === 'primitive').length,
    steps: events.filter((e) => e.type === 'step').length,
    reviewRounds: Math.max(0, ...reviews.map((r) => (r.type === 'review' ? r.round : 0))),
    reviewEnd: reviews.at(-1)?.type === 'review' ? (reviews.at(-1) as { phase: string }).phase : 'none',
    briefElaboration: briefEv?.type === 'brief' ? briefEv.view.brief.elaboration : null,
    briefTarget: briefEv?.type === 'brief' ? briefEv.view.brief.richness : null,
    briefElements: briefEv?.type === 'brief' ? briefEv.view.brief.elements.map((e) => `${e.name} x${e.count}`) : null,
    evidence: briefEv?.type === 'brief' ? richnessEvidence(world, briefEv.view.brief).split('\n') : null,
    lights: Object.values(world.entities).filter((e) => e.light).length,
    referenceDecision: briefEv?.type === 'brief' ? briefEv.view.reference : null,
    errors: events.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text.slice(0, 200)),
    final: events.filter((e) => e.type === 'message').at(-1),
  };
  await writeFile(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(join(out, 'world.json'), JSON.stringify(world));
  // Stable copy of the final world (and stills and counts) per id, so a later step can pick the best of several runs.
  const stable = join(arg('keep', join(homedir(), '.local/share/aether/gen-worlds')) as string, id);
  await mkdir(stable, { recursive: true });
  await cp(out, stable, { recursive: true });
  console.log(JSON.stringify(summary, null, 2));
  await gpuRoom?.close();
  sandbox.dispose();
}

main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});
