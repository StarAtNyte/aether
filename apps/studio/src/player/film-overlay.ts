/**
 * The story's overlay drawn into the exported film's frames: what the player shows over the canvas as DOM during the
 * live film (`StoryView` and `.pl-story__*` in player.css), painted with a 2D context at the frame's size: the cinema
 * bars, the title card, the caption lines, the end card (its title and lines; the buttons are the player's, not the
 * film's) and, over all of it as in the page, the fade. The CSS entrance animations (an opacity ramp, `ease`) run on
 * the film clock, so the overlay is deterministic too.
 */
import type { Story } from '@aether/core';
import { letterboxBar } from './film-schedule';
import type { StoryFrame } from './story';

const FALLBACK_FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** CSS `ease` (cubic-bezier(0.25, 0.1, 0.25, 1)) at `x` in 0..1. */
export function cssEase(x: number): number {
  const u = Math.max(0, Math.min(1, x));
  if (u === 0 || u === 1) return u;
  // Solve the bezier's x(s) = u by Newton steps, then return y(s).
  const bx = (s: number): number => 3 * (1 - s) * (1 - s) * s * 0.25 + 3 * (1 - s) * s * s * 0.25 + s * s * s;
  const by = (s: number): number => 3 * (1 - s) * (1 - s) * s * 0.1 + 3 * (1 - s) * s * s + s * s * s;
  let s = u;
  for (let i = 0; i < 8; i++) {
    const d = (bx(s + 1e-4) - bx(s - 1e-4)) / 2e-4;
    if (Math.abs(d) < 1e-6) break;
    s = Math.max(0, Math.min(1, s - (bx(s) - u) / d));
  }
  return by(s);
}

const clamp = (lo: number, v: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** The overlay's state over the film (what shows and since when, for the entrance animations). */
export class FilmOverlay {
  private title: { key: string; text: string; sub: string | null; since: number } | null = null;
  private caption: { key: string; text: string; since: number } | null = null;
  private endSince: number | null = null;
  private fade: StoryFrame['fade'] = { color: 'black', alpha: 0 };
  private readonly font: string;
  private readonly display: string;

  constructor(
    private readonly story: Story,
    private readonly worldTitle: string,
  ) {
    const css = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    this.font = css?.getPropertyValue('--font').trim() || FALLBACK_FONT;
    this.display = css?.getPropertyValue('--font-display').trim() || this.font;
  }

  /** Take the story's frame at film time `t` (seconds). */
  update(frame: StoryFrame, t: number): void {
    this.fade = frame.fade;
    if (frame.done) {
      this.title = null;
      this.caption = null;
      this.endSince ??= t;
      return;
    }
    this.endSince = null;
    if (frame.title) {
      const key = `t${frame.index}`;
      if (this.title?.key !== key) this.title = { key, text: frame.title, sub: frame.subtitle, since: t };
    } else this.title = null;
    if (frame.caption) {
      const key = `c${frame.index}${frame.caption}`;
      if (this.caption?.key !== key) this.caption = { key, text: frame.caption, since: t };
    } else this.caption = null;
  }

  /** Paint the overlay over the frame already in `ctx` (`w`×`h` pixels) at film time `t`. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const vw = w / 100;
    const vh = h / 100;
    const bar = letterboxBar(w, h, this.story.letterbox);
    ctx.save();
    if (bar > 0.5) {
      ctx.fillStyle = '#050404';
      ctx.fillRect(0, 0, w, Math.round(bar));
      ctx.fillRect(0, h - Math.round(bar), w, Math.round(bar));
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if (this.title) this.drawTitle(ctx, w, h, vw, vh, bar, cssEase((t - this.title.since) / 1.6));
    if (this.caption) this.drawCaption(ctx, w, h, vw, bar, cssEase((t - this.caption.since) / 0.5));
    if (this.endSince !== null) this.drawEnd(ctx, w, h, vw, cssEase((t - this.endSince) / 1.2));
    if (this.fade.alpha > 0.0005) {
      ctx.globalAlpha = Math.min(1, this.fade.alpha);
      ctx.fillStyle = this.fade.color === 'white' ? '#fff8ec' : '#000';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  private spaced(ctx: CanvasRenderingContext2D, px: number, em: number): void {
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${(px * em).toFixed(2)}px`;
  }

  private shadowed(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, shadows: ReadonlyArray<readonly [number, number, string]>): void {
    // Each CSS text-shadow is a pass of the glyphs with that shadow; the glyphs themselves once on top.
    for (const [dy, blur, c] of shadows) {
      ctx.shadowColor = c;
      ctx.shadowOffsetY = dy;
      ctx.shadowBlur = blur;
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    }
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  private drawTitle(ctx: CanvasRenderingContext2D, w: number, h: number, vw: number, vh: number, bar: number, alpha: number): void {
    const t = this.title!;
    const h1 = clamp(30, 5.2 * vw, 62);
    const p = clamp(13, 1.4 * vw, 17);
    const pad = 4 * vh;
    const subH = t.sub ? 14 + p * 1.5 : 0;
    const boxH = pad * 2 + h1 * 1.05 + subH;
    const bottom = h - bar - 9 * vh;
    const top = bottom - boxH;
    ctx.globalAlpha = alpha;
    // The soft dark band behind thin title type (radial-gradient(ellipse 46% 60%, rgb(24 14 34 / 0.32), transparent 72%)).
    const cx = w / 2;
    const cy = top + boxH / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(0.46 * w, 0.6 * boxH);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(24,14,34,0.32)');
    g.addColorStop(0.72, 'rgba(24,14,34,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-w / (0.46 * w), -1 / 0.6, 2 / 0.46, 2 / 0.6);
    ctx.restore();
    ctx.font = `400 ${h1}px ${this.display}`;
    this.spaced(ctx, h1, 0.2);
    const base = top + pad + h1 * 0.025 + h1 * 0.8;
    this.shadowed(ctx, t.text.toUpperCase(), cx + h1 * 0.1, base, '#fff6e8', [[0, 1, 'rgba(30,16,40,0.6)'], [2, 24, 'rgba(30,16,40,0.6)']]);
    if (t.sub) {
      ctx.font = `400 ${p}px ${this.font}`;
      this.spaced(ctx, p, 0.32);
      this.shadowed(ctx, t.sub.toUpperCase(), cx + p * 0.16, top + pad + h1 * 1.05 + 14 + p * 1.1, 'rgba(255,240,222,0.85)', [[1, 14, 'rgba(40,20,50,0.6)']]);
    }
    this.spaced(ctx, 0, 0);
    ctx.globalAlpha = 1;
  }

  private drawCaption(ctx: CanvasRenderingContext2D, w: number, h: number, vw: number, bar: number, alpha: number): void {
    const size = clamp(17, 1.9 * vw, 25);
    ctx.font = `500 ${size}px ${this.font}`;
    this.spaced(ctx, size, 0.01);
    const maxW = Math.min(86 * vw, 64 * ctx.measureText('0').width);
    const lines = wrap(this.caption!.text, maxW, (s) => ctx.measureText(s).width);
    const lh = size * 1.4;
    ctx.globalAlpha = alpha;
    const bottom = h - bar - 22;
    lines.forEach((line, i) => {
      const y = bottom - (lines.length - 1 - i) * lh - (lh - size) / 2 - size * 0.22;
      this.shadowed(ctx, line, w / 2, y, '#fffaf2', [[0, 2, 'rgba(20,12,24,0.9)'], [1, 10, 'rgba(20,12,24,0.75)']]);
    });
    this.spaced(ctx, 0, 0);
    ctx.globalAlpha = 1;
  }

  private drawEnd(ctx: CanvasRenderingContext2D, w: number, h: number, vw: number, alpha: number): void {
    const end = this.story.endCard;
    const title = end?.title ?? this.story.title ?? this.worldTitle;
    const lines = end?.lines ?? [];
    ctx.globalAlpha = alpha;
    // The scrim over the living scene (radial-gradient(ellipse 60% 45%, rgb(14 10 28 / 0.5), transparent)).
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(0.6 * w, 0.45 * h);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(14,10,28,0.5)');
    g.addColorStop(1, 'rgba(14,10,28,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-1 / 0.6, -1 / 0.45, 2 / 0.6, 2 / 0.45);
    ctx.restore();
    const h2 = clamp(28, 4.6 * vw, 56);
    const p = 15;
    const block = h2 * 1.1 + 6 + lines.length * (10 + p * 1.5);
    let y = h / 2 - block / 2;
    ctx.font = `300 ${h2}px ${this.display}`;
    this.spaced(ctx, h2, 0.16);
    ctx.fillStyle = '#f3f1ec';
    ctx.fillText(title.toUpperCase(), w / 2 + h2 * 0.08, y + h2 * 0.05 + h2 * 0.8);
    y += h2 * 1.1 + 6;
    ctx.font = `400 ${p}px ${this.font}`;
    this.spaced(ctx, 0, 0);
    ctx.fillStyle = '#c8c5be';
    for (const l of lines) {
      y += 10;
      ctx.fillText(l, w / 2, y + p * 1.1);
      y += p * 1.5;
    }
    ctx.globalAlpha = 1;
  }
}

/** Greedy word wrap of `text` into lines no wider than `max` (by `measure`). */
export function wrap(text: string, max: number, measure: (s: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
