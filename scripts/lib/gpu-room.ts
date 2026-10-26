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
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      await ctx.addInitScript(SKIP_FIRST_RUN);
      // On the integrated GPU the page draws through WebGL2: the machine's only WebGPU adapter is SwiftShader (software), which
      // fails some post passes and ends in a black picture, so it is hidden as the weak-GPU and frame-recorder harnesses do.
      if (process.env['GEN_GPU'] === 'intel') await ctx.addInitScript({ content: 'delete Navigator.prototype.gpu; try { delete navigator.gpu; } catch {}' });
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
