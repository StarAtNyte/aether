/**
 * Colour / material edits: "make the sofa dark green velvet", "wallpaper on
 * the bedroom's back wall", "swap the kitchen tiles to white subway tiles".
 *
 * Procedural objects are edited through their declared parameters (colour
 * and enum params found in the generator's spec), so the right slot changes
 * (upholstery, not legs) and nothing else is regenerated. Walls change the
 * finish of the face that looks into the room.
 */
import { FINISHES } from '@aether/arch';
import { MaterialFinish } from '@aether/core';
import { adjustColor } from './adjust';
import { setPath } from './draft';
import { MATERIAL_WORDS, WALLPAPER, colorName } from './lexicon';
import { flattenPart } from './parse-ref';
import { colorOf, resolveRef, resolveRooms } from './resolve';
import { roomWalls } from './walls';
import { ask, describeTargets, failed, outcome, refused } from './ops-types';
const FINISH_IDS = new Set(MaterialFinish.options);
/** Wallpaper finish for a requested pattern word ("floral", "striped", "damask"…). */
export function wallpaperFinish(pattern) {
    switch (pattern) {
        case 'striped': return 'wallpaper-stripe';
        case 'floral': return 'wallpaper-floral';
        case 'damask':
        case 'patterned': return 'wallpaper-damask';
        case 'geometric':
        case 'scallop':
        case 'checkered':
        case 'checked':
        case 'plaid':
        case 'polka dot':
        case 'dotted': return 'wallpaper-geometric';
        default: return 'wallpaper';
    }
}
function materialWord(look) {
    if (look.material === 'wallpaper') {
        // Use a dedicated wallpaper finish once the library has one.
        const finish = wallpaperFinish(look.pattern);
        return FINISH_IDS.has(finish) ? { finish: finish, label: 'wallpaper', kind: 'wall' } : WALLPAPER;
    }
    return look.material ? MATERIAL_WORDS[look.material] : undefined;
}
function decide(look, current) {
    const d = {};
    if (look.color)
        d.color = look.color;
    else if (look.adjust && current)
        d.color = adjustColor(current, look.adjust.dir, look.adjust.amount);
    const mw = materialWord(look);
    if (mw?.finish)
        d.finish = mw.finish;
    if (mw?.preset)
        d.preset = mw.preset;
    if (look.opacity !== undefined)
        d.opacity = look.opacity;
    if (look.glow)
        d.glow = true;
    if (look.metal)
        d.metal = true;
    if (look.finish === 'glossy')
        d.roughness = 0.2;
    if (look.finish === 'matte')
        d.roughness = 0.9;
    // Wallpaper without a colour gets a calm default instead of the bare weave.
    if (look.material === 'wallpaper' && !d.color && !current)
        d.color = '#b9c4ac';
    return d;
}
/** The fabric-like finishes keep their colour; natural ones do not take a paint colour. */
function tintable(finish) {
    return FINISHES[finish]?.tintable ?? true;
}
/** Merge a decided look into a material spec. */
function mergeMaterial(old, d) {
    const out = { ...(old ?? {}) };
    if (d.finish) {
        out['finish'] = d.finish;
        delete out['preset'];
        if (!d.color && !tintable(d.finish))
            delete out['color'];
    }
    if (d.preset) {
        out['preset'] = d.preset;
        delete out['finish'];
    }
    if (d.color)
        out['color'] = d.color;
    if (d.roughness !== undefined)
        out['roughness'] = d.roughness;
    if (d.opacity !== undefined)
        out['opacity'] = d.opacity;
    if (d.glow) {
        out['emissive'] = d.color ?? (typeof out['color'] === 'string' ? out['color'] : '#ffe08a');
        out['emissiveIntensity'] = 2;
    }
    if (d.metal) {
        out['metalness'] = 0.9;
        out['roughness'] = d.roughness ?? 0.3;
    }
    return out;
}
function lookText(look) {
    const parts = [];
    if (look.colorText)
        parts.push(look.colorText);
    else if (look.color)
        parts.push(colorName(look.color));
    if (look.adjust)
        parts.push(look.adjust.dir);
    const mw = materialWord(look);
    if (mw)
        parts.push(mw.label);
    if (look.pattern)
        parts.push(look.pattern);
    if (look.opacity !== undefined)
        parts.push('transparent');
    if (look.glow)
        parts.push('glowing');
    if (look.metal)
        parts.push('metallic');
    return parts.join(' ') || 'new look';
}
// ---------------------------------------------------------------------------
// Parameter-driven procedural objects
// ---------------------------------------------------------------------------
const MAIN_FINISH_KEYS = ['upholstery', 'finish', 'material', 'fabric', 'cover', 'surface', 'top', 'wood', 'seat', 'body'];
const SECONDARY_KEYS = ['legs', 'leg', 'base', 'frame', 'hardware', 'handle', 'trim', 'hinge'];
const PART_ALIASES = {
    leg: ['leg', 'legs', 'foot', 'feet', 'base'],
    frame: ['frame', 'wood', 'structure', 'body'],
    cushion: ['cushion', 'pillow', 'accent', 'seat', 'pad', 'upholstery', 'cover'],
    pillow: ['pillow', 'accent', 'cushion'],
    seat: ['seat', 'upholstery', 'cover', 'cushion'],
    top: ['top', 'worktop', 'surface', 'tabletop'],
    base: ['base', 'foot', 'stand'],
    shade: ['shade', 'lampshade', 'shadecolor', 'cover'],
    handle: ['handle', 'hardware', 'knob', 'pull'],
    trim: ['trim', 'border', 'edge'],
    headboard: ['headboard', 'head'],
    linen: ['linen', 'bedding', 'sheet', 'duvet'],
    border: ['border', 'edge', 'trim'],
    worktop: ['worktop', 'top', 'counter'],
    countertop: ['worktop', 'top', 'counter'],
    accent: ['accent', 'pillow', 'secondary'],
    upholstery: ['upholstery', 'cover', 'fabric'],
    cover: ['cover', 'upholstery', 'fabric'],
    pot: ['pot', 'planter', 'vase'],
    fronts: ['fronts', 'front', 'cabinet', 'door'],
    front: ['fronts', 'front', 'cabinet', 'door'],
};
function specText(key, spec) {
    return `${key} ${spec.description ?? ''}`.toLowerCase();
}
function currentParam(e, key, spec) {
    const sh = e.shape;
    if (sh.kind === 'procedural' && Object.hasOwn(sh.params, key))
        return sh.params[key];
    return spec.default;
}
/** Choose the colour param for a part ("legs" → legColor …) or the object's main colour. */
function colorKey(spec, part) {
    const keys = Object.keys(spec).filter((k) => spec[k]?.type === 'color');
    if (keys.length === 0)
        return undefined;
    if (part) {
        const aliases = PART_ALIASES[part] ?? [part];
        const hit = keys.find((k) => aliases.some((a) => specText(k, spec[k]).includes(a)));
        return hit;
    }
    if (keys.includes('color'))
        return 'color';
    const main = keys.find((k) => /cover|body|main|upholster|fabric|paint|surface|seat|bed|shell/.test(specText(k, spec[k])) && !/accent|pillow|secondary|trim|border/.test(specText(k, spec[k])));
    return main ?? keys[0];
}
/** Choose the enum param that takes `finish` (or the preset word) for a part. */
function enumKey(spec, finishWords, part) {
    const cands = [];
    for (const [key, s] of Object.entries(spec)) {
        if (s.type !== 'enum' || !s.options)
            continue;
        const option = s.options.find((o) => finishWords.includes(o.toLowerCase()));
        if (!option)
            continue;
        let score = 1;
        const text = specText(key, s);
        if (part) {
            const aliases = PART_ALIASES[part] ?? [part];
            score += aliases.some((a) => text.includes(a)) ? 10 : -5;
        }
        else {
            if (MAIN_FINISH_KEYS.some((m) => key.toLowerCase().includes(m)))
                score += 5;
            if (SECONDARY_KEYS.some((m) => key.toLowerCase() === m))
                score -= 3;
        }
        cands.push({ key, option, score });
    }
    cands.sort((a, b) => b.score - a.score);
    const top = cands[0];
    return top && top.score > 0 ? { key: top.key, option: top.option } : undefined;
}
/** Finishes a plain colour stands for when an object only has finish options. */
function colorFinishWords(hex) {
    const [r, g, b] = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (l < 0.16)
        return ['black-metal', 'black', 'dark'];
    if (sat < 28) {
        if (l > 0.82)
            return ['plaster', 'marble', 'ceramic', 'paint', 'white', 'quartz'];
        if (l > 0.55)
            return ['concrete', 'stone', 'chrome', 'brushed-metal', 'steel'];
        return ['black-metal', 'concrete', 'brushed-metal', 'stone'];
    }
    if (r > 170 && g > 130 && b < 110)
        return l > 0.5 ? ['brass', 'gold', 'oak'] : ['brass', 'walnut'];
    if (r > g && g >= b && l < 0.34)
        return ['walnut', 'dark', 'brick'];
    if (r > g && g >= b)
        return ['oak', 'ash', 'brick'];
    return [];
}
/** Option lists of the finish-like params ("oak, walnut, ash …"), for explaining what an object offers. */
function finishOptions(spec, part) {
    const out = [];
    for (const [key, s] of Object.entries(spec)) {
        if (s.type !== 'enum' || !s.options)
            continue;
        if (part && !(PART_ALIASES[part] ?? [part]).some((a) => specText(key, s).includes(a)))
            continue;
        for (const o of s.options)
            if (o && !out.includes(o))
                out.push(o);
    }
    return out.slice(0, 8);
}
function finishWordsOf(mw) {
    if (!mw)
        return [];
    const out = [];
    if (mw.finish)
        out.push(mw.finish);
    if (mw.preset)
        out.push(mw.preset);
    // Word-level synonyms ("wooden" parts: oak, walnut, ash).
    if (mw.kind === 'wood' && mw.finish === 'oak')
        out.push('wood', 'walnut', 'ash');
    if (mw.finish === 'brushed-metal')
        out.push('steel', 'metal', 'chrome');
    return out;
}
function paintParams(draft, e, spec, look, part) {
    const out = { changed: [], ignored: [] };
    const ent = draft.entity(e.id);
    if (ent.shape.kind !== 'procedural')
        return out;
    const params = ent.shape.params;
    const mw = materialWord(look);
    const ck = colorKey(spec, part);
    const current = ck ? currentParam(e, ck, spec[ck]) : undefined;
    const d = decide(look, typeof current === 'string' ? current : colorOf({ entity: e }));
    if (d.color) {
        if (ck) {
            params[ck] = d.color;
            out.changed.push(ck);
        }
        else {
            // No colour parameter: a colour word may still name one of the finishes ("black legs" → black metal).
            const ek = enumKey(spec, colorFinishWords(d.color), part);
            if (ek && !mw) {
                params[ek.key] = ek.option;
                out.changed.push(ek.key);
            }
            else
                out.ignored.push('colour');
        }
    }
    if (mw) {
        const ek = enumKey(spec, finishWordsOf(mw), part);
        if (ek) {
            params[ek.key] = ek.option;
            out.changed.push(ek.key);
        }
        else if (Object.keys(spec).some((k) => spec[k]?.type === 'enum') || mw.kind !== 'soft')
            out.ignored.push(mw.label);
        else
            out.ignored.push(mw.label);
    }
    return out;
}
// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------
const ARCH_SLOT = { room: 'finish', ceiling: 'finish', door: 'finish', window: 'frame', roof: 'finish', railing: 'finish', stair: 'finish', column: 'finish', pool: 'finish' };
function paintArchSlot(env, item, look) {
    const role = item.entity.arch?.role;
    if (!role)
        return false;
    const key = ARCH_SLOT[role];
    const sh = item.entity.shape;
    if (!key || sh.kind !== 'procedural')
        return false;
    const ent = env.draft.entity(item.id);
    const params = ent.shape.params;
    const old = (params[key] ?? undefined);
    const d = decide(look, old?.color);
    params[key] = mergeMaterial(old, d);
    return true;
}
function paintWallFaces(env, faces, look) {
    const touched = [];
    for (const f of faces) {
        const ent = env.draft.entity(f.wallId);
        if (ent.shape.kind !== 'procedural')
            continue;
        const params = ent.shape.params;
        const key = f.side === 'a' ? 'finishA' : 'finishB';
        const old = params[key];
        const d = decide(look, old?.color);
        params[key] = mergeMaterial(old, d);
        touched.push(f.wallId);
    }
    return touched;
}
function paintPlain(env, item, look) {
    const ent = env.draft.entity(item.id);
    const d = decide(look, ent.material?.color ?? colorOf(item));
    const sh = ent.shape;
    if (sh.kind === 'scatter' && sh.of.kind === 'procedural' && d.color && !d.finish && !d.preset) {
        sh.of.params = { ...sh.of.params, color: d.color };
        return;
    }
    ent.material = mergeMaterial(ent.material, d);
}
function descendantsWithShape(env, id) {
    return env.index.subtree(id).slice(1).map((c) => env.index.get(c)).filter((x) => !!x && x.entity.shape.kind !== 'none' && !x.entity.light);
}
function paintItem(env, item, cmd, notes) {
    const e = item.entity;
    const lightNoun = /^(light|lamp|lantern|bulb|lighting)$/.test(cmd.ref.noun);
    // A light's colour.
    if (e.light && (lightNoun || e.shape.kind === 'none')) {
        const base = e.light.color;
        const d = decide(cmd.look, base);
        if (d.color) {
            env.draft.entity(item.id).light = { ...e.light, color: d.color };
            return true;
        }
    }
    if (e.arch && e.arch.role !== 'furniture' && e.arch.role !== 'fixture' && e.arch.role !== 'light' && e.arch.role !== 'switch')
        return paintArchSlot(env, item, cmd.look);
    const sh = e.shape;
    if (sh.kind === 'procedural') {
        const spec = env.params(sh.generator);
        if (spec && Object.keys(spec).length > 0) {
            const r = paintParams(env.draft, e, spec, cmd.look, cmd.ref.part);
            // Opacity, glow and metal are whole-object looks: they live on the entity material.
            if (cmd.look.opacity !== undefined || cmd.look.glow || cmd.look.metal) {
                paintPlain(env, item, { ...(cmd.look.opacity !== undefined ? { opacity: cmd.look.opacity } : {}), ...(cmd.look.glow ? { glow: true } : {}), ...(cmd.look.metal ? { metal: true } : {}) });
                r.changed.push('material');
            }
            if (r.changed.length > 0) {
                if (r.ignored.length > 0)
                    notes.push(`the ${item.label.toLowerCase()} has no ${r.ignored.join('/')} option, so I only changed ${r.changed.join(', ')}`);
                // Lamps: the light follows the shade.
                if (e.light && cmd.look.color && !cmd.ref.part)
                    env.draft.entity(item.id).light = { ...e.light, color: cmd.look.color };
                return true;
            }
            // No matching param: only fall back to the entity material when the object has no colour/finish params at all.
            const hasLookParams = Object.values(spec).some((s) => s.type === 'color' || s.type === 'enum');
            if (hasLookParams) {
                const opts = finishOptions(spec, cmd.ref.part);
                notes.push(`the ${item.label.toLowerCase()}${cmd.ref.part ? ` ${cmd.ref.part}` : ''} can't be ${r.ignored.map((w) => (w === 'colour' ? 'recoloured' : `made ${w}`)).join(' or ') || 'changed that way'}${opts.length > 0 ? `; it comes in ${opts.map((o) => o.replace(/-/g, ' ')).join(', ')}` : ''}`);
                return false;
            }
        }
        paintPlain(env, item, cmd.look);
        return true;
    }
    if (sh.kind === 'none') {
        const kids = descendantsWithShape(env, item.id);
        if (kids.length === 0)
            return false;
        for (const k of kids)
            paintPlain(env, k, cmd.look);
        return true;
    }
    paintPlain(env, item, cmd.look);
    // Composite objects (a tent with poles) follow their root's colour only when the root is a plain shape.
    return true;
}
/** Tiles are a surface treatment, not an object: floors, wall faces and kitchen splashbacks that are tiled. */
function planTiles(env, cmd) {
    const ref = cmd.ref;
    let rooms = env.index.rooms;
    if (ref.room) {
        rooms = resolveRooms(env.index, ref.room, env.ctx);
        if (rooms.length > 1 && !ref.room.allWord)
            return ask(`Which ${ref.room.noun}?`, rooms);
        if (rooms.length === 0)
            return failed(`I can't find a room called "${ref.room.text}"`);
    }
    const isTile = (m) => typeof m === 'object' && m !== null && /tile|ceramic/.test(String(m.finish ?? ''));
    const touched = [];
    const notes = [];
    const looked = lookText(cmd.look);
    const roomIds = new Set(rooms.map((r) => r.id));
    const mw = materialWord(cmd.look);
    for (const room of rooms) {
        const sh = room.entity.shape;
        if (sh.kind === 'procedural' && isTile(sh.params['finish'])) {
            paintArchSlot(env, room, cmd.look);
            touched.push(room.id);
        }
        const faces = roomWalls(env.index, room).flatMap((w) => w.faces).filter((f) => {
            const wall = env.index.get(f.wallId)?.entity;
            return wall?.shape.kind === 'procedural' && isTile(wall.shape.params[f.side === 'a' ? 'finishA' : 'finishB']);
        });
        if (faces.length > 0)
            touched.push(...paintWallFaces(env, faces, cmd.look));
    }
    // Fittings with a tiled option (a kitchen's splashback).
    for (const it of env.index.items) {
        if (!it.roomId || !roomIds.has(it.roomId) || it.entity.shape.kind !== 'procedural')
            continue;
        const spec = env.params(it.entity.shape.generator);
        if (!spec)
            continue;
        for (const [key, s] of Object.entries(spec)) {
            if (s.type !== 'enum' || !s.options || !/splash|tile|wall/.test(`${key} ${s.description ?? ''}`.toLowerCase()))
                continue;
            const opt = s.options.find((o) => (mw?.finish && o === mw.finish) || (/tile/.test(o) && mw?.finish && /tile/.test(mw.finish)));
            if (!opt)
                continue;
            const params = env.draft.entity(it.id).shape.params;
            params[key] = opt;
            touched.push(it.id);
        }
    }
    if (touched.length === 0) {
        const floors = rooms.map((r) => `${r.label.toLowerCase()} floor is ${String((r.entity.shape.kind === 'procedural' ? r.entity.shape.params['finish'] : undefined)?.finish ?? 'plain').replace(/-/g, ' ')}`);
        return refused(`There are no tiles there to swap (the ${floors.slice(0, 2).join(', the ')}). Say “make the ${rooms[0]?.label.toLowerCase() ?? 'kitchen'} floor ${mw?.label ?? 'tile'}” to put some in.`);
    }
    if (cmd.look.color && !mw)
        notes.push('tile colours come with the tile style');
    return outcome({ summary: `swapped the ${rooms.length === 1 ? `${rooms[0].label.toLowerCase()} ` : ''}tiles to ${looked}`, targets: [...new Set(touched)], notes, cosmetic: true, rooms: rooms.map((r) => r.id) });
}
/** Apply a paint command. */
export function planPaint(env, cmd) {
    let ref = cmd.ref;
    const tilesRef = ref.noun === 'tile' || ref.adjectives.includes('tile');
    if (tilesRef)
        return planTiles(env, cmd);
    let res = resolveRef(env.index, ref, env.ctx);
    // "log seat" is a thing, not the seat of a log: retry the compound before giving up.
    if (res.items.length === 0 && !res.ambiguous && ref.part) {
        ref = flattenPart(ref);
        res = resolveRef(env.index, ref, env.ctx);
    }
    if (res.ambiguous && res.ambiguous.length > 0)
        return ask(`${res.reason ?? 'Which one?'}`, res.ambiguous);
    if (res.items.length === 0)
        return failed(res.reason ?? `I can't find "${ref.text}"`);
    const notes = [];
    const looked = lookText(cmd.look);
    const also = [];
    const targets = [];
    // Walls by face.
    if (res.faces && res.faces.length > 0) {
        const touched = paintWallFaces(env, res.faces, cmd.look);
        if (cmd.look.pattern && cmd.look.material === 'wallpaper' && wallpaperFinish(cmd.look.pattern) === 'wallpaper')
            notes.push(`"${cmd.look.pattern}" isn't available as a pattern yet, so I used plain ${looked.replace(cmd.look.pattern, '').trim()} wallpaper`);
        const spilled = (res.walls ?? []).filter((w) => w.spill > 0.6);
        if (spilled.length > 0)
            notes.push(`${spilled.length === 1 ? 'one of these walls continues' : `${spilled.length} of these walls continue`} past the room, so the new finish runs along the whole wall`);
        const where = res.room ? `the ${res.room.label.toLowerCase()}'s ${ref.side ? `${ref.side} ` : ''}wall${new Set(touched).size > 1 ? 's' : ''}` : 'the walls';
        const summary = cmd.look.material === 'wallpaper' ? `put ${looked} on ${where}` : `made ${where} ${looked}`;
        return outcome({ summary, targets: [...new Set(touched)], notes, cosmetic: true, ...(res.room ? { rooms: [res.room.id] } : {}) });
    }
    const items = res.items;
    // Rooms painted by name ("paint the bedroom blue") mean the interior walls.
    let changed = 0;
    for (const item of items) {
        if (item.entity.arch?.role === 'room' && ref.noun !== 'floor') {
            // "the bedroom" → its walls
            const wallRes = resolveRef(env.index, { text: 'walls', noun: 'wall', adjectives: [], all: true, room: { text: item.label, noun: item.kind.split(' ').pop() ?? 'room', adjectives: [] } }, { ...env.ctx, selection: [item.id] });
            const faces = wallRes.faces ?? [];
            if (faces.length > 0) {
                paintWallFaces(env, faces, cmd.look);
                for (const f of faces)
                    targets.push(f.wallId);
                changed++;
                continue;
            }
        }
        if (paintItem(env, item, cmd, notes)) {
            changed++;
            targets.push(item.id);
            // Painting a composite root paints its parts: they may change too.
            if (item.entity.shape.kind === 'none')
                also.push(...descendantsWithShape(env, item.id).map((x) => x.id));
        }
    }
    if (cmd.look.tone && !cmd.look.color) {
        const mw = materialWord(cmd.look);
        if (mw?.finish && !tintable(mw.finish))
            notes.push(`${mw.label} comes in one tone, so "${cmd.look.tone}" could not be applied`);
    }
    if (changed === 0)
        return notes[0] ? refused(`${notes[0].charAt(0).toUpperCase()}${notes[0].slice(1)}.`, { notes }) : failed(`I couldn't change the colour of ${describeTargets(items, cmd.ref)}`, { notes });
    const part = ref.part ? ` ${ref.part}` : '';
    void ref;
    const what = items.length === 1 && items[0]?.entity.arch?.role === 'room' ? `the ${items[0].label.toLowerCase()} floor` : describeTargets(items, cmd.ref);
    return outcome({ summary: `made ${what}${part} ${looked}`, targets: [...new Set(targets)], also, notes, cosmetic: true });
}
/** Colour edits that name a light ("make the lamp blue" when the lamp is only a light source). */
export function wantsLightColor(items) {
    return items.every((i) => i.entity.light !== undefined && i.entity.shape.kind === 'none');
}
export { setPath };
