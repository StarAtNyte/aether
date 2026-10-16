/**
 * Edits on block worlds: restyle, move, add, remove or resize one stamped
 * structure; swap a block type everywhere; flip game settings. Each edit
 * touches only the `voxel` settings/edits it names.
 */
import { VOXEL_BLOCK_IDS, VOXEL_STRUCTURES } from '@aether/core';
import { COLOR_WORDS, MATERIAL_WORDS, findColor, hexToRgb, singular, synonymsOf } from './lexicon';
import { ask, failed, outcome } from './ops-types';
import { viewVectors } from './walls';
const SIZES = ['small', 'medium', 'large'];
const STRUCTURE_SYNONYMS = { home: 'house', cottage: 'house', cabin: 'house', hut: 'house', fortress: 'castle', keep: 'castle', skyscraper: 'tower', lamp: 'lamppost', 'lamp post': 'lamppost', light: 'lamppost', lantern: 'lamppost', fountain: 'well', bridge: 'bridge', fence: 'wall', gate: 'arch', tree: 'tree' };
/** True when the world is a block world. */
export function isVoxelWorld(world) {
    return world.voxel !== undefined;
}
function structureId(noun) {
    const n = singular(noun);
    if (VOXEL_STRUCTURES.includes(n))
        return n;
    const syn = STRUCTURE_SYNONYMS[n];
    if (syn)
        return syn;
    for (const s of synonymsOf(n))
        if (VOXEL_STRUCTURES.includes(s))
            return s;
    return undefined;
}
/** The block a colour / material phrase means. */
export function blockFor(colorHex, materialKey, part) {
    const mat = materialKey ? MATERIAL_WORDS[materialKey] : undefined;
    if (mat?.finish === 'oak' || mat?.finish === 'walnut')
        return part === 'roof' ? 'dark_planks' : 'oak_planks';
    if (mat?.finish === 'ash')
        return 'birch_planks';
    if (mat?.finish === 'brick')
        return 'bricks';
    if (mat?.finish === 'stone')
        return 'stone_bricks';
    if (mat?.finish === 'concrete')
        return 'smooth_stone';
    if (mat?.finish === 'marble')
        return 'quartz';
    if (mat?.finish === 'glass')
        return 'glass';
    if (mat?.finish === 'roof-tile')
        return 'roof_tiles';
    if (materialKey === 'tile' || materialKey === 'tiles')
        return 'roof_tiles';
    if (mat?.preset === 'sand')
        return 'sandstone';
    if (mat?.preset === 'snow')
        return 'snow';
    if (mat?.preset === 'ice')
        return 'ice';
    if (mat?.preset === 'gold')
        return 'gold_block';
    if (!colorHex)
        return undefined;
    // Nearest wool.
    const wools = {
        white_wool: [240, 240, 240], red_wool: [190, 50, 40], orange_wool: [230, 130, 40], yellow_wool: [235, 200, 60], lime_wool: [125, 190, 50], green_wool: [80, 120, 40], cyan_wool: [40, 140, 150],
        light_blue_wool: [100, 160, 220], blue_wool: [50, 70, 170], purple_wool: [130, 60, 170], magenta_wool: [190, 70, 180], pink_wool: [235, 140, 170], brown_wool: [110, 70, 40], gray_wool: [110, 115, 120], black_wool: [25, 25, 30],
    };
    const [r, g, b] = hexToRgb(colorHex);
    let best = 'white_wool';
    let bd = Infinity;
    for (const [id, c] of Object.entries(wools)) {
        const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
        if (d < bd) {
            bd = d;
            best = id;
        }
    }
    return best;
}
/** A block id named in free text ("oak planks", "stone bricks", "red wool", "glass"). */
export function blockNamed(text) {
    const t = text.toLowerCase().replace(/[-\s]+/g, '_').replace(/s$/, '');
    const exact = VOXEL_BLOCK_IDS.find((b) => b === t || b === `${t}s` || b === t.replace(/_block$/, ''));
    if (exact)
        return exact;
    const words = text.toLowerCase().split(/\s+/);
    const col = findColor(text);
    if (col && words.includes('wool'))
        return blockFor(col.hex, undefined);
    const aliases = { planks: 'oak_planks', plank: 'oak_planks', wood: 'oak_planks', brick: 'bricks', bricks: 'bricks', stonebrick: 'stone_bricks', dirt: 'dirt', grass: 'grass', leaves: 'oak_leaves', leaf: 'oak_leaves', roof: 'roof_tiles', tiles: 'roof_tiles', sandstone: 'sandstone', water: 'water' };
    for (const w of words)
        if (aliases[w] && !(COLOR_WORDS.has(words[0]) && words.length > 1))
            return aliases[w];
    return VOXEL_BLOCK_IDS.find((b) => b.replace(/_/g, ' ') === text.toLowerCase().trim().replace(/s$/, ''));
}
function edits(world) {
    return (world.voxel?.edits ?? []);
}
function structureRefs(env, ref) {
    const sid = structureId(ref.noun);
    if (!sid)
        return { none: `I don't see a ${ref.noun} in the block world` };
    const all = edits(env.base).map((edit, idx) => ({ idx, edit })).filter((x) => x.edit['shape'] === 'structure' && x.edit['structure'] === sid);
    if (all.length === 0)
        return { none: `there is no ${sid} in this block world` };
    if (ref.all || all.length === 1)
        return all;
    if (ref.ordinal !== undefined) {
        const pick = ref.ordinal === -1 ? all[all.length - 1] : all[ref.ordinal - 1];
        return pick ? [pick] : { none: `there are only ${all.length} ${sid}s` };
    }
    const nearest = [...all].sort((a, b) => Math.hypot(...a.edit['at'].filter((_, i) => i !== 1)) - Math.hypot(...b.edit['at'].filter((_, i) => i !== 1)));
    void nearest;
    return { question: outcome({ ok: false, failure: `Which ${sid}?`, question: { text: `Which ${sid}?`, candidates: all.slice(0, 8).map((x, n) => ({ id: `voxel-${x.idx}`, label: `${sid} ${n + 1} (at ${x.edit['at'][0]}, ${x.edit['at'][2]})` })) } }) };
}
function setEdits(env, next) {
    const v = env.draft.world.voxel;
    if (v)
        env.draft.world.voxel = { ...v, edits: next };
}
/** Paint a structure or swap a block everywhere. */
export function voxelPaint(env, cmd) {
    const ref = cmd.ref;
    const sid = structureId(ref.noun);
    if (sid) {
        const found = structureRefs(env, ref);
        if ('question' in found)
            return found.question;
        if ('none' in found)
            return failed(found.none);
        const part = ref.part ?? (ref.side === 'front' ? undefined : undefined);
        const key = part === 'roof' || ref.noun === 'roof' ? 'roof' : part === 'floor' ? 'floor' : part === 'trim' ? 'trim' : part === 'window' ? 'window' : 'wall';
        const block = blockFor(cmd.look.color, cmd.look.material, key);
        if (!block)
            return failed('I could not map that look to a block');
        const next = edits(env.base).map((e) => ({ ...e }));
        for (const f of found) {
            const pal = { ...next[f.idx]['palette'] };
            pal[key] = block;
            next[f.idx]['palette'] = pal;
        }
        setEdits(env, next);
        return outcome({ summary: `restyled ${found.length === 1 ? `the ${sid}` : `${found.length} ${sid}s`}: ${key} → ${block.replace(/_/g, ' ')}`, cosmetic: true });
    }
    // "make the oak planks stone bricks" / "turn all the grass to sand"
    const from = blockNamed(ref.text);
    const to = blockFor(cmd.look.color, cmd.look.material);
    if (from && to && from !== to) {
        const es = edits(env.base);
        let min = [-48, 0, -48];
        let max = [48, 100, 48];
        const pts = es.filter((e) => Array.isArray(e['at'])).map((e) => e['at']);
        if (pts.length > 0) {
            min = [Math.min(...pts.map((p) => p[0])) - 24, 0, Math.min(...pts.map((p) => p[2])) - 24];
            max = [Math.max(...pts.map((p) => p[0])) + 24, 100, Math.max(...pts.map((p) => p[2])) + 24];
        }
        setEdits(env, [...es, { shape: 'replace', from: min, to: max, block: from, with: to, anchor: 'world' }]);
        return outcome({ summary: `replaced ${from.replace(/_/g, ' ')} with ${to.replace(/_/g, ' ')}`, cosmetic: true });
    }
    return null;
}
/** Structure moves / resizes / removals / additions. */
export function voxelStructureOp(env, cmd) {
    if (cmd.op === 'add') {
        const sid = structureId(cmd.noun);
        if (!sid)
            return null;
        const es = edits(env.base).map((e) => ({ ...e }));
        const taken = es.filter((e) => Array.isArray(e['at'])).map((e) => e['at']);
        const centre = taken.length > 0 ? [taken.reduce((s, p) => s + p[0], 0) / taken.length, taken.reduce((s, p) => s + p[2], 0) / taken.length] : [0, 0];
        let spot = [Math.round(centre[0]) + 14, Math.round(centre[1])];
        outer: for (let ring = 1; ring < 14; ring++) {
            for (let k = 0; k < 8 + ring * 3; k++) {
                const a = (k / (8 + ring * 3)) * Math.PI * 2;
                const x = Math.round(centre[0] + Math.cos(a) * ring * 9);
                const z = Math.round(centre[1] + Math.sin(a) * ring * 9);
                if (taken.every((p) => Math.hypot(p[0] - x, p[2] - z) > 10)) {
                    spot = [x, z];
                    break outer;
                }
            }
        }
        const block = blockFor(cmd.look?.color, cmd.look?.material);
        const n = Math.min(cmd.count, 6);
        for (let k = 0; k < n; k++) {
            es.push({ shape: 'structure', structure: sid, at: [spot[0] + k * 12, 0, spot[1]], size: 'medium', facing: 'south', palette: block ? { wall: block } : {}, anchor: 'surface' });
        }
        setEdits(env, es);
        return outcome({ summary: `added ${n > 1 ? `${n} ${sid}s` : `a ${sid}`}`, cosmetic: false });
    }
    if (cmd.op !== 'remove' && cmd.op !== 'move' && cmd.op !== 'scale' && cmd.op !== 'duplicate')
        return null;
    const ref = cmd.ref;
    if (!structureId(ref.noun))
        return null;
    const found = structureRefs(env, ref);
    if ('question' in found)
        return found.question;
    if ('none' in found)
        return failed(found.none);
    const sid = structureId(ref.noun);
    const es = edits(env.base).map((e) => ({ ...e }));
    const idxs = new Set(found.map((f) => f.idx));
    if (cmd.op === 'remove') {
        setEdits(env, es.filter((_, i) => !idxs.has(i)));
        return outcome({ summary: `removed ${found.length === 1 ? `the ${sid}` : `${found.length} ${sid}s`}`, cosmetic: false });
    }
    if (cmd.op === 'move') {
        const { forward, right } = viewVectors(env.ctx.heading);
        const dir = cmd.direction;
        const m = Math.max(1, Math.round(cmd.metres));
        const d = dir === 'left' ? [-right[0] * m, -right[1] * m] : dir === 'right' ? [right[0] * m, right[1] * m] : dir === 'forward' || dir === 'north' ? [dir === 'north' ? 0 : forward[0] * m, dir === 'north' ? -m : forward[1] * m] : dir === 'back' || dir === 'south' ? [dir === 'south' ? 0 : -forward[0] * m, dir === 'south' ? m : -forward[1] * m] : dir === 'east' ? [m, 0] : dir === 'west' ? [-m, 0] : [0, 0];
        for (const i of idxs) {
            const at = es[i]['at'];
            es[i]['at'] = [Math.round(at[0] + d[0]), at[1], Math.round(at[2] + d[1])];
        }
        setEdits(env, es);
        return outcome({ summary: `moved the ${sid} ${m} blocks ${dir ?? ''}`.trim(), cosmetic: false });
    }
    if (cmd.op === 'scale') {
        for (const i of idxs) {
            const cur = SIZES.indexOf(es[i]['size'] ?? 'medium');
            const next = Math.max(0, Math.min(2, cur + (cmd.factor >= 1 ? 1 : -1)));
            es[i]['size'] = SIZES[next];
        }
        setEdits(env, es);
        return outcome({ summary: `made the ${sid} ${cmd.factor >= 1 ? 'bigger' : 'smaller'}`, cosmetic: false });
    }
    return null;
}
/** Game settings of block worlds. */
export function voxelGame(env, text) {
    const v = env.base.voxel;
    if (!v)
        return null;
    const game = { ...(v.game ?? {}) };
    const t = text.toLowerCase();
    let summary = '';
    if (/\b(?:no|turn off|disable|remove|without|stop)\s+(?:the\s+)?(?:monsters?|mobs?|zombies?|enemies|hostile|spiders?)\b|\bpeaceful\b/.test(t)) {
        game['mobs'] = false;
        summary = 'turned the mobs off';
    }
    else if (/\b(?:turn on|enable|add|with|more)\s+(?:the\s+)?(?:monsters?|mobs?|zombies?|enemies)\b/.test(t)) {
        game['mobs'] = true;
        summary = 'turned the mobs on';
    }
    else if (/\b(?:no|turn off|disable|without)\s+hunger\b/.test(t)) {
        game['hunger'] = false;
        summary = 'turned hunger off';
    }
    else if (/\b(?:longer|slower)\s+(?:days?|nights?|day cycle)\b|\b(?:days?|nights?|day cycle)\s+(?:longer|slower)\b/.test(t)) {
        game['dayLength'] = Math.min(7200, Math.round((game['dayLength'] ?? 600) * 1.6));
        summary = 'made the days longer';
    }
    else if (/\b(?:shorter|faster|quicker)\s+(?:days?|nights?|day cycle)\b|\b(?:days?|nights?|day cycle)\s+(?:shorter|faster|quicker)\b/.test(t)) {
        game['dayLength'] = Math.max(30, Math.round((game['dayLength'] ?? 600) * 0.6));
        summary = 'made the days shorter';
    }
    else if (/\bcreative\b/.test(t)) {
        game['mode'] = 'creative';
        summary = 'switched to creative mode';
    }
    else if (/\bsurvival\b/.test(t)) {
        game['mode'] = 'survival';
        summary = 'switched to survival mode';
    }
    else if (/\bexplore\b/.test(t)) {
        game['mode'] = 'explore';
        summary = 'switched to explore mode';
    }
    else if (/\b(?:no|disable|turn off)\s+fall damage\b/.test(t)) {
        game['fallDamage'] = false;
        summary = 'turned fall damage off';
    }
    else if (/\b(?:always|forever|permanent)\s+(?:day|night)\b|\b(?:stop|freeze|disable)\s+(?:the\s+)?day(?:\/night)?\s+cycle\b/.test(t)) {
        game['cycle'] = false;
        summary = 'stopped the day/night cycle';
    }
    else
        return null;
    env.draft.world.voxel = { ...v, game: game };
    return outcome({ summary, cosmetic: true });
}
export { ask };
