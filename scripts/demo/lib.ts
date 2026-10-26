/**
 * Helpers for the demo recorder: an on-page cursor and highlight overlay, smooth pointer motion, slow typing and a
 * timeline of captions / speed ramps / cuts that `compose.ts` turns into the final edit. Nothing here touches the
 * app's own code; it drives the real studio through Playwright like a user.
 */
import { writeFileSync } from 'node:fs';
import type { Locator, Page } from 'playwright';

/** One thing the editor does to the raw take (times are milliseconds from the start of the page's video). */
export type Mark =
  | { kind: 'caption'; t0: number; t1: number; text: string; note?: boolean; high?: boolean; top?: boolean }
  | { kind: 'title'; t0: number; t1: number; text: string }
  | { kind: 'cut'; t0: number; t1: number }
  | { kind: 'ramp'; t0: number; t1: number; factor: number };

export interface Timeline {
  scene: string;
  /** Free-text provenance line, shown in docs/DEMO_VIDEO.md (e.g. "offline planner, recorded"). */
  source: string;
  marks: Mark[];
}

/** Records marks relative to the moment the page was created (where Playwright's video starts). */
export class Recorder {
  readonly t0 = Date.now();
  readonly marks: Mark[] = [];
  private openCaption: { t0: number; text: string; note?: boolean; high?: boolean; top?: boolean } | null = null;
  private openNote: { t0: number; text: string } | null = null;
  constructor(
    readonly scene: string,
    readonly source: string,
  ) {}
  now(): number {
    return Date.now() - this.t0;
  }
  /** Show a caption from now until the next caption (or `endCaption`). */
  caption(text: string, opts: { note?: boolean; high?: boolean; top?: boolean } = {}): void {
    this.endCaption();
    process.stdout.write(`  [${(this.now() / 1000).toFixed(1)}s] ${text}\n`);
    this.openCaption = { t0: this.now(), text, ...opts };
  }
  endCaption(): void {
    if (!this.openCaption) return;
    const c = this.openCaption;
    this.marks.push({ kind: 'caption', t0: c.t0, t1: this.now(), text: c.text, ...(c.note ? { note: true } : {}), ...(c.high ? { high: true } : {}), ...(c.top ? { top: true } : {}) });
    this.openCaption = null;
  }
  /** A small provenance note (top right) that stays up, independent of the captions, until `endNote` or the next note. */
  note(text: string): void {
    this.endNote();
    this.openNote = { t0: this.now(), text };
  }
  endNote(): void {
    if (!this.openNote) return;
    this.marks.push({ kind: 'caption', t0: this.openNote.t0, t1: this.now(), text: this.openNote.text, note: true });
    this.openNote = null;
  }
  title(text: string, ms = 2200): void {
    const t = this.now();
    process.stdout.write(`  [${(t / 1000).toFixed(1)}s] == ${text}\n`);
    this.marks.push({ kind: 'title', t0: t, t1: t + ms, text });
  }
  /** Drop everything from `from` (a value of `now()`) to the present: booting, white frames, dead waits. */
  cut(from: number): void {
    this.marks.push({ kind: 'cut', t0: from, t1: this.now() });
  }
  /** Keep what happened since `from` but play it at least `factor` times faster, so a long build takes `targetMs`. */
  ramp(from: number, targetMs: number): void {
    const real = this.now() - from;
    if (real <= targetMs * 1.2) return;
    this.marks.push({ kind: 'ramp', t0: from, t1: this.now(), factor: Math.round((real / targetMs) * 10) / 10 });
  }
  save(file: string): void {
    this.endCaption();
    this.endNote();
    const tl: Timeline = { scene: this.scene, source: this.source, marks: this.marks };
    writeFileSync(file, JSON.stringify(tl, null, 1));
  }
}

/** Injected into every page: a fake cursor that follows the real mouse, click ripples, a ring highlight and a zoom. */
export const OVERLAY_SCRIPT = `(() => {
  if (window.__demo) return;
  const css = document.createElement('style');
  css.textContent = \`
  #__cur{position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
  .__rip{position:fixed;z-index:2147483646;pointer-events:none;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:3px solid rgba(255,255,255,.95);background:rgba(88,120,255,.35);animation:__rip .5s ease-out forwards}
  @keyframes __rip{to{transform:scale(4.2);opacity:0}}
  .__ring{position:fixed;z-index:2147483645;pointer-events:none;border-radius:12px;border:3px solid #ffd24a;box-shadow:0 0 0 9999px rgba(8,10,20,.38),0 0 22px 4px rgba(255,210,74,.55);transition:opacity .25s,left .25s,top .25s,width .25s,height .25s}
  #root{transition:transform .9s cubic-bezier(.4,0,.2,1)}
  \`;
    const cur = document.createElement('div');
  cur.id = '__cur';
  cur.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2l15 9.2-6.6 1.5 3.9 6.9-2.8 1.6-3.9-6.9L4.6 19z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const mount = () => { if (document.body) { document.head.appendChild(css); document.body.appendChild(cur); } };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  addEventListener('mousemove', (e) => { cur.style.transform = 'translate(' + (e.clientX - 4) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
  addEventListener('mousedown', (e) => {
    const r = document.createElement('div'); r.className = '__rip'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
    document.body.appendChild(r); setTimeout(() => r.remove(), 600);
  }, true);
  window.__demo = {
    ring(x, y, w, h) {
      let r = document.querySelector('.__ring');
      if (!r) { r = document.createElement('div'); r.className = '__ring'; document.body.appendChild(r); }
      Object.assign(r.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', opacity: '1' });
    },
    unring() { const r = document.querySelector('.__ring'); if (r) { r.style.opacity = '0'; setTimeout(() => r.remove(), 300); } },
    zoom(x, y, s) { const el = document.getElementById('root'); if (!el) return; el.style.transformOrigin = x + 'px ' + y + 'px'; el.style.transform = 'scale(' + s + ')'; },
    cursor(on) { cur.style.display = on ? '' : 'none'; },
    unzoom() { const el = document.getElementById('root'); if (el) el.style.transform = 'none'; },
  };
})();`;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export { sleep };

const pos = new WeakMap<Page, { x: number; y: number }>();
const hidden = new WeakSet<Page>();

/** Move the pointer to (x, y) along an eased path taking about `ms` milliseconds. */
export async function glide(page: Page, x: number, y: number, ms = 700): Promise<void> {
  const from = pos.get(page) ?? { x: 640, y: 400 };
  const steps = Math.max(8, Math.round(ms / 16));
  const t0 = Date.now();
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    const wait = (ms * i) / steps - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  pos.set(page, { x, y });
}

/** Centre of a locator, scrolled into view first. */
export async function centre(loc: Locator): Promise<{ x: number; y: number; w: number; h: number; left: number; top: number }> {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) throw new Error('element has no box');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height, left: b.x, top: b.y };
}

/** Glide to an element, pause like a person, click. */
export async function click(page: Page, loc: Locator, ms = 700): Promise<void> {
  const c = await centre(loc.first());
  await glide(page, c.x, c.y, ms);
  await sleep(180);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
  await sleep(160);
}

export async function hover(page: Page, loc: Locator, ms = 700): Promise<void> {
  const c = await centre(loc.first());
  await glide(page, c.x, c.y, ms);
}

/** Type at a readable pace into whatever has focus. */
export async function type(page: Page, text: string, delay = 70): Promise<void> {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(delay + Math.random() * 35);
  }
}

/** Spotlight an element with a ring for `ms`. */
export async function ring(page: Page, loc: Locator, ms = 2000, pad = 8): Promise<void> {
  const c = await centre(loc.first());
  await page.evaluate(([x, y, w, h]) => (window as unknown as { __demo: { ring(...a: number[]): void } }).__demo.ring(x as number, y as number, w as number, h as number), [c.left - pad, c.top - pad, c.w + pad * 2, c.h + pad * 2] as number[]);
  await sleep(ms);
  await page.evaluate(() => (window as unknown as { __demo: { unring(): void } }).__demo.unring());
  await sleep(300);
}

/** Zoom the page into an element for `ms`, then back. */
export async function zoomTo(page: Page, loc: Locator, scale = 1.5, ms = 2400): Promise<void> {
  const c = await centre(loc.first());
  await page.evaluate(([x, y, s]) => (window as unknown as { __demo: { zoom(...a: number[]): void } }).__demo.zoom(x as number, y as number, s as number), [c.x, c.y, scale] as number[]);
  await sleep(ms + 900);
  await page.evaluate(() => (window as unknown as { __demo: { unzoom(): void } }).__demo.unzoom());
  await sleep(1000);
}

/** Show or hide the fake cursor (hidden while the camera is driven by the keyboard). */
export async function cursor(page: Page, on: boolean): Promise<void> {
  if (on) hidden.delete(page);
  else hidden.add(page);
  await page.evaluate((v) => (window as unknown as { __demo: { cursor(v: boolean): void } }).__demo.cursor(v), on);
}

/** Hold a key for `ms`. */
export async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
}

/** Show a source photograph as an inset card with its credit line; `hidePhoto` removes it. */
export async function showPhoto(page: Page, dataUrl: string, credit: string): Promise<void> {
  await page.evaluate(([src, label]) => {
    const d = document.createElement('div');
    d.id = '__photo';
    d.style.cssText = 'position:fixed;right:24px;top:70px;z-index:2147483640;width:360px;background:#fff;border-radius:12px;padding:8px 8px 6px;box-shadow:0 10px 40px rgba(0,0,0,.45);font:600 13px Inter,system-ui,sans-serif;color:#222;opacity:0;transition:opacity .4s';
    d.innerHTML = '<img style="display:block;width:100%;border-radius:8px" src="' + src + '"><div style="padding:6px 2px 0">' + label + '</div>';
    document.body.appendChild(d);
    requestAnimationFrame(() => (d.style.opacity = '1'));
  }, [dataUrl, credit]);
}

export async function hidePhoto(page: Page): Promise<void> {
  await page.evaluate(() => document.getElementById('__photo')?.remove());
}

/**
 * Wait `ms` like a person reading: the pointer drifts a little so the take is never a frozen frame. While the cursor is
 * hidden (the keyboard drives the camera) it is a plain wait, so the mouse cannot turn the view.
 */
export async function dwell(page: Page, ms: number): Promise<void> {
  if (hidden.has(page) || ms < 900) return sleep(ms);
  const end = Date.now() + ms;
  const base = pos.get(page) ?? { x: 640, y: 400 };
  let k = 0;
  while (Date.now() < end - 300) {
    k++;
    const a = k * 1.7;
    await glide(page, Math.max(20, Math.min(1260, base.x + Math.cos(a) * 110)), Math.max(60, Math.min(700, base.y + Math.sin(a * 1.3) * 60)), Math.min(650, end - Date.now() - 100));
  }
  await sleep(Math.max(0, end - Date.now()));
}

/** Turn the first-person camera by `deg` degrees over `ms`, in steps of the game's own input; returns the final yaw. */
export async function turn(page: Page, deg: number, ms: number): Promise<number> {
  const steps = Math.max(4, Math.round(ms / 100));
  let yaw = 0;
  for (let i = 0; i < steps; i++) {
    yaw = await page.evaluate((d) => {
      const input = (window as unknown as { __aether: { simulation: { input: { turnBy(d: number): void; yawDeg: number } } } }).__aether.simulation.input;
      input.turnBy(d);
      return input.yawDeg;
    }, deg / steps);
    await sleep(ms / steps);
  }
  return yaw;
}
