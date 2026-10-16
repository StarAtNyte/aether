/**
 * Small test worlds ("labs") for checking the renderer's materials and lights side by side, as World IR
 * patches. `photoreal.e2e.ts --lab=<name>` replaces the open world with one of them and shoots it from
 * the lab's camera.
 */
function box(id, size, position, material, rotation = [0, 0, 0]) {
    return {
        op: 'add',
        entity: { id, shape: { kind: 'primitive', primitive: 'box', size }, transform: { position, rotation, scale: [1, 1, 1] }, material, castShadow: true, receiveShadow: true },
    };
}
function sphere(id, radius, position, material) {
    return {
        op: 'add',
        entity: { id, shape: { kind: 'primitive', primitive: 'sphere', size: [radius * 2, radius * 2, radius * 2] }, transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] }, material, castShadow: true, receiveShadow: true },
    };
}
function lamp(id, position, light, size = [0.2, 0.05, 0.2]) {
    return {
        op: 'add',
        entity: {
            id,
            shape: { kind: 'primitive', primitive: 'box', size },
            transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
            material: { color: '#fff4e0', emissive: '#fff4e0', emissiveIntensity: 3 },
            light,
            castShadow: false,
        },
    };
}
/** A dim room with an area panel, an IES-style batwing spot, a narrow downlight and a point lamp over four finishes. */
const lights = {
    cam: { pos: [0, 2.2, 8.5], target: [0, 1.1, -2] },
    patches: [
        { op: 'clear', keepEnvironment: false },
        { op: 'setEnvironment', set: { sky: 'night', timeOfDay: 23, sunIntensity: 0.4, ambientIntensity: 0.05, fog: null, ground: null, bloom: 0.6 } },
        box('floor', [16, 0.1, 12], [0, -0.05, -1], { finish: 'oak' }),
        box('wall', [16, 4.5, 0.2], [0, 2.2, -6.5], { finish: 'plaster', color: '#d9d3c8' }),
        box('wall-left', [0.2, 4.5, 12], [-8, 2.2, -1], { finish: 'plaster', color: '#c9c2b6' }),
        sphere('ball-marble', 0.55, [-4.2, 0.55, -3.2], { finish: 'marble' }),
        sphere('ball-metal', 0.55, [-1.4, 0.55, -3.2], { finish: 'brushed-metal' }),
        sphere('ball-leather', 0.55, [1.4, 0.55, -3.2], { finish: 'leather', color: '#6e4128' }),
        sphere('ball-plaster', 0.55, [4.2, 0.55, -3.2], { finish: 'plaster' }),
        box('block', [1.4, 0.8, 0.8], [0, 0.4, -1.2], { finish: 'concrete' }),
        lamp('panel', [-4, 3.6, -3], { type: 'area', color: '#fff1dd', intensity: 2.2, size: [2.4, 0.5] }, [2.4, 0.04, 0.5]),
        lamp('batwing', [3.2, 3.8, -3], { type: 'spot', color: '#ffe6c0', intensity: 3, angle: 48, range: 12, profile: 'batwing' }),
        lamp('downlight', [0, 3.8, -3], { type: 'spot', color: '#ffffff', intensity: 3.2, angle: 26, range: 12, profile: 'narrow' }),
        lamp('lamp', [-1.2, 1.7, 0.6], { type: 'point', color: '#ffb36b', intensity: 1.4, range: 8 }, [0.18, 0.18, 0.18]),
    ],
};
/** Only an area panel (and a dim sky) over a floor and a wall: shows which way the panel shines. */
const area = {
    cam: { pos: [0, 2.6, 8.5], target: [0, 1.0, -2] },
    patches: [
        { op: 'clear', keepEnvironment: false },
        { op: 'setEnvironment', set: { sky: 'night', timeOfDay: 23, sunIntensity: 0.1, ambientIntensity: 0.02, fog: null, ground: null, bloom: 0.3 } },
        box('floor', [16, 0.1, 12], [0, -0.05, -1], { finish: 'plaster', color: '#cfcfcf' }),
        box('wall', [16, 4.5, 0.2], [0, 2.2, -6.5], { finish: 'plaster', color: '#cfcfcf' }),
        sphere('ball', 0.6, [0, 0.6, -3], { finish: 'plaster', color: '#dddddd' }),
        lamp('panel', [-2, 2.6, -3], { type: 'area', color: '#ffffff', intensity: 2, size: [2, 1] }, [2, 0.04, 1]),
    ],
};
/** Chrome and matte spheres under the day sky: the sun light's highlight and the HDRI's reflection must coincide. */
const sun = {
    cam: { pos: [0, 2.2, 7], target: [0, 1.0, 0] },
    patches: [
        { op: 'clear', keepEnvironment: false },
        { op: 'setEnvironment', set: { sky: 'day', timeOfDay: 14, sunIntensity: 3, ambientIntensity: 0.4, weather: 'clear', ground: { material: { finish: 'concrete', color: '#9a968e' }, size: 60 } } },
        sphere('chrome-a', 0.9, [-2.4, 0.9, 0], { finish: 'chrome' }),
        sphere('chrome-b', 0.9, [0, 0.9, 0], { finish: 'chrome' }),
        sphere('matte', 0.9, [2.4, 0.9, 0], { finish: 'plaster', color: '#d8d4cc' }),
    ],
};
/** Every photographed finish as a sphere, lit by the day sky, to check scale, albedo balance and roughness at a glance. */
const FINISH_ROWS = [
    [{ finish: 'oak' }, { finish: 'walnut' }, { finish: 'marble' }, { finish: 'terrazzo' }, { finish: 'concrete' }, { finish: 'plaster' }],
    [{ finish: 'brick' }, { finish: 'stone' }, { finish: 'tile' }, { finish: 'fabric' }, { finish: 'leather' }, { finish: 'brushed-metal' }],
    [{ finish: 'grass' }, { finish: 'gravel' }, { finish: 'soil' }, { finish: 'sand' }, { finish: 'snow' }, { finish: 'rock' }],
    [{ finish: 'bark' }, { finish: 'asphalt' }, { preset: 'grass' }, { preset: 'stone' }, { preset: 'wood' }, { preset: 'dirt' }],
];
const materials = {
    cam: { pos: [0, 6.2, 11], target: [0, 1.6, 0] },
    patches: [
        { op: 'clear', keepEnvironment: false },
        { op: 'setEnvironment', set: { sky: 'day', timeOfDay: 14, sunIntensity: 3, ambientIntensity: 0.45, weather: 'clear', ground: { material: { finish: 'concrete', color: '#b8b4ac' }, size: 60 } } },
        ...FINISH_ROWS.flatMap((row, r) => row.map((m, c) => sphere(`m-${r}-${c}`, 0.8, [(c - 2.5) * 2, 0.8 + (FINISH_ROWS.length - 1 - r) * 0, -r * 2 + 2], m))),
    ],
};
/** A pond and a glass pane over a sunlit lawn: reflections of the sky and the surroundings. */
const water = {
    cam: { pos: [0, 2.4, 9], target: [0, 0.6, -2] },
    patches: [
        { op: 'clear', keepEnvironment: false },
        { op: 'setEnvironment', set: { sky: 'sunset', timeOfDay: 17.4, sunIntensity: 3, ambientIntensity: 0.4, weather: 'clear', ground: { material: { preset: 'grass' }, size: 80 } } },
        box('pond', [10, 0.05, 6], [-2, 0.03, -2], { preset: 'water' }),
        box('pane', [3, 2.4, 0.06], [4.5, 1.2, -1.5], { finish: 'glass' }, [0, -25, 0]),
        box('pier', [6, 0.12, 1.2], [-2, 0.3, 1.5], { finish: 'decking' }),
        sphere('rock', 0.7, [-6, 0.4, -3], { preset: 'stone' }),
        sphere('chrome', 0.6, [2, 0.6, -0.5], { finish: 'chrome' }),
    ],
};
function gen(id, generator, position, params = {}, extra = {}) {
    return { op: 'add', entity: { id, shape: { kind: 'procedural', generator, params }, transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] }, physics: { body: 'static' }, ...extra } };
}
/** Realistic vegetation and layered terrain under the day sun: broadleaf, birch, spruce, shrubs, ferns, grass, boulders on a hill. */
const flora = {
    cam: { pos: [-2, 2.4, 20], target: [2, 3.4, -4] },
    patches: [
        { op: 'clear', keepEnvironment: false },
        { op: 'setEnvironment', set: { sky: 'day', timeOfDay: 15.5, sunIntensity: 3, ambientIntensity: 0.45, weather: 'clear', fog: { color: '#bcd0e0', density: 0.004 }, ground: null, bloom: 0.25 } },
        gen('hills', 'terrain', [0, -2, -10], { size: 120, height: 14, resolution: 160, variant: 0, roughness: 0.55 }),
        gen('oak', 'tree-broadleaf', [-9, 1.4, 2], { height: 10, variant: 0 }),
        gen('oak-2', 'tree-broadleaf', [6, 1.1, -3], { height: 12, variant: 2, color: '#5c8a34' }),
        gen('birch', 'tree-birch', [-3, 1.3, -2], { height: 8 }),
        gen('birch-2', 'tree-birch', [1, 1.2, 4], { height: 7 }),
        gen('spruce', 'tree-spruce', [12, 1.0, 5], { height: 14 }),
        gen('spruce-2', 'tree-spruce', [-14, 1.5, -6], { height: 10 }),
        gen('shrub', 'shrub', [-5, 1.3, 7], { size: 1.6 }),
        gen('shrub-2', 'shrub', [4, 1.2, 8], { size: 1.3, color: '#5a7a2a' }),
        gen('fern', 'fern', [-1, 1.2, 9], { size: 0.9 }),
        gen('boulder', 'boulder', [2, 1.1, 10], { size: 2.2, variant: 0 }),
        gen('boulder-2', 'boulder', [-7, 1.2, 10], { size: 1.4, variant: 2 }),
        { op: 'add', entity: { id: 'grass', shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'meadow-grass', params: { size: 0.6 } }, count: 900, area: [30, 18], minSpacing: 0.35 }, transform: { position: [0, 1.2, 4], rotation: [0, 0, 0], scale: [1, 1, 1] } } },
    ],
};
/** The labs by name. */
export const LABS = Object.freeze({ lights, materials, water, area, sun, flora });
