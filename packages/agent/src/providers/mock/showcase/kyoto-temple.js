/**
 * Kyoto Temple Lanterns — a story in four chapters at dusk in the rain. A
 * tunnel of vermilion torii climbs the hill past stone lanterns; at each
 * shrine an old monk tells part of the temple's story; light the four
 * shrine lanterns and climb to the great bell. Ring it (E) to end the tale.
 */
import { r2 } from '../builder';
import { faceToward, finish, flagshipBuilder, glowLantern, onCircle } from './kit';
/** The pilgrim path: from the gate (south) up the hill to the bell court (north). */
const PATH = [
    [0, 0, 46],
    [0, 0, 30],
    [-6, 0, 16],
    [-8, 0, 2],
    [-2, 0, -12],
    [6, 0, -24],
    [6, 0, -38],
];
/** A temple hall built from parts: stone podium, timber columns, a deep dark roof with flared eaves. */
function hall(b, x, z, w, d, yaw, name) {
    const base = b.prim('hall-podium', 'box', [r2(w + 2), 0.8, r2(d + 2)], [x, 0.4, z], { yaw, name, material: { preset: 'stone', color: '#8f8a82' }, physics: 'static', tags: ['hall'] });
    b.prim('hall-body', 'box', [w, 3.6, d], [0, 2.2, 0], { parent: base, material: { preset: 'wood', color: '#5a2e22' } });
    b.prim('hall-panels', 'box', [r2(w - 0.4), 2.6, r2(d + 0.06)], [0, 1.9, 0], { parent: base, material: { preset: 'fabric', color: '#f1e3c4', emissive: '#ffcf8a', emissiveIntensity: 0.55 } });
    for (const sx of [-1, 1])
        for (const sz of [-1, 1])
            b.prim('hall-column', 'cylinder', [0.45, 3.8, 0.45], [r2(sx * (w / 2 + 0.3)), 2.3, r2(sz * (d / 2 + 0.3))], { parent: base, material: { preset: 'wood', color: '#c0392b' } });
    b.prim('hall-roof', 'box', [r2(w + 3.4), 0.5, r2(d + 3.4)], [0, 4.35, 0], { parent: base, material: { preset: 'stone', color: '#2c3238', roughness: 0.6 } });
    b.prim('hall-roof-top', 'cone', [r2(Math.max(w, d) + 2.2), 2.6, r2(Math.max(w, d) + 2.2)], [0, 5.8, 0], { parent: base, rot: [0, 45, 0], scale: [1, 1, r2(d / w)], material: { preset: 'stone', color: '#2c3238', roughness: 0.6, flatShading: true } });
    return base;
}
/** Plan Kyoto Temple Lanterns. */
export function kyotoTemple() {
    const b = flagshipBuilder(0x6b70, { dusk: true, rain: true });
    b.env({
        sky: 'sunset',
        timeOfDay: 18.4,
        sunIntensity: 1.1,
        ambientIntensity: 0.4,
        fog: { color: '#6d5a72', density: 0.012, visibility: 260 },
        weather: 'rain',
        bloom: 1.2,
        exposure: 1.1,
        ground: { material: { preset: 'grass', color: '#4d6a3c', roughness: 0.9 }, size: 260 },
    });
    // --- The path, the torii tunnel and the lanterns --------------------------------------------
    for (let i = 0; i < PATH.length - 1; i++) {
        const a = PATH[i];
        const c = PATH[i + 1];
        const len = Math.hypot(c[0] - a[0], c[2] - a[2]);
        const yaw = faceToward(a[0], a[2], c[0], c[2]);
        b.prim('stone-path', 'box', [3.4, 0.08, r2(len + 1.2)], [r2((a[0] + c[0]) / 2), 0.04, r2((a[2] + c[2]) / 2)], { yaw, material: { preset: 'stone', color: '#7d776d', roughness: 0.35 }, castShadow: false, tags: ['path'] });
        // Torii every ~2.4 m along the first three legs: the famous tunnel.
        if (i < 3) {
            const n = Math.floor(len / 2.4);
            for (let k = 0; k < n; k++) {
                const t = (k + 0.5) / n;
                b.gen('torii', 'torii-gate', { height: 4.4, color: '#d9452b' }, [r2(a[0] + (c[0] - a[0]) * t), 0, r2(a[2] + (c[2] - a[2]) * t)], { yaw, physics: 'static', tags: ['torii'] });
            }
        }
        // Stone lanterns flanking the upper legs (a few real lights, the rest glow).
        if (i >= 3) {
            const mx = (a[0] + c[0]) / 2;
            const mz = (a[2] + c[2]) / 2;
            const nx = -(c[2] - a[2]) / len;
            const nz = (c[0] - a[0]) / len;
            for (const side of [-1, 1])
                glowLantern(b, [r2(mx + nx * 2.6 * side), 0, r2(mz + nz * 2.6 * side)], '#ffb15c', { height: 1.2, lit: side > 0, shade: '#f3e2c0' });
        }
    }
    // --- Chapters: four shrines with a monk's story ---------------------------------------------------
    const chapters = [
        { at: [4, 0, 24], title: 'Chapter I — The Thousand Gates', lines: ['Each gate was a gift from someone who once climbed this hill.', 'Walk slowly. The rain keeps their names.'] },
        { at: [-13, 0, 6], title: 'Chapter II — The Lantern Keeper', lines: ['A girl once lit every lantern on this slope in one night.', 'Light this one, and the path will remember you.'] },
        { at: [4, 0, -8], title: 'Chapter III — The Pagoda in the Rain', lines: ['Five roofs, five elements. Earth, water, fire, wind, sky.', 'The storm has never once put out its lamp.'] },
        { at: [-1, 0, -30], title: 'Chapter IV — The Silent Bell', lines: ['The great bell has been silent since the keeper left.', 'Light the four shrine lanterns, then ring it with E.'] },
    ];
    chapters.forEach((ch, i) => {
        const shrine = b.prim('shrine', 'box', [1.6, 1.4, 1.2], [ch.at[0], 0.7, ch.at[2]], { name: `Shrine ${i + 1}`, material: { preset: 'wood', color: '#6b3a2a' }, physics: 'static', tags: ['shrine'] });
        b.prim('shrine-roof', 'cone', [2.4, 0.9, 2], [0, 1.15, 0], { parent: shrine, rot: [0, 45, 0], material: { preset: 'stone', color: '#2c3238', flatShading: true } });
        const lamp = b.prim('shrine-lantern', 'box', [0.5, 0.6, 0.5], [r2(ch.at[0] + 1.3), 1.1, ch.at[2]], {
            name: `Shrine lantern ${i + 1}`,
            material: { preset: 'emissive', color: '#5a4636', emissive: '#ffb15c', emissiveIntensity: 0.05 },
            tags: ['shrine-lantern'],
            castShadow: false,
        });
        b.prim('shrine-lantern-post', 'box', [0.14, 0.8, 0.14], [0, -0.7, 0], { parent: lamp, material: { preset: 'wood', color: '#3b2a20' } });
        const glow = b.light(lamp, [0, 0.2, 0], '#ffb15c', 0, 9);
        // Standing in front of the shrine lights its lantern and tells the chapter.
        const zone = b.prim('chapter-zone', 'cylinder', [5, 3, 5], [ch.at[0], 1.5, r2(ch.at[2] + 1)], { visible: false, physics: { body: 'static', sensor: true }, tags: ['chapter-zone'] });
        b.rule({
            id: `chapter-${i + 1}`,
            description: ch.title,
            when: { on: 'enter', zone },
            then: [
                { do: 'message', text: ch.title, duration: 4 },
                { do: 'setProperty', target: lamp, path: 'material.emissiveIntensity', value: 3.2 },
                { do: 'setProperty', target: glow, path: 'light.intensity', value: 2.4 },
                { do: 'add', key: 'chapters', amount: 1 },
                { do: 'sound', sound: 'bell' },
            ],
            once: true,
        });
        b.prim('monk', 'capsule', [0.56, 1.7, 0.56], [r2(ch.at[0] - 1.6), 0.85, r2(ch.at[2] + 0.8)], {
            character: { wardrobe: 'elder', gender: 'male', age: 'old', top: i % 2 ? '#7a4a22' : '#8a5a2b', bottom: '#4a3b2a', mood: 'calm', hold: i % 2 ? 'staff' : 'lantern' },
            name: 'The old monk',
            yaw: faceToward(ch.at[0] - 1.6, ch.at[2] + 0.8, 0, 46),
            physics: 'kinematic',
            behaviors: [{ type: 'npc', params: { name: 'Monk Ryōkan', persona: 'an old monk who tells the temple’s story in short, quiet sentences', lines: ch.lines, greetRadius: 4, talkInterval: 4.5, wander: false } }],
            tags: ['npc'],
        });
    });
    // --- The temple: pagoda, halls, bell tower, pond ------------------------------------------------------
    b.gen('pagoda', 'pagoda', { tiers: 5, roofColor: '#2c3238', wallColor: '#c0392b' }, [16, 0, -14], { physics: 'static', name: 'Five-storey pagoda', tags: ['landmark'] });
    b.light(b.empty('pagoda-lamp', [16, 3, -10]), [0, 0, 0], '#ffb15c', 2.6, 14);
    hall(b, -16, -26, 9, 6, 15, 'Main hall');
    hall(b, 20, -36, 7, 5, -20, 'Sutra hall');
    const court = b.prim('bell-court', 'box', [10, 0.4, 10], [6, 0.2, -44], { name: 'Bell court', material: { preset: 'stone', color: '#8f8a82' }, physics: 'static' });
    void court;
    for (const [x, z] of [[2.5, -40.5], [9.5, -40.5], [2.5, -47.5], [9.5, -47.5]])
        b.prim('belfry-post', 'box', [0.4, 5, 0.4], [x, 2.9, z], { material: { preset: 'wood', color: '#5a2e22' }, physics: 'static' });
    b.prim('belfry-roof', 'cone', [10.5, 2.4, 10.5], [6, 6.6, -44], { rot: [0, 45, 0], material: { preset: 'stone', color: '#2c3238', flatShading: true }, physics: 'static' });
    const bell = b.prim('great-bell', 'cylinder', [2, 2.6, 2], [6, 3.5, -44], { name: 'The great bell', material: { preset: 'metal', color: '#6a5a3a', roughness: 0.4, metalness: 0.8 }, tags: ['bell', 'landmark'] });
    b.prim('bell-zone', 'box', [9, 3, 9], [6, 1.9, -44], { visible: false, physics: { body: 'static', sensor: true }, behaviors: [{ type: 'pressurePlate', params: { who: 'player', stateKey: 'atBell', height: 3 } }] });
    // Koi pond with a little bridge beside the path.
    b.prim('pond', 'cylinder', [12, 0.06, 9], [-18, 0.04, 22], { name: 'Koi pond', material: { preset: 'water', color: '#22424a', opacity: 0.9, roughness: 0.03 }, castShadow: false, tags: ['water'] });
    b.keepClear(-18, 22, 7);
    b.gen('pond-bridge', 'bridge', { length: 9, width: 1.6, height: 1.2, color: '#c0392b', variant: 0 }, [-18, 0, 22], { physics: 'static', name: 'Moon bridge' });
    for (let i = 0; i < 6; i++) {
        const [x, , z] = onCircle(-18, 22, 3, (i / 6) * Math.PI * 2);
        b.asset('koi', 'fish', [x, 0.02, z], { fitSize: 0.6, physics: { body: 'kinematic', sensor: true }, behaviors: [{ type: 'orbit', params: { center: [-18, 0.02, 22], radius: r2(2 + (i % 3) * 0.9), speed: r2(14 + i * 3) } }], castShadow: false, tags: ['koi'] });
    }
    // --- Planting: cherry, maple, pines, bamboo, moss rocks; mountains in the mist --------------------------
    const tree = (gen, p, x, z) => {
        if (!b.claim(x, z, 2))
            return;
        b.gen('garden-tree', gen, p, [x, 0, z], { yaw: r2(b.rand(0, 360)), physics: 'static', tags: ['tree'] });
    };
    for (let i = 0; i < 40; i++) {
        const x = r2(b.rand(-40, 40));
        const z = r2(b.rand(-60, 56));
        // Keep the path corridor clear.
        if (PATH.some((p) => Math.hypot(p[0] - x, p[2] - z) < 6))
            continue;
        const roll = b.rand(0, 1);
        if (roll < 0.25)
            tree('hero-cherry-tree', { height: 5.5, spread: 6.5 }, x, z);
        else if (roll < 0.5)
            tree('tree-oak', { height: r2(b.rand(5, 7)), color: '#c2402a', density: 7, variant: 2 }, x, z);
        else
            tree('tree-pine', { height: r2(b.rand(9, 14)), color: '#2b4a35', tiers: 6, variant: 1 }, x, z);
    }
    b.scatter('moss', 'grass-tuft', { size: 0.45, color: '#5f7f3a', blades: 12 }, 1400, [80, 110], [0, 0, -2], { minSpacing: 0.9, scaleRange: [0.7, 1.4] });
    b.scatter('mossy-rocks', 'rock', { size: 1.2, color: '#7d7468', mossy: true, variant: 0 }, 60, [80, 110], [0, 0, -2], { minSpacing: 4, scaleRange: [0.5, 1.4] });
    for (let i = 0; i < 7; i++) {
        const [x, , z] = onCircle(0, -10, b.rand(130, 160), Math.PI * 0.9 + (i / 7) * Math.PI * 1.2);
        b.gen('mountain', 'mountain', { size: r2(b.rand(90, 130)), height: r2(b.rand(40, 70)), color: '#45405a', snowLine: 0.92, groundColor: '#4d6a3c' }, [x, 0, z], { tags: ['backdrop'] });
    }
    // --- Rules: lanterns, the bell, the ending ----------------------------------------------------------
    b.player({ mode: 'thirdPerson', spawn: [0, 0.2, 52], moveSpeed: 4.6, jumpSpeed: 5 });
    b.state('chapters', 0);
    b.state('atBell', false);
    b.hud('chapters', 'Chapters / 4');
    b.rule({ id: 'prologue', when: { on: 'start' }, then: [{ do: 'message', text: 'Prologue — Climb through the gates. Stop at every shrine.', duration: 5 }] });
    b.rule({
        id: 'ring-bell',
        description: 'Press E at the bell once every chapter is told',
        when: { on: 'key', key: 'e' },
        if: [{ key: 'atBell', op: '==', value: true }, { key: 'chapters', op: '>=', value: 4 }],
        then: [{ do: 'sound', sound: 'bell' }, { do: 'setProperty', target: bell, path: 'material.emissiveIntensity', value: 0.6 }, { do: 'emit', event: 'rung' }],
        once: true,
    });
    b.rule({ id: 'not-yet', when: { on: 'key', key: 'e' }, if: [{ key: 'atBell', op: '==', value: true }, { key: 'chapters', op: '<', value: 4 }], then: [{ do: 'message', text: 'The bell waits. Hear every chapter first.', duration: 3 }] });
    b.rule({ id: 'epilogue', when: { on: 'event', name: 'rung' }, then: [{ do: 'sound', sound: 'win' }, { do: 'win', text: 'Epilogue — The bell rolls down the hill through the rain, and every lantern answers.' }], once: true });
    b.rule({ id: 'reset-key', when: { on: 'key', key: 'r' }, then: [{ do: 'reset' }] });
    b.test({ id: 'koi-swim', kind: 'moves', target: '#koi', distance: 1, within: 6 });
    b.test({ id: 'no-overlap', kind: 'noOverlap' });
    return finish(b, {
        name: 'Kyoto Temple Lanterns',
        description: 'A rain-soaked temple hill at dusk: a story in four chapters and a silent bell.',
        intro: {
            title: 'Kyoto Temple Lanterns',
            tagline: 'Rain on a thousand gates, lanterns waking one by one, an old monk’s story.',
            objective: 'Climb the torii path, hear all four chapters, then ring the great bell with E.',
            controls: ['WASD — walk', 'Mouse — look', 'E — ring the bell', 'R — restart', 'Esc — editor'],
            accent: '#e05a3a',
        },
        plan: 'Plan: a dusk temple hill in the rain — a stone path through a tunnel of torii, stone lanterns, four story shrines with a monk NPC and chapter rules, pagoda, halls, a bell court with an interaction zone, koi pond and bridge, cherry, maple and pine planting, misty mountains.',
        message: 'Built Kyoto Temple Lanterns: a rain-soaked temple hill at dusk. Press Play, climb the torii path, stop at each shrine for the monk’s story, then ring the great bell with E.',
    });
}
