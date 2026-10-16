/**
 * Bathroom fixtures: wall-hung toilet with a concealed cistern panel, a
 * vanity with a ceramic basin, a freestanding tub and a walk-in shower with
 * a glass screen and rain head. Basins at 0.85 m, toilets 0.4 m seat height.
 */
import { Geom, box, cylinder, extrude, lathe, roundedBox, tube } from '../mesh';
import { PartSet } from '../parts';
import { choice, color, mat, num, roundedRect } from './kit';
export const TOILET = {
    id: 'furn-toilet',
    kind: 'toilet',
    description: 'Wall-hung toilet with a slim seat and a flush plate on a cistern panel; back against a wall.',
    params: {
        color: color('#f3f1ed', 'ceramic colour'),
    },
    mount: 'floor',
    againstWall: true,
    frontClearance: 0.6,
    size: () => [0.4, 1.1, 0.62],
    build(p) {
        const set = new PartSet();
        const ceramic = mat('ceramic', p.color('color'));
        // Bowl: a lathe stretched into an oval.
        const bowl = lathe([
            [0.001, 0.22],
            [0.12, 0.24],
            [0.17, 0.3],
            [0.185, 0.36],
            [0.18, 0.4],
            [0.001, 0.4],
        ], 28).scale(1, 1, 1.4);
        bowl.translate(0, 0, 0.06);
        const seat = extrude(roundedRect(0.36, 0.46, 0.17, 8), 0.4, 0.42).translate(0, 0, 0.07);
        set.add(bowl.merge(seat), ceramic);
        set.add(box(-0.25, 0, -0.31, 0.25, 1.1, -0.17), mat('tile', '#e9e6e0'));
        set.add(roundedBox(0.22, 0.15, 0.012, 0.01, 2).translate(0, 0.98, -0.164), mat('chrome'));
        set.boxMinMax(-0.19, 0.2, -0.31, 0.19, 0.42, 0.3);
        set.boxMinMax(-0.25, 0, -0.31, 0.25, 1.1, -0.17);
        return set.build();
    },
};
export const VANITY = {
    id: 'furn-vanity',
    kind: 'vanity',
    description: 'Bathroom vanity: wall-hung cabinet with drawers, stone top, ceramic basin and a wall tap; back against a wall.',
    params: {
        width: num(0.9, 0.5, 2, 'width (m)'),
        body: choice(['oak', 'walnut', 'paint'], 'oak', 'cabinet finish'),
        top: choice(['marble', 'terrazzo', 'concrete'], 'marble', 'top finish'),
    },
    mount: 'floor',
    againstWall: true,
    frontClearance: 0.7,
    size: (p) => [p.num('width'), 0.9, 0.48],
    build(p) {
        const set = new PartSet();
        const w = p.num('width');
        const d = 0.48;
        const body = p.str('body') === 'paint' ? mat('paint', '#e6e2da') : mat(p.str('body'));
        set.add(roundedBox(w, 0.42, d - 0.02, 0.006, 1).translate(0, 0.38 + 0.21, -0.01), body);
        set.add(roundedBox(w - 0.02, 0.2, 0.018, 0.003, 1).translate(0, 0.69, d / 2 - 0.01).merge(roundedBox(w - 0.02, 0.2, 0.018, 0.003, 1).translate(0, 0.485, d / 2 - 0.01)), body);
        set.add(box(-w / 2, 0.8, -d / 2, w / 2, 0.83, d / 2), mat(p.str('top')));
        const basin = lathe([
            [0.001, 0.83],
            [0.15, 0.835],
            [0.2, 0.86],
            [0.215, 0.95],
            [0.2, 0.95],
            [0.185, 0.87],
            [0.001, 0.855],
        ], 32);
        set.add(basin, mat('ceramic'));
        set.add(tube([[0, 1.05, -d / 2], [0, 1.05, -d / 2 + 0.16], [0, 1.03, -d / 2 + 0.18]], 0.011, 10), mat('chrome'));
        set.boxMinMax(-w / 2, 0.38, -d / 2, w / 2, 0.95, d / 2);
        return set.build();
    },
};
export const BATHTUB = {
    id: 'furn-bathtub',
    kind: 'bathtub',
    description: 'Freestanding oval bathtub with a floor-standing mixer. Long side along X.',
    params: {
        length: num(1.7, 1.4, 1.9, 'length (m)'),
        color: color('#f4f2ee', 'enamel colour'),
    },
    mount: 'floor',
    againstWall: true,
    frontClearance: 0.7,
    size: (p) => [p.num('length') + 0.3, 1.0, 0.78],
    build(p) {
        const set = new PartSet();
        const L = p.num('length');
        const W = 0.78;
        const h = 0.58;
        const outer = roundedRect(L, W, W / 2 - 0.02, 10);
        const inner = roundedRect(L - 0.12, W - 0.12, W / 2 - 0.08, 10);
        const g = new Geom();
        // Outer shell tapering in toward the base.
        const base = outer.map((q) => [q[0] * 0.92, q[1] * 0.88]);
        for (let k = 0; k < outer.length; k++) {
            const a = outer[k];
            const b = outer[(k + 1) % outer.length];
            const a0 = base[k];
            const b0 = base[(k + 1) % base.length];
            g.quadAuto([b0[0], 0, b0[1]], [a0[0], 0, a0[1]], [a[0], h, a[1]], [b[0], h, b[1]]);
        }
        g.flatPolygon(outer, h, true, [inner]);
        // Inner tub: walls and a floor 0.42 m below the rim.
        const floorY = h - 0.42;
        for (let k = 0; k < inner.length; k++) {
            const a = inner[k];
            const b = inner[(k + 1) % inner.length];
            const a1 = [a[0] * 0.94, a[1] * 0.9];
            const b1 = [b[0] * 0.94, b[1] * 0.9];
            g.quadAuto([a1[0], floorY, a1[1]], [b1[0], floorY, b1[1]], [b[0], h, b[1]], [a[0], h, a[1]]);
        }
        g.flatPolygon(inner.map((q) => [q[0] * 0.94, q[1] * 0.9]), floorY, true);
        g.flatPolygon(base, 0, false);
        set.add(g, mat('ceramic', p.color('color')));
        const mixer = new Geom();
        mixer.merge(cylinder(0.018, 0.018, 0.95, 12).translate(L / 2 + 0.12, 0, 0));
        mixer.merge(tube([[L / 2 + 0.12, 0.95, 0], [L / 2 + 0.12, 1.0, 0], [L / 2 - 0.05, 0.98, 0]], 0.014, 10));
        set.add(mixer, mat('chrome'));
        set.boxMinMax(-L / 2, 0, -W / 2, L / 2, h, W / 2);
        return set.build();
    },
};
export const SHOWER = {
    id: 'furn-shower',
    kind: 'shower',
    description: 'Walk-in shower: low stone tray, frameless glass screen, rain head and wall mixer. Back against a wall.',
    params: {
        width: num(1.2, 0.8, 2, 'width (m)'),
        depth: num(0.9, 0.8, 1.4, 'depth (m)'),
    },
    mount: 'floor',
    againstWall: true,
    frontClearance: 0.6,
    size: (p) => [p.num('width'), 2.1, p.num('depth')],
    build(p) {
        const set = new PartSet();
        const w = p.num('width');
        const d = p.num('depth');
        set.add(box(-w / 2, 0, -d / 2, w / 2, 0.03, d / 2), mat('stone', '#c9c3b8'));
        set.add(box(-w / 2, 0.03, -d / 2, w / 2, 2.1, -d / 2 + 0.012), mat('subway-tile', '#e8e5df'));
        set.add(box(w / 2 - 0.01, 0.03, -d / 2, w / 2, 2.0, d / 2 - 0.02), mat('glass'));
        set.add(box(w / 2 - 0.015, 2.0, -d / 2, w / 2 + 0.005, 2.02, d / 2 - 0.02), mat('black-metal'));
        const fittings = new Geom();
        fittings.merge(tube([[0, 2.0, -d / 2 + 0.01], [0, 2.18, -d / 2 + 0.01], [0, 2.18, -d / 2 + 0.3]], 0.012, 8));
        fittings.merge(cylinder(0.15, 0.15, 0.012, 32).translate(0, 2.16, -d / 2 + 0.3));
        fittings.merge(roundedBox(0.16, 0.08, 0.04, 0.01, 2).translate(0, 1.1, -d / 2 + 0.03));
        set.add(fittings, mat('chrome'));
        set.boxMinMax(-w / 2, 0, -d / 2, w / 2, 0.03, d / 2);
        set.boxMinMax(w / 2 - 0.02, 0, -d / 2, w / 2, 2.0, d / 2);
        return set.build();
    },
};
/** Bathroom definitions. */
export const BATH = [TOILET, VANITY, BATHTUB, SHOWER];
