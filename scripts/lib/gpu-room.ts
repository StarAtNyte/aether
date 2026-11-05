/**
 * Photoreal stills of a room from an explicit camera, on the machine's GPU: the studio is opened in Chromium (real GPU
 * through ANGLE/Vulkan, or SwiftShader with `AETHER_E2E_GPU` unset), the room replaces its world, and the renderer's
 * still chain (AO, bounced light, eye adaptation, tone curve, grade) draws the view. The software rasteriser used by the
 * headless review is flat; this is what the studio shows.
 *
 * The owner must call {@link GpuRoom.close} in a `finally`: it stops the browser and the server.
 */
import { chromium, type Browser, type Page } from 'playwright';
import type { WorldDoc } from '@aether/core';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer, type TestServer } from '../../tests/e2e/support/env';

/** A camera pose in world metres; `fov` is vertical degrees. */
export interface GpuView {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  fov: number;
}

/** Options of {@link GpuRoom.open}. */
export interface GpuRoomOptions {
  /** Show the browser window (default: headless). */
  headed?: boolean;
  log?: (line: string) => void;
  /** User agent of the page (e.g. a Firefox one, to take the renderer's Gecko path in Chromium). */
  userAgent?: string;
}

/** A studio page that draws rooms from given cameras. */
export class GpuRoom {
  private constructor(
    private readonly server: TestServer,
    private readonly browser: Browser,
    private readonly page: Page,
    private readonly log: (line: string) => void,
  ) {}

  /** Start the server and the browser and open an empty studio. */
  static async open(opts: GpuRoomOptions = {}): Promise<GpuRoom> {
    const log = opts.log ?? ((l: string): void => void process.stdout.write(`${l}\n`));
    const server = await startServer(log);
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS], headless: opts.headed !== true });
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...(opts.userAgent ? { userAgent: opts.userAgent } : {}) });
      await ctx.addInitScript(SKIP_FIRST_RUN);
      // tsx wraps functions in `__name(...)`; a function run in the page by `evaluate` needs it defined there.
      await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      // AETHER_FULL_QUALITY=1: pin the automatic low-memory mode off (it trips on Chromium's heap signal headless and turns
      // post-processing, the full water shader and full-size textures off), so a review sees what a visitor's GPU shows; the render tier is pinned too (AETHER_RENDER_TIER, default high), since a
      // headless software GPU otherwise gets the low tier, which skips the post chain and with it the world's grade and bloom.
      if (process.env['AETHER_FULL_QUALITY'] === '1') await ctx.addInitScript({ content: `try { const k = 'aether.studio.settings.v1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); s.lowMemory = 'off'; s.renderTier = ${JSON.stringify(process.env['AETHER_RENDER_TIER'] ?? 'high')}; localStorage.setItem(k, JSON.stringify(s)); } catch {}` });
      // On the integrated GPU the page draws through WebGL2: the machine's only WebGPU adapter is SwiftShader (software), which
      // fails some post passes and ends in a black picture, so it is hidden as the weak-GPU and frame-recorder harnesses do.
      // The stills are drawn by a `nice`d job on a shared machine: the first frame of a heavy world can take longer than the watchdog's
      // 35 s, and the plain-material step it takes then would turn every still after it flat. Give the watch the time the job needs.
      await ctx.addInitScript({ content: 'globalThis.__aetherWatchdog = { firstFrameMs: 900000, stepFrameMs: 900000, giveUpMs: 900000 };' });
      if (process.env['GEN_GPU'] === 'intel') await ctx.addInitScript({ content: 'delete Navigator.prototype.gpu; try { delete navigator.gpu; } catch {}' });
      // AETHER_PAGE_GLOBALS='{"__AETHER_SLICED_UPLOAD":false}': engine switches set before the studio starts (A/B runs).
      if (process.env['AETHER_PAGE_GLOBALS']) await ctx.addInitScript({ content: `Object.assign(globalThis, ${JSON.stringify(JSON.parse(process.env['AETHER_PAGE_GLOBALS']))});` });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => log(`  pageerror: ${e.message.slice(0, 200)}`));
      page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning' || process.env['GPU_ROOM_VERBOSE'] === '1') log(`  console.${m.type()}: ${m.text().slice(0, 240)}`);
      });
      await page.goto(`${server.url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => {
          const a = window.__aether;
          return !!a && a.simulation !== null && a.store.getState().loading === null && !a.store.getState().agentBusy;
        },
        null,
        { timeout: 150_000, polling: 250 },
      );
      await page.evaluate(() => {
        const st = window.__aether?.store.getState();
        st?.updateSettings({ showPerf: false, showNavHint: false });
        st?.setPanel('left', false);
        st?.setPanel('right', false);
      });
      return new GpuRoom(server, browser, page, log);
    } catch (e) {
      await browser?.close().catch(() => undefined);
      await server.stop().catch(() => undefined);
      throw e;
    }
  }

  /** Run `fn` in the studio page (the renderer is `window.__aether?.simulation?.renderer`). */
  evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<T> {
    return this.page.evaluate(fn as never, arg as never) as Promise<T>;
  }

  /** A PNG of the viewport canvas as it is drawn now (the live picture, not a still). */
  async screenshot(): Promise<Buffer> {
    const box = await this.page.locator('.viewport__host canvas').first().boundingBox();
    return this.page.screenshot(box ? { clip: { x: box.x, y: box.y, width: box.width, height: box.height } } : {});
  }

  /** Texture sets the page already knows (ids), so each is registered once. */
  private readonly known = new Set<string>();

  /** Register texture sets (encoded maps) with the studio's project store, as the photo flow would in the browser. */
  async registerTextures(sets: ReadonlyArray<{ id: string; def: unknown; files: ReadonlyArray<{ tier: number; map: string; bytes: Uint8Array }> }>): Promise<void> {
    for (const s of sets) {
      if (this.known.has(s.id)) continue;
      this.known.add(s.id);
      const files = s.files.map((f) => ({ tier: f.tier, map: f.map, b64: Buffer.from(f.bytes).toString('base64') }));
      const res = await this.page.evaluate(async ([id, def, fl]) => {
        const t = (window.__aether?.studio as unknown as { textures?: { add(s: unknown): Promise<{ ok: boolean; error?: string }> } } | undefined)?.textures;
        if (!t) return 'no texture store';
        const bytes = (fl as Array<{ tier: number; map: string; b64: string }>).map((f) => ({ tier: f.tier, map: f.map, bytes: Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)) }));
        const r = await t.add({ id, def, files: bytes });
        return r.ok ? '' : (r.error ?? 'refused');
      }, [s.id, s.def, files] as const);
      if (res) this.log(`  texture ${s.id} not registered: ${res}`);
    }
  }

  /** Replace the world of the studio with `world` and wait until it is built and the lighting has settled. */
  async load(world: WorldDoc): Promise<void> {
    const err = await this.page.evaluate((w) => {
      const a = window.__aether;
      if (!a) return 'no studio';
      a.studio.replaceWorld(w as never, 'Room from a photo');
      a.store.getState().setArch({ walls: 'up' });
      return '';
    }, world as unknown);
    if (err) throw new Error(err);
    const toast = await this.page.evaluate(() => JSON.stringify((window.__aether?.store.getState() as unknown as { toasts?: Array<{ text?: string; message?: string }> }).toasts ?? []).slice(0, 300));
    if (/could not|error/i.test(toast)) this.log(`  studio toasts: ${toast}`);
    const have = await this.page.evaluate(() => Object.keys(window.__aether?.studio.history.current.entities ?? {}).length);
    if (have !== Object.keys(world.entities).length) this.log(`  the studio holds ${have} entities after the load, the room has ${Object.keys(world.entities).length}`);
    await this.page.evaluate(async () => {
      window.addEventListener('unhandledrejection', (e) => console.error(`unhandled: ${String((e.reason as Error)?.stack ?? e.reason).slice(0, 400)}`));
      await window.__aether?.simulation?.whenSynced();
    });
    await this.page.waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: 120_000, polling: 500 }).catch(() => this.log('  (still animating, continuing)'));
    await this.page.waitForTimeout(1500);
  }

  /**
   * Draw the loaded room from `view` as a PNG.
   * @param quality `studio` (photoreal, a few samples) or `final` (supersampled).
   */
  async still(view: GpuView, size: { width: number; height: number }, quality: 'studio' | 'final' = 'studio'): Promise<Buffer> {
    const now = await this.page.evaluate(() => `${window.__aether?.studio.history.current.name}:${Object.keys(window.__aether?.studio.history.current.entities ?? {}).length}`);
    const st = await this.page.evaluate(() => JSON.stringify((window.__aether?.simulation?.renderer as unknown as { stats(): unknown } | undefined)?.stats()));
    this.log(`  drawing world ${now}; renderer ${st}`);
    // The studio re-frames its camera and arch view after a load; make sure the walls are solid before drawing.
    await this.page.evaluate(() => window.__aether?.store.getState().setArch({ walls: 'up' }));
    await this.page.waitForTimeout(800);
    const dataUrl = await this.page.evaluate(
      async ([pos, target, fov, w, h, q]) => {
        const r = window.__aether?.simulation?.renderer;
        if (!r) return null;
        (r as unknown as { setRenderTier?: (t: string) => void }).setRenderTier?.('ultra');
        r.setRenderQuality(q as 'studio' | 'final');
        // A photograph of a room is sharp end to end: the depth-of-field blur of the cinematic look would only hide differences.
        (r as unknown as { setEffects?: (o: Record<string, boolean>) => void }).setEffects?.({ dof: false });
        // The building's bounced-light volume bakes a moment after the last change: finish it so the still has its interior light.
        (r as unknown as { finishLightVolume?: () => boolean }).finishLightVolume?.();
        await r.preparePost();
        // The pose is explicit: the orbit rig would keep the eye outside the room.
        const pose = { pos: pos as [number, number, number], target: target as [number, number, number], fov: fov as number };
        const plan = r.planStill(w as number, h as number, q as 'studio' | 'final');
        const img = await r.renderStill({ width: w as number, height: h as number, pose, frames: plan.frames, tileSize: plan.tileSize, ...(plan.supersample > 1 ? { supersample: plan.supersample } : {}) });
        const c = new OffscreenCanvas(img.width, img.height);
        const ctx = c.getContext('2d');
        if (!ctx) return null;
        ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
        const blob = await c.convertToBlob({ type: 'image/png' });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return `data:image/png;base64,${btoa(bin)}`;
      },
      [[...view.position], [...view.target], view.fov, size.width, size.height, quality] as const,
    );
    if (!dataUrl) throw new Error('still failed');
    return Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  }

  /**
   * Frame intervals of the live viewport (default tier, no vsync override) while the eye walks `frames` small steps along a line at
   * eye height inside the world: median and 90th percentile in milliseconds, with the renderer's own draw and triangle counts.
   */
  async frameCost(from: readonly [number, number, number], to: readonly [number, number, number], frames: number): Promise<{ medianMs: number; p90Ms: number; maxMs: number; over50: number; stats: unknown }> {
    await this.page.evaluate(() => window.__aether?.store.getState().setArch({ walls: 'up' }));
    return this.page.evaluate(
      async ([a, b, n]) => {
        const r = window.__aether?.simulation?.renderer as unknown as { setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void; stats(): unknown };
        const yaw = Math.atan2(-(b[0] - a[0]), -(b[2] - a[2]));
        const dts: number[] = [];
        let last = performance.now();
        for (let i = 0; i < (n as number) + 30; i++) {
          const t = i / (n as number);
          r.setCameraPose(a[0] + (b[0] - a[0]) * t, a[1], a[2] + (b[2] - a[2]) * t, yaw, -0.05 + 0.1 * Math.sin(i / 7));
          await new Promise((res) => requestAnimationFrame(() => res(null)));
          const now = performance.now();
          if (i >= 30) dts.push(now - last);
          last = now;
        }
        dts.sort((x, y) => x - y);
        return { medianMs: Math.round((dts[Math.floor(dts.length / 2)] as number) * 10) / 10, p90Ms: Math.round((dts[Math.floor(dts.length * 0.9)] as number) * 10) / 10, maxMs: Math.round((dts[dts.length - 1] as number) * 10) / 10, over50: dts.filter((d) => d > 50).length, stats: r.stats() };
      },
      [[...from], [...to], frames] as const,
    );
  }

  /**
   * Review captures exactly as the studio hands them to the agent (`Simulation.capturePoses`: the live scene, the eye adapted to
   * each pose, no post chain), as JPEG data URLs in the order of `poses`; null for one that could not be drawn.
   */
  async capture(poses: ReadonlyArray<{ position: readonly number[]; target: readonly number[]; up?: readonly number[]; fov: number; hideTops?: boolean }>, size: { width: number; height: number }): Promise<Array<string | null>> {
    return this.page.evaluate(
      async ([ps, w, h]) => {
        const sim = window.__aether?.simulation as unknown as { capturePoses(p: unknown[], s: { width: number; height: number }): Promise<Array<string | null>> } | null | undefined;
        if (!sim) return [];
        return sim.capturePoses((ps as Array<Record<string, unknown>>).map((p) => ({ up: [0, 1, 0], hideTops: false, ...p })), { width: w as number, height: h as number });
      },
      [poses.map((p) => ({ ...p, position: [...p.position], target: [...p.target] })), size.width, size.height] as const,
    );
  }

  /**
   * Live frames, as the studio draws them while the camera moves: the camera is posed (yaw/pitch in radians), a few frames are left
   * to settle, and the canvas is read back as a grey image of `w` x `h`. Used to score flicker; stills use {@link still}.
   */
  async liveFrames(poses: ReadonlyArray<{ x: number; y: number; z: number; yaw: number; pitch: number }>, size: { w: number; h: number }, settleFrames = 6): Promise<Uint8Array[]> {
    await this.page.evaluate(() => window.__aether?.store.getState().setArch({ walls: 'up' }));
    const out: Uint8Array[] = [];
    for (const p of poses) {
      await this.page.evaluate(async ([x, y, z, yaw, pitch, n]) => {
        const r = window.__aether?.simulation?.renderer;
        r?.setCameraPose(x as number, y as number, z as number, yaw as number, pitch as number);
        for (let i = 0; i < (n as number); i++) await new Promise((res) => requestAnimationFrame(() => res(null)));
      }, [p.x, p.y, p.z, p.yaw, p.pitch, settleFrames] as const);
      const png = await this.page.screenshot({ type: 'png' });
      const b64 = await this.page.evaluate(
        async ([data, w, h]) => {
          const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
          const bmp = await createImageBitmap(blob);
          const c = new OffscreenCanvas(w as number, h as number);
          const ctx = c.getContext('2d');
          if (!ctx) return '';
          ctx.drawImage(bmp, 0, 0, w as number, h as number);
          const px = ctx.getImageData(0, 0, w as number, h as number).data;
          const g = new Uint8Array((w as number) * (h as number));
          for (let i = 0; i < g.length; i++) g[i] = Math.round(0.2126 * (px[i * 4] as number) + 0.7152 * (px[i * 4 + 1] as number) + 0.0722 * (px[i * 4 + 2] as number));
          let bin = '';
          for (let i = 0; i < g.length; i += 0x8000) bin += String.fromCharCode(...g.subarray(i, i + 0x8000));
          return btoa(bin);
        },
        [png.toString('base64'), size.w, size.h] as const,
      );
      out.push(Uint8Array.from(Buffer.from(b64, 'base64')));
    }
    return out;
  }

  /** Set the render tier of the live view (`low`..`ultra`, or `auto`). */
  async setTier(tier: string): Promise<void> {
    await this.page.evaluate((t) => (window.__aether?.simulation?.renderer as unknown as { setRenderTier?: (x: string) => void } | undefined)?.setRenderTier?.(t), tier);
    await this.page.waitForTimeout(1500);
  }

  /** A screenshot of the page as it is (debugging). */
  async snap(path: string): Promise<void> {
    await this.page.screenshot({ path });
  }

  /** What the renderer says about the building's bounced-light volume (for diagnosing a dark still). */
  async lightVolume(): Promise<unknown> {
    return this.page.evaluate(() => {
      const r = window.__aether?.simulation?.renderer as unknown as { lightVolumeReady?: boolean; lightVolumeBaking?: boolean; lightVolumeStats?: unknown } | undefined;
      return r ? { ready: r.lightVolumeReady, baking: r.lightVolumeBaking, stats: typeof r.lightVolumeStats === 'function' ? (r.lightVolumeStats as () => unknown)() : r.lightVolumeStats } : null;
    });
  }

  /** Stop the browser and the server. */
  async close(): Promise<void> {
    await this.browser.close().catch(() => undefined);
    await this.server.stop().catch(() => undefined);
  }
}
