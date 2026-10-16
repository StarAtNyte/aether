// 3x5 digits, one row per string character group (MSB left).
const DIGITS = {
    '0': [0b111, 0b101, 0b101, 0b101, 0b111],
    '1': [0b010, 0b110, 0b010, 0b010, 0b111],
    '2': [0b111, 0b001, 0b111, 0b100, 0b111],
    '3': [0b111, 0b001, 0b111, 0b001, 0b111],
    '4': [0b101, 0b101, 0b111, 0b001, 0b001],
    '5': [0b111, 0b100, 0b111, 0b001, 0b111],
    '6': [0b111, 0b100, 0b111, 0b101, 0b111],
    '7': [0b111, 0b001, 0b010, 0b010, 0b010],
    '8': [0b111, 0b101, 0b111, 0b101, 0b111],
    '9': [0b111, 0b101, 0b111, 0b001, 0b111],
};
/** Most marks drawn on one image. */
export const MAX_RGBA_MARKS = 40;
function hueToRgb(hue) {
    const h = (((hue % 360) + 360) % 360) / 60;
    const c = 0.82;
    const x = c * (1 - Math.abs((h % 2) - 1));
    const m = 0.12;
    const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function rect(px, w, h, x0, y0, x1, y1, rgb) {
    const ax = Math.max(0, Math.floor(x0));
    const ay = Math.max(0, Math.floor(y0));
    const bx = Math.min(w, Math.ceil(x1));
    const by = Math.min(h, Math.ceil(y1));
    for (let y = ay; y < by; y++) {
        for (let x = ax; x < bx; x++) {
            const i = (y * w + x) * 4;
            px[i] = rgb[0];
            px[i + 1] = rgb[1];
            px[i + 2] = rgb[2];
            px[i + 3] = 255;
        }
    }
}
function outline(px, w, h, x, y, bw, bh, t, rgb) {
    rect(px, w, h, x, y, x + bw, y + t, rgb);
    rect(px, w, h, x, y + bh - t, x + bw, y + bh, rgb);
    rect(px, w, h, x, y, x + t, y + bh, rgb);
    rect(px, w, h, x + bw - t, y, x + bw, y + bh, rgb);
}
/** Draw the marks into `rgba` (width×height, modified in place). Hostile values are ignored. */
export function drawMarksRgba(rgba, width, height, marks) {
    if (!(width > 0 && height > 0) || rgba.length < width * height * 4)
        return;
    const scale = Math.max(2, Math.round(Math.min(width, height) / 150));
    const line = Math.max(1, Math.round(scale / 2));
    const kept = marks
        .filter((m) => [m.n, m.x, m.y, m.w, m.h].every(Number.isFinite) && m.n > 0 && m.n < 1000)
        .sort((a, b) => b.w * b.h - a.w * a.h)
        .slice(0, MAX_RGBA_MARKS)
        .sort((a, b) => a.n - b.n);
    const taken = [];
    for (const m of kept) {
        const color = hueToRgb(m.n * 47);
        const x = Math.max(0, (m.x - m.w) * width);
        const y = Math.max(0, (m.y - m.h) * height);
        const bw = Math.min(width - x, m.w * 2 * width);
        const bh = Math.min(height - y, m.h * 2 * height);
        outline(rgba, width, height, x, y, bw, bh, line, color);
        const text = String(Math.floor(m.n));
        const badgeW = (text.length * 4 + 1) * scale + scale;
        const badgeH = 7 * scale;
        let bx = Math.min(Math.max(0, x), width - badgeW);
        let by = Math.min(Math.max(0, y), height - badgeH);
        for (let tries = 0; tries < 8 && taken.some((t) => bx < t[0] + t[2] && bx + badgeW > t[0] && by < t[1] + t[3] && by + badgeH > t[1]); tries++) {
            bx = Math.min(width - badgeW, bx + badgeW);
            if (tries % 2 === 1)
                by = Math.min(height - badgeH, by + badgeH);
        }
        taken.push([bx, by, badgeW, badgeH]);
        rect(rgba, width, height, bx, by, bx + badgeW, by + badgeH, [Math.round(color[0] * 0.55), Math.round(color[1] * 0.55), Math.round(color[2] * 0.55)]);
        outline(rgba, width, height, bx, by, badgeW, badgeH, 1, [255, 255, 255]);
        for (let d = 0; d < text.length; d++) {
            const rows = DIGITS[text[d]];
            if (!rows)
                continue;
            for (let r = 0; r < 5; r++) {
                for (let c = 0; c < 3; c++) {
                    if ((rows[r] >> (2 - c)) & 1)
                        rect(rgba, width, height, bx + scale + (d * 4 + c) * scale, by + scale + r * scale, bx + scale + (d * 4 + c + 1) * scale, by + scale + (r + 1) * scale, [255, 255, 255]);
                }
            }
        }
    }
}
