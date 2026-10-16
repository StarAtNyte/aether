import { r2 } from '../builder';
import { finish, flagshipBuilder, onCircle } from './kit';
const WALK_CONTROLS = ['WASD — walk', 'E — doors & lights', '1–4 — time of day', 'R — swap finishes', 'P — photo mode', 'V — view'];
/** Skyline Penthouse: rooftop apartment over a sunset city. */
export function skylinePenthouse() {
    const b = flagshipBuilder(0x9e47, { dusk: true });
    b.env({
        sky: 'sunset',
        timeOfDay: 17.7,
        sunIntensity: 2.6,
        ambientIntensity: 0.45,
        fog: { color: '#e9c2a6', density: 0.0011 },
        bloom: 0.7,
        exposure: 1.05,
        weather: 'clear',
        // The rooftop: a finite slab of concrete (the collider under it is infinite, so nobody falls).
        ground: { material: { finish: 'concrete', color: '#a9a49c' }, size: 52 },
    });
    // Parapet around the roof edge with a glass rail on top (the plan is centred on the roof: origin −9.5, −3).
    const half = 25;
    const parapet = (from, to) => {
        const dx = to[0] - from[0];
        const dz = to[2] - from[2];
        const len = Math.hypot(dx, dz);
        b.prim('parapet', 'box', [r2(Math.abs(dx) > 0 ? len : 0.35), 1.05, r2(Math.abs(dz) > 0 ? len : 0.35)], [r2((from[0] + to[0]) / 2), 0.52, r2((from[2] + to[2]) / 2)], { material: { finish: 'concrete', color: '#c9c3b8' }, physics: 'static', tags: ['parapet'] });
        b.prim('rail-glass', 'box', [r2(Math.abs(dx) > 0 ? len : 0.04), 0.9, r2(Math.abs(dz) > 0 ? len : 0.04)], [r2((from[0] + to[0]) / 2), 1.5, r2((from[2] + to[2]) / 2)], { material: { finish: 'glass', opacity: 0.25 }, physics: 'static', castShadow: false });
    };
    const cx = 0;
    const cz = 0;
    parapet([cx - half, 0, cz - half], [cx + half, 0, cz - half]);
    parapet([cx - half, 0, cz + half], [cx + half, 0, cz + half]);
    parapet([cx - half, 0, cz - half], [cx - half, 0, cz + half]);
    parapet([cx + half, 0, cz - half], [cx + half, 0, cz + half]);
    // Rooftop planting and loungers on the deck outside the glass.
    for (const [x, z] of [[-15.5, -13], [15.5, -13], [-15.5, 13], [15.5, 13], [-15.5, 0], [15.5, 0]]) {
        b.asset('planter', 'planter', [x, 0, z], { physics: 'static', footprint: 1 });
        b.gen('olive', 'furn-tree', { height: 3.4, species: 'olive', leaf: '#74845a' }, [x, 0.6, z], { physics: 'static' });
    }
    // The city: towers standing on streets 40 m below the roof, their crowns rising around the
    // terrace, landmark spires beyond.
    const towers = ['skyscraper', 'skyscraper-b', 'skyscraper-c', 'tall-building'];
    for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2 + b.rand(-0.04, 0.04);
        const far = i % 9 === 0;
        const d = far ? b.rand(190, 280) : b.rand(105, 230);
        const [x, , z] = onCircle(cx, cz, d, a);
        // Crowns rise well above the roof deck: a skyline around the terrace, not rooftops below it.
        const h = far ? b.rand(120, 170) : b.rand(60, 115);
        b.asset('tower', b.pick(towers), [x, -40, z], { fitSize: r2(h), yaw: r2(b.rand(0, 360)), tags: ['backdrop', 'city'], castShadow: false });
    }
    // Warm beacons on a few crowns.
    for (let i = 0; i < 6; i++) {
        const [x, , z] = onCircle(cx, cz, b.rand(170, 250), b.rand(0, Math.PI * 2));
        b.prim('beacon', 'sphere', [1.6, 1.6, 1.6], [x, r2(b.rand(24, 42)), z], { material: { preset: 'emissive', color: '#ff5a3c', emissive: '#ff5a3c', emissiveIntensity: 4 }, castShadow: false, behaviors: [{ type: 'pulseLight', params: { min: 0.5, max: 4, period: 2.4, phase: r2(b.rand(0, 1)), property: 'material.emissiveIntensity' } }], tags: ['backdrop'] });
    }
    const plan = {
        id: 'penthouse',
        name: 'Skyline Penthouse',
        style: 'modern',
        origin: [-9.5, -3],
        plinth: 0.15,
        exteriorWall: { thickness: 0.3, finish: { finish: 'plaster', color: '#efebe4' } },
        levels: [{
                name: 'Penthouse',
                height: 3.3,
                autoWindows: false,
                rooms: [
                    { id: 'living', type: 'living', name: 'Living room', rect: [0, 0, 10, 7], floor: { finish: 'oak', color: '#c9a77c' } },
                    { id: 'dining', type: 'dining', name: 'Dining', rect: [10, 0, 15, 7], floor: { finish: 'oak', color: '#c9a77c' } },
                    { id: 'kitchen', type: 'kitchen', name: 'Kitchen', rect: [15, 0, 19, 7] },
                    { id: 'hall', type: 'hall', name: 'Gallery hall', rect: [0, 7, 19, 9], floor: { finish: 'marble', color: '#ecebe7' } },
                    { id: 'master', type: 'bedroom', name: 'Main bedroom', rect: [0, 9, 6, 14] },
                    { id: 'bath', type: 'bathroom', name: 'Bathroom', rect: [6, 9, 9, 14] },
                    { id: 'guest', type: 'bedroom', name: 'Guest bedroom', rect: [9, 9, 13.5, 14] },
                    { id: 'study', type: 'office', name: 'Study', rect: [13.5, 9, 19, 14] },
                ],
                doors: [
                    { between: ['hall', 'outside'], side: 'east', main: true, width: 1.1 },
                    { between: ['hall', 'living'], kind: 'opening', width: 2.4 },
                    { between: ['living', 'dining'], kind: 'opening', width: 4 },
                    { between: ['dining', 'kitchen'], kind: 'opening', width: 3.2 },
                    { between: ['living', 'outside'], side: 'north', kind: 'sliding', width: 2.4, style: 'glass' },
                    { between: ['hall', 'master'] },
                    { between: ['hall', 'bath'], width: 0.8 },
                    { between: ['hall', 'guest'] },
                    { between: ['hall', 'study'] },
                ],
                windows: [
                    { room: 'living', side: 'north', count: 2, width: 2.6, height: 2.6, sill: 0.25, style: 'picture' },
                    { room: 'living', side: 'west', count: 2, width: 2.2, height: 2.6, sill: 0.25, style: 'picture' },
                    { room: 'dining', side: 'north', count: 2, width: 1.9, height: 2.6, sill: 0.25, style: 'picture' },
                    { room: 'kitchen', side: 'north', count: 1, width: 2.4, height: 1.4, sill: 1.05, style: 'fixed' },
                    { room: 'kitchen', side: 'east', count: 1, width: 2, height: 2.4, sill: 0.4, style: 'picture' },
                    { room: 'master', side: 'south', count: 2, width: 2, height: 2.4, sill: 0.4, style: 'picture' },
                    { room: 'master', side: 'west', count: 1, width: 2.2, height: 2.4, sill: 0.4, style: 'picture' },
                    { room: 'guest', side: 'south', count: 1, width: 2.2, height: 2.2, sill: 0.5, style: 'picture' },
                    { room: 'study', side: 'south', count: 1, width: 2.2, height: 2.2, sill: 0.5, style: 'picture' },
                    { room: 'study', side: 'east', count: 1, width: 1.6, height: 2.2, sill: 0.5, style: 'picture' },
                    { room: 'bath', side: 'south', count: 1, width: 1, height: 0.9, sill: 1.5, style: 'fixed' },
                ],
            }],
        roof: { shape: 'flat', overhang: 0.6 },
        site: { terrace: [[-1, -8], [20, -8], [20, 0], [-1, 0]], terraceFinish: { finish: 'decking', color: '#9c7a58' }, pool: { at: [12, -4.2], width: 9, length: 3.2 }, planting: true },
    };
    b.player({ mode: 'firstPerson', moveSpeed: 3.2 });
    return finish(b, {
        name: 'Skyline Penthouse',
        description: 'A rooftop penthouse at golden hour over a city of towers.',
        intro: {
            title: 'Skyline Penthouse',
            tagline: 'Three bedrooms, a terrace pool and the whole city at your feet.',
            objective: 'Walk through, switch the lights, change the time of day and take a photo.',
            controls: WALK_CONTROLS,
            accent: '#f2b880',
        },
        plan: 'Plan: modern three-bedroom penthouse (8 rooms) compiled with build_architecture on a rooftop with a parapet, terrace pool and planters, 34 towers of the city below, sunset light.',
        message: 'Built Skyline Penthouse: a three-bedroom penthouse with picture windows and a terrace pool on a rooftop above a sunset city. Press Play to walk it — E switches lights, 1–4 change the time of day, R swaps finishes, P is photo mode; the Architecture bar has the floor plan, cutaway, exploded and section views.',
        arch: { ops: [{ op: 'create_building', plan }], message: 'Skyline Penthouse' },
    });
}
/** Dusk House by the Lake: two-storey glass house, pool terrace, lake and jetty. */
export function duskLakeHouse() {
    const b = flagshipBuilder(0xd05e, { dusk: true, water: true });
    b.env({
        sky: 'sunset',
        timeOfDay: 18.15,
        sunIntensity: 1.6,
        ambientIntensity: 0.4,
        fog: { color: '#c9a7b8', density: 0.0026 },
        bloom: 0.95,
        exposure: 1.1,
        weather: 'fireflies',
        ground: { material: { finish: 'grass', color: '#6f8a52' }, size: 260 },
    });
    // The lake south of the terrace, with a sandy rim, reeds and a jetty.
    const lx = 7;
    const lz = 36;
    const lr = 17;
    const lake = b.prim('lake', 'cylinder', [lr * 2, 0.08, lr * 2], [lx, 0.05, lz], { name: 'Lake', material: { preset: 'water', color: '#4f7f99', opacity: 0.9, roughness: 0.03 }, castShadow: false, tags: ['water'] });
    b.prim('lake-shore', 'cylinder', [lr * 2 + 3, 0.05, lr * 2 + 3], [lx, 0.03, lz], { material: { preset: 'sand', color: '#a8977a' }, castShadow: false });
    b.reserve(lx, lz, lr + 1);
    b.keepClear(lx, lz, lr + 1);
    b.gen('jetty', 'dock', { length: 10, width: 2, height: 0.45, color: '#7a5a3c', variant: 1 }, [lx - 2, 0, lz - lr + 3], { yaw: 90, physics: 'static', name: 'Jetty' });
    b.gen('rowboat', 'boat', { length: 3.6, variant: 0, color: '#e8e1d4', accentColor: '#2f5d7a' }, [lx + 2.2, 0.05, lz - lr + 8], { yaw: 70, behaviors: [{ type: 'bob', params: { amplitude: 0.05, period: 3.6 } }], name: 'Rowboat' });
    for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + 0.3;
        const [x, , z] = onCircle(lx, lz, lr + 1.2, a);
        b.scatter('reeds', 'meadow-grass', { color: '#6f8a3a', size: 1.2 }, 9, [2.6, 2.6], [x, 0, z], { minSpacing: 0.35, scaleRange: [0.9, 1.7] });
    }
    // Pines and birches framing the house, a path to the jetty, mountains beyond the lake.
    for (let i = 0; i < 26; i++) {
        const p = b.spot(7, 6, 18, 60, 2.2);
        if (!p)
            continue;
        if (Math.abs(p[0] - lx) < lr + 4 && p[1] > 14)
            continue;
        const pine = b.chance(0.6);
        // Leaf-card spruce and broadleaf trees (the realistic vegetation generators), not the stylised cones.
        b.gen(pine ? 'pine' : 'birch', pine ? 'tree-spruce' : 'tree-broadleaf', pine ? { height: r2(b.rand(11, 18)), color: '#2f4f3a' } : { height: r2(b.rand(8, 12)), color: '#8fa558', trunkColor: '#d8d2c4', variant: 1 }, [p[0], 0, p[1]], { yaw: r2(b.rand(0, 360)), physics: 'static', tags: ['tree'] });
    }
    b.scatter('meadow', 'meadow-grass', { color: '#7d9a52', size: 0.6 }, 900, [70, 50], [7, 0, 6], { minSpacing: 0.6, scaleRange: [0.7, 1.4] });
    for (let i = 0; i < 6; i++) {
        const [x, , z] = onCircle(lx, lz, b.rand(120, 150), Math.PI * 0.15 + (i / 6) * Math.PI * 0.7);
        b.gen('mountain', 'mountain', { size: r2(b.rand(90, 130)), height: r2(b.rand(35, 60)), color: '#5d6676', snowLine: 0.7, groundColor: '#6f8a52' }, [x, 0, z], { tags: ['backdrop'] });
    }
    b.light(lake, [0, 3, 0], '#ffb06a', 0.8, 30);
    const plan = {
        id: 'lakehouse',
        name: 'Dusk House by the Lake',
        style: 'japandi',
        plinth: 0.3,
        exteriorWall: { thickness: 0.3, finish: { finish: 'plaster', color: '#e9e4da' } },
        levels: [
            {
                name: 'Ground floor',
                height: 3.3,
                autoWindows: false,
                rooms: [
                    { id: 'living', type: 'living', name: 'Living room', rect: [0, 0, 9, 7], floor: { finish: 'oak', color: '#c8a57a' } },
                    { id: 'kitchen', type: 'kitchen', name: 'Kitchen', rect: [9, 0, 14, 7] },
                ],
                doors: [
                    { between: ['kitchen', 'outside'], side: 'east', main: true, width: 1.1 },
                    { between: ['living', 'kitchen'], kind: 'opening', width: 3 },
                    { between: ['living', 'outside'], side: 'south', kind: 'sliding', width: 2.6, style: 'glass' },
                ],
                windows: [
                    { room: 'living', side: 'south', count: 2, width: 2.4, height: 2.7, sill: 0.2, style: 'picture' },
                    { room: 'living', side: 'west', count: 2, width: 2, height: 2.6, sill: 0.25, style: 'picture' },
                    { room: 'kitchen', side: 'south', count: 1, width: 3, height: 2.6, sill: 0.25, style: 'picture' },
                    { room: 'kitchen', side: 'north', count: 1, width: 2.2, height: 1.2, sill: 1.1, style: 'fixed' },
                ],
                stairs: [{ at: [0.6, 0.6], heading: 'east', width: 1 }],
            },
            {
                name: 'Upper floor',
                height: 3,
                autoWindows: false,
                rooms: [
                    { id: 'landing', type: 'hall', name: 'Landing', rect: [0, 0, 14, 2.2] },
                    { id: 'master', type: 'bedroom', name: 'Main bedroom', rect: [0, 2.2, 6, 7] },
                    { id: 'bath', type: 'bathroom', name: 'Bathroom', rect: [6, 2.2, 9, 7] },
                    { id: 'guest', type: 'bedroom', name: 'Guest bedroom', rect: [9, 2.2, 14, 7] },
                ],
                doors: [{ between: ['landing', 'master'] }, { between: ['landing', 'bath'], width: 0.8 }, { between: ['landing', 'guest'] }],
                windows: [
                    { room: 'master', side: 'south', count: 2, width: 2.2, height: 2.3, sill: 0.4, style: 'picture' },
                    { room: 'master', side: 'west', count: 1, width: 1.8, height: 2.2, sill: 0.4, style: 'picture' },
                    { room: 'guest', side: 'south', count: 1, width: 2.4, height: 2.3, sill: 0.4, style: 'picture' },
                    { room: 'guest', side: 'east', count: 1, width: 1.6, height: 2.2, sill: 0.4, style: 'picture' },
                    { room: 'bath', side: 'south', count: 1, width: 1.2, height: 1, sill: 1.4, style: 'fixed' },
                    { room: 'landing', side: 'north', count: 3, width: 1.4, height: 1, sill: 1.3, style: 'fixed' },
                ],
            },
        ],
        roof: { shape: 'shed', pitch: 8, overhang: 1.1 },
        site: { terrace: [[-2, 7], [16, 7], [16, 15], [-2, 15]], terraceFinish: { finish: 'decking', color: '#8f6d4f' }, pool: { at: [8.5, 11], width: 8, length: 3 }, planting: true },
    };
    b.player({ mode: 'firstPerson', moveSpeed: 3.2 });
    return finish(b, {
        name: 'Dusk House by the Lake',
        description: 'A two-storey glass house lit from inside at dusk, by a lake.',
        intro: {
            title: 'Dusk House by the Lake',
            tagline: 'Warm light, cool water: a glass house the evening the lamps come on.',
            objective: 'Explode the storeys, cut a section, then walk down to the jetty.',
            controls: WALK_CONTROLS,
            accent: '#ffb46b',
        },
        plan: 'Plan: two-storey japandi house (6 rooms, stair, shed roof) compiled with build_architecture, pool terrace, lake with jetty and rowboat, pines, birches and mountains, dusk light with the interior lamps on.',
        message: 'Built Dusk House by the Lake: a two-storey glass house with a pool terrace stepping down to a lake and jetty, lit from inside at dusk. Use the Architecture bar to explode the storeys, cut away the walls or take a section; press Play to walk inside.',
        arch: { ops: [{ op: 'create_building', plan }], message: 'Dusk House by the Lake' },
    });
}
