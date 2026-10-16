/**
 * Casa del Patio: a courtyard house in the hills above Sintra. Eight rooms
 * ring a stone patio with a lap pool, an olive tree and a timber pergola;
 * every room opens onto it through sliding glass. Limewashed walls,
 * terracotta tile, oak and wrought iron; a papered library, a panelled
 * living room, drawers and cabinets that open, mugs to pick up. Built by the
 * same `build_architecture` plan as any building, then staged on a dry hill
 * plot with an olive grove, cypresses, a gravel drive and the serra behind.
 *
 * The plan reveal (Architecture bar → Reveal) draws this plan in ink and
 * raises the walls out of it.
 */
import { r2 } from '../builder';
import { finish, flagshipBuilder, onCircle } from './kit';
const CONTROLS = ['WASD — walk', 'Mouse — look', 'E — open · use · pick up', 'Click — throw', '1–4 — time of day', 'P — photo mode'];
/** Plan origin in the world: the house is centred on the world origin. */
const ORIGIN = [-9.5, -7.5];
/** The building plan (plan coordinates in metres; x east, z south). */
export function casaPlan() {
    return {
        id: 'casa',
        name: 'Casa del Patio',
        style: 'mediterranean',
        origin: ORIGIN,
        plinth: 0.22,
        exteriorWall: { thickness: 0.42, finish: { finish: 'plaster', color: '#f2ede3' } },
        interiorWall: { thickness: 0.14 },
        levels: [
            {
                name: 'Ground floor',
                height: 3.3,
                autoWindows: false,
                rooms: [
                    { id: 'living', type: 'living', name: 'Living room', rect: [0, 0, 9, 5], dado: { height: 1.05, material: { finish: 'panelling', color: '#e8e0d0' }, rail: true } },
                    { id: 'kitchen', type: 'kitchen', name: 'Kitchen and dining', rect: [9, 0, 19, 5] },
                    { id: 'study', type: 'office', name: 'Library', rect: [0, 5, 5, 11], finish: { finish: 'wallpaper-stripe', color: '#d9dfcf' }, dado: { height: 0.9, material: { finish: 'panelling', color: '#566a52' }, rail: true } },
                    { id: 'bed1', type: 'bedroom', name: 'Guest bedroom', rect: [14, 5, 19, 11], walls: { east: { finish: 'wallpaper-floral', color: '#e2e6d3' } } },
                    { id: 'hall', type: 'hall', name: 'Entrance hall', rect: [0, 11, 6, 15] },
                    { id: 'master', type: 'bedroom', name: 'Main bedroom', rect: [6, 11, 14, 15], walls: { south: { finish: 'wallpaper-damask', color: '#e5ddc9' } } },
                    { id: 'bath', type: 'bathroom', name: 'Bathroom', rect: [14, 11, 19, 15] },
                ],
                doors: [
                    { between: ['hall', 'outside'], side: 'south', main: true, width: 1.3, style: 'panel' },
                    { between: ['living', 'outside'], side: 'south', kind: 'sliding', width: 3.2, style: 'glass' },
                    { between: ['kitchen', 'outside'], side: 'south', kind: 'sliding', width: 3.2, style: 'glass' },
                    { between: ['study', 'outside'], side: 'east', kind: 'sliding', width: 2, style: 'glass' },
                    { between: ['bed1', 'outside'], side: 'west', kind: 'sliding', width: 2, style: 'glass' },
                    { between: ['master', 'outside'], side: 'north', kind: 'sliding', width: 3.2, style: 'glass' },
                    { between: ['living', 'kitchen'], kind: 'opening', width: 2.6 },
                    { between: ['living', 'study'], width: 0.95 },
                    { between: ['hall', 'master'], width: 1 },
                    { between: ['bed1', 'bath'], width: 0.85 },
                    { between: ['master', 'bath'], width: 0.85 },
                ],
                windows: [
                    { room: 'living', side: 'north', count: 2, width: 2.2, height: 2.3, sill: 0.6, style: 'casement' },
                    { room: 'living', side: 'west', count: 1, width: 1.6, height: 2.2, sill: 0.7, style: 'casement' },
                    { room: 'kitchen', side: 'north', count: 2, width: 1.6, height: 1.3, sill: 1.05, style: 'casement' },
                    { room: 'kitchen', side: 'east', count: 1, width: 1.4, height: 2.2, sill: 0.7, style: 'casement' },
                    { room: 'study', side: 'west', count: 1, width: 1.5, height: 2.1, sill: 0.8, style: 'casement' },
                    { room: 'bed1', side: 'east', count: 1, width: 1.5, height: 2.1, sill: 0.8, style: 'casement' },
                    { room: 'master', side: 'south', count: 2, width: 1.5, height: 2.1, sill: 0.8, style: 'casement' },
                    { room: 'bath', side: 'south', count: 1, width: 0.8, height: 0.9, sill: 1.4, style: 'fixed' },
                    { room: 'bath', side: 'east', count: 1, width: 0.8, height: 0.9, sill: 1.4, style: 'fixed' },
                ],
            },
        ],
        roof: { shape: 'flat', overhang: 0.35 },
        site: {
            // The patio: stone flags around a lap pool.
            terrace: [[5.2, 5.2], [13.8, 5.2], [13.8, 10.8], [5.2, 10.8]],
            terraceFinish: { finish: 'stone', color: '#d8cfbd' },
            pool: { at: [11.5, 8], width: 2.8, length: 4.4 },
            planting: true,
        },
    };
}
/** Casa del Patio: a courtyard house above Sintra at the golden end of the afternoon. */
export function casaPatio() {
    const b = flagshipBuilder(0x5171, { dusk: true });
    b.env({
        sky: 'sunset',
        timeOfDay: 17.3,
        sunIntensity: 3.4,
        ambientIntensity: 0.75,
        fog: { color: '#ecd6b4', density: 0.0009 },
        bloom: 0.4,
        exposure: 1.1,
        weather: 'clear',
        ground: { material: { finish: 'grass', color: '#a29b5e' }, size: 320 },
    });
    const [ox, oz] = ORIGIN;
    const at = (x, z) => [r2(ox + x), r2(oz + z)];
    // Gravel forecourt and drive down to the lane, edged with dry-stone walls.
    const [dx, dz0] = at(3, 15.2);
    b.prim('drive', 'box', [4.2, 0.08, 34], [dx, 0.04, r2(dz0 + 17)], { name: 'Gravel drive', material: { finish: 'gravel', color: '#b9ad94' }, physics: 'static', castShadow: false, tags: ['site'] });
    b.prim('forecourt', 'box', [11, 0.08, 6.5], [r2(dx + 0.5), 0.04, r2(dz0 + 3)], { name: 'Forecourt', material: { finish: 'stone', color: '#cdc2ad' }, physics: 'static', castShadow: false, tags: ['site'] });
    for (const side of [-1, 1]) {
        const [wx] = at(3 + side * 6.2, 0);
        b.prim('wall-garden', 'box', [0.55, 0.85, 30], [wx, 0.42, r2(dz0 + 17)], { name: 'Dry-stone wall', material: { finish: 'stone', color: '#b3a894' }, physics: 'static', tags: ['site', 'wall'] });
    }
    // Pergola over the patio table in the western half of the patio: oak posts, beams and slats.
    const [px0, pz0] = at(5.7, 6.0);
    const oak = { finish: 'oak', color: '#a97d52' };
    for (const [x, z] of [[0, 0], [3.8, 0], [0, 4], [3.8, 4]])
        b.prim('pergola-post', 'box', [0.16, 2.7, 0.16], [r2(px0 + x), 1.35 + 0.22, r2(pz0 + z)], { material: oak, physics: 'static', tags: ['pergola'] });
    for (const z of [0, 4])
        b.prim('pergola-beam', 'box', [4.2, 0.18, 0.14], [r2(px0 + 1.9), 2.98, r2(pz0 + z)], { material: oak, physics: 'static', castShadow: true, tags: ['pergola'] });
    for (let k = 0; k < 10; k++)
        b.prim('pergola-slat', 'box', [0.07, 0.07, 4.3], [r2(px0 - 0.1 + k * 0.45), 3.1, r2(pz0 + 2)], { material: oak, physics: 'static', tags: ['pergola'] });
    b.gen('patio-table', 'furn-table', { width: 2.1, depth: 0.95, shape: 'rect', top: 'oak', base: 'trestle', legs: 'oak' }, [r2(px0 + 1.9), 0.22, r2(pz0 + 2)], { yaw: 90, physics: 'static', name: 'Patio table' });
    for (const [x, z, yaw] of [[1.15, -0.5, 270], [1.15, 0.5, 270], [2.65, -0.5, 90], [2.65, 0.5, 90]]) {
        b.gen('patio-chair', 'furn-chair', { wood: 'oak', seat: 'wood', style: 'slat' }, [r2(px0 + x), 0.22, r2(pz0 + 1.9 + z)], { yaw, physics: 'static', name: 'Chair' });
    }
    // A big olive in the corner of the patio.
    const [tx, tz] = at(6.1, 10.0);
    b.gen('patio-olive', 'furn-tree', { height: 4.4, species: 'olive', leaf: '#74845a' }, [tx, 0.22, tz], { physics: 'static', tags: ['tree'], name: 'Olive tree' });
    // The olive grove below the house and cypresses along the drive.
    for (let i = 0; i < 20; i++) {
        const p = b.spot(0, 30, 7, 60, 3.4);
        if (!p || (Math.abs(p[0]) < 9 && p[1] < 24))
            continue;
        b.gen('olive', 'furn-tree', { height: r2(b.rand(3.4, 5.4)), species: 'olive', leaf: b.chance(0.5) ? '#6c7d4c' : '#77875a' }, [p[0], 0, p[1]], { yaw: r2(b.rand(0, 360)), physics: 'static', tags: ['tree'] });
    }
    for (const side of [-1, 1]) {
        for (let k = 0; k < 4; k++) {
            const [cx] = at(3 + side * 4.4, 0);
            b.gen('cypress', 'furn-tree', { height: r2(b.rand(8.5, 11.5)), species: 'cypress', leaf: '#2f3f2c' }, [cx, 0, r2(dz0 + 4 + k * 6)], { yaw: r2(b.rand(0, 360)), physics: 'static', tags: ['tree'] });
        }
    }
    for (let i = 0; i < 5; i++) {
        const p = b.spot(-30, -22, 4, 22, 4);
        if (!p)
            continue;
        b.gen('pine', 'furn-tree', { height: r2(b.rand(11, 15)), species: 'umbrella-pine', leaf: '#4d6a3c' }, [p[0], 0, p[1]], { yaw: r2(b.rand(0, 360)), physics: 'static', tags: ['tree'] });
    }
    b.scatter('dry-grass', 'grass-tuft', { color: '#a9a266', size: 0.7 }, 700, [90, 56], [0, 0, 44], { minSpacing: 0.7, scaleRange: [0.7, 1.5] });
    b.scatter('dry-grass-back', 'grass-tuft', { color: '#a9a266', size: 0.7 }, 260, [90, 18], [0, 0, -22], { minSpacing: 0.7, scaleRange: [0.7, 1.5] });
    b.scatter('agave', 'bush', { color: '#6f8b6a', size: 0.7 }, 24, [30, 12], [0, 0, 34], { minSpacing: 2.5, scaleRange: [0.7, 1.2] });
    // The serra: soft ochre and green hills far behind.
    for (let i = 0; i < 7; i++) {
        const [x, , z] = onCircle(0, 4, b.rand(150, 190), Math.PI * (1.1 + (i / 7) * 0.9));
        b.gen('hill', 'mountain', { size: r2(b.rand(110, 150)), height: r2(b.rand(28, 46)), color: '#78814f', snowLine: 2, groundColor: '#8f9156' }, [x, 0, z], { tags: ['backdrop'] });
    }
    b.player({ mode: 'firstPerson', moveSpeed: 3.1 });
    return finish(b, {
        name: 'Casa del Patio',
        description: 'A courtyard house in the hills above Sintra: eight rooms around a stone patio and a lap pool.',
        intro: {
            title: 'Casa del Patio',
            tagline: 'A courtyard house in the hills above Sintra.',
            objective: 'Walk in, open the drawers and the shutters of the day, carry a coffee out to the patio.',
            controls: CONTROLS,
            accent: '#d98a5f',
        },
        plan: 'Plan: mediterranean courtyard house (7 rooms ringing a stone patio with a lap pool, sliding glass to the patio, flat roof with parapet) compiled with build_architecture, papered library, panelled living room, pergola, olive grove, cypress drive and the serra behind.',
        message: 'Built Casa del Patio: a courtyard house in the hills above Sintra, seven rooms around a stone patio with a lap pool. Press Play to walk it: E opens doors, drawers and cabinets, turns on the tap and picks up the mugs (click throws). The Architecture bar has Reveal (the plan drawn in ink, the walls rising out of it), the cutaway and the section.',
        arch: { ops: [{ op: 'create_building', plan: casaPlan() }], message: 'Casa del Patio' },
    });
}
