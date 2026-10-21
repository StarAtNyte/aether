/**
 * Stills of a person taking the stairs: builds a two-storey house (an L stair with its balustrades), puts a rigged,
 * animated resident at the foot of the stair with a day that sends them upstairs, presses Play and photographs them
 * on the flights and the landing from the hall, so their walk, their feet on the treads and the balustrade can be
 * judged by eye.
 *
 * Run: `npm run build && npx tsx tests/e2e/npcstairs.e2e.ts --out=<dir> [--style=scandinavian] [--gpu|--intel] [--size=WxH]`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { applyArchOps, fitStair, parsePlan, type PlanStair } from '@aether/arch';
import { applyPatches, createWorld, type EntityInput } from '@aether/core';
import { stairLinks } from '@aether/logic';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const OUT = resolve(arg('out') ?? '/tmp/aether-npcstairs');
const STYLE = arg('style') ?? 'scandinavian';
const GPU = ARGS.includes('--gpu');
const INTEL = ARGS.includes('--intel');
const [W, H] = (arg('size') ?? '1600x900').split('x').map(Number) as [number, number];
const GPU_ARGS = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--disable-vulkan-surface'];
const INTEL_ARGS = ['--enable-unsafe-webgpu', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'];

const startedAt = performance.now();
function log(line: string): void {
  process.stdout.write(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}

function plan(stairs: PlanStair[]): Record<string, unknown> {
  return {
    id: 'h',
    style: STYLE,
    levels: [
      {
        height: 3,
        rooms: [
          { id: 'hall', type: 'hall', rect: [0, 0, 8, 8] },
          { id: 'living', type: 'living', rect: [8, 0, 14, 8] },
        ],
        doors: [{ between: ['living', 'outside'], side: 'south', main: true }, { between: ['hall', 'living'], kind: 'opening', width: 1.6, at: 0.5 }],
        stairs,
      },
      {
        height: 3,
        rooms: [
          { id: 'landing', type: 'hall', rect: [0, 0, 8, 8] },
          { id: 'bed', type: 'bedroom', rect: [8, 0, 14, 8] },
        ],
        doors: [{ between: ['landing', 'bed'], at: 0.5 }],
      },
    ],
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const fit = fitStair(parsePlan(plan([])), 0, { room: 'hall', shape: 'l' });
  if (!fit.ok) throw new Error(`no stair fits: ${fit.reasons.join('; ')}`);
  const base = applyArchOps(createWorld(), [{ op: 'create_building', plan: plan([fit.stair]) }]).target;
  const link = stairLinks(base)[0];
  if (!link) throw new Error('no stair link');
  const foot: [number, number] = [link.line[0] as number, link.line[2] as number];
  const top: [number, number] = [link.line[(link.n - 1) * 3] as number, link.line[(link.n - 1) * 3 + 2] as number];
  // A resident a few steps from the foot, whose day starts upstairs.
  const resident = {
    id: 'walker',
    name: 'Clara',
    shape: { kind: 'primitive', primitive: 'capsule', size: [0.56, 1.7, 0.56] },
    transform: { position: [foot[0] + 2.2, link.y0 + 0.87, foot[1] - 1.2], rotation: [0, 0, 0] },
    physics: { body: 'kinematic' },
    character: { wardrobe: 'casual', gender: 'female', age: 'adult', top: '#7a8f9c', bottom: '#3a3f4a', mood: 'calm', hold: 'none' },
    tags: ['npc', 'resident'],
    npc: { role: 'resident', archetype: 'villager', faction: 'household', speed: 1.0, radius: 0.3, routine: [{ at: [top[0] + 2.5, link.y1, top[1] - 0.3], stay: 60 }] },
  } as unknown as EntityInput;
  const world = applyPatches(base, [{ op: 'add', entity: resident }]).world;
  world.player.spawn = [13, link.y0 + 0.1, 6.5];
  const dir = resolve(import.meta.dirname, '../../apps/studio/dist/templates/worlds');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'apartment.json'), JSON.stringify({ format: 'aether-world', version: 1, world }));
  const server = await startServer(log);
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ executablePath: findChrome(), args: INTEL ? INTEL_ARGS : GPU ? GPU_ARGS : [...CHROME_ARGS] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await context.addInitScript({ content: SKIP_FIRST_RUN });
    await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    if (GPU) await context.addInitScript({ content: 'delete Navigator.prototype.gpu;' });
    const page = await context.newPage();
    page.on('pageerror', (err) => log(`  pageerror: ${err.message}`));
    await page.goto(`${server.url}/?debug=1#/new/apartment`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const a = window.__aether;
      return !!a && a.simulation !== null && a.store.getState().loading === null && !a.store.getState().agentBusy && Object.keys(a.history.current.entities).length > 0;
    }, null, { timeout: 150_000, polling: 250 });
    await page.evaluate(async () => {
      await window.__aether?.simulation?.whenSynced();
    });
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__aether?.simulation?.play());
    await page.waitForFunction(() => window.__aether?.simulation?.mode === 'play', null, { timeout: 60_000 });
    // From the hall, looking at the stair; the camera follows the walker.
    const eye: [number, number, number] = [foot[0] + 4.2, link.y0 + 1.55, foot[1] + 1.8];
    const shots: Array<{ name: string; when: string }> = [
      { name: 'first-flight', when: 'low' },
      { name: 'landing', when: 'mid' },
      { name: 'second-flight', when: 'high' },
    ];
    for (const shot of shots) {
      const deadline = Date.now() + 45_000;
      let ok = false;
      while (Date.now() < deadline) {
        const s = await page.evaluate(([e]) => {
          const sim = window.__aether?.simulation;
          const info = sim?.logic?.npcs.info('walker');
          if (!sim || !info) return null;
          const dx = info.x - e[0];
          const dy = info.y + 1.0 - e[1];
          const dz = info.z - e[2];
          sim.renderer.setCameraPose(e[0], e[1], e[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
          return { stair: info.stair, y: info.y, anim: info.anim };
        }, [eye] as const);
        if (s?.stair) {
          const f = (s.y - link.y0) / (link.y1 - link.y0);
          if ((shot.when === 'low' && f > 0.15 && f < 0.4) || (shot.when === 'mid' && f >= 0.45 && f < 0.55) || (shot.when === 'high' && f > 0.65 && f < 0.9)) {
            ok = true;
            log(`  ${shot.name}: on the stair at ${(f * 100).toFixed(0)} % of the rise, anim ${s.anim}`);
            break;
          }
        }
        await page.waitForTimeout(60);
      }
      if (!ok) log(`  ${shot.name}: not seen on that part of the stair`);
      const dataUrl = await page.evaluate(async ([w, h]) => (await window.__aether?.simulation?.renderer.screenshot({ width: w, height: h, mime: 'image/png' })) ?? null, [W, H] as const);
      if (dataUrl?.startsWith('data:image/png;base64,')) writeFileSync(join(OUT, `${shot.name}.png`), Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));
    }
    await context.close();
    log('NPCSTAIRS DONE');
  } finally {
    await browser?.close();
    await server.stop();
  }
}

main().catch((err: unknown) => {
  log(`NPCSTAIRS FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
