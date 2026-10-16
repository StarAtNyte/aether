/** Drag-and-drop MIME type of palette tiles. */
export const PALETTE_DRAG_TYPE = 'application/x-aether-palette';
/** Section titles and helper text. */
export const PALETTE_SECTIONS = [
    { id: 'primitives', title: 'Primitives', hint: 'Basic shapes with physics' },
    { id: 'nature', title: 'Nature', hint: 'Trees, rocks and plants' },
    { id: 'buildings', title: 'Buildings', hint: 'Structures and paths' },
    { id: 'props', title: 'Props', hint: 'Furniture and objects' },
    { id: 'gameplay', title: 'Gameplay', hint: 'Pickups, goals and hazards' },
    { id: 'lights', title: 'Lights', hint: 'Local light sources' },
    { id: 'effects', title: 'Effects', hint: 'Glow and magic' },
];
const NEUTRAL = '#d4d7de';
function prim(id, label, primitive, size, dynamic) {
    return {
        id,
        label,
        section: 'primitives',
        keywords: `shape primitive ${primitive}`,
        entity: {
            name: label,
            shape: { kind: 'primitive', primitive, size },
            material: { preset: 'plastic', color: NEUTRAL },
            physics: { body: dynamic ? 'dynamic' : 'static' },
        },
    };
}
function gen(id, label, section, keywords, extra = {}) {
    return {
        id,
        label,
        section,
        keywords,
        entity: { name: label, shape: { kind: 'procedural', generator: id, params: {} }, physics: { body: 'static' }, ...extra },
    };
}
/** Everything in the palette. */
export const PALETTE_ITEMS = Object.freeze([
    prim('box', 'Box', 'box', [1, 1, 1], true),
    prim('sphere', 'Sphere', 'sphere', [1, 1, 1], true),
    prim('cylinder', 'Cylinder', 'cylinder', [1, 1, 1], true),
    prim('cone', 'Cone', 'cone', [1, 1.2, 1], false),
    prim('capsule', 'Capsule', 'capsule', [0.6, 1.4, 0.6], true),
    prim('torus', 'Torus', 'torus', [1.2, 0.3, 1.2], false),
    prim('plane', 'Plane', 'plane', [4, 0.05, 4], false),
    gen('tree-pine', 'Pine tree', 'nature', 'tree conifer forest'),
    gen('tree-oak', 'Oak tree', 'nature', 'tree forest'),
    gen('tree-palm', 'Palm tree', 'nature', 'tree tropical beach'),
    gen('bush', 'Bush', 'nature', 'shrub plant'),
    gen('rock', 'Rock', 'nature', 'stone boulder'),
    gen('flowers', 'Flowers', 'nature', 'plant garden', { physics: undefined }),
    gen('mushroom', 'Mushroom', 'nature', 'fungus forest'),
    gen('house', 'House', 'buildings', 'home cottage building'),
    gen('tower', 'Tower', 'buildings', 'castle keep'),
    gen('windmill', 'Windmill', 'buildings', 'mill farm'),
    gen('wall', 'Wall', 'buildings', 'barrier'),
    gen('fence', 'Fence', 'buildings', 'barrier garden'),
    gen('bridge', 'Bridge', 'buildings', 'crossing river'),
    gen('stairs', 'Stairs', 'buildings', 'steps'),
    gen('arch', 'Arch', 'buildings', 'gate doorway'),
    gen('crate', 'Crate', 'props', 'box wooden', { physics: { body: 'dynamic' } }),
    gen('barrel', 'Barrel', 'props', 'keg', { physics: { body: 'dynamic' } }),
    gen('bench', 'Bench', 'props', 'seat park'),
    gen('table', 'Table', 'props', 'furniture'),
    gen('chair', 'Chair', 'props', 'seat furniture'),
    gen('tent', 'Tent', 'props', 'camp'),
    gen('lamp-post', 'Lamp post', 'props', 'street light lantern'),
    gen('statue', 'Statue', 'props', 'monument sculpture'),
    {
        id: 'coin',
        label: 'Coin',
        section: 'gameplay',
        keywords: 'pickup collectible gold score',
        entity: {
            name: 'Coin',
            tags: ['coin', 'pickup'],
            transform: { position: [0, 1, 0], rotation: [90, 0, 0], scale: [1, 1, 1] },
            shape: { kind: 'primitive', primitive: 'cylinder', size: [0.6, 0.1, 0.6] },
            material: { preset: 'gold' },
            behaviors: [
                { type: 'spin', params: {} },
                { type: 'collectible', params: {} },
            ],
        },
    },
    {
        id: 'goal',
        label: 'Goal',
        section: 'gameplay',
        keywords: 'finish win flag end',
        entity: {
            name: 'Goal',
            tags: ['goal'],
            shape: { kind: 'primitive', primitive: 'cylinder', size: [1.6, 0.1, 1.6] },
            material: { preset: 'neon', color: '#3ecf8e', emissive: '#3ecf8e', emissiveIntensity: 1.5 },
            physics: { body: 'static', sensor: true },
            behaviors: [{ type: 'goal', params: {} }],
        },
    },
    {
        id: 'hazard',
        label: 'Lava pad',
        section: 'gameplay',
        keywords: 'hazard lava danger lose',
        entity: {
            name: 'Lava pad',
            tags: ['hazard'],
            shape: { kind: 'primitive', primitive: 'box', size: [3, 0.1, 3] },
            material: { preset: 'lava' },
            physics: { body: 'static', sensor: true },
            behaviors: [{ type: 'hazard', params: {} }],
        },
    },
    {
        id: 'launcher',
        label: 'Jump pad',
        section: 'gameplay',
        keywords: 'launcher bounce trampoline',
        entity: {
            name: 'Jump pad',
            shape: { kind: 'primitive', primitive: 'cylinder', size: [1.4, 0.2, 1.4] },
            material: { preset: 'rubber', color: '#5b6cf0' },
            physics: { body: 'static' },
            behaviors: [{ type: 'launcher', params: {} }],
        },
    },
    {
        id: 'ball',
        label: 'Ball',
        section: 'gameplay',
        keywords: 'bouncy rubber sphere',
        entity: {
            name: 'Ball',
            shape: { kind: 'primitive', primitive: 'sphere', size: [0.8, 0.8, 0.8] },
            material: { preset: 'rubber', color: '#e5484d' },
            physics: { body: 'dynamic', restitution: 0.75 },
        },
    },
    gen('ramp', 'Ramp', 'gameplay', 'slope incline'),
    {
        id: 'point-light',
        label: 'Point light',
        section: 'lights',
        keywords: 'lamp bulb glow',
        entity: { name: 'Point light', transform: { position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, light: { type: 'point', color: '#ffd9a0', intensity: 4, range: 12 } },
    },
    {
        id: 'spot-light',
        label: 'Spot light',
        section: 'lights',
        keywords: 'spotlight beam',
        entity: { name: 'Spot light', transform: { position: [0, 4, 0], rotation: [-90, 0, 0], scale: [1, 1, 1] }, light: { type: 'spot', color: '#ffffff', intensity: 8, range: 20, angle: 30, castShadow: true } },
    },
    gen('campfire', 'Campfire', 'lights', 'fire flame camp'),
    gen('crystal', 'Crystal', 'effects', 'gem glow magic'),
    gen('portal', 'Portal', 'effects', 'gate magic teleport'),
    gen('cloud', 'Cloud', 'effects', 'sky weather', { physics: undefined }),
]);
/** Palette item by id. */
export function paletteItem(id) {
    return PALETTE_ITEMS.find((p) => p.id === id);
}
/** A world-unique entity id derived from `base` ("crate", "crate-2", …). */
export function uniqueEntityId(world, base) {
    const slug = base
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'object';
    const has = (id) => Object.prototype.hasOwnProperty.call(world.entities, id);
    if (!has(slug))
        return slug;
    for (let n = 2; n < 100_000; n++) {
        const id = `${slug}-${n}`;
        if (!has(id))
            return id;
    }
    return `${slug}-${Date.now().toString(36)}`;
}
/**
 * The entity for placing `item` at `at` (ground point). The template's own
 * position is treated as an offset above that point.
 */
export function paletteEntity(item, world, at) {
    const base = item.entity;
    const t = base.transform;
    const offset = t?.position ?? [0, 0, 0];
    const lift = item.section === 'primitives' && item.id !== 'plane' ? 0.5 * (item.entity.shape?.size?.[1] ?? 1) : 0;
    const position = [at[0] + offset[0], at[1] + offset[1] + lift, at[2] + offset[2]];
    const entity = { ...base, id: uniqueEntityId(world, item.id), name: item.label, transform: { position, rotation: t?.rotation ?? [0, 0, 0], scale: t?.scale ?? [1, 1, 1] } };
    if (entity.physics === undefined)
        delete entity.physics;
    return entity;
}
