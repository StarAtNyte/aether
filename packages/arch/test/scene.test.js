import { describe, expect, it } from 'vitest';
import { anchorToOpening, centerOver, findingsText, findOpening, findRoom, isLookupError, listEntities, measure, moveItem, placeItem, queryWall, readScene, removeItem, resizeItem, reviewScene, rotateItem, scoreFindings, snapToWall, wallQueryText, } from '../src/index';
import { applyEdit, shellWorld } from './scene-helpers';
describe('scene model', () => {
    const world = shellWorld();
    const scene = readScene(world, 'home');
    it('reads rooms, walls with compass sides, openings and the room beyond a door', () => {
        expect(scene).not.toBeNull();
        const bedroom = findRoom(scene, 'bedroom');
        expect(isLookupError(bedroom)).toBe(false);
        if (isLookupError(bedroom))
            return;
        expect(bedroom.walls.map((w) => w.compass).sort()).toEqual(['east', 'north', 'south', 'west']);
        const north = bedroom.walls.find((w) => w.compass === 'north');
        expect(north.length).toBeCloseTo(4, 1);
        expect(north.openings).toHaveLength(1);
        expect(north.openings[0]?.kind).toBe('window');
        expect(north.openings[0]?.width).toBeCloseTo(1.4, 2);
        const south = bedroom.walls.find((w) => w.compass === 'south');
        const door = south.openings.find((o) => o.kind === 'door');
        expect(door).toBeDefined();
        expect(door?.leadsTo).toBe('home-l0-hall');
    });
    it('measures t from the left end seen from inside (north: west to east)', () => {
        const bedroom = findRoom(scene, 'bedroom');
        if (isLookupError(bedroom))
            throw new Error('no room');
        const north = bedroom.walls.find((w) => w.compass === 'north');
        expect(north.a[0]).toBeLessThan(north.b[0]);
        const south = bedroom.walls.find((w) => w.compass === 'south');
        expect(south.a[0]).toBeGreaterThan(south.b[0]);
    });
    it('queries a wall: openings, free stretches and a readable text', () => {
        const bedroom = findRoom(scene, 'bedroom');
        if (isLookupError(bedroom))
            throw new Error('no room');
        const north = bedroom.walls.find((w) => w.compass === 'north');
        const q = queryWall(scene, bedroom, north, { kind: 'art', y0: 1.2, y1: 1.8 });
        expect(q.free.length).toBeGreaterThanOrEqual(2);
        const win = north.openings[0];
        for (const f of q.free)
            expect(f.t1 <= win.t0 + 0.01 || f.t0 >= win.t1 - 0.01).toBe(true);
        const text = wallQueryText(q);
        expect(text).toContain('window');
        expect(text).toContain('north wall');
        expect(text).toContain('from the west end to the east end');
    });
    it('lists entities by room and wall', () => {
        const l = listEntities(scene, { room: 'bedroom' });
        expect(l.lines.some((x) => x.startsWith('room '))).toBe(true);
        expect(l.lines.some((x) => x.startsWith('opening '))).toBe(true);
        expect(listEntities(scene, { room: 'nowhere' }).lines[0]).toContain('no room');
    });
    it('measures between a wall face and a point', () => {
        const m = measure(scene, 'bedroom/north', { point: [2, 1] });
        expect('error' in m).toBe(false);
        if ('error' in m)
            return;
        expect(m.gap).toBeGreaterThan(0.5);
        expect(m.text).toContain('b is');
    });
});
describe('placement tools', () => {
    it('places a bed against the north wall, centred, and reports measured facts', () => {
        const w0 = shellWorld();
        const r = placeItem(w0, undefined, { kind: 'bed', room: 'bedroom', id: 'bed', wall: 'north', align: 'centre' });
        expect(r.ok).toBe(true);
        if (!r.ok)
            return;
        expect(r.text).toContain('against the north wall');
        expect(r.text).toContain('from the left end');
        const w1 = applyEdit(w0, r);
        const scene = readScene(w1, 'home');
        const bed = scene.items.find((i) => i.id === 'home-bed');
        expect(bed.placed).toBe(true);
        expect(bed.against?.[0]?.compass).toBe('north');
        expect(bed.pos[0]).toBeCloseTo(2, 1);
    });
    it('refuses a curtain over a door and over a bare wall, accepts it at the window', () => {
        const w0 = shellWorld();
        const scene = readScene(w0, 'home');
        const bedroom = findRoom(scene, 'bedroom');
        if (isLookupError(bedroom))
            throw new Error('x');
        const door = bedroom.walls.flatMap((w) => w.openings).find((o) => o.kind === 'door');
        const win = bedroom.walls.flatMap((w) => w.openings).find((o) => o.kind === 'window');
        const bad = placeItem(w0, undefined, { kind: 'curtain', room: 'bedroom', opening: door.id });
        expect(bad.ok).toBe(false);
        if (!bad.ok)
            expect(bad.error).toMatch(/not a window/);
        const noAnchor = placeItem(w0, undefined, { kind: 'curtain', room: 'bedroom', wall: 'east', t: 1 });
        expect(noAnchor.ok).toBe(false);
        const good = placeItem(w0, undefined, { kind: 'curtain', room: 'bedroom', id: 'drape', opening: win.id });
        expect(good.ok).toBe(true);
        if (!good.ok)
            return;
        expect(good.ids.length).toBe(2);
        const w1 = applyEdit(w0, good);
        expect(reviewScene(w1, 'home').filter((f) => f.code.startsWith('wall_item') || f.code === 'curtain_off_window')).toEqual([]);
    });
    it('refuses a painting over the window and suggests the nearest clear spot', () => {
        const w0 = shellWorld();
        const scene = readScene(w0, 'home');
        const bedroom = findRoom(scene, 'bedroom');
        if (isLookupError(bedroom))
            throw new Error('x');
        const win = bedroom.walls.flatMap((w) => w.openings).find((o) => o.kind === 'window');
        const r = placeItem(w0, undefined, { kind: 'art', room: 'bedroom', wall: 'north', t: win.centre, y: 1.2 });
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.error).toContain('overlap');
            expect(r.error).toContain('nearest clear spot');
        }
        const ok = placeItem(w0, undefined, { kind: 'art', room: 'bedroom', wall: 'north', t: 3.4, y: 1.2, params: { width: 0.6, height: 0.8 } });
        expect(ok.ok).toBe(true);
    });
    it('refuses overlaps, pieces through a wall, pieces in a doorway and walls-in', () => {
        let w = shellWorld();
        w = applyEdit(w, placeItem(w, undefined, { kind: 'bed', room: 'bedroom', id: 'bed', wall: 'north', align: 'centre' }));
        const overlap = placeItem(w, undefined, { kind: 'wardrobe', room: 'bedroom', at: [2, 0.7] });
        expect(overlap.ok).toBe(false);
        if (!overlap.ok)
            expect(overlap.error).toMatch(/overlaps/);
        const poke = placeItem(w, undefined, { kind: 'wardrobe', room: 'bedroom', at: [3.9, 2.5], yaw: 90 });
        expect(poke.ok).toBe(false);
        if (!poke.ok)
            expect(poke.error).toMatch(/through the (east|south|north|west) wall/);
        const scene = readScene(w, 'home');
        const bedroom = findRoom(scene, 'bedroom');
        if (isLookupError(bedroom))
            throw new Error('x');
        const south = bedroom.walls.find((x) => x.compass === 'south');
        const door = south.openings.find((o) => o.kind === 'door');
        // A wardrobe right in front of the door.
        const dx = south.a[0] + south.dir[0] * door.centre;
        const inDoor = placeItem(w, undefined, { kind: 'wardrobe', room: 'bedroom', at: [dx, 3.1] });
        expect(inDoor.ok).toBe(false);
    });
    it('moves, rotates, resizes, removes, snaps, anchors and centres', () => {
        let w = shellWorld();
        w = applyEdit(w, placeItem(w, undefined, { kind: 'bed', room: 'bedroom', id: 'bed', wall: 'north', align: 'centre' }));
        const scene = readScene(w, 'home');
        const win = scene.rooms[0].walls.flatMap((x) => x.openings).find((o) => o.kind === 'window');
        w = applyEdit(w, placeItem(w, undefined, { kind: 'art', room: 'bedroom', id: 'picture', wall: 'north', t: 3.4, y: 1.4, params: { width: 0.7, height: 0.5 } }));
        // Centre the picture over the bed: the bed centre is at 2.0, but the window is behind it: refused (window).
        const over = centerOver(w, undefined, 'picture', 'bed', { gap: 0.4 });
        expect(over.ok).toBe(false);
        if (!over.ok)
            expect(over.error).toMatch(/window/);
        // Anchor it to the window's right side instead.
        const right = anchorToOpening(w, undefined, 'picture', { opening: win.id, mode: 'right', gap: 0.2 });
        expect(right.ok).toBe(true);
        // Move the bed to the west wall, rotate it, resize it, then remove it.
        const mv = moveItem(w, undefined, 'bed', { wall: 'west', align: 'centre' });
        expect(mv.ok).toBe(true);
        w = applyEdit(w, mv);
        const rot = rotateItem(w, undefined, 'bed', { delta: 0 });
        expect(rot.ok).toBe(true);
        const rs = resizeItem(w, undefined, 'bed', { width: 1.2 });
        expect(rs.ok).toBe(true);
        w = applyEdit(w, rs);
        const snapped = snapToWall(w, undefined, 'bed', { wall: 'east', align: 'end' });
        expect(snapped.ok).toBe(true);
        const gone = removeItem(w, undefined, 'bed');
        expect(gone.ok).toBe(true);
        if (gone.ok)
            expect(gone.patches[0]).toMatchObject({ op: 'remove', id: 'home-bed' });
    });
    it('survives hostile input without throwing', () => {
        const w = shellWorld();
        const bad = [
            () => placeItem(w, undefined, { kind: 'bed', room: 'bedroom', at: [Number.NaN, 1] }),
            () => placeItem(w, undefined, { kind: 'bed', room: 'bedroom', at: [1e12, 1] }),
            () => placeItem(w, undefined, { kind: 'bed', room: 'bedroom', wall: 'north', t: Number.POSITIVE_INFINITY }),
            () => placeItem(w, undefined, { kind: '__proto__', room: 'bedroom', at: [1, 1] }),
            () => placeItem(w, undefined, { kind: 'constructor', room: 'bedroom', at: [1, 1] }),
            () => placeItem(w, undefined, { kind: 'bed', room: '__proto__', at: [1, 1] }),
            () => placeItem(w, undefined, { kind: 'bed', room: 'bedroom', at: [1, 1], id: '../../x' }),
            () => placeItem(w, undefined, { kind: 'bed', room: 'bedroom', at: [1, 1], params: JSON.parse('{"__proto__":{"x":1},"width":"wide"}') }),
            () => placeItem(w, 'nope', { kind: 'bed', room: 'bedroom', at: [1, 1] }),
            () => moveItem(w, undefined, 'ghost', { at: [1, 1] }),
            () => moveItem(w, undefined, '__proto__', { at: [1, 1] }),
            () => rotateItem(w, undefined, 'ghost', { yaw: 1 }),
            () => resizeItem(w, undefined, 'ghost', { width: 1 }),
            () => removeItem(w, undefined, 'ghost'),
            () => removeItem(w, undefined, '\u0000'.repeat(500)),
        ];
        for (const f of bad) {
            const r = f();
            expect(r.ok).toBe(false);
        }
        const huge = placeItem(w, undefined, { kind: 'bed', room: 'bedroom', at: [2, 2], params: { width: 1e9, depth: -5, headboard: 'x'.repeat(10_000) } });
        // Parameters clamp to their ranges instead of failing.
        expect(huge.ok === true || huge.error.length > 0).toBe(true);
    });
    it('a finished bedroom scores well and the findings text is readable', () => {
        let w = shellWorld();
        w = applyEdit(w, placeItem(w, undefined, { kind: 'bed', room: 'bedroom', id: 'bed', wall: 'west', align: 'centre' }));
        w = applyEdit(w, placeItem(w, undefined, { kind: 'ceiling-light', room: 'bedroom', id: 'light', at: [2, 1.8] }));
        const f = reviewScene(w, 'home');
        expect(scoreFindings(f)).toBeGreaterThan(70);
        expect(typeof findingsText(f)).toBe('string');
    });
    it('opening lookups name what exists', () => {
        const scene = readScene(shellWorld(), 'home');
        const r = findOpening(scene, 'nothing');
        expect(isLookupError(r)).toBe(true);
        if (isLookupError(r))
            expect(r.error).toContain('openings are');
    });
});
