import { r2 } from '../builder';
import { finish, flagshipBuilder, pickup } from './kit';
const NEON = ['#ff2e88', '#22e1ff', '#ffd23f', '#9b5dff', '#3dff9a', '#ff6b2e'];
/** Avenue (along Z) and cross street (along X) half-widths. */
const AVE = 9;
const CROSS = 8;
/** Window centres on the four faces of a tower (a grid, with some unlit). */
function windows(b, t, out) {
    const sx = 2.6;
    const sy = 3.4;
    for (let face = 0; face < 4; face++) {
        const along = face < 2 ? t.w : t.d;
        const cols = Math.max(1, Math.floor((along - 2) / sx));
        const rows = Math.max(1, Math.floor((t.h - 4) / sy));
        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
                const roll = b.rand(0, 1);
                if (roll < 0.42)
                    continue; // dark office
                const u = -along / 2 + 1 + sx / 2 + c * sx + (along - 2 - cols * sx) / 2;
                const y = r2(3.2 + r * sy);
                const p = face === 0 ? [r2(t.x + u), y, r2(t.z + t.d / 2 + 0.06)] : face === 1 ? [r2(t.x + u), y, r2(t.z - t.d / 2 - 0.06)] : face === 2 ? [r2(t.x + t.w / 2 + 0.06), y, r2(t.z + u)] : [r2(t.x - t.w / 2 - 0.06), y, r2(t.z + u)];
                const zFacing = face < 2;
                (roll < 0.86 ? (zFacing ? out.litZ : out.litX) : zFacing ? out.coolZ : out.coolX).push(p);
            }
        }
    }
}
/** Plan Neon Rain City. */
export function neonRainCity() {
    const b = flagshipBuilder(0x7e0c, { night: true, rain: true });
    b.env({
        sky: 'night',
        timeOfDay: 22.6,
        sunIntensity: 0.4,
        ambientIntensity: 0.55,
        fog: { color: '#1c1838', density: 0.011 },
        weather: 'rain',
        bloom: 1.5,
        exposure: 1.15,
        // Wet asphalt: dark and glossy so neon smears across it.
        ground: { material: { preset: 'concrete', color: '#14161d', roughness: 0.12, metalness: 0.1 }, size: 360 },
    });
    // --- Streets ------------------------------------------------------------------------------
    b.prim('avenue', 'box', [AVE * 2, 0.04, 220], [0, 0.02, 0], { name: 'Avenue', material: { preset: 'concrete', color: '#101218', roughness: 0.08, metalness: 0.2 }, castShadow: false });
    b.prim('cross-street', 'box', [200, 0.04, CROSS * 2], [0, 0.022, 0], { name: 'Cross street', material: { preset: 'concrete', color: '#101218', roughness: 0.08, metalness: 0.2 }, castShadow: false });
    for (let z = -104; z <= 104; z += 8) {
        if (Math.abs(z) < CROSS + 2)
            continue;
        b.prim('lane-mark', 'box', [0.18, 0.05, 3.2], [0, 0.03, z], { material: { preset: 'emissive', color: '#e8e0c8', emissive: '#c9c2aa', emissiveIntensity: 0.25 }, castShadow: false });
    }
    for (let k = 0; k < 9; k++) {
        for (const [x, z] of [[r2(-AVE + 1 + k * 2), r2(CROSS + 1.6)], [r2(-AVE + 1 + k * 2), r2(-CROSS - 1.6)]])
            b.prim('zebra', 'box', [1, 0.05, 2.6], [x, 0.03, z], { material: { preset: 'plastic', color: '#d8d4c8', roughness: 0.3 }, castShadow: false });
    }
    // Raised sidewalks along both streets.
    for (const side of [-1, 1]) {
        b.prim('sidewalk', 'box', [5, 0.22, 220], [r2(side * (AVE + 2.5)), 0.11, 0], { material: { preset: 'concrete', color: '#2a2d36', roughness: 0.25 }, physics: 'static', castShadow: false });
        b.prim('sidewalk', 'box', [200, 0.22, 5], [0, 0.11, r2(side * (CROSS + 2.5))], { material: { preset: 'concrete', color: '#2a2d36', roughness: 0.25 }, physics: 'static', castShadow: false });
    }
    // --- Towers with lit windows ------------------------------------------------------------------
    const towers = [];
    const sets = { litZ: [], litX: [], coolZ: [], coolX: [] };
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            // Each quadrant: two rows of towers back from the street corners.
            for (let k = 0; k < 5; k++) {
                for (let row = 0; row < 2; row++) {
                    const w = r2(b.rand(11, 16));
                    const d = r2(b.rand(11, 16));
                    const x = r2(sx * (AVE + 5 + w / 2 + row * 18 + b.rand(0, 2)));
                    const z = r2(sz * (CROSS + 5 + d / 2 + k * 19 + b.rand(0, 2)));
                    const near = row === 0 && k < 2;
                    const h = r2(near ? b.rand(26, 48) : b.rand(34, 92));
                    towers.push({ x, z, w, d, h });
                }
            }
        }
    }
    towers.forEach((t, i) => {
        const glass = i % 3 === 0;
        b.prim('tower', 'box', [t.w, t.h, t.d], [t.x, r2(t.h / 2), t.z], { name: 'Tower', material: glass ? { preset: 'metal', color: '#1d2433', roughness: 0.18, metalness: 0.75 } : { preset: 'concrete', finish: i % 3 === 1 ? 'brick' : 'concrete', color: b.pick(['#4a4655', '#54545f', '#5d5360', '#3f4b58']), roughness: 0.5 }, physics: 'static', tags: ['tower'] });
        // Rooftop clutter and a blinking mast: the skyline reads as a real city against the glow, not as bare boxes.
        for (let k = 0; k < 3; k++) {
            const bw = r2(b.rand(1.6, 3.2));
            b.prim('rooftop-unit', 'box', [bw, r2(b.rand(1, 2)), r2(b.rand(1.6, 3))], [r2(t.x + b.rand(-t.w * 0.28, t.w * 0.28)), r2(t.h + 2 + 0.7), r2(t.z + b.rand(-t.d * 0.28, t.d * 0.28))], { material: { preset: 'metal', color: '#3b3f48', roughness: 0.5, metalness: 0.6 }, physics: 'static' });
        }
        if (i % 2 === 0)
            b.prim('water-tank', 'cylinder', [2.4, 2.6, 2.4], [r2(t.x + t.w * 0.2), r2(t.h + 2 + 1.3), r2(t.z - t.d * 0.2)], { material: { preset: 'wood', color: '#4a3a2c', roughness: 0.8 }, physics: 'static' });
        const mast = b.prim('mast', 'cylinder', [0.18, r2(b.rand(6, 11)), 0.18], [r2(t.x - t.w * 0.25), r2(t.h + 2 + 4), r2(t.z + t.d * 0.25)], { material: { preset: 'metal', color: '#555a63' }, physics: 'static' });
        b.prim('mast-light', 'sphere', [0.5, 0.5, 0.5], [0, 5.3, 0], { parent: mast, material: { preset: 'emissive', color: '#ff2a2a', emissive: '#ff2a2a', emissiveIntensity: 3 }, castShadow: false, behaviors: [{ type: 'pulseLight', params: { min: 0.1, max: 3.4, period: r2(b.rand(1.2, 2.4)), property: 'material.emissiveIntensity' } }] });
        b.prim('crown', 'box', [r2(t.w * 0.7), 2, r2(t.d * 0.7)], [t.x, r2(t.h + 1), t.z], { material: { preset: 'concrete', color: '#22222a' }, physics: 'static' });
        if (i % 4 === 1)
            b.prim('crown-light', 'box', [r2(t.w * 0.72), 0.25, r2(t.d * 0.72)], [t.x, r2(t.h + 2.1), t.z], { material: { preset: 'neon', color: NEON[i % NEON.length], emissive: NEON[i % NEON.length], emissiveIntensity: 2.4 }, castShadow: false });
        windows(b, t, sets);
    });
    // Shallow boxes just proud of each facade (thin along the face normal), as four instanced layers.
    const windowLayer = (base, points, zFacing, color, intensity) => {
        if (points.length === 0)
            return;
        b.add({
            id: b.id(base),
            name: base.startsWith('warm') ? 'Lit windows' : 'Screen-lit windows',
            transform: { position: [0, 0, 0] },
            shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'box', size: zFacing ? [1.15, 1.55, 0.1] : [0.1, 1.55, 1.15] }, count: points.length, area: [400, 400], seed: 3, scaleRange: [1, 1], randomYaw: false, points: points.slice(0, 20_000) },
            material: { preset: 'emissive', color, emissive: color, emissiveIntensity: intensity },
            castShadow: false,
            receiveShadow: false,
            tags: ['windows'],
        });
    };
    windowLayer('warm-windows', sets.litZ, true, '#ffc983', 1.0);
    windowLayer('warm-windows', sets.litX, false, '#ffc983', 1.0);
    windowLayer('cool-windows', sets.coolZ, true, '#8fd8ff', 1.1);
    windowLayer('cool-windows', sets.coolX, false, '#8fd8ff', 1.1);
    // --- Neon signs on the street-facing towers ---------------------------------------------------------
    towers.filter((t) => Math.abs(t.x) < AVE + 14 || Math.abs(t.z) < CROSS + 14).forEach((t, i) => {
        const color = NEON[(i * 2) % NEON.length];
        const facingAve = Math.abs(t.x) < AVE + 14;
        const sx = Math.sign(t.x);
        const sz = Math.sign(t.z);
        const p = facingAve ? [r2(t.x - sx * (t.w / 2 + 0.9)), r2(b.rand(6, 11)), r2(t.z - sz * b.rand(0, t.d / 3))] : [r2(t.x - sx * b.rand(0, t.w / 3)), r2(b.rand(6, 11)), r2(t.z - sz * (t.d / 2 + 0.9))];
        const sign = b.prim('neon-sign', 'box', facingAve ? [0.35, 5.2, 1.4] : [1.4, 5.2, 0.35], p, {
            name: 'Neon sign',
            material: { preset: 'neon', color, emissive: color, emissiveIntensity: 3 },
            castShadow: false,
            behaviors: i % 3 === 0 ? [{ type: 'pulseLight', params: { min: 0.4, max: 3.2, period: r2(b.rand(0.25, 0.8)), property: 'material.emissiveIntensity' } }] : [],
            tags: ['sign'],
        });
        if (i < 6)
            b.light(sign, [facingAve ? -sx * 1.2 : 0, -2, facingAve ? 0 : -sz * 1.2], color, 3.2, 16);
        // A glowing strip under the sign's awning.
        b.prim('awning', 'box', facingAve ? [2, 0.12, 6] : [6, 0.12, 2], [r2(facingAve ? t.x - sx * (t.w / 2 + 1) : p[0]), 3.4, r2(facingAve ? p[2] : t.z - sz * (t.d / 2 + 1))], { material: { preset: 'neon', color: NEON[(i * 2 + 3) % NEON.length], emissive: NEON[(i * 2 + 3) % NEON.length], emissiveIntensity: 1.6 }, castShadow: false });
    });
    // --- Street furniture: lamps, puddles, steam ---------------------------------------------------------
    for (let z = -96; z <= 96; z += 24) {
        for (const side of [-1, 1]) {
            const lamp = b.asset('street-lamp', 'streetlight', [r2(side * (AVE + 0.6)), 0.22, z], { yaw: side > 0 ? -90 : 90, physics: 'static' });
            if (Math.abs(z) < 30)
                b.light(lamp, [r2(-side * 1.2), 4.6, 0], '#ffd9a8', 2.2, 14);
        }
    }
    for (let i = 0; i < 18; i++) {
        const x = r2(b.rand(-AVE + 1, AVE - 1));
        const z = r2(b.rand(-90, 90));
        b.prim('puddle', 'cylinder', [r2(b.rand(1.5, 3.5)), 0.01, r2(b.rand(1.2, 2.4))], [x, 0.045, z], { material: { preset: 'water', color: '#0f1420', roughness: 0.02, opacity: 0.9 }, castShadow: false });
    }
    for (const [x, z] of [[3, 30], [-4, -42], [5, -70], [-2, 60]]) {
        b.gen('steam', 'cloud', { size: 3, color: '#d9d4ff', variant: 1 }, [x, 0.6, z], { castShadow: false, material: { opacity: 0.45, emissive: '#5a4f8a', emissiveIntensity: 0.4 }, behaviors: [{ type: 'bob', params: { amplitude: 0.6, period: 3.2 } }] });
    }
    // --- Traffic and people ----------------------------------------------------------------------------
    const lanes = [[3.2, -1], [-3.2, 1]];
    const cars = ['taxi', 'car', 'van', 'taxi', 'suv', 'hatchback', 'taxi', 'delivery-truck'];
    cars.forEach((model, i) => {
        const [lx, dir] = lanes[i % 2];
        // A loop: up one lane of the avenue, across at the end, down the other.
        const loop = dir < 0 ? [[lx, 0.04, -105], [-lx, 0.04, -105], [-lx, 0.04, 105], [lx, 0.04, 105]] : [[lx, 0.04, 105], [-lx, 0.04, 105], [-lx, 0.04, -105], [lx, 0.04, -105]];
        const z0 = r2(-100 + ((i * 53) % 200));
        const car = b.asset('car', model, [lx, 0.04, z0], {
            name: model === 'taxi' ? 'Taxi' : 'Car',
            yaw: dir < 0 ? 0 : 180,
            physics: { body: 'kinematic', sensor: true },
            behaviors: [{ type: 'patrol', params: { waypoints: loop, speed: r2(b.rand(7, 11)), mode: 'loop', face: true } }],
            tags: ['traffic'],
            fallback: { kind: 'procedural', generator: 'car', params: { length: 4.2, color: '#ffd23f' } },
        });
        // Headlights and tail lights.
        b.prim('headlights', 'box', [1.6, 0.18, 0.1], [0, 0.75, -2.3], { parent: car, material: { preset: 'emissive', color: '#fff6e0', emissive: '#fff6e0', emissiveIntensity: 4 }, castShadow: false });
        b.prim('taillights', 'box', [1.6, 0.16, 0.1], [0, 0.8, 2.3], { parent: car, material: { preset: 'emissive', color: '#ff2e3c', emissive: '#ff2e3c', emissiveIntensity: 3 }, castShadow: false });
    });
    const coats = ['#2b2f3a', '#8c2f39', '#2f5d8c', '#c9a227', '#3d6b4f', '#6b3f8c', '#1d1d24', '#b5651d'];
    coats.forEach((coat, i) => {
        const side = i % 2 ? 1 : -1;
        // Real pedestrians from the cast in rain coats (the capsule is only the collider).
        b.prim('pedestrian', 'capsule', [0.56, 1.7, 0.56], [r2(side * (AVE + 2.5)), 0.22 + 0.85, r2(-60 + i * 16)], { character: { wardrobe: i % 4 === 3 ? 'worker' : 'casual', gender: i % 2 ? 'female' : 'male', top: coat, mood: i % 3 === 0 ? 'tired' : 'neutral', hold: i % 4 === 1 ? 'bag' : 'none' }, behaviors: [{ type: 'patrol', params: { waypoints: [[0, 0, -12], [0, 0, 12]], relative: true, speed: r2(b.rand(1.1, 1.5)), mode: 'pingpong', wait: 1, face: true } }], physics: { body: 'kinematic', sensor: true }, tags: ['pedestrian'] });
    });
    // --- The game: five neon cats -------------------------------------------------------------------------
    const cats = [[r2(AVE + 3.5), 0.9, -38], [r2(-AVE - 3.5), 0.9, 52], [-34, 0.9, r2(CROSS + 3.5)], [41, 0.9, r2(-CROSS - 3.5)], [r2(AVE + 3.5), 0.9, 86]];
    cats.forEach((p, i) => {
        pickup(b, 'neon-cat', p, { scoreKey: 'cats', color: NEON[i], size: 0.9, shape: 'sphere', name: 'Neon cat', message: 'Meow! A neon cat.', tags: ['cat'] });
        b.asset('cat-body', 'cat-statue', [p[0], 0.22, p[2]], { fitSize: 0.9, castShadow: false });
    });
    b.player({ mode: 'thirdPerson', spawn: [0, 0.3, 14], moveSpeed: 6 });
    b.state('cats', 0);
    b.hud('cats', 'Neon cats / 5');
    b.rule({ id: 'hint', when: { on: 'start' }, then: [{ do: 'message', text: 'Five neon cats are hiding on these blocks. Find them all.', duration: 4 }] });
    b.rule({ id: 'all-cats', when: { on: 'state', key: 'cats', op: '>=', value: 5 }, then: [{ do: 'sound', sound: 'win' }, { do: 'win', text: 'All five neon cats found. The city purrs.' }], once: true });
    b.rule({ id: 'reset-key', when: { on: 'key', key: 'r' }, then: [{ do: 'reset' }] });
    b.test({ id: 'traffic-flows', kind: 'moves', target: '#traffic', distance: 10, within: 5 });
    b.test({ id: 'towers-stand', kind: 'stable', target: '#tower', seconds: 1, maxDrift: 0.01 });
    b.test({ id: 'cats-float', kind: 'staysAbove', target: '#cat', y: 0.3, within: 3 });
    return finish(b, {
        name: 'Neon Rain City',
        description: 'A rain-soaked downtown at night, lit window by window — find the five neon cats.',
        intro: {
            title: 'Neon Rain City',
            tagline: 'Rain, wet asphalt and a thousand lit windows. The city never sleeps.',
            objective: 'Walk the blocks and find the five neon cats hiding by the street.',
            controls: ['WASD — walk', 'Space — jump', 'Mouse — look', 'R — restart', 'Esc — editor'],
            accent: '#ff2e88',
        },
        plan: 'Plan: a night downtown in the rain — avenue and cross street with wet asphalt, 40 towers with two instanced layers of lit windows, flickering neon signs with coloured lights, street lamps, puddles and steam, eight cars and eight pedestrians on patrol, five neon cat pickups and a win rule.',
        message: 'Built Neon Rain City: a rain-soaked downtown at night — towers lit window by window, flickering neon over wet asphalt, traffic and people. Press Play and find the five neon cats (WASD to walk).',
    });
}
