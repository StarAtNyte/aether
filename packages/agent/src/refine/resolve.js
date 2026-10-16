import { hexToRgb, synonymsOf, singular } from './lexicon';
import { ROOM_WORDS } from './parse-ref';
import { groundDistance } from './scene';
import { roomWalls, viewVectors, wallsBySide } from './walls';
const GENERIC_ADJ = new Set(['big', 'small', 'large', 'old', 'new', 'nice', 'wooden', 'main', 'other']);
const MAX_AMBIGUOUS = 8;
const ROOM_SYNONYMS = {
    master: ['main'], main: ['master'], lounge: ['living'], living: ['lounge'], hallway: ['hall'], hall: ['hallway'], washroom: ['bathroom'], bath: ['bathroom'], toilet: ['bathroom'], den: ['study'], kitchenette: ['kitchen'], loo: ['bathroom'],
};
function naturalCompare(a, b) {
    return a.localeCompare(b, 'en', { numeric: true });
}
function colorDistance(a, b) {
    const [r1, g1, b1] = hexToRgb(a);
    const [r2, g2, b2] = hexToRgb(b);
    return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}
/** The main colour of an entity, when it has one. */
export function colorOf(item) {
    const e = item.entity;
    if (e.material?.color)
        return e.material.color;
    const sh = e.shape;
    if (sh.kind === 'procedural') {
        const c = sh.params['color'];
        if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))
            return c;
    }
    return undefined;
}
function isLocked(item) {
    return item.entity.locked === true;
}
/** Resolve rooms matching a room phrase. */
export function resolveRooms(index, ref, ctx) {
    let pool = index.rooms;
    if (pool.length === 0)
        return [];
    const noun = ref.noun;
    const wanted = new Set();
    for (const w of [noun, ...ref.adjectives]) {
        if (!w)
            continue;
        wanted.add(singular(w));
        for (const s of ROOM_SYNONYMS[singular(w)] ?? [])
            wanted.add(s);
    }
    wanted.delete('room');
    wanted.delete('the');
    if (wanted.size > 0) {
        const scored = pool.map((r) => {
            let s = 0;
            for (const w of wanted)
                if (r.tokens.has(w))
                    s += w === noun ? 3 : 2;
            return { r, s };
        });
        const top = Math.max(...scored.map((x) => x.s));
        pool = top > 0 ? scored.filter((x) => x.s === top).map((x) => x.r) : [];
        // "bedroom" matches "master bedroom" and "bedroom 2": keep all when only the noun was given.
    }
    if (pool.length > 1 && ref.ordinal !== undefined && ref.ordinal > 0) {
        // "bedroom 2" names the room called Bedroom 2.
        const named = pool.filter((r) => r.tokens.has(String(ref.ordinal)));
        if (named.length === 1)
            return named;
    }
    if (pool.length > 1 && ref.ordinal !== undefined) {
        // Main / master rooms come first, then by the number in the name, then by id.
        const rank = (r) => (/\b(?:main|master|primary)\b/.test(r.label.toLowerCase()) ? -1 : Number(/\d+/.exec(r.label)?.[0] ?? 0));
        const sorted = [...pool].sort((a, b) => rank(a) - rank(b) || naturalCompare(a.id, b.id));
        const pick = ref.ordinal === -1 ? sorted[sorted.length - 1] : sorted[ref.ordinal - 1];
        return pick ? [pick] : [];
    }
    if (pool.length > 1 && ref.other) {
        const anchors = (ctx.focusRooms ?? []).concat(ctx.focus, ctx.selection).map((id) => index.get(id)).filter((x) => !!x);
        const used = new Set(anchors.map((a) => (a.entity.arch?.role === 'room' ? a.id : index.roomOf(a)?.id)).filter((x) => !!x));
        const others = pool.filter((r) => !used.has(r.id));
        if (others.length > 0 && used.size > 0)
            return others;
    }
    return pool;
}
function nounScore(item, noun, adjectives) {
    if (!noun)
        return 0;
    let s = 0;
    if (item.tokens.has(noun))
        s = 10;
    else {
        for (const syn of synonymsOf(noun)) {
            if (item.tokens.has(syn)) {
                s = 6;
                break;
            }
        }
    }
    if (noun === 'floor' && item.entity.arch?.role === 'room')
        s = 10;
    if (noun === 'light' || noun === 'lamp') {
        if (item.entity.light && s === 0)
            s = 5;
        if (item.entity.arch?.role === 'light' && s === 0)
            s = 7;
    }
    if (s === 0)
        return 0;
    // The object IS the noun (a sofa), not something merely named after it (an "island pendant").
    const lastWord = item.kind.split(' ').pop() ?? '';
    if (lastWord === noun || synonymsOf(noun).includes(lastWord))
        s += 6;
    for (const a of adjectives) {
        if (GENERIC_ADJ.has(a))
            continue;
        const w = singular(a);
        if (item.tokens.has(w) || item.roomTokens.has(w))
            s += 4;
        else
            for (const syn of synonymsOf(a))
                if (syn !== noun && (item.tokens.has(syn) || item.roomTokens.has(syn)))
                    s += 2;
    }
    return s;
}
function relationFilter(items, anchor, rel, heading) {
    const { forward, right } = viewVectors(heading);
    const sat = items.filter((c) => {
        if (c.id === anchor.id)
            return false;
        const dx = c.pos[0] - anchor.pos[0];
        const dz = c.pos[2] - anchor.pos[2];
        const dy = c.pos[1] - anchor.pos[1];
        const horiz = Math.hypot(dx, dz);
        const reach = Math.max(anchor.size[0], anchor.size[2]) / 2 + 3;
        switch (rel) {
            case 'left of':
                return horiz < reach + 3 && dx * right[0] + dz * right[1] < -0.2;
            case 'right of':
                return horiz < reach + 3 && dx * right[0] + dz * right[1] > 0.2;
            case 'above':
                return dy > anchor.size[1] * 0.3 && horiz < reach;
            case 'under':
                return dy < -0.05 && horiz < reach;
            case 'behind':
                return horiz < reach + 2 && dx * forward[0] + dz * forward[1] > 0.2;
            case 'in front of':
                return horiz < reach + 2 && dx * forward[0] + dz * forward[1] < -0.2;
            default:
                return horiz < reach + 2;
        }
    });
    const pool = sat.length > 0 ? sat : items.filter((c) => c.id !== anchor.id);
    return pool.sort((a, b) => groundDistance(a, anchor) - groundDistance(b, anchor));
}
/** Resolve a reference. Locked objects are never returned: the user locked them so they stay as they are. */
export function resolveRef(index, ref, ctx, depth = 0) {
    const r = resolveInner(index, ref, ctx, depth);
    const open = r.items.filter((i) => !isLocked(i));
    if (open.length === r.items.length)
        return r;
    return open.length > 0 ? { ...r, items: open } : { items: [], via: 'none', reason: `${r.items[0]?.label ?? 'That'} is locked, so I left it alone` };
}
function resolveInner(index, ref, ctx, depth) {
    const live = (ids) => ids.map((id) => index.get(id)).filter((x) => !!x && !isLocked(x));
    const none = (reason) => ({ items: [], reason, via: 'none' });
    // --- Pronouns -------------------------------------------------------------
    const demonstrative = ref.pronoun !== undefined;
    if (demonstrative && !ref.noun) {
        const sel = live(ctx.selection);
        if (ref.pronoun === 'same') {
            const f = live(ctx.focus);
            if (f.length > 0)
                return { items: f, via: 'focus' };
            return sel.length > 0 ? { items: sel, via: 'selection' } : none('nothing to refer to yet');
        }
        if (sel.length > 0)
            return { items: ref.pronoun === 'it' || ref.pronoun === 'this' || ref.pronoun === 'that' ? sel.slice(0, 1).concat(sel.length > 1 ? sel.slice(1) : []) : sel, via: 'selection' };
        const f = live(ctx.focus);
        if (f.length > 0)
            return { items: f, via: 'focus' };
        return none('nothing is selected');
    }
    // --- Room qualifier -------------------------------------------------------
    let room;
    let roomCandidates = [];
    if (ref.room && depth < 2) {
        roomCandidates = resolveRooms(index, ref.room, ctx);
        if (roomCandidates.length === 0)
            return none(`I can't find a room called "${ref.room.text}"`);
        if (roomCandidates.length > 1) {
            // The room the user is working in wins over a guess.
            const near = ctx.selection.concat(ctx.focus).map((id) => index.get(id)).filter((x) => !!x);
            const nearRooms = new Set(near.map((n) => (n.entity.arch?.role === 'room' ? n.id : n.roomId)));
            const inFocus = roomCandidates.filter((r) => nearRooms.has(r.id));
            if (inFocus.length === 1 && !ref.room.other)
                roomCandidates = inFocus;
        }
        if (roomCandidates.length === 1)
            room = roomCandidates[0];
    }
    // A room phrase alone ("the bedroom") resolves to the room itself.
    if (!ref.noun && ref.room === undefined && !ref.all)
        return none('I did not catch what to change');
    if (!ref.noun && ref.room) {
        return roomCandidates.length === 1 ? { items: roomCandidates, room: roomCandidates[0], via: 'room' } : { items: [], ambiguous: roomCandidates.slice(0, MAX_AMBIGUOUS), via: 'room', reason: 'which room?' };
    }
    // --- Candidate pool by noun -----------------------------------------------
    const noun = ref.noun;
    const isRoomNoun = ROOM_WORDS.has(noun) && !ref.room && noun !== 'floor';
    if (isRoomNoun) {
        const rooms = resolveRooms(index, ref, ctx);
        if (rooms.length === 1)
            return { items: rooms, room: rooms[0], via: 'room' };
        if (rooms.length > 1)
            return { items: [], ambiguous: rooms.slice(0, MAX_AMBIGUOUS), via: 'room', reason: 'which room?' };
    }
    // Walls: geometry decides which faces.
    if (noun === 'wall' || noun === 'walls') {
        const rooms = room ? [room] : roomCandidates.length > 1 ? roomCandidates : index.rooms;
        if (ref.room && roomCandidates.length > 1 && ref.ordinal === undefined && !ref.allWord) {
            return { items: [], ambiguous: roomCandidates.slice(0, MAX_AMBIGUOUS), via: 'room', reason: `which ${ref.room.noun}?` };
        }
        const picks = [];
        for (const r of rooms)
            picks.push(...wallsBySide(roomWalls(index, r), ref.side, ctx.heading));
        const faces = new Map();
        for (const w of picks)
            for (const f of w.faces)
                faces.set(`${f.wallId}:${f.side}`, f);
        const items = [...new Set([...faces.values()].map((f) => f.wallId))].map((id) => index.get(id)).filter((x) => !!x && !isLocked(x));
        if (items.length > 0)
            return { items, faces: [...faces.values()], walls: picks, ...(room ? { room } : {}), via: 'room' };
        // No room geometry (non-arch world): fall through to entity matching.
    }
    let pool = index.items.filter((i) => !i.entity.tags.includes('backdrop') && (ctx.only ? ctx.only(i) : true));
    pool = pool.filter((i) => i.entity.arch?.role !== 'building' && i.entity.arch?.role !== 'level' || noun === 'building' || noun === 'house');
    const scored = pool.map((i) => ({ i, s: nounScore(i, noun, ref.adjectives) })).filter((x) => x.s > 0);
    // Exact id / full-name match wins outright.
    const text = ref.text.toLowerCase().replace(/^(?:the|a|an|my)\s+/, '');
    const sameName = pool.filter((i) => i.id === text || i.id === noun || i.label.toLowerCase() === text);
    // A name only settles it when exactly one thing carries it ("Station", not "Chair" ×8).
    const exact = sameName.length === 1 ? sameName[0] : undefined;
    if (exact && !ref.ordinal && !ref.all)
        return { items: [exact], via: 'name' };
    let cands = scored;
    if (cands.length === 0) {
        // Whole-phrase token overlap ("lantern post", "campfire").
        return none(`I can't find "${ref.text}" in this world`);
    }
    const best = Math.max(...cands.map((x) => x.s));
    // Keep the strongest matches, plus synonyms when the noun itself hit nothing.
    cands = cands.filter((x) => x.s >= best - (best >= 10 ? 3 : 0));
    // Parts of a composite (a tent's pole, a campfire's light) only when nothing whole fits as well.
    const whole = cands.filter((x) => !x.i.isPart);
    if (whole.length > 0)
        cands = whole;
    let items = cands.map((x) => x.i).sort((a, b) => a.order - b.order);
    // Pronoun + noun ("this chair"): selection / focus first.
    if (demonstrative) {
        const pref = new Set([...ctx.selection, ...ctx.focus]);
        const pi = items.filter((i) => pref.has(i.id));
        if (pi.length > 0)
            return { items: pi.filter((i) => !isLocked(i)), via: 'selection' };
    }
    // --- Qualifiers -----------------------------------------------------------
    if (roomCandidates.length > 0) {
        const ids = new Set(roomCandidates.map((r) => r.id));
        const inRooms = items.filter((i) => (i.roomId && ids.has(i.roomId)) || ids.has(i.id));
        if (inRooms.length > 0 || roomCandidates.length === 1)
            items = inRooms;
        if (items.length === 0)
            return none(`there is no ${noun} in the ${ref.room?.text ?? 'room'}`);
    }
    if (ref.colorAdj) {
        const near = items.filter((i) => {
            const c = colorOf(i);
            return c !== undefined && colorDistance(c, ref.colorAdj) < 140;
        });
        if (near.length > 0)
            items = near;
    }
    if (ref.relation && depth < 2) {
        const anchorRes = resolveRef(index, ref.relation.anchor, ctx, depth + 1);
        if (anchorRes.items.length === 0)
            return anchorRes.ambiguous ? { ...anchorRes, items: [] } : none(anchorRes.reason ?? `I can't find "${ref.relation.anchor.text}"`);
        const anchor = anchorRes.items[0];
        const ranked = relationFilter(items, anchor, ref.relation.rel, ctx.heading);
        if (ranked.length === 0)
            return none(`nothing like that near the ${anchor.label.toLowerCase()}`);
        return { items: ref.all ? ranked : [ranked[0]], via: 'relation' };
    }
    if (ctx.excluded && ref.other)
        items = items.filter((i) => !ctx.excluded?.includes(i.id));
    // Ordinal: natural id order within the room that has most of them.
    if (ref.ordinal !== undefined) {
        let group = items;
        if (!room && roomCandidates.length <= 1) {
            const byRoom = new Map();
            for (const i of items)
                byRoom.set(i.roomId ?? '', [...(byRoom.get(i.roomId ?? '') ?? []), i]);
            const sel = ctx.selection.concat(ctx.focus).map((id) => index.get(id)).find((x) => !!x);
            const pref = sel ? byRoom.get(sel.roomId ?? '') : undefined;
            group = pref && pref.length >= Math.abs(ref.ordinal) ? pref : [...byRoom.values()].sort((a, b) => b.length - a.length)[0] ?? items;
        }
        const sorted = [...group].sort((a, b) => naturalCompare(a.id, b.id));
        const pick = ref.ordinal === -1 ? sorted[sorted.length - 1] : sorted[ref.ordinal - 1];
        return pick ? { items: isLocked(pick) ? [] : [pick], via: 'name', ...(isLocked(pick) ? { reason: `${pick.label} is locked` } : {}) } : none(`there are only ${sorted.length} ${noun}s`);
    }
    // "the other one": everything of that kind except the focus.
    if (ref.other) {
        const used = new Set([...(ctx.excluded ?? []), ...ctx.focus]);
        const others = items.filter((i) => !used.has(i.id));
        if (others.length > 0)
            return { items: others.filter((i) => !isLocked(i)), via: 'name' };
    }
    items = items.filter((i) => !isLocked(i));
    if (items.length === 0)
        return none(`${ref.text} is locked, so I left it alone`);
    if (items.length === 1)
        return { items, ...(room ? { room } : {}), via: 'name' };
    // "The train": a group tag shared by its parts (engine, carriages) names the whole group.
    if (!ref.ordinal && items.length >= 2 && items.every((i) => i.entity.tags.includes(noun) && !i.entity.arch) && !items.some((i) => (i.kind.split(' ').pop() ?? '') === noun)) {
        return { items: items.filter((i) => !isLocked(i)), ...(room ? { room } : {}), via: 'name' };
    }
    // "The pine forest": a scatter field is often several fields with one name.
    if (!ref.ordinal && items.length >= 2 && items.every((i) => i.entity.shape.kind === 'scatter')) {
        const stem = (id) => id.replace(/-\d+$/, '');
        if (items.every((i) => stem(i.id) === stem(items[0].id)))
            return { items, ...(room ? { room } : {}), via: 'name' };
    }
    // Plural / "all": every match. One-of-a-kind landmarks and goals are not "the lanterns" when a crowd of the same thing exists.
    if (ref.all) {
        const crowd = items.filter((i) => !i.entity.tags.some((t) => /^(landmark|goal|focus|hero)$/.test(t)));
        return { items: (crowd.length >= 3 ? crowd : items).slice(0, 400), ...(room ? { room } : {}), via: 'name' };
    }
    // Several matches: prefer what the user selected or just edited, then the closest to them.
    const sel = live(ctx.selection).filter((s) => items.some((i) => i.id === s.id));
    if (sel.length > 0)
        return { items: sel, via: 'selection' };
    const foc = live(ctx.focus).filter((s) => items.some((i) => i.id === s.id));
    if (foc.length > 0)
        return { items: foc, via: 'focus' };
    const context = live(ctx.selection.concat(ctx.focus));
    if (context.length > 0) {
        const anchor = context[0];
        const sameRoom = items.filter((i) => i.roomId !== undefined && i.roomId === (anchor.entity.arch?.role === 'room' ? anchor.id : anchor.roomId));
        if (sameRoom.length === 1)
            return { items: sameRoom, via: 'relation' };
    }
    // Identical interchangeable things (a field of coins) are one group, not an ambiguity, for plural-ish nouns.
    return { items: [], ambiguous: items.slice(0, MAX_AMBIGUOUS), via: 'name', reason: `which ${noun}?` };
}
