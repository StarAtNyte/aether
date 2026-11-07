/**
 * Proof shots of the toon body `kaho` in Cloudwatch Harbour's sunset light: a full-body turnaround, a face close-up and
 * walk / run frames (the entity is moved every frame through `renderer.setEntityProperty`, as a cinematic would).
 *
 *   STATIC_DIR=<dist> GEN_GPU=intel npx tsx scripts/characters/kaho-shots.ts --out=<dir> [--at=x,z] [--only=turn,face,walk,run,idle,clips,expressions] [--body=kaho]
 *
 * Writes a scratch world (`kaho-proof.json`: Cloudwatch Harbour plus one entity with `character.body: 'kaho'`) into the
 * dist's templates, opens it in the player and writes PNGs plus `report.json` (clip names by speed).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import * as env from '../../tests/e2e/support/env';

const args = process.argv.slice(2);
const arg = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out = resolve(arg('out') ?? 'probe-out/kaho');
const only = new Set((arg('only') ?? 'turn,face,walk,run,idle').split(','));
const at = (arg('at') ?? '0,8').split(',').map(Number) as [number, number];
const dist = process.env['STATIC_DIR'];
if (!dist) throw new Error('STATIC_DIR (a built studio) is required');
mkdirSync(out, { recursive: true });
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);

const world = JSON.parse(readFileSync(join(dist, 'templates/worlds/cloudwatch-harbour.json'), 'utf8')) as { world: { id: string; name: string; entities: Record<string, unknown>; startMode?: string } };
world.world.id = 'kaho-proof';
world.world.name = 'Kaho proof';
// The proof world opens on the orbit view, not on the film (whose cameras would take over the shots).
delete (world.world as { story?: unknown }).story;
world.world.startMode = 'orbit';
world.world.entities['kaho-test'] = {
  behaviors: [], castShadow: true, id: 'kaho-test', name: 'Kaho', parent: null, receiveShadow: true,
  shape: { kind: 'primitive', primitive: 'box', size: [0.5, 1.6, 0.5] }, state: {}, tags: [], template: false,
  transform: { position: [at[0], 0.8, at[1]], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true,
  character: { body: arg('body') ?? 'kaho' },
};
writeFileSync(join(dist, 'templates/worlds/kaho-proof.json'), JSON.stringify(world));

type R = {
  lookAt(p: number[], t: number[], fov?: number): void;
  setEntityProperty(id: string, path: string, v: unknown): void;
  raycastWorld(o: number[], d: number[], max?: number, exclude?: Set<string>): { point: number[] } | null;
  characterRig(id: string): { clipName: string; state: string; speed: number; playClip(n: string, o?: unknown): boolean; stopClip(): void } | null;
};
const R = 'window.__aetherPlayer.simulation.renderer';

async function canvasShot(page: Page, name: string): Promise<void> {
  const file = join(out, `${name}.png`);
  await page.locator('canvas').first().screenshot({ path: file });
  log(`shot ${name}`);
}

const server = await env.startServer(log);
const report: Record<string, unknown> = {};
try {
  const browser = await chromium.launch({ executablePath: env.findChrome(), args: [...env.CHROME_ARGS], headless: env.HEADLESS });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
  if (process.env['GEN_GPU'] === 'intel') await page.addInitScript({ content: 'delete Navigator.prototype.gpu; try { delete navigator.gpu; } catch {}' });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error' || /toon|kaho/i.test(m.text())) errors.push(`console ${m.type()}: ${m.text().slice(0, 300)}`);
  });
  await page.goto(`${server.url}/play.html#t=kaho-proof&cook=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as { __aetherCook?: { ready: boolean } }).__aetherCook?.ready === true, null, { timeout: 300_000, polling: 250 });
  await page.waitForFunction(`(${R})?.characterRig('kaho-test') != null`, null, { timeout: 120_000, polling: 250 });
  await page.waitForTimeout(3000);
  // Stand her on the floor under `at`.
  const floor = (await page.evaluate(`(() => { const r = ${R}; const h = r.raycastWorld([${at[0]}, 60, ${at[1]}], [0, -1, 0], 200, new Set(['kaho-test'])); return h ? h.point[1] : 0; })()`)) as number;
  log(`floor ${floor.toFixed(3)}`);
  const place = (x: number, z: number, yaw: number): Promise<unknown> => page.evaluate(`(() => { const r = ${R}; r.setEntityProperty('kaho-test', 'transform.position', [${x}, ${floor + 0.8}, ${z}]); r.setEntityProperty('kaho-test', 'transform.rotation', [0, ${yaw}, 0]); })()`);
  const cam = (p: number[], t: number[], fov = 30): Promise<unknown> => page.evaluate(`${R}.lookAt(${JSON.stringify(p)}, ${JSON.stringify(t)}, ${fov})`);
  const [x0, z0] = at;
  const rig = (): Promise<unknown> => page.evaluate(`(() => { const g = ${R}.characterRig('kaho-test'); return g ? { clip: g.clipName, state: g.state, speed: +g.speed.toFixed(2) } : null; })()`);
  if (only.has('debug')) {
    await place(x0, z0, 180);
    await page.waitForTimeout(500);
    report['debug'] = await page.evaluate(`(() => { const r = ${R}; const g = r.characterRig('kaho-test'); const e = g.root.matrixWorld.elements; const c = r.camera.position; const toe = g.root.getObjectByName('Bip01_L_Toe0').getWorldPosition(g.root.position.clone()); const foot = g.root.getObjectByName('Bip01_L_Foot').getWorldPosition(g.root.position.clone()); const m = g.root.getObjectByName('kaho-body'); return { toeMinusFoot: [toe.x - foot.x, toe.z - foot.z], meshAuto: m && [m.matrixWorldAutoUpdate, m.matrixAutoUpdate, m.bindMode], rootZ: [e[8], e[9], e[10]], camera: [c.x, c.y, c.z], parentRot: g.root.parent && g.root.parent.rotation.toArray() }; })()`);
  }
  if (only.has('debug')) {
    await cam([x0 + 3.2, floor + 1.0, z0], [x0, floor + 0.85, z0], 32);
    await page.waitForTimeout(1200);
    await canvasShot(page, 'debug-side');
    await cam([x0, floor + 1.0, z0 - 3.2], [x0, floor + 0.85, z0], 32);
    await page.waitForTimeout(1200);
    await canvasShot(page, 'debug-back');
  }
  if (only.has('probe')) {
    if (arg('wait')) await page.waitForTimeout(Number(arg('wait')));
    await page.evaluate(`(() => { const r = ${R}; window.__kahoMove = { t0: performance.now(), stop: false }; const m = window.__kahoMove; const step = () => { if (m.stop) return; const t = (performance.now() - m.t0) / 1000; const x = ${x0 - 3} + 1.3 * t; r.setEntityProperty('kaho-test', 'transform.position', [x, ${floor + 0.8}, ${z0}]); r.setEntityProperty('kaho-test', 'transform.rotation', [0, 90, 0]); r.lookAt([x + 0.4, ${floor + 1.0}, ${z0 + 4.2}], [x, ${floor + 0.8}, ${z0}], 32); requestAnimationFrame(step); }; step(); })()`);
    const samples: unknown[] = [];
    for (let k = 0; k < 16; k++) {
      await page.waitForTimeout(300);
      samples.push(await page.evaluate(`(() => { const r = ${R}; const cs = r.characters; const e = cs.entries.get('kaho-test'); const g = e.rig; const b = g.root.getObjectByName('Bip01_L_Thigh'); return { t: ${k}, acc: +e.accumulated.toFixed(3), dist: +e.dist.toFixed(1), frame: e.frame, size: cs.size, rigSame: g === r.characterRig('kaho-test'), disposed: g.disposed, q: +b.quaternion.x.toFixed(3), speed: +g.speed.toFixed(2) }; })()`));
    }
    await page.evaluate('window.__kahoMove.stop = true');
    report['probe'] = samples;
  }
  if (only.has('turn')) {
    for (const [i, yaw] of [180, 135, 90, 45, 0, 270].entries()) {
      await place(x0, z0, yaw);
      await cam([x0, floor + 0.95, z0 + 3.6], [x0, floor + 0.8, z0], 32);
      await page.waitForTimeout(1200);
      await canvasShot(page, `turn-${i}`);
    }
  }
  if (only.has('face')) {
    await place(x0, z0, 200);
    await cam([x0 + 0.12, floor + 1.43, z0 + 0.75], [x0, floor + 1.41, z0], 30);
    await page.waitForTimeout(1500);
    await canvasShot(page, 'face');
    await cam([x0 - 0.2, floor + 1.2, z0 + 1.6], [x0, floor + 1.25, z0], 30);
    await page.waitForTimeout(800);
    await canvasShot(page, 'bust');
  }
  for (const [mode, speed] of [['walk', 1.3], ['run', 4.0]] as const) {
    if (!only.has(mode)) continue;
    // Move along +x every frame; the camera follows from the side.
    await page.evaluate(`(() => { const r = ${R}; window.__kahoMove = { t0: performance.now(), stop: false }; const m = window.__kahoMove; const step = () => { if (m.stop) return; const t = (performance.now() - m.t0) / 1000; const x = ${x0 - 3} + ${speed} * t; r.setEntityProperty('kaho-test', 'transform.position', [x, ${floor + 0.8}, ${z0}]); r.setEntityProperty('kaho-test', 'transform.rotation', [0, 90, 0]); r.lookAt([x + 0.4, ${floor + 1.0}, ${z0 + 4.2}], [x, ${floor + 0.8}, ${z0}], 32); m.x = x; requestAnimationFrame(step); }; step(); })()`);
    const states: unknown[] = [];
    for (let k = 0; k < 4; k++) {
      await page.waitForTimeout(k === 0 ? 1100 : 260);
      states.push(await rig());
      await canvasShot(page, `${mode}-${k}`);
    }
    await page.evaluate('window.__kahoMove.stop = true');
    report[mode] = states;
  }
  if (only.has('clips')) {
    // the body's own clips (a built character's extra beats), front on
    for (const clip of ['two_fingers', 'hand_to_chest', 'look_up']) {
      await place(x0, z0, 180);
      await cam([x0, floor + 1.0, z0 + 3.0], [x0, floor + 0.85, z0], 32);
      report[`clip-${clip}`] = await page.evaluate(`${R}.characterRig('kaho-test').playClip('${clip}')`);
      await page.waitForTimeout(900);
      await canvasShot(page, `clip-${clip}`);
      await page.waitForTimeout(1800);
    }
  }
  if (only.has('expressions')) {
    await place(x0, z0, 200);
    await cam([x0 + 0.12, floor + 1.43, z0 + 0.75], [x0, floor + 1.41, z0], 30);
    for (const ex of (arg('exprs') ?? 'smile,surprised,sad,teary,blink,mouth_open,determined').split(',')) {
      await page.evaluate(`(() => { const g = ${R}.characterRig('kaho-test'); for (const e of ['smile', 'surprised', 'sad', 'teary', 'blink', 'mouth_open', 'determined']) g.setExpression(e, e === '${ex}' ? 1 : 0); })()`);
      await page.waitForTimeout(700);
      await canvasShot(page, `ex-${ex}`);
    }
  }
  if (only.has('idle')) {
    await place(x0, z0, 190);
    await page.waitForTimeout(1500);
    report['idle'] = await rig();
    report['wave'] = await page.evaluate(`${R}.characterRig('kaho-test').playClip('wave')`);
    await page.waitForTimeout(900);
    report['waving'] = await rig();
  }
  report['errors'] = errors;
  await browser.close();
} finally {
  await server.stop();
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  log(JSON.stringify(report).slice(0, 1500));
}
