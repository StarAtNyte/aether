/**
 * The prompt flight: when a prompt is sent, a copy of it lifts out of the
 * composer, arcs into the middle of the viewport and dissolves into a ring
 * that widens across the world — the words go into the world. Pure DOM +
 * Web Animations (Chromium, Firefox, Safari); two short-lived nodes per
 * send, removed when their animation ends. Skipped with reduced motion or
 * when either end is not on screen. Text is set with `textContent` only.
 */

/** Flight duration in ms. */
export const FLIGHT_MS = 620;
/** Longest prompt text shown in the flying pill. */
const MAX_FLIGHT_CHARS = 80;

/** Arc keyframes from rect `a`'s centre to rect `b`'s centre (translate in px). Pure. */
export function flightPath(a: { left: number; top: number; width: number; height: number }, b: { left: number; top: number; width: number; height: number }, pill: { width: number; height: number }): Array<{ x: number; y: number; scale: number; opacity: number }> {
  const x0 = a.left + a.width / 2 - pill.width / 2;
  const y0 = a.top + a.height / 2 - pill.height / 2;
  const x1 = b.left + b.width / 2 - pill.width / 2;
  const y1 = b.top + b.height / 2 - pill.height / 2;
  // Lift: the midpoint rises above the straight line (a throw, not a slide).
  const lift = Math.min(160, Math.hypot(x1 - x0, y1 - y0) * 0.25);
  return [
    { x: x0, y: y0, scale: 1, opacity: 1 },
    { x: (x0 + x1) / 2, y: Math.min(y0, y1) - lift, scale: 0.85, opacity: 1 },
    { x: x1, y: y1, scale: 0.35, opacity: 0 },
  ];
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

function visible(r: DOMRect): boolean {
  return r.width > 8 && r.height > 8 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
}

/** Fly `text` from `from` into the viewport (no-op when it cannot be shown). Never throws. */
export function launchPromptFlight(text: string, from: Element | null): void {
  try {
    if (typeof document === 'undefined' || reducedMotion()) return;
    const viewport = document.querySelector<HTMLElement>('.viewport');
    if (!from || !viewport) return;
    const a = from.getBoundingClientRect();
    const b = viewport.getBoundingClientRect();
    const ring = (): void => {
      const r = document.createElement('span');
      r.className = 'vp-ripple';
      r.setAttribute('aria-hidden', 'true');
      r.addEventListener('animationend', () => r.remove(), { once: true });
      viewport.appendChild(r);
      // Safety net if animations are disabled (no animationend).
      setTimeout(() => r.remove(), 1500);
    };
    if (!visible(b)) return;
    if (!visible(a) || typeof Element.prototype.animate !== 'function') {
      ring();
      return;
    }
    const pill = document.createElement('div');
    pill.className = 'prompt-flight';
    pill.setAttribute('aria-hidden', 'true');
    pill.textContent = text.length > MAX_FLIGHT_CHARS ? `${text.slice(0, MAX_FLIGHT_CHARS - 1)}…` : text;
    document.body.appendChild(pill);
    const size = { width: pill.offsetWidth, height: pill.offsetHeight };
    const frames = flightPath(a, b, size).map((k) => ({ transform: `translate(${k.x}px, ${k.y}px) scale(${k.scale})`, opacity: k.opacity }));
    const anim = pill.animate(frames, { duration: FLIGHT_MS, easing: 'cubic-bezier(0.3, 0, 0.2, 1)', fill: 'forwards' });
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      pill.remove();
      ring();
    };
    anim.addEventListener('finish', finish, { once: true });
    anim.addEventListener('cancel', () => pill.remove(), { once: true });
    setTimeout(finish, FLIGHT_MS + 400);
  } catch {
    /* decoration only */
  }
}
