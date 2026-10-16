import { areaLabel, roomColors } from '../lib/planView';
const INK = '#1f2328';
const WALL = '#2b2f36';
const MUTED = '#6b7079';
const ACCENT = '#4f56d6';
/** Clean a label for drawing (control and bidi characters removed, length capped). */
export function planText(text, max = 80) {
    // eslint-disable-next-line no-control-regex
    return String(text ?? '').replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
/** Build the drawing of one storey. */
export function planDrawing(plan, opts) {
    const [bx0, bz0, bx1, bz1] = plan.bounds;
    const w = Math.max(1, bx1 - bx0);
    const h = Math.max(1, bz1 - bz0);
    const unit = Math.max(w, h) / 40; // text and symbol scale (≈ 1/40 of the plan)
    const items = [];
    for (const room of plan.rooms) {
        const [fill] = roomColors(room.kind);
        items.push({ k: 'poly', pts: room.polygon, fill, closed: true });
    }
    for (const item of plan.items)
        items.push({ k: 'poly', pts: item.polygon, stroke: MUTED, width: unit * 0.04, closed: true });
    for (const stair of plan.stairs) {
        items.push({ k: 'poly', pts: stair.outline, fill: '#ffffff', stroke: INK, width: unit * 0.05, closed: true });
        for (const [a, b] of stair.treads)
            items.push({ k: 'poly', pts: [a, b], stroke: MUTED, width: unit * 0.035, closed: false });
        items.push({ k: 'poly', pts: [stair.arrow[0], stair.arrow[1]], stroke: INK, width: unit * 0.05, closed: false });
    }
    for (const wall of plan.walls)
        for (const piece of wall.pieces)
            items.push({ k: 'poly', pts: piece, fill: WALL, closed: true });
    for (const win of plan.windows) {
        const dx = win.b[0] - win.a[0];
        const dz = win.b[1] - win.a[1];
        const len = Math.hypot(dx, dz) || 1;
        const nx = (-dz / len) * win.thickness * 0.5;
        const nz = (dx / len) * win.thickness * 0.5;
        items.push({ k: 'poly', pts: [[win.a[0] + nx, win.a[1] + nz], [win.b[0] + nx, win.b[1] + nz], [win.b[0] - nx, win.b[1] - nz], [win.a[0] - nx, win.a[1] - nz]], fill: '#ffffff', stroke: INK, width: unit * 0.04, closed: true });
        items.push({ k: 'poly', pts: [win.a, win.b], stroke: ACCENT, width: unit * 0.05, closed: false });
    }
    for (const door of plan.doors) {
        if (door.kind === 'swing' && door.hinge && door.open && door.closed) {
            items.push({ k: 'poly', pts: [door.hinge, door.open], stroke: INK, width: unit * 0.06, closed: false });
            const r = Math.hypot(door.closed[0] - door.hinge[0], door.closed[1] - door.hinge[1]);
            items.push({ k: 'arc', c: door.hinge, r, a0: Math.atan2(door.open[1] - door.hinge[1], door.open[0] - door.hinge[0]), a1: Math.atan2(door.closed[1] - door.hinge[1], door.closed[0] - door.hinge[0]), stroke: MUTED, width: unit * 0.035 });
        }
        else {
            items.push({ k: 'poly', pts: [door.a, door.b], stroke: INK, width: unit * 0.05, closed: false, dash: [unit * 0.15, unit * 0.1] });
        }
    }
    for (const room of plan.rooms) {
        const name = planText(room.name, 40);
        items.push({ k: 'text', at: [room.label[0], room.label[1] - unit * 0.25], text: name, size: unit * 0.55, bold: true, color: INK, anchor: 'middle' });
        items.push({ k: 'text', at: [room.label[0], room.label[1] + unit * 0.5], text: areaLabel(room.area), size: unit * 0.42, color: MUTED, anchor: 'middle' });
    }
    for (const dim of plan.dimensions) {
        const off = unit * 0.9;
        const a = [dim.a[0] + dim.normal[0] * off, dim.a[1] + dim.normal[1] * off];
        const b = [dim.b[0] + dim.normal[0] * off, dim.b[1] + dim.normal[1] * off];
        items.push({ k: 'poly', pts: [a, b], stroke: INK, width: unit * 0.03, closed: false });
        for (const p of [a, b]) {
            items.push({ k: 'poly', pts: [[p[0] - dim.normal[0] * unit * 0.3, p[1] - dim.normal[1] * unit * 0.3], [p[0] + dim.normal[0] * unit * 0.3, p[1] + dim.normal[1] * unit * 0.3]], stroke: INK, width: unit * 0.03, closed: false });
        }
        items.push({ k: 'text', at: [(a[0] + b[0]) / 2 + dim.normal[0] * unit * 0.45, (a[1] + b[1]) / 2 + dim.normal[1] * unit * 0.45], text: planText(dim.label, 24), size: unit * 0.4, color: INK, anchor: 'middle' });
    }
    // Sheet: the plan with room for dimensions, plus a title block below.
    const pad = unit * 3;
    const sx0 = bx0 - pad;
    const sz0 = bz0 - pad;
    const sx1 = bx1 + pad;
    const block = unit * 3.2;
    const sz1 = bz1 + pad + block;
    const ty = bz1 + pad + unit * 1.1;
    const title = planText(opts.title, 80) || 'Floor plan';
    items.push({ k: 'poly', pts: [[sx0 + unit, ty - unit * 1.1], [sx1 - unit, ty - unit * 1.1]], stroke: '#c9ccd2', width: unit * 0.03, closed: false });
    items.push({ k: 'text', at: [sx0 + unit, ty + unit * 0.2], text: title, size: unit * 0.75, bold: true, color: INK, anchor: 'start' });
    const sub = planText(opts.subtitle ?? `${plan.levelName} · ${areaLabel(plan.rooms.reduce((s, r) => s + r.area, 0))}`, 100);
    items.push({ k: 'text', at: [sx0 + unit, ty + unit * 1.25], text: sub, size: unit * 0.45, color: MUTED, anchor: 'start' });
    // Scale bar: 5 m (or 1 m for small plans) in alternating blocks.
    const barLen = Math.max(w, h) > 12 ? 5 : 1;
    const bx = sx1 - unit - barLen;
    const by = ty;
    for (let i = 0; i < 5; i++) {
        const seg = barLen / 5;
        items.push({ k: 'poly', pts: [[bx + i * seg, by], [bx + (i + 1) * seg, by], [bx + (i + 1) * seg, by + unit * 0.25], [bx + i * seg, by + unit * 0.25]], fill: i % 2 === 0 ? INK : '#ffffff', stroke: INK, width: unit * 0.02, closed: true });
    }
    items.push({ k: 'text', at: [bx, by + unit * 0.9], text: '0', size: unit * 0.38, color: MUTED, anchor: 'middle' });
    items.push({ k: 'text', at: [bx + barLen, by + unit * 0.9], text: `${barLen} m`, size: unit * 0.38, color: MUTED, anchor: 'middle' });
    // North arrow (plan north is −z).
    const nx = bx - unit * 1.6;
    const nz = by + unit * 0.2;
    items.push({ k: 'poly', pts: [[nx, nz - unit * 0.6], [nx + unit * 0.3, nz + unit * 0.35], [nx, nz + unit * 0.15], [nx - unit * 0.3, nz + unit * 0.35]], fill: INK, closed: true });
    items.push({ k: 'text', at: [nx, nz + unit * 1.05], text: 'N', size: unit * 0.4, bold: true, color: INK, anchor: 'middle' });
    return { sheet: [sx0, sz0, sx1, sz1], items, title };
}
/** Escape text for XML content and attributes. */
export function escapeXml(text) {
    return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function n(v) {
    return String(Math.round(v * 1000) / 1000);
}
/** A standalone SVG document of the drawing at a print scale (1:`scale`, default 1:50). */
export function planSvg(d, scale = 50) {
    const [x0, z0, x1, z1] = d.sheet;
    const wm = x1 - x0;
    const hm = z1 - z0;
    const mmPerM = 1000 / Math.max(1, scale);
    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${n(wm * mmPerM)}mm" height="${n(hm * mmPerM)}mm" viewBox="${n(x0)} ${n(z0)} ${n(wm)} ${n(hm)}" font-family="Inter, Helvetica, Arial, sans-serif">`);
    out.push(`<title>${escapeXml(d.title)}</title>`);
    out.push(`<rect x="${n(x0)}" y="${n(z0)}" width="${n(wm)}" height="${n(hm)}" fill="#ffffff"/>`);
    for (const p of d.items) {
        if (p.k === 'poly') {
            const pts = p.pts.map((q) => `${n(q[0])},${n(q[1])}`).join(' ');
            const attrs = `fill="${p.fill ?? 'none'}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${n(p.width ?? 0.02)}" stroke-linejoin="round" stroke-linecap="round"` : ''}${p.dash ? ` stroke-dasharray="${p.dash.map(n).join(' ')}"` : ''}`;
            out.push(p.closed ? `<polygon points="${pts}" ${attrs}/>` : `<polyline points="${pts}" ${attrs}/>`);
        }
        else if (p.k === 'arc') {
            const sx = p.c[0] + Math.cos(p.a0) * p.r;
            const sz = p.c[1] + Math.sin(p.a0) * p.r;
            const ex = p.c[0] + Math.cos(p.a1) * p.r;
            const ez = p.c[1] + Math.sin(p.a1) * p.r;
            let delta = p.a1 - p.a0;
            while (delta > Math.PI)
                delta -= Math.PI * 2;
            while (delta < -Math.PI)
                delta += Math.PI * 2;
            out.push(`<path d="M${n(sx)} ${n(sz)} A${n(p.r)} ${n(p.r)} 0 0 ${delta > 0 ? 1 : 0} ${n(ex)} ${n(ez)}" fill="none" stroke="${p.stroke}" stroke-width="${n(p.width)}" stroke-dasharray="${n(p.width * 4)} ${n(p.width * 3)}"/>`);
        }
        else {
            out.push(`<text x="${n(p.at[0])}" y="${n(p.at[1])}" font-size="${n(p.size)}"${p.bold ? ' font-weight="600"' : ''} fill="${p.color}" text-anchor="${p.anchor}" dominant-baseline="middle">${escapeXml(p.text)}</text>`);
        }
    }
    out.push('</svg>');
    return out.join('\n');
}
