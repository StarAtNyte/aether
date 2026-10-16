/**
 * Title cards and finishing touches drawn over exported video frames: an
 * opening title (fade in, hold, fade out), an end card, cinematic
 * letterbox bars and fades from / to black. Text is drawn with
 * `fillText` on a 2D canvas (never HTML). Timing is pure and tested.
 */
/** Defaults: a title from the world's name, no end card, fades on. */
export function defaultTitles(name) {
    return { title: name.slice(0, 80), subtitle: '', endText: '', letterbox: false, fades: true };
}
function ramp(t, a, b) {
    if (b <= a)
        return t >= b ? 1 : 0;
    return Math.min(1, Math.max(0, (t - a) / (b - a)));
}
/** Overlay opacities (pure). */
export function overlayAt(t, duration, spec) {
    const d = Math.max(0.1, duration);
    // The opening title takes at most 45 % of a short clip.
    const win = Math.min(4.2, d * 0.45);
    const fadeIn = win * 0.2;
    const fadeOut = win * 0.2;
    const title = spec.title.trim() === '' ? 0 : t < win ? Math.min(ramp(t, win * 0.08, win * 0.08 + fadeIn), 1 - ramp(t, win - fadeOut, win)) : 0;
    const endWin = Math.min(2.8, d * 0.35);
    const end = spec.endText.trim() === '' || d < 3 ? 0 : ramp(t, d - endWin, d - endWin + endWin * 0.3);
    const fade = Math.min(0.6, d * 0.1);
    const black = spec.fades ? Math.max(1 - ramp(t, 0, fade), ramp(t, d - fade, d)) : 0;
    return { title, end, black };
}
/** Height of each letterbox bar for a frame (0 when the frame is already wider than 2.39:1). */
export function letterboxBar(width, height) {
    return Math.max(0, Math.round((height - width / 2.39) / 2));
}
function fitText(ctx, text, weight, size, maxWidth) {
    let s = size;
    for (let i = 0; i < 6; i++) {
        ctx.font = `${weight} ${s}px Inter, "Segoe UI", system-ui, sans-serif`;
        if (ctx.measureText(text).width <= maxWidth)
            break;
        s *= 0.85;
    }
    return s;
}
const scrims = new WeakMap();
/** Draw the overlay for time `t` onto a frame already on `ctx` (`w`×`h`). */
export function drawOverlay(ctx, w, h, t, duration, spec) {
    const o = overlayAt(t, duration, spec);
    ctx.save();
    if (spec.letterbox) {
        const bar = letterboxBar(w, h);
        if (bar > 0) {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, w, bar);
            ctx.fillRect(0, h - bar, w, bar);
        }
    }
    const text = (label, sub, alpha) => {
        if (alpha <= 0.001)
            return;
        ctx.globalAlpha = alpha;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // A soft scrim keeps text legible over bright skies (one gradient per canvas size).
        let grad = scrims.get(ctx);
        if (!grad || grad.h !== h) {
            const g = ctx.createLinearGradient(0, h * 0.35, 0, h * 0.75);
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(0.5, 'rgba(0,0,0,0.28)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            grad = { h, g };
            scrims.set(ctx, grad);
        }
        ctx.fillStyle = grad.g;
        ctx.fillRect(0, h * 0.35, w, h * 0.4);
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = h * 0.02;
        ctx.fillStyle = '#ffffff';
        const size = fitText(ctx, label, 650, Math.round(h * 0.075), w * 0.86);
        const y = sub ? h * 0.52 : h * 0.55;
        ctx.fillText(label, w / 2, y);
        if (sub) {
            ctx.fillStyle = 'rgba(255,255,255,0.86)';
            fitText(ctx, sub, 450, Math.round(Math.min(size * 0.42, h * 0.034)), w * 0.8);
            ctx.fillText(sub, w / 2, y + size * 0.85);
        }
    };
    text(spec.title.trim(), spec.subtitle.trim(), o.title);
    text(spec.endText.trim(), '', o.end);
    if (o.black > 0.001) {
        ctx.globalAlpha = o.black;
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
}
