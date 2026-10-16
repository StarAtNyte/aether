/**
 * Offline planner for block worlds (voxel terrain): recognises requests
 * like "a minecraft-like survival world", "build a stone castle on the
 * hill", "a village of block houses" or "pixel art heart in the sky" and
 * answers with `setVoxel` + `voxelEdit` patches — terrain preset, game-kit
 * settings and builds anchored to the generated ground near the spawn.
 * In a world that already has voxel terrain, building requests (castle,
 * house, tower, bridge, pixel art, text …) and simple changes (night,
 * creative mode, mobs) become edits of that terrain.
 *
 * Deterministic: everything is derived from the request text and the
 * world summary.
 */
import { hashString } from '@aether/core';
/** Words that ask for a block world. */
const VOXEL_WORDS = /\b(minecraft|mine ?craft|voxels?|blocky|block[- ]?(?:world|game|houses?|village|castle|art|terrain|building)|survival (?:world|game|mode)|creative mode|pixel[- ]?art|crafting|craft and build|cubes? world|8-?bit world)\b/;
/** The voxel part of a world summary (null when the world has no voxel terrain). */
export function parseVoxelSummary(summary) {
    const head = /^voxel preset=([a-z]+) seed=-?\d+ view=\d+.*?edits=(\d+)/m.exec(summary);
    if (!head)
        return null;
    const game = /^voxel-game mode=([a-z]+)/m.exec(summary);
    const sp = /^player \w+ spawn=(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/m.exec(summary);
    const spawn = sp ? [Number(sp[1]), Number(sp[2]), Number(sp[3])] : [0, 0, 0];
    return { preset: head[1], edits: Number(head[2]), spawn, mode: game?.[1] ?? 'survival' };
}
function presetOf(t) {
    if (/\bflat\b|superflat/.test(t))
        return 'flat';
    if (/\bdesert|dunes?|cact/.test(t))
        return 'desert';
    if (/\bsnow|winter|frozen|ice\b|tundra/.test(t))
        return 'snow';
    if (/\bmountains?|peaks?|cliffs?|alps/.test(t))
        return 'mountains';
    if (/\bislands?|archipelago|ocean|sea\b/.test(t))
        return 'islands';
    if (/\bforest|woods|jungle|taiga/.test(t))
        return 'forest';
    if (/\bplains?|meadow|grassland|farm|village|town/.test(t))
        return 'plains';
    if (/\bsky\b|void|floating|skyblock/.test(t) && /\bvoid|skyblock|floating island/.test(t))
        return 'void';
    return 'survival';
}
/** Deterministic spot `index` around the spawn on a widening spiral (avoids overlapping builds). */
function spot(seed, index, sx, sz, ring = 20) {
    const a = ((seed % 360) * Math.PI) / 180 + index * 2.39996;
    const r = ring + index * 7;
    return [Math.round(sx + Math.cos(a) * r), Math.round(sz + Math.sin(a) * r)];
}
const HEART = [
    '..kkk...kkk..',
    '.krrrk.krrrk.',
    'krwwrrkrrrrrk',
    'krwrrrrrrrrrk',
    'krrrrrrrrrrrk',
    '.krrrrrrrrrk.',
    '..krrrrrrrk..',
    '...krrrrrk...',
    '....krrrk....',
    '.....krk.....',
    '......k......',
];
const HEART_PALETTE = { k: 'black_wool', r: 'red_wool', w: 'pink_wool' };
const STAR = [
    '.....k.....',
    '....kyk....',
    '....kyk....',
    'kkkkkyykkkk',
    'kyyyyyyyyyk',
    '.kyyyyyyyk.',
    '..kyyyyyk..',
    '.kyyykyyyk.',
    '.kyyk.kyyk.',
    'kyk.....kyk',
    'kk.......kk',
];
const STAR_PALETTE = { k: 'orange_wool', y: 'yellow_wool' };
const SMILE = [
    '..kkkkk..',
    '.kyyyyyk.',
    'kyykyykyk',
    'kyyyyyyyk',
    'kykyyykyk',
    'kyykkkyyk',
    '.kyyyyyk.',
    '..kkkkk..',
];
const HOUSE_PALETTES = [
    { wall: 'oak_planks', roof: 'roof_tiles', trim: 'oak_log', floor: 'cobblestone', window: 'glass' },
    { wall: 'birch_planks', roof: 'dark_planks', trim: 'birch_log', floor: 'stone_bricks', window: 'glass' },
    { wall: 'spruce_planks', roof: 'roof_tiles', trim: 'spruce_log', floor: 'cobblestone', window: 'glass' },
    { wall: 'white_wool', roof: 'dark_planks', trim: 'oak_log', floor: 'oak_planks', window: 'glass' },
    { wall: 'bricks', roof: 'dark_planks', trim: 'stone_bricks', floor: 'oak_planks', window: 'glass' },
    { wall: 'sandstone', roof: 'terracotta', trim: 'smooth_stone', floor: 'sandstone', window: 'glass' },
];
/** Text the user wants written in blocks ("write HELLO", "sign that says 'hi'"). */
function quotedText(raw) {
    const q = /["“']([^"”']{1,24})["”']/.exec(raw);
    if (q)
        return q[1];
    const w = /\b(?:write|spell|letters?|sign(?: that)? says?)\s+([a-z0-9 !?]{1,24})/i.exec(raw);
    return w ? w[1].trim() : null;
}
/** Structures and art named in the request, placed around (sx, sz). */
function builds(t, raw, seed, sx, sz, startIndex, village) {
    const edits = [];
    const notes = [];
    let i = startIndex;
    const at = (ring = 20) => spot(seed, i++, sx, sz, ring);
    if (village) {
        // A well in the square, houses around it, lampposts and a watch tower.
        const [cx, cz] = at(16);
        edits.push({ shape: 'structure', structure: 'well', at: [cx, 0, cz], anchor: 'surface' });
        const houses = 7;
        for (let k = 0; k < houses; k++) {
            const a = (k / houses) * Math.PI * 2 + (seed % 7) * 0.1;
            const r = 15 + (k % 2) * 4;
            const hx = Math.round(cx + Math.cos(a) * r);
            const hz = Math.round(cz + Math.sin(a) * r);
            // Front door faces the square.
            const facing = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? (Math.cos(a) > 0 ? 'west' : 'east') : Math.sin(a) > 0 ? 'north' : 'south';
            edits.push({ shape: 'structure', structure: 'house', at: [hx, 0, hz], size: k % 3 === 0 ? 'medium' : 'small', facing, palette: HOUSE_PALETTES[(k + seed) % HOUSE_PALETTES.length], anchor: 'surface' });
            const la = a + Math.PI / houses;
            edits.push({ shape: 'structure', structure: 'lamppost', at: [Math.round(cx + Math.cos(la) * 9), 0, Math.round(cz + Math.sin(la) * 9)], anchor: 'surface' });
        }
        edits.push({ shape: 'structure', structure: 'tower', at: [cx + 26, 0, cz - 4], size: 'small', anchor: 'surface' });
        // Hay stacks by the well.
        edits.push({ shape: 'box', from: [cx + 4, 0, cz + 3], to: [cx + 5, 1, cz + 3], block: 'hay_bale', anchor: 'surface' });
        notes.push('a village of 7 block houses around a well, lampposts and a watch tower');
    }
    if (/\bcastle|fortress|keep|citadel/.test(t)) {
        const [x, z] = at(26);
        edits.push({ shape: 'structure', structure: 'castle', at: [x, 0, z], size: /\bsmall|tiny/.test(t) ? 'medium' : 'large', facing: 'south', anchor: 'surface' });
        notes.push('a stone castle');
    }
    if (/\btowers?\b/.test(t) && !/castle/.test(t)) {
        const [x, z] = at();
        edits.push({ shape: 'structure', structure: 'tower', at: [x, 0, z], size: 'large', anchor: 'surface' });
        notes.push('a tower');
    }
    if (/\bhouses?|cabin|cottage|home\b/.test(t) && !village) {
        const count = /\bhouses\b/.test(t) ? 3 : 1;
        for (let k = 0; k < count; k++) {
            const [x, z] = at(16);
            edits.push({ shape: 'structure', structure: 'house', at: [x, 0, z], size: 'medium', facing: 'south', palette: HOUSE_PALETTES[(seed + k) % HOUSE_PALETTES.length], anchor: 'surface' });
        }
        notes.push(count > 1 ? `${count} houses` : 'a house');
    }
    if (/\bbridge/.test(t)) {
        const [x, z] = at();
        edits.push({ shape: 'structure', structure: 'bridge', at: [x, 0, z], length: 24, anchor: 'surface' });
        notes.push('a bridge');
    }
    if (/\bpyramid/.test(t)) {
        const [x, z] = at(30);
        edits.push({ shape: 'structure', structure: 'pyramid', at: [x, 0, z], size: 'large', anchor: 'surface' });
        notes.push('a pyramid');
    }
    if (/\bwell\b/.test(t) && !village) {
        const [x, z] = at(10);
        edits.push({ shape: 'structure', structure: 'well', at: [x, 0, z], anchor: 'surface' });
        notes.push('a well');
    }
    if (/\bgiant tree|huge tree|big tree|world tree/.test(t)) {
        const [x, z] = at();
        edits.push({ shape: 'structure', structure: 'tree', at: [x, 0, z], size: 'large', anchor: 'surface' });
        notes.push('a giant tree');
    }
    if (/\barch(?:way)?\b|portal|gate\b/.test(t)) {
        const [x, z] = at(12);
        edits.push({ shape: 'structure', structure: 'arch', at: [x, 0, z], anchor: 'surface' });
        notes.push('an arch');
    }
    if (/\bheart|star|smiley|smile|pixel/.test(t)) {
        const which = /\bstar/.test(t) ? 'star' : /\bsmil/.test(t) ? 'smile' : 'heart';
        const rows = which === 'star' ? STAR : which === 'smile' ? SMILE : HEART;
        const palette = which === 'star' ? STAR_PALETTE : which === 'smile' ? { k: 'black_wool', y: 'yellow_wool' } : HEART_PALETTE;
        const scale = 2;
        const width = rows[0].length * scale;
        // In the sky, facing the spawn (plane xy, in front along −z).
        const sky = /\bsky|air|float|above/.test(t);
        edits.push({ shape: 'pixels', at: [Math.round(sx - width / 2), sky ? 22 : 2, Math.round(sz - 22)], rows: [...rows], palette, plane: 'xy', scale, anchor: 'surface' });
        notes.push(`pixel-art ${which}${sky ? ' floating in the sky' : ''}`);
    }
    const text = /\b(write|spell|letters|sign)\b/.test(t) ? quotedText(raw) : null;
    if (text) {
        const s = text.toUpperCase().slice(0, 24);
        edits.push({ shape: 'text', text: s, at: [Math.round(sx - s.length * 3), 6, Math.round(sz - 18)], block: 'gold_block', plane: 'xy', anchor: 'surface' });
        notes.push(`the word "${s}" in gold blocks`);
    }
    return { edits, notes };
}
function gameSettings(t) {
    const game = {};
    if (/\bcreative|build mode|sandbox/.test(t))
        game['mode'] = 'creative';
    else if (/\bexplore|peaceful walk|sightseeing/.test(t))
        game['mode'] = 'explore';
    else
        game['mode'] = 'survival';
    if (/\bnight|zombies?|spiders?|monsters?|hostile|scary|horror/.test(t))
        game['startHour'] = 19.6;
    if (/\bno mobs|peaceful|without mobs/.test(t))
        game['mobs'] = false;
    if (/\bhardcore|hard mode/.test(t))
        game['keepInventory'] = false;
    if (game['mode'] === 'survival') {
        game['startItems'] = [
            { item: 'wooden_pickaxe', count: 1 },
            { item: 'torch', count: 8 },
            { item: 'bread', count: 4 },
            { item: 'oak_planks', count: 16 },
        ];
    }
    else if (game['mode'] === 'creative') {
        game['startItems'] = ['stone_bricks', 'oak_planks', 'glass', 'bricks', 'quartz', 'roof_tiles', 'glowstone', 'torch', 'red_wool'].map((item) => ({ item, count: 64 }));
    }
    return game;
}
function skyOf(t, game) {
    const night = typeof game['startHour'] === 'number' && game['startHour'] >= 19;
    if (/\bsunset|dusk|evening/.test(t))
        return { sky: 'sunset', ground: null, weather: 'clear', bloom: 0.5 };
    if (night)
        return { sky: 'night', ground: null, weather: 'clear', bloom: 0.8 };
    if (/\bdawn|sunrise|morning/.test(t))
        return { sky: 'dawn', ground: null, weather: 'clear', bloom: 0.4 };
    if (/\bsnow|winter/.test(t))
        return { sky: 'overcast', ground: null, weather: 'snow', bloom: 0.2 };
    return { sky: 'day', ground: null, weather: 'clear', bloom: 0.3 };
}
function title(t, preset, notes) {
    if (/\bvillage/.test(t))
        return 'Block Village';
    if (/\bcastle/.test(t))
        return 'Castle on the Hill';
    if (/\bheart/.test(t))
        return 'Pixel Heart';
    if (/\bcreative/.test(t))
        return 'Creative Sandbox';
    if (notes.length > 0)
        return 'Block World';
    return preset === 'survival' ? 'Survival World' : `${preset[0]?.toUpperCase() ?? ''}${preset.slice(1)} World`;
}
/** Plan a new block world. */
function newWorld(raw, t, wipe) {
    const seed = hashString(t) % 100000;
    let preset = presetOf(t);
    // A castle "on a hill" wants relief; pixel art and villages read best on gentle land.
    if (/\bhill|hilltop/.test(t) && preset === 'survival')
        preset = 'mountains';
    if (/\bvillage/.test(t) && preset === 'survival')
        preset = 'plains';
    const game = gameSettings(t);
    const village = /\bvillage|town|hamlet/.test(t);
    const b = builds(t, raw, seed, 0, 0, 0, village);
    const patches = [];
    if (wipe)
        patches.push({ op: 'clear', keepEnvironment: false });
    const name = title(t, preset, b.notes);
    patches.push({ op: 'setMeta', name, description: raw.slice(0, 200), seed }, { op: 'setEnvironment', set: skyOf(t, game) }, { op: 'setPlayer', set: { mode: 'firstPerson', spawn: [0, 0, 0], moveSpeed: 4.3, jumpSpeed: 8.4 } }, { op: 'setVoxel', set: { preset, seed, viewDistance: 8, game } });
    for (let k = 0; k < b.edits.length; k += 200)
        patches.push({ op: 'voxelEdit', edits: b.edits.slice(k, k + 200) });
    const mode = game['mode'];
    const extras = b.notes.length > 0 ? ` with ${b.notes.join(', ')}` : '';
    return {
        plan: `Plan: block world (${preset} terrain, ${mode} mode)${extras}; ${b.edits.length} block edits.`,
        patches,
        message: `Built ${name}: endless ${preset} block terrain${extras}. Press Play: WASD to move, mouse to look, left-click breaks, right-click places, E opens inventory and crafting${mode === 'creative' ? ', double-tap Space to fly' : ''}.`,
    };
}
/**
 * Blockfall, the flagship block world: endless survival terrain (biomes,
 * caves, ores), a village around a well with a watch tower, a stone castle,
 * a giant tree, a bridge and the name spelled in gold blocks by the spawn;
 * survival mode at sunrise with a starter kit, day/night cycle and mobs.
 */
export function planBlockfall() {
    const raw = 'a survival world with a village, a stone castle, a giant tree, a bridge and a sign that says "BLOCKFALL"';
    const t = raw.toLowerCase();
    const seed = 4242;
    const b = builds(t, raw, seed, 0, 0, 0, true);
    const game = {
        mode: 'survival',
        startHour: 6.6,
        dayLength: 720,
        mobs: true,
        maxMobs: 24,
        startItems: [
            { item: 'wooden_pickaxe', count: 1 },
            { item: 'wooden_axe', count: 1 },
            { item: 'torch', count: 16 },
            { item: 'bread', count: 6 },
            { item: 'oak_planks', count: 24 },
        ],
    };
    const patches = [
        { op: 'clear', keepEnvironment: false },
        { op: 'setMeta', name: 'Blockfall', description: 'Mine, craft and survive the night in an endless block world.', seed },
        { op: 'setEnvironment', set: { sky: 'dawn', ground: null, weather: 'clear', bloom: 0.45 } },
        { op: 'setPlayer', set: { mode: 'firstPerson', spawn: [0, 0, 0], moveSpeed: 4.3, jumpSpeed: 8.4 } },
        { op: 'setVoxel', set: { preset: 'survival', seed, viewDistance: 8, game } },
    ];
    for (let k = 0; k < b.edits.length; k += 200)
        patches.push({ op: 'voxelEdit', edits: b.edits.slice(k, k + 200) });
    patches.push({
        op: 'setMeta',
        intro: {
            title: 'Blockfall',
            tagline: 'An endless block world: mine by day, build a shelter, survive the night.',
            objective: 'Gather wood and stone, craft better tools in the inventory (E), and light your shelter before dark.',
            controls: ['WASD — move', 'Mouse — look', 'Left click — mine', 'Right click — place', 'E — inventory & crafting', '1–9 — hotbar'],
            accent: '#7bd389',
        },
    });
    return {
        plan: `Plan: block world (survival terrain with biomes and caves) with ${b.notes.join(', ')}; survival mode at sunrise with a starter kit; ${b.edits.length} block edits.`,
        patches,
        message: `Built Blockfall: an endless survival block world with ${b.notes.join(', ')}. Press Play — WASD to move, left-click mines, right-click places, E opens the inventory and crafting. Night brings zombies: build a shelter!`,
    };
}
/** Edit an existing block world. */
function editWorld(raw, t, view) {
    const seed = hashString(`${t}|${view.edits}`) % 100000;
    const patches = [];
    const done = [];
    const village = /\bvillage|town|hamlet/.test(t);
    const b = builds(t, raw, seed, view.spawn[0], view.spawn[2], view.edits, village);
    for (let k = 0; k < b.edits.length; k += 200)
        patches.push({ op: 'voxelEdit', edits: b.edits.slice(k, k + 200) });
    done.push(...b.notes);
    const game = {};
    if (/\bcreative/.test(t))
        game['mode'] = 'creative';
    else if (/\bsurvival/.test(t))
        game['mode'] = 'survival';
    if (/\bno mobs|peaceful|remove (?:the )?mobs/.test(t))
        game['mobs'] = false;
    else if (/\bmore mobs|add (?:some )?(?:animals|mobs|sheep|pigs|chickens)/.test(t)) {
        game['mobs'] = true;
        game['maxMobs'] = 32;
    }
    if (/\b(make it|set it to|turn it) night|\bnight time|midnight/.test(t))
        game['startHour'] = 21;
    else if (/\b(make it|set it to|turn it) day|\bdaytime|noon/.test(t))
        game['startHour'] = 10;
    if (Object.keys(game).length > 0) {
        patches.push({ op: 'setVoxel', set: { game } });
        done.push(`game: ${Object.keys(game).join(', ')}`);
    }
    if (game['startHour'] !== undefined)
        patches.push({ op: 'setEnvironment', set: { sky: game['startHour'] >= 19 ? 'night' : 'day' } });
    if (/\b(remove|clear|undo) (?:all )?(?:the )?(?:builds|buildings|structures|edits)/.test(t)) {
        patches.push({ op: 'setVoxel', set: { edits: [] } });
        done.push('removed every build');
    }
    if (/\bview distance|render distance|see further|farther/.test(t)) {
        patches.push({ op: 'setVoxel', set: { viewDistance: /\bless|shorter|lower/.test(t) ? 4 : 10 } });
        done.push('view distance');
    }
    if (patches.length === 0)
        return null;
    return { plan: `Plan: ${done.join('; ')}.`, patches, message: `Done — ${done.join('; ')}.` };
}
/**
 * Plan a request against a world summary, or null when it is not about a
 * block world (the regular planner handles it then).
 */
export function planVoxel(request, summary) {
    const t = request.toLowerCase();
    const view = parseVoxelSummary(summary);
    const asksVoxel = VOXEL_WORDS.test(t);
    if (view) {
        // A new block world requested explicitly replaces the current one.
        if (asksVoxel && /\b(new|another|fresh|create|make me|generate)\b/.test(t) && /\bworld|game|terrain\b/.test(t))
            return newWorld(request, t, true);
        return editWorld(request, t, view);
    }
    if (!asksVoxel)
        return null;
    const count = /\bentities=(\d+)/.exec(summary);
    return newWorld(request, t, count !== null && count[1] !== '0');
}
