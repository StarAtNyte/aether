/**
 * The screen layer of the game feel: the flash and vignette pulses the
 * renderer's feel director computes, and floating score / damage text that
 * rises from where something happened. Plain DOM over the canvas (it works
 * the same on every backend and quality tier, and it never lands in stills
 * or thumbnails, which render the scene alone).
 *
 * Allocation-free per frame: a fixed pool of text nodes, styles written only
 * when a value changed.
 */
import { Vector3, type PerspectiveCamera } from 'three';
import type { FeelPulse } from '@aether/render';

/** Most floating texts at once (older ones are reused). */
export const MAX_FLOATING_TEXT = 12;
/** How long a floating text lives (s) and how far it rises (CSS px). */
const TEXT_LIFE = 0.95;
const TEXT_RISE = 46;

interface FloatText {
  el: HTMLDivElement;
  age: number;
  x: number;
  y: number;
  z: number;
  live: boolean;
  text: string;
  shown: string;
}

const scratch = new Vector3();

/** Owns the overlay elements of one viewport. */
export class FeelOverlay {
  private readonly root: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private readonly texts: FloatText[] = [];
  private next = 0;
  private lastFlash = '';
  private lastVignette = '';
  private reduce = false;

  constructor(parent: HTMLElement) {
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'feel-overlay';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.dataset['testid'] = 'feel-overlay';
    const base = 'position:absolute;inset:0;pointer-events:none;';
    this.root.style.cssText = `${base}overflow:hidden;z-index:3;`;
    this.flash = doc.createElement('div');
    this.flash.style.cssText = `${base}opacity:0;`;
    this.vignette = doc.createElement('div');
    this.vignette.style.cssText = `${base}opacity:0;`;
    this.root.append(this.vignette, this.flash);
    for (let i = 0; i < MAX_FLOATING_TEXT; i++) {
      const el = doc.createElement('div');
      el.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;font:700 20px/1 var(--font-sans, system-ui, sans-serif);letter-spacing:0.02em;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,0.55),0 0 10px rgba(0,0,0,0.25);will-change:transform,opacity;opacity:0;';
      this.root.append(el);
      this.texts.push({ el, age: 0, x: 0, y: 0, z: 0, live: false, text: '', shown: '' });
    }
    if (getComputedStyleSafe(parent) === 'static') parent.style.position = 'relative';
    parent.append(this.root);
  }

  /** Reduce motion: texts fade in place instead of rising. */
  setReducedMotion(on: boolean): void {
    this.reduce = on;
  }

  /** Show `text` rising from a world position (`color` CSS). */
  text(text: string, at: readonly [number, number, number], color: string): void {
    const t = this.texts[this.next] as FloatText;
    this.next = (this.next + 1) % this.texts.length;
    t.age = 0;
    t.x = at[0];
    t.y = at[1] + 1.1;
    t.z = at[2];
    t.live = true;
    t.text = text;
    if (t.el.style.color !== color) t.el.style.color = color;
  }

  /** Floating texts on screen (tests). */
  get liveTexts(): number {
    let n = 0;
    for (const t of this.texts) if (t.live) n++;
    return n;
  }

  /** Draw one frame. */
  frame(dt: number, pulse: FeelPulse | null, camera: PerspectiveCamera, width: number, height: number): void {
    const flash = pulse && pulse.flash > 0.003 ? `rgb(${Math.round(pulse.r * 255)},${Math.round(pulse.g * 255)},${Math.round(pulse.b * 255)})|${Math.min(0.85, pulse.flash * 0.75).toFixed(3)}` : '';
    if (flash !== this.lastFlash) {
      this.lastFlash = flash;
      if (flash) {
        const [color, alpha] = flash.split('|') as [string, string];
        this.flash.style.background = color;
        this.flash.style.opacity = alpha;
      } else this.flash.style.opacity = '0';
    }
    const vig = pulse && pulse.vignette > 0.003 ? `${Math.round(pulse.vr * 255)},${Math.round(pulse.vg * 255)},${Math.round(pulse.vb * 255)}|${Math.min(1, pulse.vignette).toFixed(3)}` : '';
    if (vig !== this.lastVignette) {
      this.lastVignette = vig;
      if (vig) {
        const [rgb, alpha] = vig.split('|') as [string, string];
        this.vignette.style.background = `radial-gradient(ellipse at center, rgba(${rgb},0) 45%, rgba(${rgb},0.55) 78%, rgba(${rgb},0.9) 100%)`;
        this.vignette.style.opacity = alpha;
      } else this.vignette.style.opacity = '0';
    }
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    for (const t of this.texts) {
      if (!t.live) continue;
      t.age += step;
      if (t.age >= TEXT_LIFE) {
        t.live = false;
        t.el.style.opacity = '0';
        continue;
      }
      scratch.set(t.x, t.y, t.z).project(camera);
      if (scratch.z > 1 || scratch.z < -1) {
        t.el.style.opacity = '0';
        continue;
      }
      const k = t.age / TEXT_LIFE;
      const sx = (scratch.x * 0.5 + 0.5) * width;
      const sy = (-scratch.y * 0.5 + 0.5) * height - (this.reduce ? 0 : TEXT_RISE * (1 - (1 - k) * (1 - k)));
      // Pop in (1.35× → 1), then fade over the last 40 %.
      const pop = this.reduce ? 1 : 1 + 0.35 * Math.max(0, 1 - k * 6);
      const alpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      if (t.shown !== t.text) {
        t.el.textContent = t.text;
        t.shown = t.text;
      }
      t.el.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-50%) scale(${pop.toFixed(3)})`;
      t.el.style.opacity = alpha.toFixed(3);
    }
  }

  /** Clear everything on screen (session end). */
  clear(): void {
    for (const t of this.texts) {
      t.live = false;
      t.el.style.opacity = '0';
    }
    this.flash.style.opacity = '0';
    this.vignette.style.opacity = '0';
    this.lastFlash = '';
    this.lastVignette = '';
  }

  dispose(): void {
    this.root.remove();
  }
}

function getComputedStyleSafe(el: HTMLElement): string {
  try {
    return el.ownerDocument.defaultView?.getComputedStyle(el).position ?? 'static';
  } catch {
    return 'static';
  }
}
