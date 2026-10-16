/**
 * From a {@link RoomDescription} to something the design tools can build: the design plan (shell only),
 * the ordered placement steps (every piece anchored to a wall, an opening, a host piece or a point), the
 * environment, and the camera the compare render is taken from.
 *
 * Nothing here is a preset: the room is exactly the rectangle described, the openings sit where the
 * description puts them, and each piece is placed where its own wall-relative numbers say. The steps are
 * fed to `design_plan` / `place_items`, so every one is measured and may be refused with a reason.
 */
import { isForbiddenKey } from '@aether/core';
import { furnitureByKind, furnitureSize } from '../furniture/index';
/** Half the thickness of the (exterior) wall of the shell: interior face coordinates are shifted by this to wall `t`. */
export const PHOTO_WALL_INSET = 0.14;
/** Id of the room built from a photo. */
export const PHOTO_ROOM_ID = 'room';
/** Id of the building built from a photo. */
export const PHOTO_BUILDING_ID = 'room-photo';
const FINISH_WORDS = [
    [/herringbone|chevron|parquet/, 'herringbone'],
    [/carpet|rug|wool|shag/, 'carpet'],
    [/oak|pine|ash|birch|maple|laminate|wood|timber|hardwood|plank/, 'oak'],
    [/walnut|mahogany|dark wood|espresso/, 'walnut'],
    [/marble/, 'marble'],
    [/terrazzo/, 'terrazzo'],
    [/concrete|cement|screed/, 'concrete'],
    [/subway/, 'subway-tile'],
    [/tile|ceramic|porcelain/, 'tile'],
    [/stone|slate|granite|limestone/, 'stone'],
    [/brick/, 'brick'],
    [/vinyl|lino/, 'tile'],
];
/** The nearest material finish of a free-text floor description (default oak). */
export function floorFinish(text) {
    const t = text.toLowerCase();
    for (const [re, f] of FINISH_WORDS)
        if (re.test(t))
            return f;
    return 'oak';
}
const FACING_YAW = { south: 0, east: 90, north: 180, west: -90 };
/** Plan-frame wall length of the shell (centreline) for a description wall. */
function wallRun(d, wall) {
    return wall === 'north' || wall === 'south' ? d.footprint.width : d.footprint.depth;
}
/** Wall `t` of an interior distance along a wall. */
export function alongToT(along) {
    return Math.round((along + PHOTO_WALL_INSET) * 1000) / 1000;
}
/** The compass side opposite to a heading (the wall behind the camera). */
export function wallBehind(headingDeg) {
    const h = ((headingDeg % 360) + 360) % 360;
    if (h >= 315 || h < 45)
        return 'south';
    if (h < 135)
        return 'west';
    if (h < 225)
        return 'north';
    return 'east';
}
function mostCommon(colors) {
    const count = new Map();
    for (const c of colors)
        count.set(c.toLowerCase(), (count.get(c.toLowerCase()) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}
/** A clear stretch of `wall` for an assumed door of `width`: the spot with the most room around it. */
function doorSpot(d, wall, width) {
    const len = wallRun(d, wall);
    const taken = [];
    for (const o of d.openings)
        if (o.wall === wall)
            taken.push([o.along - o.width / 2 - 0.15, o.along + o.width / 2 + 0.15]);
    for (const it of d.items) {
        if (it.wall !== wall || it.along === undefined)
            continue;
        const def = furnitureByKind(it.kind);
        const w = typeof it.params['width'] === 'number' ? it.params['width'] : def ? furnitureSize(def, it.params)[0] : 0.6;
        if (def?.mount === 'floor' || (def?.mount === 'wall' && (it.bottom ?? 1) < 2.1))
            taken.push([it.along - w / 2 - 0.1, it.along + w / 2 + 0.1]);
    }
    let best = len / 2;
    let bestGap = -1;
    for (let k = 0; k <= 40; k++) {
        const c = 0.35 + width / 2 + ((len - 0.7 - width) * k) / 40;
        if (c - width / 2 < 0.2 || c + width / 2 > len - 0.2)
            continue;
        // Distance to the nearest taken stretch (negative when inside one).
        let gap = Number.POSITIVE_INFINITY;
        for (const [a, b] of taken)
            gap = Math.min(gap, Math.max(a - (c + width / 2), c - width / 2 - b));
        if (gap > bestGap) {
            bestGap = gap;
            best = c;
        }
    }
    return Math.round(best * 100) / 100;
}
function paramJson(p) {
    const out = {};
    for (const [k, v] of Object.entries(p))
        if (!isForbiddenKey(k))
            out[k] = v;
    return out;
}
/** The plan opening of a description opening. */
function toPlanOpening(o, main) {
    const isWindow = o.kind === 'window';
    return {
        id: o.id,
        kind: isWindow ? 'window' : o.kind === 'opening' ? 'opening' : 'door',
        room: PHOTO_ROOM_ID,
        wall: o.wall,
        along: alongToT(o.along),
        width: o.width,
        ...(o.height !== undefined ? { height: o.height } : {}),
        ...(isWindow ? { ...(o.sill !== undefined ? { sill: o.sill } : { sill: 0.9 }), style: 'picture' } : { to: 'outside' }),
        ...(main ? { main: true } : {}),
    };
}
/**
 * An opening that the shell can be built with: a window or door that reaches above the ceiling, is wider than its wall or
 * sticks out past a corner is brought inside (and the change is reported), because a photo's estimates are rarely exact
 * and a refused shell would cost the whole run.
 */
export function fitOpening(d, o, notes) {
    const run = wallRun(d, o.wall);
    const ceiling = d.footprint.ceiling;
    const label = `${o.kind} ${o.id}`;
    let { width, along } = o;
    const maxWidth = Math.max(0.4, run - 0.7);
    if (width > maxWidth) {
        notes.push(`The ${label} is ${Math.round(width * 100) / 100} m wide but the ${o.wall} wall is ${Math.round(run * 100) / 100} m: narrowed to ${Math.round(maxWidth * 100) / 100} m.`);
        width = maxWidth;
    }
    // The builder drops an opening that comes closer than about 0.3 m to the end of its wall (the corner joint).
    const lo = width / 2 + 0.3;
    const hi = run - width / 2 - 0.3;
    const moved = Math.min(Math.max(along, lo), Math.max(lo, hi));
    if (Math.abs(moved - along) > 0.005) {
        notes.push(`The ${label} would stick out past a corner of the ${o.wall} wall: moved ${Math.round(Math.abs(moved - along) * 100) / 100} m along the wall.`);
        along = moved;
    }
    let { height, sill } = o;
    if (o.kind === 'window') {
        const s = sill ?? 0.9;
        const h = height ?? 1.3;
        const top = ceiling - 0.12;
        if (s + h > top) {
            const fitted = Math.max(0.4, top - s);
            if (s + fitted > top)
                sill = Math.max(0, top - fitted);
            else
                sill = s;
            height = fitted;
            notes.push(`The ${label} (sill ${Math.round(s * 100) / 100} m, ${Math.round(h * 100) / 100} m tall) would reach the ceiling at ${ceiling} m: shortened to ${Math.round(fitted * 100) / 100} m.`);
        }
    }
    else if (height !== undefined && height > ceiling - 0.1) {
        notes.push(`The ${label} is ${Math.round(height * 100) / 100} m tall under a ${ceiling} m ceiling: shortened.`);
        height = ceiling - 0.1;
    }
    return { ...o, width, along, ...(height !== undefined ? { height } : {}), ...(sill !== undefined ? { sill } : {}) };
}
/** Derive the plan, the steps and the environment from a description. */
export function deriveBuild(d) {
    const notes = [];
    const W = d.footprint.width;
    const D = d.footprint.depth;
    const i = PHOTO_WALL_INSET;
    const openings = d.openings.map((o) => fitOpening(d, { ...o }, notes));
    let assumedDoor;
    if (!openings.some((o) => o.kind !== 'window')) {
        const wall = wallBehind(d.camera.heading);
        const width = 0.9;
        assumedDoor = { id: 'door-assumed', kind: 'door', wall, along: doorSpot(d, wall, width), width, height: 2.05, visible: false, note: 'not visible in the photo' };
        openings.push(assumedDoor);
        notes.push(`No door is visible in the photo: a door was assumed in the ${wall} wall, behind the camera.`);
    }
    const mainDoorId = openings.find((o) => o.kind === 'door')?.id;
    const wallColors = ['north', 'south', 'east', 'west'].flatMap((w) => {
        const f = d.walls[w];
        return f?.color && f.visible !== false ? [f.color] : [];
    });
    const wallColor = mostCommon(wallColors);
    const distinct = new Set(wallColors.map((c) => c.toLowerCase()));
    // Walls that differ in the photo are painted one by one; walls the photo does not show take the common colour.
    const perWall = {};
    if (distinct.size > 1)
        for (const w of ['north', 'east', 'south', 'west'])
            if (d.walls[w]?.color)
                perWall[w] = d.walls[w]?.color;
    const finish = floorFinish(`${d.floor.material} ${d.floor.note}`);
    const relations = (it) => {
        const def = furnitureByKind(it.kind);
        if (!def)
            return [];
        const rel = [];
        if (def.mount === 'floor' && it.wall && (it.gap ?? 0.02) <= 0.1)
            rel.push({ type: 'against_wall', wall: it.wall });
        if (def.mount === 'surface' && it.on)
            rel.push({ type: 'on_top', target: it.on });
        if (def.kind === 'curtain' && it.opening)
            rel.push({ type: 'centred_on_opening', target: it.opening });
        return rel;
    };
    const plan = {
        id: PHOTO_BUILDING_ID,
        name: 'Room from a photo',
        style: d.style,
        brief: (d.summary || `A ${d.roomType} rebuilt from a photograph.`).slice(0, 500),
        programme: [{ room: PHOTO_ROOM_ID, purpose: d.roomType }],
        circulation: { entrance: PHOTO_ROOM_ID, notes: '', routes: [] },
        levels: [
            {
                name: 'Ground floor',
                height: Math.round((d.footprint.ceiling + 0.22) * 100) / 100,
                rooms: [
                    {
                        id: PHOTO_ROOM_ID,
                        type: d.roomType,
                        name: d.roomType.charAt(0).toUpperCase() + d.roomType.slice(1),
                        rect: [-i, -i, Math.round((W + i) * 1000) / 1000, Math.round((D + i) * 1000) / 1000],
                        floor: { finish, ...(d.floor.color ? { color: d.floor.color } : {}) },
                        ...(wallColor ? { wallColor } : {}),
                        ...(Object.keys(perWall).length > 0 ? { wallColors: perWall } : {}),
                    },
                ],
                openings: openings.map((o) => toPlanOpening(o, o.id === mainDoorId)),
                stairs: [],
            },
        ],
        furniture: d.items.filter((it) => it.kind !== 'cornice').map((it) => ({ id: it.id, kind: it.kind, room: PHOTO_ROOM_ID, intent: (it.label || it.kind).slice(0, 240), relations: relations(it) })),
    };
    const steps = [];
    const windowIds = new Set(openings.filter((o) => o.kind === 'window').map((o) => o.id));
    for (const it of d.items) {
        const def = furnitureByKind(it.kind);
        if (!def)
            continue;
        const base = { kind: it.kind, room: PHOTO_ROOM_ID, id: it.id, name: (it.label || it.kind).slice(0, 60) };
        const params = paramJson(it.params);
        if (Object.keys(params).length > 0)
            base['params'] = params;
        if (it.kind === 'cornice')
            continue; // handled below from the ceiling description, per wall
        if (it.kind === 'curtain') {
            if (!it.opening || !windowIds.has(it.opening)) {
                notes.push(`Curtain "${it.id}" names no window of the room (${it.opening ?? 'none given'}), so it was not hung: curtains are anchored to a window.`);
                continue;
            }
            steps.push({ id: it.id, phase: 'curtain', input: base, openingAlias: it.opening });
            continue;
        }
        if (def.mount === 'wall') {
            if (!it.wall || it.along === undefined) {
                notes.push(`${def.kind} "${it.id}" has no wall and position, so it was left out.`);
                continue;
            }
            const input = { ...base, wall: it.wall, t: alongToT(it.along) };
            if (it.above) {
                steps.push({ id: it.id, phase: 'wall', input, aboveOf: { target: it.above, gap: it.aboveGap ?? 0.35 } });
                continue;
            }
            if (it.bottom !== undefined)
                input['y'] = it.bottom;
            steps.push({ id: it.id, phase: 'wall', input });
            continue;
        }
        if (def.mount === 'ceiling') {
            const at = it.at ?? [W / 2, D / 2];
            steps.push({ id: it.id, phase: 'ceiling', input: { ...base, at } });
            continue;
        }
        if (def.mount === 'surface') {
            if (!it.on) {
                notes.push(`${def.kind} "${it.id}" is meant to stand on a piece but names none, so it was left out.`);
                continue;
            }
            const input = { ...base, on: it.on };
            if (it.offset)
                input['offset'] = it.offset;
            if (it.faces && it.faces in FACING_YAW)
                input['yaw'] = FACING_YAW[it.faces];
            steps.push({ id: it.id, phase: 'surface', input });
            continue;
        }
        // Floor pieces.
        const input = { ...base };
        if (it.wall && it.along !== undefined) {
            input['wall'] = it.wall;
            input['t'] = alongToT(it.along);
            input['gap'] = it.gap ?? 0.02;
            if (it.faces && it.faces in FACING_YAW)
                input['yaw'] = FACING_YAW[it.faces];
        }
        else if (it.at) {
            input['at'] = it.at;
            if (it.faces)
                input['faces'] = it.faces in FACING_YAW ? { point: facePoint(it.at, it.faces) } : it.faces;
        }
        else {
            notes.push(`${def.kind} "${it.id}" has neither a wall and position nor a floor point, so it was left out.`);
            continue;
        }
        steps.push({ id: it.id, phase: it.kind === 'rug' ? 'rug' : 'floor', input });
    }
    // Crown moulding: one run per wall, mitred in plan by shortening the side walls by the projection.
    const co = d.ceiling.cornice;
    if (co) {
        const depth = co.depth ?? Math.min(0.2, Math.max(0.06, co.height * 0.9));
        for (const wall of ['north', 'south', 'east', 'west']) {
            const run = wallRun(d, wall);
            const width = Math.min(14, wall === 'north' || wall === 'south' ? run : Math.max(0.5, run - 2 * depth));
            steps.push({
                id: `cornice-${wall}`,
                phase: 'trim',
                input: { kind: 'cornice', room: PHOTO_ROOM_ID, id: `cornice-${wall}`, name: `Cornice (${wall} wall)`, wall, t: alongToT(run / 2), params: { width, height: co.height, depth, ...(co.color ? { color: co.color } : {}) } },
            });
        }
    }
    const order = { rug: 0, floor: 1, surface: 2, wall: 3, curtain: 4, ceiling: 5, trim: 6 };
    const area = (s) => {
        const def = furnitureByKind(String(s.input['kind']));
        if (!def)
            return 0;
        const sz = furnitureSize(def, (s.input['params'] ?? {}));
        return sz[0] * sz[2];
    };
    steps.sort((a, b) => order[a.phase] - order[b.phase] || (a.phase === 'floor' ? area(b) - area(a) : 0));
    const light = d.light;
    const environment = { sky: light.sky, timeOfDay: light.timeOfDay };
    return { plan, steps, environment, notes, ...(assumedDoor ? { assumedDoor } : {}), openingIds: openings.map((o) => o.id) };
}
function facePoint(at, to) {
    switch (to) {
        case 'north':
            return [at[0], at[1] - 3];
        case 'south':
            return [at[0], at[1] + 3];
        case 'east':
            return [at[0] + 3, at[1]];
        case 'west':
            return [at[0] - 3, at[1]];
    }
}
