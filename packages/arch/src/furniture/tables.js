import { Geom, box, cylinder, extrude, roundedBox } from '../mesh';
import { PartSet } from '../parts';
import { choice, color, drawerBox, emitFront, flag, leg, mat, MovableSink, num, roundedRect, squareLeg } from './kit';
const TOPS = ['oak', 'walnut', 'ash', 'marble', 'terrazzo', 'concrete', 'black-metal', 'glass'];
const BASES = ['oak', 'walnut', 'ash', 'black-metal', 'brass', 'chrome'];
/** A table top slab (rounded rectangle or round) with its top surface at `h`. */
function top(w, d, h, t, round) {
    if (round) {
        const r = Math.min(w, d) / 2;
        return cylinder(r, r, t, 48).translate(0, h - t, 0);
    }
    const outline = roundedRect(w, d, Math.min(0.02, Math.min(w, d) * 0.05), 4);
    return extrude(outline, h - t, h);
}
/** Cabinet carcass with drawer / door fronts (front faces +Z). */
function cabinet(w, h, d, y0, fronts, horizontal, body, front, pull, set, sink) {
    set.add(roundedBox(w, h, d, 0.006, 1).translate(0, y0 + h / 2, 0), body);
    const g = new Geom();
    const handles = new Geom();
    const gap = 0.004;
    for (let k = 0; k < fronts; k++) {
        if (horizontal) {
            const fh = (h - 0.02) / fronts;
            const y = y0 + 0.01 + fh * (k + 0.5);
            emitFront(sink, { front: g, handle: handles }, {
                id: `drawer-${k}`, name: 'Drawer', kind: 'drawer', center: [0, y, d / 2 + 0.009], size: [w - 0.02, fh - gap, 0.018], motion: { type: 'slide', offset: [0, 0, Math.min(0.4, d * 0.85)] },
                front: roundedBox(w - 0.02, fh - gap, 0.018, 0.003, 1).translate(0, y, d / 2 + 0.009),
                handle: roundedBox(Math.min(0.22, w * 0.4), 0.012, 0.02, 0.005, 1).translate(0, y + fh * 0.25, d / 2 + 0.028),
                body: drawerBox(0, y, w - 0.02, fh - gap, d / 2 + 0.018, d * 0.8),
                frontMaterial: front, handleMaterial: pull, bodyMaterial: body,
            });
        }
        else {
            const fw = (w - 0.02) / fronts;
            const x = -w / 2 + 0.01 + fw * (k + 0.5);
            const hx = x + (k % 2 === 0 ? 1 : -1) * (fw / 2 - 0.04);
            const hinge = k % 2 === 0 ? 'left' : 'right';
            emitFront(sink, { front: g, handle: handles }, {
                id: `door-${k}`, name: 'Cabinet door', kind: 'door', center: [x, y0 + h / 2, d / 2 + 0.009], size: [fw - gap, h - 0.02, 0.018], motion: { type: 'swing', hinge, angle: hinge === 'left' ? -105 : 105 },
                front: roundedBox(fw - gap, h - 0.02, 0.018, 0.003, 1).translate(x, y0 + h / 2, d / 2 + 0.009),
                handle: roundedBox(0.012, Math.min(0.18, h * 0.35), 0.02, 0.005, 1).translate(hx, y0 + h * 0.7, d / 2 + 0.028),
                frontMaterial: front, handleMaterial: pull,
            });
        }
    }
    set.add(g, front).add(handles, pull);
}
export const DINING_TABLE = {
    id: 'furn-table',
    kind: 'dining-table',
    description: 'Dining or meeting table (rectangular or round top, four legs / trestle / pedestal base). Top at 0.75 m.',
    params: {
        width: num(1.8, 0.6, 6, 'length along X (m)'),
        depth: num(0.9, 0.6, 1.6, 'depth along Z (m)'),
        shape: choice(['rect', 'round'], 'rect', 'top shape (round uses the smaller side as diameter)'),
        top: choice(TOPS, 'oak', 'top finish'),
        base: choice(['four', 'trestle', 'pedestal'], 'four', 'base style'),
        legs: choice(BASES, 'oak', 'base finish'),
    },
    mount: 'floor',
    againstWall: false,
    frontClearance: 0.8,
    size: (p) => (p.str('shape') === 'round' ? [Math.min(p.num('width'), p.num('depth')), 0.75, Math.min(p.num('width'), p.num('depth'))] : [p.num('width'), 0.75, p.num('depth')]),
    build(p) {
        const set = new PartSet();
        const round = p.str('shape') === 'round';
        const w = round ? Math.min(p.num('width'), p.num('depth')) : p.num('width');
        const d = round ? w : p.num('depth');
        const h = 0.75;
        const t = 0.035;
        set.add(top(w, d, h, t, round), mat(p.str('top')));
        const base = new Geom();
        const style = round ? 'pedestal' : p.str('base');
        if (style === 'pedestal') {
            base.merge(cylinder(0.07, 0.05, h - t, 24));
            base.merge(cylinder(Math.min(0.32, w * 0.3), Math.min(0.3, w * 0.28), 0.03, 32));
        }
        else if (style === 'trestle') {
            for (const s of [-1, 1]) {
                const x = s * (w / 2 - 0.25);
                base.merge(box(x - 0.03, 0.04, -d / 2 + 0.1, x + 0.03, h - t, -d / 2 + 0.16));
                base.merge(box(x - 0.03, 0.04, d / 2 - 0.16, x + 0.03, h - t, d / 2 - 0.1));
                base.merge(box(x - 0.035, 0, -d / 2 + 0.08, x + 0.035, 0.05, d / 2 - 0.08));
                base.merge(box(x - 0.035, h - t - 0.05, -d / 2 + 0.08, x + 0.035, h - t, d / 2 - 0.08));
            }
            base.merge(box(-w / 2 + 0.25, 0.3, -0.02, w / 2 - 0.25, 0.36, 0.02));
        }
        else {
            for (const sx of [-1, 1])
                for (const sz of [-1, 1])
                    base.merge(squareLeg(sx * (w / 2 - 0.08), sz * (d / 2 - 0.08), h - t, 0.05));
            base.merge(box(-w / 2 + 0.08, h - t - 0.08, -d / 2 + 0.06, w / 2 - 0.08, h - t, -d / 2 + 0.08));
            base.merge(box(-w / 2 + 0.08, h - t - 0.08, d / 2 - 0.08, w / 2 - 0.08, h - t, d / 2 - 0.06));
        }
        set.add(base, mat(p.str('legs')));
        set.boxMinMax(-w / 2, h - t, -d / 2, w / 2, h, d / 2);
        set.boxMinMax(-Math.min(w / 2, 0.4), 0, -Math.min(d / 2, 0.3), Math.min(w / 2, 0.4), h - t, Math.min(d / 2, 0.3));
        return set.build();
    },
};
export const COFFEE_TABLE = {
    id: 'furn-coffee-table',
    kind: 'coffee-table',
    description: 'Low coffee or side table (rectangular, round or oval) with a stone or wood top. Use width 0.5 for a side table.',
    params: {
        width: num(1.2, 0.4, 2, 'width (m)'),
        depth: num(0.6, 0.4, 1.2, 'depth (m)'),
        height: num(0.4, 0.3, 0.65, 'height (m)'),
        shape: choice(['rect', 'round', 'oval'], 'rect', 'top shape'),
        top: choice(TOPS, 'marble', 'top finish'),
        legs: choice(BASES, 'black-metal', 'base finish'),
        shelf: flag(true, 'lower shelf'),
    },
    mount: 'floor',
    againstWall: false,
    frontClearance: 0.4,
    size: (p) => [p.num('width'), p.num('height'), p.str('shape') === 'round' ? p.num('width') : p.num('depth')],
    build(p) {
        const set = new PartSet();
        const w = p.num('width');
        const shape = p.str('shape');
        const d = shape === 'round' ? w : p.num('depth');
        const h = p.num('height');
        const t = 0.03;
        const outline = shape === 'rect' ? roundedRect(w, d, 0.015, 3) : roundedRect(w, d, Math.min(w, d) / 2 - 0.001, 12);
        set.add(extrude(outline, h - t, h), mat(p.str('top')));
        const base = new Geom();
        if (shape === 'round') {
            base.merge(cylinder(0.04, 0.04, h - t, 20).translate(0, 0, 0));
            base.merge(cylinder(w * 0.32, w * 0.32, 0.02, 32));
        }
        else {
            for (const sx of [-1, 1])
                for (const sz of [-1, 1])
                    base.merge(leg(sx * (w / 2 - 0.06), sz * (d / 2 - 0.06), h - t, 0.014, 1));
            if (p.bool('shelf'))
                set.add(extrude(roundedRect(w - 0.1, d - 0.1, 0.01, 2), 0.1, 0.12), mat(p.str('legs') === 'black-metal' ? 'oak' : p.str('legs')));
        }
        set.add(base, mat(p.str('legs')));
        set.boxMinMax(-w / 2, 0, -d / 2, w / 2, h, d / 2);
        return set.build();
    },
};
export const DESK = {
    id: 'furn-desk',
    kind: 'desk',
    description: 'Work desk with a drawer pedestal and cable tray; back against a wall, front +Z.',
    params: {
        width: num(1.4, 0.8, 2.4, 'width (m)'),
        depth: num(0.7, 0.5, 0.9, 'depth (m)'),
        top: choice(TOPS, 'oak', 'top finish'),
        base: choice(BASES, 'black-metal', 'leg finish'),
    },
    mount: 'floor',
    againstWall: true,
    frontClearance: 0.9,
    size: (p) => [p.num('width'), 0.75, p.num('depth')],
    build(p) {
        const set = new PartSet();
        const w = p.num('width');
        const d = p.num('depth');
        const h = 0.75;
        set.add(top(w, d, h, 0.03, false), mat(p.str('top')));
        const base = new Geom();
        for (const sx of [-1, 1])
            for (const sz of [-1, 1])
                base.merge(squareLeg(sx * (w / 2 - 0.04), sz * (d / 2 - 0.04), h - 0.03, 0.035));
        set.add(base, mat(p.str('base')));
        cabinet(0.4, 0.5, d - 0.12, h - 0.03 - 0.52, 3, true, mat('paint', '#e9e6e0'), mat('paint', '#e9e6e0'), mat('brushed-metal'), new PartSetProxy(set, w / 2 - 0.28));
        set.boxMinMax(-w / 2, 0, -d / 2, w / 2, h, d / 2);
        return set.build();
    },
};
/** Adds geometry to a set with an X offset (positions sub-assemblies). */
class PartSetProxy extends PartSet {
    target;
    dx;
    dz;
    constructor(target, dx, dz = 0) {
        super();
        this.target = target;
        this.dx = dx;
        this.dz = dz;
    }
    add(geom, material) {
        this.target.add(geom.translate(this.dx, 0, this.dz), material);
        return this;
    }
}
export const SIDEBOARD = {
    id: 'furn-sideboard',
    kind: 'sideboard',
    description: 'Low sideboard / media console with door or drawer fronts on short legs; back against a wall.',
    params: {
        width: num(1.8, 0.8, 3, 'width (m)'),
        height: num(0.6, 0.4, 0.9, 'height (m)'),
        body: choice(['oak', 'walnut', 'ash', 'paint'], 'walnut', 'carcass finish'),
        fronts: choice(['doors', 'drawers', 'slats'], 'doors', 'front style'),
        legs: choice(BASES, 'black-metal', 'leg finish'),
        color: color('#e7e3dc', 'paint colour (body = paint)'),
        interactive: flag(false, 'the doors and drawers are separate parts that open'),
    },
    interactive: true,
    mount: 'floor',
    againstWall: true,
    frontClearance: 0.6,
    size: (p) => [p.num('width'), p.num('height'), 0.45],
    build(p, _seed, sink) {
        const set = new PartSet();
        const w = p.num('width');
        const h = p.num('height');
        const d = 0.45;
        const legH = 0.12;
        const body = p.str('body') === 'paint' ? mat('paint', p.color('color')) : mat(p.str('body'));
        const n = Math.max(2, Math.round(w / 0.45));
        if (p.str('fronts') === 'slats') {
            set.add(roundedBox(w, h - legH, d, 0.006, 1).translate(0, legH + (h - legH) / 2, 0), body);
            const slats = new Geom();
            for (let x = -w / 2 + 0.03; x < w / 2 - 0.02; x += 0.035)
                slats.merge(roundedBox(0.022, h - legH - 0.04, 0.02, 0.004, 1).translate(x + 0.011, legH + (h - legH) / 2, d / 2 + 0.01));
            set.add(slats, body);
        }
        else
            cabinet(w, h - legH, d, legH, p.str('fronts') === 'drawers' ? 3 : n, p.str('fronts') === 'drawers', body, body, mat('brass'), set, sink);
        const legs = new Geom();
        for (const sx of [-1, 1])
            for (const sz of [-1, 1])
                legs.merge(leg(sx * (w / 2 - 0.06), sz * (d / 2 - 0.06), legH, 0.015, 0.8));
        set.add(legs, mat(p.str('legs')));
        set.boxMinMax(-w / 2, 0, -d / 2, w / 2, h, d / 2);
        return set.build();
    },
};
export const NIGHTSTAND = {
    id: 'furn-nightstand',
    kind: 'nightstand',
    description: 'Bedside table with one drawer and an open shelf on slim legs.',
    params: {
        body: choice(['oak', 'walnut', 'ash', 'paint'], 'oak', 'finish'),
        color: color('#ece8e1', 'paint colour (body = paint)'),
        interactive: flag(false, 'the drawer is a separate part that opens'),
    },
    interactive: true,
    mount: 'floor',
    againstWall: true,
    frontClearance: 0.3,
    size: () => [0.48, 0.55, 0.4],
    build(p, _seed, sink) {
        const set = new PartSet();
        const body = p.str('body') === 'paint' ? mat('paint', p.color('color')) : mat(p.str('body'));
        const w = 0.48;
        const d = 0.4;
        const g = new Geom();
        g.merge(roundedBox(w, 0.025, d, 0.006, 1).translate(0, 0.54, 0));
        g.merge(roundedBox(w, 0.02, d, 0.005, 1).translate(0, 0.3, 0));
        g.merge(box(-w / 2, 0.3, -d / 2, -w / 2 + 0.018, 0.53, d / 2));
        g.merge(box(w / 2 - 0.018, 0.3, -d / 2, w / 2, 0.53, d / 2));
        g.merge(box(-w / 2, 0.3, -d / 2, w / 2, 0.53, -d / 2 + 0.012));
        for (const sx of [-1, 1])
            for (const sz of [-1, 1])
                g.merge(squareLeg(sx * (w / 2 - 0.02), sz * (d / 2 - 0.02), 0.3, 0.03));
        set.add(g, body);
        const drawerFront = new Geom();
        const drawerPull = new Geom();
        emitFront(sink, { front: drawerFront, handle: drawerPull }, {
            id: 'drawer-0', name: 'Drawer', kind: 'drawer', center: [0, 0.46, d / 2 - 0.01], size: [w - 0.04, 0.12, 0.018], motion: { type: 'slide', offset: [0, 0, 0.3] },
            front: roundedBox(w - 0.04, 0.12, 0.018, 0.003, 1).translate(0, 0.46, d / 2 - 0.01),
            handle: roundedBox(0.1, 0.014, 0.018, 0.006, 1).translate(0, 0.46, d / 2 + 0.008),
            body: drawerBox(0, 0.46, w - 0.04, 0.12, d / 2 - 0.001, 0.34),
            frontMaterial: body, handleMaterial: mat('brass'), bodyMaterial: body,
        });
        set.add(drawerFront, body);
        set.add(drawerPull, mat('brass'));
        set.boxMinMax(-w / 2, 0, -d / 2, w / 2, 0.555, d / 2);
        return set.build();
    },
};
/** Table and casegood definitions. */
export const TABLES = [DINING_TABLE, COFFEE_TABLE, DESK, SIDEBOARD, NIGHTSTAND];
