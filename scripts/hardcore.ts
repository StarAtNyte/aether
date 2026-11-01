/**
 * Hardcore mode in Node: refine a world to match reference pictures, pass by pass (see packages/agent/src/hardcore.ts).
 *
 *   GEN_GPU=intel npx tsx scripts/hardcore.ts --from=lisbon-hills --subject="..." --out=<dir>
 *       [--refs=<dir with ref-1.png ...>] [--passes=massing,architecture,...] [--rounds=6] [--turns=150] [--effort=high]
 *
 * 1. Hero shots are derived from the world. 2. One reference per shot is drawn by Codex's image tool (your ChatGPT login), unless
 * `--refs` names a folder that has them. 3. Luminance targets are measured from the references and the model writes what they
 * share. 4. Each pass is a refine run whose review renders the hero shots and shows each beside its reference. The world, the
 * hero renders and a contact sheet are written after every pass, so a long run can be followed and resumed (`--from=<pass world>`).
 * Model calls go to the Anthropic API key (scripts/lib/live-provider.ts); images to Codex.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createWorld, type PatchResult, type WorldDoc } from '@aether/core';
import { HARDCORE_PASSES, WorldAgent, bibleText, heroShots, lumaPercentiles, meanTargets, passPrompt, heroReferencePrompt as referencePrompt, type AgentEvent, type LumaTargets, type Provider, type ReviewViewRequest } from '@aether/agent';
import { initScripting } from '@aether/logic';
import { initPhysics } from '@aether/physics';
import { loadLibraryGenerator } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';
import { createCodexImageBackend } from '../apps/bridge/src/backends/codex-image';
import { createHeadlessProvider } from './lib/live-provider';
import { CATALOGS, GENERATOR_DRY_RUN_MS, NodeAgentHost, nodeLevelTools } from './lib/headless-world';
import { GpuRoom } from './lib/gpu-room';

const ARGS = process.argv.slice(2);
const arg = (n: string, d?: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const from = arg('from') ?? 'lisbon-hills';
const subject = arg('subject') ?? '';
const out = resolve(arg('out') ?? 'probe-out/hardcore');
const refsDir = arg('refs');
const passIds = (arg('passes') ?? HARDCORE_PASSES.map((p) => p.id).join(',')).split(',').filter(Boolean);
const rounds = Number(arg('rounds', '6'));
const effort = (arg('effort', 'high') as 'low' | 'medium' | 'high');

const log = (m: string): void => void process.stdout.write(`${m}\n`);

/** RGBA pixels of an image (file or bytes) at most `side` px, through ImageMagick. */
function rgba(input: Buffer, side: number): { width: number; height: number; data: Uint8Array } {
  const dims = execFileSync('identify', ['-format', '%w %h', '-'], { input }).toString().trim().split(' ').map(Number);
  const s = Math.min(1, side / Math.max(dims[0] ?? 1, dims[1] ?? 1));
  const w = Math.max(1, Math.round((dims[0] ?? 1) * s));
  const h = Math.max(1, Math.round((dims[1] ?? 1) * s));
  const data = new Uint8Array(execFileSync('convert', ['-', '-resize', `${w}x${h}!`, '-depth', '8', 'rgba:-'], { input, maxBuffer: 64 << 20 }));
  return { width: w, height: h, data };
}
const fromDataUrl = (d: string): Buffer => Buffer.from(d.split(',')[1] ?? '', 'base64');
const jpegDataUrl = (b: Buffer, side: number): string => `data:image/jpeg;base64,${execFileSync('convert', ['-', '-resize', `${side}x${side}>`, '-quality', '86', 'jpeg:-'], { input: b, maxBuffer: 64 << 20 }).toString('base64')}`;

async function main(): Promise<void> {
  if (!subject) throw new Error('--subject is required (what the place is, in words)');
  await mkdir(out, { recursive: true });
  await initPhysics();
  await initScripting().catch(() => undefined);
  const sandbox = createNodeSandbox({ timeoutMs: GENERATOR_DRY_RUN_MS });
  const provider: Provider = createHeadlessProvider('claude-code', { effort });
  const gpu = await GpuRoom.open({});
  class Host extends NodeAgentHost {
    captureReview = async (v: readonly ReviewViewRequest[]): Promise<Array<{ name: string; dataUrl: string }>> => {
      await gpu.load(this.getWorld());
      const shots = await gpu.capture(v.map((x) => ({ ...x.pose, hideTops: x.hideTops })), { width: 960, height: 540 });
      return v.flatMap((x, i) => (shots[i] ? [{ name: x.name, dataUrl: shots[i] as string }] : []));
    };
    decodeImage = async (dataUrl: string, maxSide: number) => rgba(fromDataUrl(dataUrl), maxSide);
    composeImages = async (tiles: ReadonlyArray<{ dataUrl: string }>, opts: { maxSide?: number } = {}): Promise<string | null> => {
      const files = await Promise.all(tiles.map(async (t, i) => {
        const f = join(out, `.tile-${i}.jpg`);
        await writeFile(f, execFileSync('convert', ['-', '-resize', 'x540', 'jpeg:-'], { input: fromDataUrl(t.dataUrl), maxBuffer: 64 << 20 }));
        return f;
      }));
      const pair = execFileSync('convert', [...files, '+append', '-resize', `${opts.maxSide ?? 1600}x${opts.maxSide ?? 1600}>`, '-quality', '86', 'jpeg:-'], { maxBuffer: 64 << 20 });
      return `data:image/jpeg;base64,${pair.toString('base64')}`;
    };
    override applyPatches(patches: unknown[], message: string): PatchResult {
      return super.applyPatches(patches, message);
    }
  }
  const raw = JSON.parse(readFileSync(from.endsWith('.json') ? resolve(from) : resolve(`apps/studio/public/templates/worlds/${from}.json`), 'utf8')) as { world?: WorldDoc };
  const host = new Host(sandbox, createWorld((raw.world ?? raw) as WorldDoc) as WorldDoc);
  const shots = heroShots(host.getWorld());
  if (shots.length === 0) throw new Error('no hero shots: the world has no built content');
  log(`hero shots: ${shots.map((s) => s.name).join(', ')}`);

  // References: one per hero shot.
  const refs: string[] = [];
  const codex = createCodexImageBackend({ timeoutMs: 400_000 });
  for (const [i, shot] of shots.entries()) {
    const file = join(refsDir ?? out, `ref-${i + 1}.png`);
    let bytes: Buffer;
    if (existsSync(file)) bytes = readFileSync(file);
    else {
      log(`drawing reference ${i + 1} (${shot.name}) with Codex…`);
      const got = await codex.generate({ prompt: referencePrompt(subject, shot), size: 1024 });
      bytes = Buffer.from(got.bytes);
      await writeFile(join(out, `ref-${i + 1}.png`), bytes);
    }
    refs.push(jpegDataUrl(bytes, 1024));
  }
  const targets = meanTargets(refs.map((r) => lumaPercentiles(rgba(fromDataUrl(r), 256).data)).filter((t): t is LumaTargets => t !== null));
  log(`targets: ${JSON.stringify(targets)}`);

  // What the references share, in the model's words.
  const notesRes = await provider.complete({ role: 'planner', system: 'You are an art director writing a short art bible.', messages: [{ role: 'user', content: [...refs.map((d) => ({ type: 'image' as const, dataUrl: d })), { type: 'text' as const, text: `These are reference pictures for: ${subject}. In at most 180 words, state what they share that a 3D build must match: light (sun height, colour, shadow colour), palette, materials and their weathering, architecture (heights, facades, roofs, window rhythm), planting, ground, atmosphere and detail density. Plain sentences, no headings.` }] }], maxTokens: 700 });
  const notes = notesRes.content.map((b) => (b.type === 'text' ? b.text : '')).join(' ').trim();
  const bible = bibleText(subject, shots, targets, notes);
  await writeFile(join(out, 'art-bible.txt'), bible);
  log(bible);

  for (const [k, id] of passIds.entries()) {
    const pi = HARDCORE_PASSES.findIndex((p) => p.id === id);
    const pass = HARDCORE_PASSES[pi];
    if (!pass) throw new Error(`unknown pass ${id}`);
    log(`\n=== pass ${k + 1}/${passIds.length}: ${pass.title}`);
    const t0 = Date.now();
    const agent = new WorldAgent({ provider, catalogs: CATALOGS, resolveGenerator: loadLibraryGenerator, maxRepairs: 2, maxTurns: Number(arg('turns', '150')), maxToolCalls: Number(arg('tool-calls', '1500')), levelTools: nodeLevelTools(sandbox), textures: { images: null }, review: { vision: true, maxViews: 4, stallRounds: 3, maxRounds: rounds, differences: true } });
    const events: AgentEvent[] = [];
    for await (const ev of agent.run(passPrompt(pass, pi, bible), host, { intent: 'refine', images: refs, hardcore: { bible, shots, ...(targets ? { targets } : {}) } })) {
      events.push(ev);
      if (ev.type === 'status' || ev.type === 'review') log(`[${Math.round((Date.now() - t0) / 1000)}s] ${ev.type}${'phase' in ev ? `:${ev.phase}` : ''} ${'text' in ev ? ev.text.slice(0, 140) : ''}`);
    }
    const dir = join(out, `pass-${k + 1}-${pass.id}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'world.json'), JSON.stringify({ format: 'aether-world', version: 1, world: host.getWorld() }));
    await gpu.load(host.getWorld());
    const renders = await gpu.capture(shots.map((s) => ({ ...s.pose, hideTops: false })), { width: 1600, height: 900 });
    const files: string[] = [];
    for (const [i, r] of renders.entries()) {
      if (!r) continue;
      const f = join(dir, `${shots[i]?.name ?? i}.png`);
      await writeFile(f, fromDataUrl(r));
      files.push(f);
    }
    const last = events.filter((e) => e.type === 'message').at(-1);
    await writeFile(join(dir, 'summary.json'), JSON.stringify({ pass: pass.id, seconds: Math.round((Date.now() - t0) / 1000), reviewEnd: (events.filter((e) => e.type === 'review').at(-1) as { phase?: string } | undefined)?.phase ?? 'none', final: last }, null, 1));
    log(`pass ${pass.id} done in ${Math.round((Date.now() - t0) / 1000)} s → ${dir}`);
  }
  await gpu.close?.();
}

main().then(() => process.exit(0), (e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
