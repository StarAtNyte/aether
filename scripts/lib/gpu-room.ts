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
      const page = await ctx.newPage();
      page.on('pageerror', (e) => log(`  pageerror: ${e.message.slice(0, 200)}`));
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
    await this.page.evaluate(async () => {
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

  /** Stop the browser and the server. */
  async close(): Promise<void> {
    await this.browser.close().catch(() => undefined);
    await this.server.stop().catch(() => undefined);
  }
}
