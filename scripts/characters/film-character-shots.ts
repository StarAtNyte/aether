/**
 * Stills of a cast member in Cloudwatch Harbour's film in the real player (for checking a body: a new or converted one,
 * scripts/characters/vrm-character.ts): the film's own camera, full-body framings, face close-ups with the morphs and a
 * hand close-up. Optionally the body file is swapped for another by intercepting its request (its far level dropped).
 *
 *   STATIC_DIR=<dist> npx tsx scripts/characters/film-character-shots.ts --out=<dir> --tag=kaho [--entity=cw-kaho]
 *       [--body=kaho] [--glb=<body.glb>] [--scan=90] [--t=3.5,74] [--close=63]
 *
 * --world=<template id> (default cloudwatch-harbour, e.g. cloudwatch-harbour-vrm).
 * --scan=<s>: print the character's state every half second of film up to <s>. --t: story stills (the film's own camera)
 * plus a full-body front and three-quarter framing. --close=<t>: face (neutral, smile, blink, surprised) and hand
 * close-ups at <t>. --faceat=<t,..>: a face close-up at each time with the film's own expressions (nothing forced). The software renderer (CHROME_ARGS) is used unless GEN_GPU says otherwise; the player is waited
 * for until it leaves `booting`.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import * as env from '../../tests/e2e/support/env';

const args = process.argv.slice(2);
const arg = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out = resolve(arg('out') ?? '.');
const tag = arg('tag') ?? 'x';
const glb = arg('glb');
const scan = Number(arg('scan') ?? 0);
const ts = (arg('t') ?? '').split(',').filter(Boolean).map(Number);
const close = arg('close') ? Number(arg('close')) : null;
const faceAt = (arg('faceat') ?? '').split(',').filter(Boolean).map(Number);
const W = Number(arg('w') ?? 960), H = Number(arg('h') ?? 540);
const ID = arg('entity') ?? 'cw-kaho';
const BODY = arg('body') ?? 'kaho';
const WORLD = arg('world') ?? 'cloudwatch-harbour';
const log = (s: string): void => void process.stdout.write(`${s}\n`);

const server = await env.startServer(() => undefined);
const browser = await chromium.launch({ executablePath: env.findChrome(), args: [...env.CHROME_ARGS], headless: env.HEADLESS });
try {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await context.addInitScript({ content: env.SKIP_FIRST_RUN });
  await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') log(`[console] ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => log(`[pageerror] ${String(e).slice(0, 300)}`));
  page.on('crash', () => log('[crash] page crashed'));
  if (glb) {
    const body = readFileSync(resolve(glb));
    await page.route(new RegExp(`/c/${BODY}\\.[0-9a-f]{8}\\.glb(\\?.*)?$`), (r) => { log(`swapped ${r.request().url()}`); return r.fulfill({ status: 200, body, contentType: 'model/gltf-binary' }); });
    await page.route(new RegExp(`/c/${BODY}\\.lod1\\.[0-9a-f]{8}\\.glb(\\?.*)?$`), (r) => r.abort());
  }
  await page.goto(`${server.url}/play.html#t=${WORLD}&cook=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__aetherCook?.ready === true, null, { timeout: 900_000, polling: 1000 });
  await page.waitForFunction(() => { const p = (window as any).__aetherPlayer?.phase; return p && p !== 'booting'; }, null, { timeout: 900_000, polling: 1000 });
  await page.waitForFunction(() => (window as any).__aetherPlayer?.phase === 'story', null, { timeout: 300_000, polling: 1000 });
  log('story ready');
  await page.evaluate(() => (window as any).__aetherPlayer.playStory(20));
  await page.waitForTimeout(6000);

  // helpers in the page: the rig, framing the camera on her, morphs
  await page.evaluate((id) => {
    const w = window as any;
    const p = w.__aetherPlayer;
    w.__probe = {
      rig: () => p.simulation.renderer.characterRig(id),
      info() {
        const r = this.rig();
        return { t: +p.story.time.toFixed(2), state: r?.state, clip: r?.clipName, speed: r ? +r.speed.toFixed(2) : null };
      },
      seek(t: number) {
        return new Promise((done) => {
          const from = Math.max(0, t - 2.2);
          p.playStory(from);
          // (the seek lands a frame or more later: wait until the clock has gone back before it)
          let landed = false;
          const tick = (): void => { if (p.story && p.story.time < t - 0.5) landed = true; if (landed && p.story && p.story.time >= t) { p.pauseStory(true); done(this.info()); } else requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
        });
      },
      /** Pin the film camera on a part of her: kind front | three | face | hand. null = the film's camera again. */
      frame(kind: string | null) {
        const r = this.rig();
        let scene = r.root; while (scene.parent) scene = scene.parent;
        const cam = p.simulation.renderer.camera;
        if (!kind) { scene.onBeforeRender = () => undefined; return null; }
        const bone = (n: string) => r.root.getObjectByName(n);
        const V = cam.position.constructor;
        const pos = (n: string) => bone(n).getWorldPosition(new V());
        const left = pos('Bip01_L_Thigh').sub(pos('Bip01_R_Thigh')); left.y = 0; left.normalize();
        const fwd = new V().crossVectors(left, new V(0, 1, 0)).normalize();
        let target: any, dist: number, dir = fwd.clone();
        if (kind === 'front' || kind === 'three') {
          target = pos('Bip01_Pelvis'); target.y += 0.12; dist = 3.4;
          if (kind === 'three') dir.applyAxisAngle(new V(0, 1, 0), 0.65);
        } else if (kind === 'face') { target = pos('Bip01_Head'); target.y += 0.04; dist = 0.85; dir.applyAxisAngle(new V(0, 1, 0), 0.25); }
        else { target = pos('Bip01_R_Hand').add(pos('Bip01_R_Finger2')).multiplyScalar(0.5); dist = 0.36; dir.applyAxisAngle(new V(0, 1, 0), -0.6); }
        const eye = target.clone().addScaledVector(dir, dist); eye.y += kind === 'hand' ? 0.08 : 0.02;
        if (cam.near > 0.05) { cam.near = 0.05; cam.updateProjectionMatrix(); }
        scene.onBeforeRender = () => { cam.position.copy(eye); cam.lookAt(target); cam.updateMatrixWorld(true); };
        return { eye: eye.toArray().map((v: number) => +v.toFixed(2)), target: target.toArray().map((v: number) => +v.toFixed(2)) };
      },
      face(name: string | null) {
        const r = this.rig();
        for (const n of ['smile', 'sad', 'surprised', 'teary', 'blink', 'mouth_open', 'determined']) r.setExpression(n, n === name ? 1 : 0);
        let hits = 0;
        r.root.traverse((o: any) => {
          if (!o.morphTargetDictionary || !o.morphTargetInfluences) return;
          for (const [n, i] of Object.entries(o.morphTargetDictionary)) o.morphTargetInfluences[i as number] = n === name ? 1 : 0;
          hits++;
        });
        return hits;
      },
    };
  }, ID);

  if (scan > 0) {
    await page.evaluate(() => (window as any).__aetherPlayer.playStory(0));
    let last = -1;
    for (let k = 0; k < 4000; k++) {
      const i = await page.evaluate(() => (window as any).__probe.info());
      if (i.t >= scan) break;
      if (i.t - last >= 0.5) { log(`scan ${JSON.stringify(i)}`); last = i.t; }
      await page.waitForTimeout(250);
    }
  }
  const shot = async (name: string, settle = 2500): Promise<void> => {
    await page.waitForTimeout(settle);
    await page.screenshot({ path: join(out, `${tag}-${name}.png`) });
    log(`saved ${join(out, `${tag}-${name}.png`)}`);
  };
  for (const t of ts) {
    log(`seek ${JSON.stringify(await page.evaluate((tt) => (window as any).__probe.seek(tt), t))}`);
    await shot(`t${t}-film`);
    for (const k of ['front', 'three']) {
      log(`frame ${k} ${JSON.stringify(await page.evaluate((kk) => (window as any).__probe.frame(kk), k))}`);
      await shot(`t${t}-${k}`);
    }
    await page.evaluate(() => (window as any).__probe.frame(null));
  }
  for (const t of faceAt) {
    log(`seek ${JSON.stringify(await page.evaluate((tt) => (window as any).__probe.seek(tt), t))}`);
    log(`frame face ${JSON.stringify(await page.evaluate(() => (window as any).__probe.frame('face')))}`);
    await shot(`faceat${t}`, 1500);
    await page.evaluate(() => (window as any).__probe.frame(null));
  }
  if (close !== null) {
    log(`seek ${JSON.stringify(await page.evaluate((tt) => (window as any).__probe.seek(tt), close))}`);
    log(`frame face ${JSON.stringify(await page.evaluate(() => (window as any).__probe.frame('face')))}`);
    for (const f of [null, 'smile', 'blink', 'surprised']) {
      log(`morph meshes ${await page.evaluate((ff) => (window as any).__probe.face(ff), f)}`);
      await shot(`face-${f ?? 'neutral'}`, 3000);
    }
    await page.evaluate(() => (window as any).__probe.face(null));
    log(`frame hand ${JSON.stringify(await page.evaluate(() => (window as any).__probe.frame('hand')))}`);
    await shot('hand');
  }
} finally {
  await browser.close();
  await server.stop?.();
}
process.exit(0);
