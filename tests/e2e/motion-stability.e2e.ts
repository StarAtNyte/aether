/**
 * Stability and sharpness of the picture while the view zooms and orbits: the default view (split studio chain on
 * integrated / unknown GPUs) against explicit Studio quality, per room.
 *
 * A scripted camera dollies in and out along the view axis while it orbits slowly; every frame is read back (luminance,
 * 480x270). Per run it reports
 *   - flicker: mean |f[t+1] - 2 f[t] + f[t-1]| (the second difference is small for a steady picture under smooth motion and
 *     large when the picture pops or shimmers), and the mean-luminance pump the same way;
 *   - blur: mean Laplacian variance of the frames, and SSIM against the converged full-chain still at 6 poses of the path;
 *   - frames per second, the scale range and the number of scale changes.
 *
 * Run: `npm run build && GEN_GPU=intel npx tsx tests/e2e/motion-stability.e2e.ts [--worlds=a,b] [--configs=default,studio,default-smooth] [--frames=180] [--out=dir]`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';
import { COVER_CAMERAS } from './support/showcase-cameras';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const WORLDS = (arg('worlds') ?? 'photo-hotel-bedroom,photo-twin-room,photo-vaulted-bedroom,skyline-penthouse,casa-patio,highland-trail').split(',').filter(Boolean);
const CONFIGS = (arg('configs') ?? 'default,studio').split(',');
const FRAMES = Number(arg('frames') ?? 180);
const OUT = arg('out');
const FW = 480;
const FH = 270;
const t0 = performance.now();
const log = (s: string): void => void process.stdout.write(`[${((performance.now() - t0) / 1000).toFixed(0).padStart(5)}s] ${s}\n`);

type R = {
  setRenderTier(t: string): void;
  setRenderQuality(q: string): string;
  setMotionProfile?(p: string): void;
  setAdaptiveResolution(on: boolean): void;
  requestRender(): void;
  setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void;
  cameraPose(): { pos: number[]; target: number[] };
  domElement?: HTMLCanvasElement;
  renderer: { domElement: HTMLCanvasElement };
  stats(): Record<string, number>;
  adaptive: { scale: number; changeCount: number };
  atRest: boolean;
};

async function open(page: Page, url: string, slug: string): Promise<void> {
  await page.goto(`${url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => {
      const a = window.__aether;
      if (!a || a.simulation === null) return false;
      const st = a.store.getState();
      const w = a.history.current;
      return st.loading === null && !st.agentBusy && (Object.keys(w.entities).length > 0 || w.voxel !== undefined);
    },
    null,
    { timeout: 150_000, polling: 250 },
  );
  await page.evaluate(async () => {
    await window.__aether?.simulation?.whenSynced();
    const st = window.__aether?.store.getState();
    st?.setPanel('left', false);
    st?.setPanel('right', false);
    st?.updateSettings({ showNavHint: false });
  });
  await page.waitForFunction(() => (window.__aether?.simulation?.renderer as unknown as { lightmapStatus: { state: string } }).lightmapStatus.state !== 'baking', null, { timeout: 60_000, polling: 500 }).catch(() => undefined);
  await page.waitForTimeout(4000);
}

interface Run {
  frames: string[];
  dts: number[];
  scales: number[];
  atRest: boolean[];
}

/** Read the path: `frames` rAF steps; returns luminance frames (base64 of FWxFH bytes). `ref` poses (indices) are also captured at rest. */
async function runPath(page: Page, pose: number[], cfg: string, frames: number, refIdx: number[] | null): Promise<Run | { refs: string[] }> {
  return page.evaluate(
    async ([p, cfgName, n, refs, fw, fh]) => {
      const r = window.__aether?.simulation?.renderer as unknown as R;
      const pose = p as number[];
      const canvas = r.renderer.domElement;
      const grab = document.createElement('canvas');
      grab.width = fw as number;
      grab.height = fh as number;
      const g = grab.getContext('2d', { willReadFrequently: true })!;
      const fx = -Math.sin(pose[3]!) * Math.cos(pose[4]!);
      const fy = Math.sin(pose[4]!);
      const fz = -Math.cos(pose[3]!) * Math.cos(pose[4]!);
      const at = (i: number): [number, number, number, number, number] => {
        const u = i / 90;
        const d = 2.2 * Math.sin(2 * Math.PI * u);
        return [pose[0]! + fx * d, pose[1]! + fy * d, pose[2]! + fz * d, pose[3]! + 0.12 * Math.sin(2 * Math.PI * u * 0.5), pose[4]!];
      };
      const luma = (): string => {
        g.drawImage(canvas, 0, 0, fw as number, fh as number);
        const d = g.getImageData(0, 0, fw as number, fh as number).data;
        const out = new Uint8Array((fw as number) * (fh as number));
        for (let i = 0; i < out.length; i++) out[i] = (d[i * 4]! * 54 + d[i * 4 + 1]! * 183 + d[i * 4 + 2]! * 19) >> 8;
        let s = '';
        for (let i = 0; i < out.length; i += 8192) s += String.fromCharCode(...out.subarray(i, i + 8192));
        return btoa(s);
      };
      const nextFrame = (): Promise<number> => new Promise((res) => requestAnimationFrame((t) => res(t)));
      if (cfgName === 'ref') {
        const out: string[] = [];
        for (const i of refs as number[]) {
          const a = at(i);
          r.setCameraPose(...a);
          r.requestRender();
          await new Promise((res) => setTimeout(res, 3500));
          await nextFrame();
          out.push(luma());
        }
        return { refs: out };
      }
      const frameOut: string[] = [];
      const dts: number[] = [];
      const scales: number[] = [];
      const rest: boolean[] = [];
      let last = await nextFrame();
      for (let i = 0; i < (n as number); i++) {
        const a = at(i);
        r.setCameraPose(...a);
        const now = await nextFrame();
        dts.push(now - last);
        last = now;
        scales.push(r.adaptive.scale);
        rest.push(r.atRest);
        frameOut.push(luma());
      }
      return { frames: frameOut, dts, scales, atRest: rest };
    },
    [pose, cfg, frames, refIdx, FW, FH] as const,
  ) as Promise<Run | { refs: string[] }>;
}

function decode(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function lapVar(f: Uint8Array): number {
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (let y = 1; y < FH - 1; y++)
    for (let x = 1; x < FW - 1; x++) {
      const i = y * FW + x;
      const l = 4 * f[i]! - f[i - 1]! - f[i + 1]! - f[i - FW]! - f[i + FW]!;
      s += l;
      s2 += l * l;
      n++;
    }
  return s2 / n - (s / n) ** 2;
}

function ssim(a: Uint8Array, b: Uint8Array): number {
  const W = 8;
  let tot = 0;
  let cnt = 0;
  for (let y = 0; y + W <= FH; y += W)
    for (let x = 0; x + W <= FW; x += W) {
      let ma = 0;
      let mb = 0;
      for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { ma += a[(y + j) * FW + x + i]!; mb += b[(y + j) * FW + x + i]!; }
      ma /= W * W;
      mb /= W * W;
      let va = 0;
      let vb = 0;
      let cv = 0;
      for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { const da = a[(y + j) * FW + x + i]! - ma; const db = b[(y + j) * FW + x + i]! - mb; va += da * da; vb += db * db; cv += da * db; }
      va /= W * W - 1; vb /= W * W - 1; cv /= W * W - 1;
      tot += ((2 * ma * mb + 6.5) * (2 * cv + 58.5)) / ((ma * ma + mb * mb + 6.5) * (va + vb + 58.5));
      cnt++;
    }
  return tot / cnt;
}

function metrics(run: Run, refs: Uint8Array[], refIdx: number[], skip: number): string {
  const fr = run.frames.map(decode);
  let flick = 0;
  let nf = 0;
  const means: number[] = [];
  for (const f of fr) { let m = 0; for (let i = 0; i < f.length; i++) m += f[i]!; means.push(m / f.length); }
  let pump = 0;
  for (let t = skip + 1; t < fr.length - 1; t++) {
    const a = fr[t - 1]!, b = fr[t]!, c = fr[t + 1]!;
    let s = 0;
    for (let i = 0; i < b.length; i++) s += Math.abs(c[i]! - 2 * b[i]! + a[i]!);
    flick += s / b.length;
    pump += Math.abs(means[t + 1]! - 2 * means[t]! + means[t - 1]!);
    nf++;
  }
  let lv = 0;
  for (let t = skip; t < fr.length; t++) lv += lapVar(fr[t]!);
  lv /= fr.length - skip;
  let ss = 0;
  refIdx.forEach((idx, k) => { ss += ssim(fr[idx]!, refs[k]!); });
  ss /= refIdx.length;
  const dts = run.dts.slice(skip).sort((a, b) => a - b);
  const fps = 1000 / (dts.reduce((a, b) => a + b, 0) / dts.length);
  const p90fps = 1000 / dts[Math.floor(dts.length * 0.9)]!;
  const sc = run.scales.slice(skip);
  const changes = sc.reduce((n, v, i) => (i > 0 && v !== sc[i - 1] ? n + 1 : n), 0);
  const restFrames = run.atRest.slice(skip).filter(Boolean).length;
  return `flicker=${(flick / nf).toFixed(3)} pump=${(pump / nf).toFixed(4)} lapVar=${lv.toFixed(1)} ssim=${ss.toFixed(4)} fps=${fps.toFixed(1)} p90fps=${p90fps.toFixed(1)} scale=${Math.min(...sc).toFixed(2)}-${Math.max(...sc).toFixed(2)} changes=${changes} restFrames=${restFrames}`;
}

async function main(): Promise<void> {
  const server = await startServer(log);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  const lines: string[] = [];
  try {
    for (const slug of WORLDS) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      await context.addInitScript({ content: SKIP_FIRST_RUN });
      await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      if (process.env['GEN_GPU'] === 'intel') await context.addInitScript(() => void delete (Navigator.prototype as unknown as Record<string, unknown>)['gpu']);
      try {
        const page = await context.newPage();
        await open(page, server.url, slug);
        const cam = COVER_CAMERAS[slug];
        let pose: number[] = await page.evaluate(() => {
          const r = window.__aether?.simulation?.renderer as unknown as R;
          const c = r.cameraPose();
          const dx = c.target[0]! - c.pos[0]!, dy = c.target[1]! - c.pos[1]!, dz = c.target[2]! - c.pos[2]!;
          return [c.pos[0]!, c.pos[1]!, c.pos[2]!, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
        });
        if (cam) {
          if (cam.arch) await page.evaluate((v) => window.__aether?.store.getState().setArch(v), cam.arch);
          const dx = cam.target[0] - cam.pos[0], dy = cam.target[1] - cam.pos[1], dz = cam.target[2] - cam.pos[2];
          pose = [cam.pos[0], cam.pos[1], cam.pos[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
        }
        await page.waitForTimeout(1500);
        const refIdx = [10, 25, 40, 55, 70, 85].map((v) => v * 2);
        // Reference: explicit Studio, full chain, converged at each pose.
        await page.evaluate(() => {
          const r = window.__aether?.simulation?.renderer as unknown as R;
          r.setAdaptiveResolution(false);
          r.setRenderTier('ultra');
          r.setRenderQuality('studio');
        });
        await page.waitForTimeout(4000);
        const ref = (await runPath(page, pose, 'ref', 0, refIdx)) as { refs: string[] };
        const refs = ref.refs.map(decode);
        if (OUT) { mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: join(OUT, `${slug}-ref.png`) }); }
        for (const cfg of CONFIGS) {
          await page.evaluate((c) => {
            const r = window.__aether?.simulation?.renderer as unknown as R;
            if (c === 'studio') {
              r.setAdaptiveResolution(false);
              r.setRenderTier('ultra');
              r.setRenderQuality('studio');
            } else {
              r.setRenderQuality('realtime');
              r.setRenderTier('auto');
              r.setAdaptiveResolution(true);
              r.setMotionProfile?.(c === 'default-smooth' ? 'smooth' : 'sharp');
            }
          }, cfg);
          await page.waitForTimeout(5000);
          const run = (await runPath(page, pose, cfg, FRAMES, null)) as Run;
          const line = `| ${slug} | ${cfg} | ${metrics(run, refs, refIdx, 20)} |`;
          lines.push(line);
          log(line);
          if (OUT) {
            writeFileSync(join(OUT, `${slug}-${cfg}.json`), JSON.stringify({ dts: run.dts, scales: run.scales, atRest: run.atRest }));
            for (const i of [20, 45, 70]) writeFileSync(join(OUT, `${slug}-${cfg}-f${i}.pgm`), Buffer.concat([Buffer.from(`P5 ${FW} ${FH} 255\n`), Buffer.from(decode(run.frames[i]!))]));
          }
        }
      } catch (e) {
        log(`${slug}: FAILED ${(e as Error).message.slice(0, 200)}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await server.stop();
  }
  process.stdout.write(`\n${lines.join('\n')}\n`);
}

void main();
