/**
 * Modelled vehicles for the asset library, authored in code (MIT, first-party): a racing kart with a helmeted driver,
 * an open-wheel race car and a family of road cars (sedan, taxi, police, sports coupe, hatchback, SUV). Each is a
 * real-sized, painted, glazed body on four wheels with separate, named nodes for the wheels, the steering and the
 * body so the renderer can spin, steer and sway them (`packages/render/src/sync/vehicle-rig.ts`):
 *
 *   chassis            the body: paint, glass, trim, lights, driver, steering wheel
 *   steer_fl/steer_fr  front wheel yaw nodes (steering), each holding wheel_fl / wheel_fr
 *   wheel_*            tyre, rim, brake; spin about the node's local X axis
 *   steer_wheel        the steering wheel (kart, race car); spins about its local X axis
 *
 *   npx tsx scripts/assets/vehicles.ts            # build GLBs + merge into assets/catalog.json
 *
 * Models face -Z (the engine's forward axis), stand on y = 0 and are centred in x / z. The paint material is named
 * "paint" so an entity's `material.color` tints it.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMaterialsClearcoat, KHRMaterialsEmissiveStrength } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { Catalog } from '../../packages/assets/src/schema';
import { colliderFor, tagsFor } from './describe';
import { hullPoints } from './process';
import { mergeIntoCatalog } from './creatures';
import { append, bounds, ellipsoid, extrudeXY, lathe, loft, merge, mesh, mirrorZ, move, resample, rotX, rotY, rotZ, roundedBox, sectionAt, sideDisc, sideLine, smooth, toLibraryFrame, topRibbon, topY, tube, triangles, } from './vehicle-geo';
const ROOT = resolve(import.meta.dirname, '../..');
const LIB = join(ROOT, 'assets', 'lib');
const hex = (h) => {
    const n = Number.parseInt(h.slice(1), 16);
    const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
};
// ---------------------------------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------------------------------
const WHEEL_NAMES = ['fl', 'fr', 'rl', 'rr'];
/** A wheel (tyre, rim with spokes, brake disc), axle along Z, outer face toward +Z when `outer` is 1. */
function wheelMeshes(r, w, rimR, spokes, outer) {
    const hw = w / 2;
    const sw = r - rimR;
    const tyre = lathe([
        [-hw * 0.9, rimR - 0.004],
        [-hw * 1.0, rimR + sw * 0.18],
        [-hw * 0.99, rimR + sw * 0.62],
        [-hw * 0.9, r - sw * 0.08],
        [-hw * 0.62, r * 0.998],
        [0, r],
        [hw * 0.62, r * 0.998],
        [hw * 0.9, r - sw * 0.08],
        [hw * 0.99, rimR + sw * 0.62],
        [hw * 1.0, rimR + sw * 0.18],
        [hw * 0.9, rimR - 0.004],
        [-hw * 0.9, rimR - 0.004],
    ], 40, false);
    // The face looks toward +x of the lathe (outer side).
    const rim = lathe([
        [hw * 0.88, rimR * 1.0],
        [hw * 0.8, rimR * 0.96],
        [hw * 0.55, rimR * 0.9],
        [-hw * 0.7, rimR * 0.92],
        [-hw * 0.9, rimR * 0.99],
    ], 36, false);
    const face = lathe([[hw * 0.62, 0], [hw * 0.66, rimR * 0.2], [hw * 0.58, rimR * 0.3], [hw * 0.5, rimR * 0.38], [hw * 0.3, rimR * 0.9]], 24, true);
    append(rim, face);
    for (let s = 0; s < spokes; s++) {
        const a = (s / spokes) * Math.PI * 2;
        const spoke = roundedBox(hw * 0.62, 0, 0, hw * 0.28, rimR * 0.62, rimR * 0.13, 3.5);
        // The box lies along +y from the hub; rotate it about the axle (lathe axis X).
        move(spoke, 0, rimR * 0.55, 0);
        rotX(spoke, a);
        append(rim, spoke);
    }
    const brake = lathe([[-hw * 0.55, rimR * 0.78], [-hw * 0.4, rimR * 0.78], [-hw * 0.4, rimR * 0.3], [-hw * 0.55, rimR * 0.3]], 32, true);
    const caliper = roundedBox(-hw * 0.5, rimR * 0.62, 0, hw * 0.3, rimR * 0.26, rimR * 0.34, 3);
    append(brake, caliper);
    // Lathe axis X -> axle Z. Outer side (lathe +x) must point to outer*Z.
    const turn = (m) => rotY(m, outer === 1 ? -Math.PI / 2 : Math.PI / 2);
    return { tyre: turn(tyre), rim: turn(rim), brake: turn(brake) };
}
/** Add four wheels (named nodes + parts). Front axle at +xf, rear at -xr, track half-width z. */
function addWheels(d, front, rear, xf, xr, zf, zr, steerNodes = true) {
    for (const nm of WHEEL_NAMES) {
        const isFront = nm[0] === 'f';
        const side = nm[1] === 'r' ? 1 : -1;
        const spec = isFront ? front : rear;
        const at = [isFront ? xf : -xr, spec.r, side * (isFront ? zf : zr)];
        if (isFront && steerNodes) {
            d.nodes.push({ name: `steer_${nm}`, parent: 'root', at });
            d.nodes.push({ name: `wheel_${nm}`, parent: `steer_${nm}`, at: [0, 0, 0] });
        }
        else {
            d.nodes.push({ name: `wheel_${nm}`, parent: 'root', at });
        }
        const wm = wheelMeshes(spec.r, spec.w, spec.rimR, spec.spokes, side);
        d.parts.push({ node: `wheel_${nm}`, mat: 'rubber', geo: wm.tyre }, { node: `wheel_${nm}`, mat: 'alloy', geo: wm.rim }, { node: `wheel_${nm}`, mat: 'brake', geo: wm.brake });
    }
}
/** The standard material set. */
function baseMats(paint, extra = {}) {
    return {
        paint: { color: hex(paint), metal: 0.45, rough: 0.3, clearcoat: 1 },
        glass: { color: [0.012, 0.02, 0.028], metal: 0, rough: 0.04, alpha: 0.5 },
        rubber: { color: [0.018, 0.018, 0.02], metal: 0, rough: 0.82 },
        alloy: { color: hex('#b9bec4'), metal: 0.85, rough: 0.28 },
        brake: { color: hex('#4a4d52'), metal: 0.8, rough: 0.5 },
        chrome: { color: hex('#d8dce0'), metal: 1, rough: 0.12 },
        black: { color: hex('#121316'), metal: 0.1, rough: 0.55 },
        carbon: { color: hex('#1b1d21'), metal: 0.3, rough: 0.35, clearcoat: 1 },
        trim: { color: hex('#f4f4f2'), metal: 0.1, rough: 0.4, clearcoat: 0.6 },
        light_white: { color: hex('#fff6e6'), metal: 0, rough: 0.1, emissive: [1.6, 1.5, 1.3] },
        light_red: { color: hex('#c01822'), metal: 0, rough: 0.15, emissive: [1.2, 0.04, 0.05] },
        light_amber: { color: hex('#e08a1a'), metal: 0, rough: 0.2, emissive: [0.9, 0.35, 0.02] },
        plate: { color: hex('#e8e8e2'), metal: 0, rough: 0.5 },
        seat: { color: hex('#1a1b1f'), metal: 0, rough: 0.85 },
        ...extra,
    };
}
// ---------------------------------------------------------------------------------------------------------------------
// The driver (kart and race car): a helmeted figure in a racing suit
// ---------------------------------------------------------------------------------------------------------------------
/** Build a seated driver; `hip` is the hip centre, `lean` the torso's backward lean (rad), `wheelAt` where the hands meet the wheel. */
function driver(d, hip, lean, wheelAt, pedals, suit, helmet, scale = 1) {
    d.mats['suit'] = { color: hex(suit), metal: 0, rough: 0.7 };
    d.mats['helmet'] = { color: hex(helmet), metal: 0.3, rough: 0.2, clearcoat: 1 };
    d.mats['visor'] = { color: [0.01, 0.012, 0.016], metal: 0.6, rough: 0.05 };
    d.mats['glove'] = { color: hex('#17181b'), metal: 0, rough: 0.6 };
    const s = scale;
    const node = 'chassis';
    const add = (mat, geo) => void d.parts.push({ node, mat, geo });
    const [hx, hy, hz] = hip;
    const up = (len) => [hx - Math.sin(lean) * len, hy + Math.cos(lean) * len, hz];
    // Torso: a tapered ellipsoid from pelvis to shoulders.
    const chestC = up(0.27 * s);
    const torso = ellipsoid(0, 0, 0, 0.115 * s, 0.3 * s, 0.2 * s, 16, 22);
    rotZ(torso, lean);
    add('suit', move(torso, chestC[0], chestC[1], chestC[2]));
    const pelvis = ellipsoid(0, 0, 0, 0.13 * s, 0.1 * s, 0.18 * s, 10, 18);
    add('suit', move(pelvis, hx, hy + 0.04 * s, hz));
    // Neck and head.
    const neckTop = up(0.62 * s);
    add('suit', move(ellipsoid(0, 0, 0, 0.05 * s, 0.07 * s, 0.05 * s, 8, 12), neckTop[0], neckTop[1], neckTop[2]));
    const headC = [neckTop[0] + 0.02 * s, neckTop[1] + 0.13 * s, neckTop[2]];
    const helm = ellipsoid(0, 0, 0, 0.165 * s, 0.155 * s, 0.14 * s, 18, 26);
    add('helmet', move(helm, headC[0], headC[1], headC[2]));
    const visor = ellipsoid(0, 0, 0, 0.1 * s, 0.05 * s, 0.125 * s, 12, 22);
    add('visor', move(visor, headC[0] + 0.1 * s, headC[1] + 0.015 * s, headC[2]));
    const chin = ellipsoid(0, 0, 0, 0.08 * s, 0.05 * s, 0.1 * s, 8, 16);
    add('helmet', move(chin, headC[0] + 0.1 * s, headC[1] - 0.075 * s, headC[2]));
    // Arms: shoulder -> elbow (out and down) -> hand on the wheel.
    for (const side of [-1, 1]) {
        const sh = up(0.5 * s);
        const shoulder = [sh[0], sh[1], hz + side * 0.2 * s];
        const hand = [wheelAt[0], wheelAt[1], wheelAt[2] + side * 0.11];
        const elbow = [(shoulder[0] + hand[0]) / 2 + 0.02, Math.min(shoulder[1], hand[1]) - 0.09 * s, hz + side * 0.3 * s];
        add('suit', tube([shoulder, elbow, hand], 0.043 * s, { seg: 10, steps: 6, r1: 0.036 * s }));
        add('suit', move(ellipsoid(0, 0, 0, 0.055 * s, 0.055 * s, 0.055 * s, 8, 12), shoulder[0], shoulder[1], shoulder[2]));
        add('glove', move(ellipsoid(0, 0, 0, 0.045 * s, 0.04 * s, 0.05 * s, 8, 12), hand[0], hand[1], hand[2]));
        // Legs: hip -> knee -> foot on the pedals.
        const hipP = [hx, hy + 0.02 * s, hz + side * 0.09 * s];
        const knee = [hx + 0.36 * s, Math.max(hy + 0.1 * s, pedals[1] + 0.2), hz + side * 0.11 * s];
        const foot = [pedals[0], pedals[1], hz + side * 0.09 * s];
        add('suit', tube([hipP, knee, foot], 0.062 * s, { seg: 10, steps: 6, r1: 0.044 * s }));
        add('glove', move(roundedBox(0, 0, 0, 0.2 * s, 0.07 * s, 0.1 * s, 3), foot[0] + 0.04, foot[1] - 0.01, foot[2]));
    }
}
/** A steering wheel (rim ring + spokes) in its own node pair: `steer_column` (tilt) -> `steer_wheel` (spin about local X). */
function steering(d, at, tiltZ, radius, column) {
    d.nodes.push({ name: 'steer_column', parent: 'chassis', at, tiltZ });
    d.nodes.push({ name: 'steer_wheel', parent: 'steer_column', at: [0, 0, 0] });
    const ring = [];
    for (let k = 0; k <= 20; k++) {
        const a = (k / 20) * Math.PI * 2;
        // The wheel lies in the YZ plane of the node (axis along X).
        ring.push([0, Math.sin(a) * radius, Math.cos(a) * radius]);
    }
    const rim = tube(ring, radius * 0.1, { seg: 8, steps: 1, smoothPath: false });
    const hub = rotZ(ellipsoid(0, 0, 0, radius * 0.18, radius * 0.18, radius * 0.18, 8, 12), 0);
    const spokeA = tube([[0, 0, -radius], [0, 0, radius]], radius * 0.06, { seg: 6, smoothPath: false });
    const spokeB = tube([[0, 0, 0], [0, -radius, 0]], radius * 0.06, { seg: 6, smoothPath: false });
    d.parts.push({ node: 'steer_wheel', mat: 'black', geo: merge(rim, hub, spokeA, spokeB) });
    if (column) {
        // A column from the chassis to the hub, in chassis space.
        d.parts.push({ node: 'chassis', mat: 'chrome', geo: tube([column, at], radius * 0.12, { seg: 8, smoothPath: false }) });
    }
}
// ---------------------------------------------------------------------------------------------------------------------
// Racing kart
// ---------------------------------------------------------------------------------------------------------------------
function kart(id, name, paint, helmet, suit) {
    const d = { id, name, tags: 'go-kart gokart karting racing arcade race kart vehicle', mats: baseMats(paint), parts: [], nodes: [{ name: 'root', parent: '', at: [0, 0, 0] }, { name: 'chassis', parent: 'root', at: [0, 0, 0] }] };
    d.mats['paint2'] = { color: hex('#f4f4f2'), metal: 0.1, rough: 0.35, clearcoat: 0.8 };
    const add = (mat, geo) => void d.parts.push({ node: 'chassis', mat, geo });
    const front = { r: 0.19, w: 0.17, rimR: 0.115, spokes: 5 };
    const rear = { r: 0.205, w: 0.29, rimR: 0.115, spokes: 5 };
    const xf = 0.72;
    const xr = 0.82;
    const zf = 0.66;
    const zr = 0.64;
    addWheels(d, front, rear, xf, xr, zf, zr);
    // Floor pan and frame.
    add('carbon', loft([{ x: -1.0, hw: 0.36, y0: 0.1, y1: 0.14, e: 6 }, { x: 0.9, hw: 0.4, y0: 0.1, y1: 0.14, e: 6 }], { ring: 16 }));
    for (const s of [-1, 1]) {
        add('black', tube([[-0.95, 0.19, s * 0.33], [-0.2, 0.17, s * 0.4], [0.6, 0.18, s * 0.36], [0.95, 0.2, s * 0.2]], 0.017, { seg: 8, steps: 4 }));
    }
    // Axles.
    add('brake', tube([[-xr, rear.r, -zr + 0.05], [-xr, rear.r, zr - 0.05]], 0.022, { seg: 10, smoothPath: false }));
    add('brake', tube([[xf, front.r, -zf + 0.05], [xf, front.r, zf - 0.05]], 0.016, { seg: 8, smoothPath: false }));
    // Nose fairing.
    const nose = [
        { x: 0.15, hw: 0.36, y0: 0.13, y1: 0.4, e: 3.2 },
        { x: 0.55, hw: 0.4, y0: 0.13, y1: 0.4, e: 3.2 },
        { x: 0.95, hw: 0.37, y0: 0.14, y1: 0.33, e: 3 },
        { x: 1.18, hw: 0.28, y0: 0.15, y1: 0.27, e: 2.8 },
        { x: 1.27, hw: 0.17, y0: 0.17, y1: 0.24, e: 2.4 },
    ];
    const noseS = resample(nose, 12);
    add('paint', loft(noseS, { ring: 24 }));
    add('paint2', topRibbon(noseS, 0.2, 1.22, 0, 0.055, 0.004, 20));
    // Number plate: a round board on the nose.
    const plate = roundedBox(0, 0, 0, 0.012, 0.3, 0.3, 2.6);
    rotZ(plate, -0.6);
    add('plate', move(plate, 0.82, 0.375, 0));
    add('black', move(rotZ(roundedBox(0, 0, 0, 0.014, 0.17, 0.17, 2.4), -0.6), 0.822, 0.378, 0));
    // Front bumper (a wide chrome bar).
    add('chrome', tube([[1.2, 0.2, -0.6], [1.26, 0.2, -0.3], [1.28, 0.2, 0.3], [1.2, 0.2, 0.6]], 0.017, { seg: 8, steps: 6 }));
    // Side pods.
    const pod = [
        { x: -0.5, hw: 0.115, y0: 0.12, y1: 0.3, zc: 0.4, e: 3 },
        { x: -0.15, hw: 0.14, y0: 0.12, y1: 0.35, zc: 0.42, e: 3 },
        { x: 0.3, hw: 0.14, y0: 0.12, y1: 0.33, zc: 0.44, e: 3 },
        { x: 0.55, hw: 0.1, y0: 0.13, y1: 0.28, zc: 0.44, e: 2.8 },
    ];
    const podR = loft(resample(pod, 10), { ring: 20 });
    add('paint', podR);
    add('paint', mirrorZ(podR));
    add('black', move(roundedBox(0, 0, 0, 0.012, 0.13, 0.1, 3), 0.56, 0.205, 0.44));
    add('black', move(roundedBox(0, 0, 0, 0.012, 0.13, 0.1, 3), 0.56, 0.205, -0.44));
    // Bucket seat.
    const seat = [
        { x: -0.72, hw: 0.27, y0: 0.12, y1: 0.78, e: 3 },
        { x: -0.52, hw: 0.28, y0: 0.12, y1: 0.66, e: 3 },
        { x: -0.3, hw: 0.26, y0: 0.12, y1: 0.4, e: 3 },
        { x: -0.12, hw: 0.2, y0: 0.12, y1: 0.28, e: 3 },
    ];
    add('seat', loft(resample(seat, 10), { ring: 22 }));
    // Engine and exhaust behind the seat (right side).
    add('alloy', roundedBox(-0.93, 0.24, 0.26, 0.2, 0.2, 0.2, 3.4));
    add('black', move(lathe([[-0.1, 0.07], [0.1, 0.07]], 14, true), -0.93, 0.36, 0.26));
    add('chrome', tube([[-1.02, 0.28, 0.3], [-1.18, 0.3, 0.34], [-1.28, 0.34, 0.2], [-1.3, 0.34, 0.0]], 0.026, { seg: 10, steps: 6 }));
    // Chain guard and rear bumper.
    add('black', roundedBox(-0.78, 0.22, 0.2, 0.34, 0.08, 0.04, 3));
    add('black', tube([[-1.15, 0.2, -0.56], [-1.2, 0.21, -0.28], [-1.2, 0.21, 0.28], [-1.15, 0.2, 0.56]], 0.02, { seg: 8, steps: 6 }));
    // Steering: column + wheel.
    steering(d, [0.14, 0.58, 0], -0.95, 0.125, [0.5, 0.2, 0]);
    // Driver.
    driver(d, [-0.4, 0.26, 0], 0.32, [0.14, 0.6, 0], [0.62, 0.2, 0], suit, helmet);
    return d;
}
// ---------------------------------------------------------------------------------------------------------------------
// Open-wheel race car
// ---------------------------------------------------------------------------------------------------------------------
function raceCar(id, name, paint, accent, helmet, suit) {
    const d = { id, name, tags: 'race car formula racing open wheel single seater motorsport vehicle', mats: baseMats(paint), parts: [], nodes: [{ name: 'root', parent: '', at: [0, 0, 0] }, { name: 'chassis', parent: 'root', at: [0, 0, 0] }] };
    d.mats['paint2'] = { color: hex(accent), metal: 0.2, rough: 0.35, clearcoat: 0.8 };
    const add = (mat, geo) => void d.parts.push({ node: 'chassis', mat, geo });
    const front = { r: 0.33, w: 0.3, rimR: 0.2, spokes: 6 };
    const rear = { r: 0.35, w: 0.4, rimR: 0.2, spokes: 6 };
    const xf = 1.55;
    const xr = 1.4;
    const zf = 0.84;
    const zr = 0.82;
    addWheels(d, front, rear, xf, xr, zf, zr);
    // Monocoque and nose.
    const mono = [
        { x: -1.95, hw: 0.14, y0: 0.2, y1: 0.46, e: 3 },
        { x: -1.5, hw: 0.25, y0: 0.18, y1: 0.62, e: 2.8 },
        { x: -0.95, hw: 0.3, y0: 0.16, y1: 0.72, e: 2.7 },
        { x: -0.3, hw: 0.31, y0: 0.15, y1: 0.58, e: 2.8 },
        { x: 0.4, hw: 0.3, y0: 0.14, y1: 0.5, e: 3 },
        { x: 1.1, hw: 0.23, y0: 0.13, y1: 0.4, e: 3 },
        { x: 1.75, hw: 0.12, y0: 0.13, y1: 0.31, e: 2.6 },
        { x: 2.3, hw: 0.05, y0: 0.14, y1: 0.24, e: 2.2 },
    ];
    const monoS = resample(mono, 28);
    add('paint', loft(monoS, { ring: 28 }));
    add('paint2', topRibbon(monoS, -1.8, 2.2, 0, 0.07, 0.004, 40));
    // Sidepods.
    const sp = [
        { x: -1.1, hw: 0.1, y0: 0.14, y1: 0.4, zc: 0.4, e: 3 },
        { x: -0.7, hw: 0.17, y0: 0.13, y1: 0.5, zc: 0.5, e: 3 },
        { x: -0.1, hw: 0.2, y0: 0.12, y1: 0.54, zc: 0.52, e: 3 },
        { x: 0.35, hw: 0.19, y0: 0.12, y1: 0.46, zc: 0.52, e: 3 },
        { x: 0.55, hw: 0.14, y0: 0.13, y1: 0.36, zc: 0.5, e: 2.8 },
    ];
    const spR = loft(resample(sp, 14), { ring: 22 });
    add('paint', spR);
    add('paint', mirrorZ(spR));
    add('black', move(roundedBox(0, 0, 0, 0.02, 0.26, 0.17, 3), 0.545, 0.42, 0.52));
    add('black', move(roundedBox(0, 0, 0, 0.02, 0.26, 0.17, 3), 0.545, 0.42, -0.52));
    // Floor plank and diffuser.
    add('carbon', roundedBox(0.0, 0.1, 0, 3.0, 0.035, 0.98, 5));
    // Airbox / engine cover fin and cockpit surround.
    const air = [
        { x: -1.15, hw: 0.04, y0: 0.62, y1: 0.78, e: 2.6 },
        { x: -0.75, hw: 0.2, y0: 0.62, y1: 1.0, e: 2.4 },
        { x: -0.4, hw: 0.17, y0: 0.6, y1: 0.95, e: 2.4 },
        { x: -0.15, hw: 0.1, y0: 0.58, y1: 0.8, e: 2.4 },
    ];
    add('paint', loft(resample(air, 10), { ring: 22 }));
    add('black', move(roundedBox(0, 0, 0, 0.012, 0.22, 0.26, 3), -0.395, 0.9, 0));
    add('carbon', loft(resample([{ x: -0.5, hw: 0.28, y0: 0.5, y1: 0.58, e: 4 }, { x: -0.1, hw: 0.3, y0: 0.5, y1: 0.6, e: 4 }, { x: 0.45, hw: 0.28, y0: 0.46, y1: 0.54, e: 4 }], 8), { ring: 20 }));
    // Front wing: main plane, flap and endplates.
    add('carbon', roundedBox(2.15, 0.12, 0, 0.3, 0.025, 1.7, 4));
    add('paint2', roundedBox(2.05, 0.16, 0, 0.2, 0.02, 1.6, 4));
    for (const s of [-1, 1])
        add('paint', roundedBox(2.12, 0.19, s * 0.86, 0.46, 0.17, 0.02, 3));
    add('carbon', tube([[1.7, 0.15, 0], [2.1, 0.13, 0]], 0.02, { seg: 6, smoothPath: false }));
    // Rear wing.
    add('carbon', roundedBox(-1.98, 0.78, 0, 0.3, 0.035, 1.05, 4));
    add('paint2', roundedBox(-1.88, 0.9, 0, 0.22, 0.03, 1.0, 4));
    for (const s of [-1, 1])
        add('paint', roundedBox(-1.93, 0.82, s * 0.54, 0.5, 0.34, 0.02, 3));
    add('carbon', tube([[-1.85, 0.4, 0], [-1.9, 0.78, 0]], 0.03, { seg: 8, smoothPath: false }));
    // Rear light and exhaust.
    add('light_red', move(roundedBox(0, 0, 0, 0.02, 0.08, 0.12, 3), -2.0, 0.42, 0));
    add('chrome', move(lathe([[-0.12, 0.04], [0.12, 0.04]], 12, true), -2.0, 0.3, 0));
    // Suspension arms (carbon) from the mono to each hub.
    for (const s of [-1, 1]) {
        const hubF = [xf, front.r, s * (zf - 0.06)];
        const hubR = [-xr, rear.r, s * (zr - 0.07)];
        add('carbon', tube([[1.05, 0.22, s * 0.2], hubF], 0.016, { seg: 6, smoothPath: false }));
        add('carbon', tube([[1.35, 0.2, s * 0.2], hubF], 0.016, { seg: 6, smoothPath: false }));
        add('carbon', tube([[-1.2, 0.3, s * 0.22], hubR], 0.018, { seg: 6, smoothPath: false }));
        add('carbon', tube([[-1.6, 0.28, s * 0.22], hubR], 0.018, { seg: 6, smoothPath: false }));
    }
    // Steering wheel + driver + halo.
    steering(d, [0.28, 0.58, 0], -1.05, 0.11, null);
    driver(d, [-0.58, 0.36, 0], 0.55, [0.28, 0.58, 0], [1.05, 0.25, 0], suit, helmet, 0.92);
    add('carbon', tube([[0.45, 0.52, -0.2], [0.35, 0.9, -0.12], [0.0, 0.95, 0], [0.35, 0.9, 0.12], [0.45, 0.52, 0.2]], 0.022, { seg: 8, steps: 6 }));
    add('carbon', tube([[0.45, 0.5, 0], [0.62, 0.55, 0]], 0.025, { seg: 8, smoothPath: false }));
    return d;
}
function roadCar(c) {
    const extraMats = {};
    if (c.accent)
        extraMats['paint2'] = { color: hex(c.accent), metal: 0.45, rough: 0.3, clearcoat: 1 };
    const d = { id: c.id, name: c.name, tags: c.tags, mats: baseMats(c.paint, extraMats), parts: [], nodes: [{ name: 'root', parent: '', at: [0, 0, 0] }, { name: 'chassis', parent: 'root', at: [0, 0, 0] }] };
    const add = (mat, geo) => void d.parts.push({ node: 'chassis', mat, geo });
    const { L, W, clear, belt, roof } = c;
    const hw = W / 2;
    const xr0 = -L / 2;
    const u = (f) => xr0 + L * f;
    // Lower body: fractions from the rear.
    const lowFor = (f, hwF, y0Add, y1F, e = 2.7) => ({ x: u(f), hw: hw * hwF, y0: clear + y0Add, y1: belt * y1F, e: e * 1.35 });
    const body = [
        lowFor(0.0, 0.66, 0.2, 0.84, 2.4),
        lowFor(0.015, 0.84, 0.1, 0.94, 2.5),
        lowFor(0.05, 0.94, 0.04, c.deck, 2.7),
        lowFor(0.16, 0.985, 0.0, c.deck * 0.99, 3),
        lowFor(0.38, 1.0, 0.0, 1.0, 3.2),
        lowFor(0.6, 1.0, 0.0, 1.0, 3.2),
        lowFor(0.76, 0.99, 0.01, c.hood * 1.02, 3),
        lowFor(0.89, 0.95, 0.05, c.hood * 0.94, 2.8),
        lowFor(0.965, 0.86, 0.11, c.hood * 0.8, 2.6),
        lowFor(1.0, 0.66, 0.2, c.hood * 0.66, 2.4),
    ];
    const bodyS = resample(body, 40);
    add('paint', loft(bodyS, { ring: 32 }));
    // Cabin (greenhouse): glass with a painted roof.
    const [c0, c1] = c.cabin;
    const rakeR = (c1 - c0) * c.rake[0];
    const rakeF = (c1 - c0) * c.rake[1];
    const cab = (f, hwF, y1, base) => ({ x: u(f), hw: hw * hwF, y0: base ?? belt * 0.97, y1, e: 3.2 });
    const cabinSecs = [
        cab(c0, 0.8, belt * 1.0, belt * 0.97),
        cab(c0 + rakeR * 0.5, 0.82, belt + (roof - belt) * 0.62),
        cab(c0 + rakeR, 0.83, roof - 0.015),
        cab((c0 + c1) / 2, 0.84, roof),
        cab(c1 - rakeF, 0.83, roof - 0.015),
        cab(c1 - rakeF * 0.45, 0.82, belt + (roof - belt) * 0.5),
        cab(c1, 0.8, belt * 1.0, belt * 0.97),
    ];
    const cabinM = loft(resample(cabinSecs, 30), { ring: 30 });
    // Split: the flat part of the top (between the windshield and rear-window bases) is painted roof, the rest glass.
    const roofM = mesh();
    const glassM = mesh();
    const RING = 30;
    const roofX0 = u(c0 + rakeR);
    const roofX1 = u(c1 - rakeF);
    const sideTris = (cabinM.i.length / 3 / (2 * RING)) | 0;
    void sideTris;
    for (let t = 0; t < cabinM.i.length; t += 3) {
        const tri = t / 3;
        const a = cabinM.i[t];
        const b = cabinM.i[t + 1];
        const cc = cabinM.i[t + 2];
        const ringCount = 30 * RING;
        let isRoof = false;
        if (a < ringCount && b < ringCount && cc < ringCount) {
            const k = Math.floor((tri % (2 * RING)) / 2);
            const ang = ((k + 0.5) / RING) * Math.PI * 2;
            const topBand = Math.abs(ang - Math.PI / 2) < 0.62;
            const x = (cabinM.p[a * 3] + cabinM.p[b * 3] + cabinM.p[cc * 3]) / 3;
            isRoof = topBand && x >= roofX0 && x <= roofX1;
        }
        const target = isRoof ? roofM : glassM;
        for (const v of [a, b, cc]) {
            target.p.push(cabinM.p[v * 3], cabinM.p[v * 3 + 1], cabinM.p[v * 3 + 2]);
            target.n.push(cabinM.n[v * 3], cabinM.n[v * 3 + 1], cabinM.n[v * 3 + 2]);
            target.i.push(target.p.length / 3 - 1);
        }
    }
    add('paint', roofM);
    add('glass', glassM);
    // Pillars and window frames: slim painted tubes along the cabin edges at the A, B and C positions.
    const cabAt = (f) => sectionAt(cabinSecs, u(f));
    const pillar = (fb, ft) => {
        for (const s of [-1, 1]) {
            const sb = cabAt(fb);
            const st = cabAt(ft);
            const yb = sb.y0 + 0.02;
            const zb = s * (sb.hw * 0.97);
            const yt = Math.min(st.y1 - 0.03, topY(st, s * st.hw * 0.7) ?? roof) - 0.01;
            add('paint', tube([[u(fb), yb, zb], [u(ft), yt, s * st.hw * 0.8]], 0.021, { seg: 8, smoothPath: false }));
        }
    };
    pillar(c0 + rakeR * 0.06, c0 + rakeR * 0.98);
    pillar(c1 - rakeF * 0.04, c1 - rakeF * 0.98);
    pillar((c0 + c1) / 2 - 0.02, (c0 + c1) / 2 - 0.015);
    // Door seams, handles, mirrors.
    const seamY0 = clear + 0.12;
    const seamY1 = belt * 0.96;
    const dA = u(c0 + (c1 - c0) * 0.09);
    const dB = u(c0 + (c1 - c0) * 0.47);
    const dC = u(c0 + (c1 - c0) * 0.93);
    for (const side of [1, -1]) {
        for (const x of [dA, dB, dC]) {
            add('black', sideLine(bodyS, [[x, seamY0], [x + 0.01, (seamY0 + seamY1) / 2], [x, seamY1]], 0.004, side, 0.002));
        }
        add('black', sideLine(bodyS, [[dA, seamY0 - 0.01], [(dA + dC) / 2, seamY0 - 0.015], [dC, seamY0 - 0.01]], 0.005, side, 0.002));
        add('chrome', move(roundedBox(0, 0, 0, 0.12, 0.022, 0.03, 3), dA + 0.2, belt * 0.9, side * (hw + 0.012)));
        add('chrome', move(roundedBox(0, 0, 0, 0.12, 0.022, 0.03, 3), dB + 0.2, belt * 0.9, side * (hw + 0.012)));
        // Mirror
        const mx = u(c1) - 0.1;
        add('black', tube([[mx, belt * 1.02, side * (hw * 0.86)], [mx - 0.02, belt * 1.06, side * (hw + 0.1)]], 0.012, { seg: 6, smoothPath: false }));
        add('paint', move(roundedBox(0, 0, 0, 0.1, 0.075, 0.13, 3), mx - 0.04, belt * 1.075, side * (hw + 0.14)));
    }
    // Wheel arches (dark decals conforming to the sides) and wheels.
    const wb = c.wheelbase;
    const xFront = u(1 - c.overhang[1]);
    const xRear = xFront - wb;
    const zTrack = hw * 0.99 - c.wheelW / 2 + 0.045;
    for (const side of [1, -1]) {
        for (const x of [xFront, xRear])
            add('black', sideDisc(bodyS, x, c.wheelR, c.wheelR * 1.13, side, 0.004, 5, 32, 0.98));
    }
    addWheels(d, { r: c.wheelR, w: c.wheelW, rimR: c.rimR, spokes: 5 }, { r: c.wheelR, w: c.wheelW, rimR: c.rimR, spokes: 5 }, xFront, -xRear, zTrack, zTrack);
    // Front end: grille, lamps, bumper; rear: lamps, bumper, plates.
    const fx = u(1.0);
    const rx = u(0.0);
    const noseY = (clear + belt * c.hood * 0.66) / 2;
    const bumperY = clear + 0.1;
    add('black', loft([{ x: fx - 0.075, hw: hw * 0.62, y0: bumperY - 0.03, y1: bumperY + 0.2, e: 4 }, { x: fx + 0.005, hw: hw * 0.6, y0: bumperY - 0.03, y1: bumperY + 0.2, e: 4 }], { ring: 20 }));
    add('black', loft([{ x: fx - 0.06, hw: hw * 0.66, y0: noseY - 0.02, y1: noseY + 0.1, e: 4 }, { x: fx + 0.002, hw: hw * 0.64, y0: noseY - 0.02, y1: noseY + 0.1, e: 4 }], { ring: 20 }));
    add('chrome', move(roundedBox(0, 0, 0, 0.012, 0.014, hw * 1.1, 3), fx + 0.004, noseY + 0.115, 0));
    for (const s of [-1, 1]) {
        add('light_white', move(ellipsoid(0, 0, 0, 0.05, 0.05, 0.14, 8, 18), fx - 0.1, belt * c.hood * 0.78, s * hw * 0.68));
        add('chrome', move(ellipsoid(0, 0, 0, 0.04, 0.062, 0.155, 8, 18), fx - 0.115, belt * c.hood * 0.78, s * hw * 0.68));
        add('light_red', move(ellipsoid(0, 0, 0, 0.04, 0.05, 0.16, 8, 18), rx + 0.05, belt * 0.9, s * hw * 0.76));
        add('light_amber', move(ellipsoid(0, 0, 0, 0.03, 0.025, 0.07, 6, 12), fx - 0.1, belt * c.hood * 0.78 - 0.07, s * hw * 0.84));
    }
    add('black', loft([{ x: rx - 0.003, hw: hw * 0.62, y0: bumperY - 0.03, y1: bumperY + 0.22, e: 4 }, { x: rx + 0.085, hw: hw * 0.64, y0: bumperY - 0.03, y1: bumperY + 0.22, e: 4 }], { ring: 20 }));
    add('plate', move(roundedBox(0, 0, 0, 0.014, 0.12, 0.38, 3), fx + 0.005, bumperY + 0.1, 0));
    add('plate', move(roundedBox(0, 0, 0, 0.014, 0.12, 0.38, 3), rx - 0.005, belt * 0.82, 0));
    add('black', move(roundedBox(0, 0, 0, 0.5, 0.012, hw * 1.2, 4), rx + 0.2, clear + 0.04, 0));
    // Hood and boot lines.
    add('black', topRibbon(bodyS, u(c1 + 0.01), u(0.985), -hw * 0.22, 0.003, 0.002, 14));
    add('black', topRibbon(bodyS, u(c1 + 0.01), u(0.985), hw * 0.22, 0.003, 0.002, 14));
    // Variants.
    if (c.extras === 'taxi') {
        add('trim', move(roundedBox(0, 0, 0, 0.42, 0.13, 0.22, 3.5), u((c0 + c1) / 2) + 0.05, roof + 0.075, 0));
        d.mats['sign'] = { color: hex('#fff2b0'), metal: 0, rough: 0.4, emissive: [0.55, 0.5, 0.2] };
        add('sign', move(roundedBox(0, 0, 0, 0.3, 0.08, 0.215, 3.5), u((c0 + c1) / 2) + 0.05, roof + 0.075, 0));
        add('black', sideLine(bodyS, [[u(0.2), belt * 0.78], [u(0.8), belt * 0.78]], 0.045, 1, 0.003));
        add('black', sideLine(bodyS, [[u(0.2), belt * 0.78], [u(0.8), belt * 0.78]], 0.045, -1, 0.003));
    }
    if (c.extras === 'police') {
        d.mats['siren_red'] = { color: hex('#d01020'), metal: 0, rough: 0.2, emissive: [1.4, 0.03, 0.05] };
        d.mats['siren_blue'] = { color: hex('#1030d0'), metal: 0, rough: 0.2, emissive: [0.05, 0.2, 1.5] };
        const rc = u((c0 + c1) / 2);
        add('black', move(roundedBox(0, 0, 0, 0.3, 0.06, 0.95, 4), rc, roof + 0.03, 0));
        add('siren_red', move(roundedBox(0, 0, 0, 0.24, 0.07, 0.36, 3.5), rc, roof + 0.075, 0.24));
        add('siren_blue', move(roundedBox(0, 0, 0, 0.24, 0.07, 0.36, 3.5), rc, roof + 0.075, -0.24));
        if (c.accent) {
            // Black lower doors (paint2 is the second colour: white body with black doors).
            add('paint2', sideLine(bodyS, [[dA - 0.03, seamY0 + 0.12], [dC + 0.02, seamY0 + 0.12]], 0.1, 1, 0.003));
            add('paint2', sideLine(bodyS, [[dA - 0.03, seamY0 + 0.12], [dC + 0.02, seamY0 + 0.12]], 0.1, -1, 0.003));
        }
    }
    if (c.extras === 'sport') {
        add('paint', roundedBox(rx + 0.12, belt * c.deck + 0.075, 0, 0.18, 0.02, hw * 1.45, 4));
        for (const s of [-1, 1])
            add('paint', tube([[rx + 0.13, belt * c.deck - 0.02, s * hw * 0.55], [rx + 0.13, belt * c.deck + 0.07, s * hw * 0.55]], 0.016, { seg: 6, smoothPath: false }));
        if (c.accent) {
            add('paint2', topRibbon(bodyS, u(0.02), u(0.985), -hw * 0.1, 0.07, 0.003, 40));
            add('paint2', topRibbon(bodyS, u(0.02), u(0.985), hw * 0.1, 0.07, 0.003, 40));
        }
    }
    if (c.extras === 'suv') {
        // Roof rails.
        for (const s of [-1, 1])
            add('black', tube([[u(c0 + 0.05), roof + 0.025, s * hw * 0.62], [u(c1 - 0.08), roof + 0.025, s * hw * 0.62]], 0.014, { seg: 6, smoothPath: false }));
    }
    return d;
}
const CARS = [
    { id: 'car', name: 'Sedan', tags: 'sedan saloon car automobile family vehicle', paint: '#1f3a5f', L: 4.65, W: 1.85, clear: 0.15, belt: 0.98, roof: 1.45, wheelR: 0.335, rimR: 0.23, wheelW: 0.225, cabin: [0.19, 0.69], rake: [0.38, 0.4], hood: 0.96, deck: 1.04, wheelbase: 2.78, overhang: [0.15, 0.1] },
    { id: 'taxi', name: 'Taxi', tags: 'taxi cab yellow cab car vehicle city', paint: '#f2b705', L: 4.65, W: 1.85, clear: 0.16, belt: 1.0, roof: 1.5, wheelR: 0.335, rimR: 0.23, wheelW: 0.225, cabin: [0.18, 0.69], rake: [0.36, 0.4], hood: 0.96, deck: 1.05, wheelbase: 2.78, overhang: [0.15, 0.1], extras: 'taxi' },
    { id: 'police-car', name: 'Police car', tags: 'police cop patrol car vehicle', paint: '#f1f2f3', accent: '#16181c', L: 4.9, W: 1.9, clear: 0.16, belt: 1.0, roof: 1.5, wheelR: 0.345, rimR: 0.23, wheelW: 0.23, cabin: [0.19, 0.69], rake: [0.36, 0.4], hood: 0.96, deck: 1.05, wheelbase: 2.9, overhang: [0.15, 0.1], extras: 'police' },
    { id: 'sports-car', name: 'Sports coupe', tags: 'sports car coupe fast supercar vehicle', paint: '#b3121c', accent: '#f1f1ef', L: 4.5, W: 1.95, clear: 0.11, belt: 0.82, roof: 1.2, wheelR: 0.34, rimR: 0.245, wheelW: 0.26, cabin: [0.3, 0.7], rake: [0.5, 0.52], hood: 0.9, deck: 1.1, wheelbase: 2.7, overhang: [0.14, 0.1], extras: 'sport' },
    { id: 'hatchback', name: 'Hatchback', tags: 'hatchback hatch compact small car vehicle', paint: '#e6e8ea', L: 4.05, W: 1.78, clear: 0.15, belt: 0.95, roof: 1.5, wheelR: 0.315, rimR: 0.215, wheelW: 0.2, cabin: [0.1, 0.7], rake: [0.2, 0.42], hood: 0.94, deck: 1.0, wheelbase: 2.55, overhang: [0.15, 0.1] },
    { id: 'van', name: 'Van', tags: 'van minivan people carrier vehicle', paint: '#c9ccd0', L: 5.1, W: 1.95, clear: 0.2, belt: 1.12, roof: 2.0, wheelR: 0.36, rimR: 0.24, wheelW: 0.235, cabin: [0.07, 0.72], rake: [0.06, 0.34], hood: 0.82, deck: 1.0, wheelbase: 3.1, overhang: [0.13, 0.1], extras: 'suv' },
    { id: 'delivery-truck', name: 'Delivery van', tags: 'delivery truck lorry van box vehicle', paint: '#e9ecef', L: 5.7, W: 2.0, clear: 0.24, belt: 1.15, roof: 2.35, wheelR: 0.38, rimR: 0.25, wheelW: 0.24, cabin: [0.05, 0.78], rake: [0.04, 0.3], hood: 0.8, deck: 1.0, wheelbase: 3.5, overhang: [0.12, 0.1] },
    { id: 'suv', name: 'SUV', tags: 'suv jeep 4x4 offroad crossover car vehicle', paint: '#3a3f44', L: 4.8, W: 1.95, clear: 0.22, belt: 1.18, roof: 1.78, wheelR: 0.38, rimR: 0.255, wheelW: 0.26, cabin: [0.1, 0.72], rake: [0.18, 0.36], hood: 0.97, deck: 1.0, wheelbase: 2.9, overhang: [0.14, 0.11], extras: 'suv' },
];
// ---------------------------------------------------------------------------------------------------------------------
// glTF export
// ---------------------------------------------------------------------------------------------------------------------
/** Quaternion about Z (tilt) for a node, in the library frame. */
function quatAxis(axis, a) {
    const s = Math.sin(a / 2);
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(a / 2)];
}
function toDocument(d) {
    const doc = new Document();
    const clearcoatExt = doc.createExtension(KHRMaterialsClearcoat);
    const emissiveExt = doc.createExtension(KHRMaterialsEmissiveStrength);
    const buffer = doc.createBuffer();
    const scene = doc.createScene(d.id);
    const mats = new Map();
    const getMat = (name) => {
        let m = mats.get(name);
        if (m)
            return m;
        const s = d.mats[name];
        if (!s)
            throw new Error(`${d.id}: unknown material ${name}`);
        m = doc.createMaterial(name).setBaseColorFactor([s.color[0], s.color[1], s.color[2], s.alpha ?? 1]).setMetallicFactor(s.metal ?? 0).setRoughnessFactor(s.rough ?? 0.6);
        if (s.alpha !== undefined && s.alpha < 1)
            m.setAlphaMode('BLEND').setDoubleSided(true);
        if (s.emissive)
            m.setEmissiveFactor([s.emissive[0], s.emissive[1], s.emissive[2]].map((v) => Math.min(1, v)));
        if (s.emissive) {
            const k = Math.max(...s.emissive);
            if (k > 1)
                m.setExtension('KHR_materials_emissive_strength', emissiveExt.createEmissiveStrength().setEmissiveStrength(k));
        }
        if (s.clearcoat) {
            const cc = clearcoatExt.createClearcoat().setClearcoatFactor(s.clearcoat).setClearcoatRoughnessFactor(0.06);
            m.setExtension('KHR_materials_clearcoat', cc);
        }
        mats.set(name, m);
        return m;
    };
    // Nodes (authoring frame -> library frame: (x, y, z) -> (z, y, -x)).
    const nodes = new Map();
    for (const n of d.nodes) {
        const node = doc.createNode(n.name).setTranslation([n.at[2], n.at[1], -n.at[0]]);
        if (n.tiltZ) {
            // Authoring tilt about Z (pitch) becomes a rotation about library X.
            node.setRotation(quatAxis([1, 0, 0], n.tiltZ));
        }
        nodes.set(n.name, node);
        if (n.parent === '')
            scene.addChild(node);
        else
            nodes.get(n.parent).addChild(node);
    }
    let tris = 0;
    // One primitive per (node, material).
    const groups = new Map();
    for (const p of d.parts) {
        const key = `${p.node}|${p.mat}`;
        const g = groups.get(key) ?? mesh();
        groups.set(key, g);
        // Parts of nodes with an offset are authored in the node's own frame already.
        append(g, p.geo);
    }
    const nodeMeshes = new Map();
    for (const [key, g] of groups) {
        const [nodeName, matName] = key.split('|');
        const node = nodes.get(nodeName);
        if (!node)
            throw new Error(`${d.id}: part on unknown node ${nodeName}`);
        // Node-local authoring geometry: parts on chassis are in model space; wheel/steer parts are node-local (origin = hub).
        const geo = { p: [...g.p], n: [...g.n], i: [...g.i] };
        toLibraryFrame(geo);
        let gm = nodeMeshes.get(nodeName);
        if (!gm) {
            gm = doc.createMesh(`${d.id}-${nodeName}`);
            nodeMeshes.set(nodeName, gm);
            node.setMesh(gm);
        }
        gm.addPrimitive(doc
            .createPrimitive()
            .setMaterial(getMat(matName))
            .setIndices(doc.createAccessor('idx', buffer).setType('SCALAR').setArray(new Uint32Array(geo.i)))
            .setAttribute('POSITION', doc.createAccessor('pos', buffer).setType('VEC3').setArray(new Float32Array(geo.p)))
            .setAttribute('NORMAL', doc.createAccessor('nor', buffer).setType('VEC3').setArray(new Float32Array(geo.n))));
        tris += geo.i.length / 3;
    }
    return { doc, tris };
}
async function encode(nio, doc) {
    const plain = await nio.writeBinary(doc);
    try {
        const copy = await nio.readBinary(plain);
        copy.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
        const packed = await nio.writeBinary(copy);
        return packed.byteLength < plain.byteLength ? packed : plain;
    }
    catch {
        return plain;
    }
}
/** Every design this script ships. */
export function designs() {
    return [
        kart('go-kart', 'Racing kart', '#d7263d', '#f2f2f2', '#1e2630'),
        kart('go-kart-blue', 'Racing kart (blue)', '#1b6fd1', '#ffd23f', '#242a33'),
        kart('go-kart-yellow', 'Racing kart (yellow)', '#f2b705', '#d7263d', '#2a2f38'),
        raceCar('race-car', 'Race car', '#1b98e0', '#f4f4f2', '#ffd23f', '#1b2330'),
        raceCar('race-car-yellow', 'Race car (yellow)', '#ffd23f', '#16181c', '#d7263d', '#1b2330'),
        ...CARS.map(roadCar),
    ];
}
const sha = (data) => createHash('sha256').update(data).digest('hex');
async function main() {
    await MeshoptEncoder.ready;
    await MeshoptDecoder.ready;
    const nio = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
    const only = process.argv.slice(2);
    const entries = [];
    const assets = [];
    const dump = process.env['VEHICLE_DUMP'];
    for (const d of designs()) {
        if (only.length > 0 && !only.includes(d.id))
            continue;
        const { doc, tris } = toDocument(d);
        // Bounds in the library frame and ground contact: the lowest wheel point must sit on y = 0 (wheels are at hub height r).
        const all = mesh();
        for (const p of d.parts) {
            const node = d.nodes.find((n) => n.name === p.node);
            const copy = { p: [...p.geo.p], n: [...p.geo.n], i: [...p.geo.i] };
            // Wheel and steering parts live in node-local space: place them at the node's absolute position for bounds.
            let at = [0, 0, 0];
            for (let nn = node; nn; nn = d.nodes.find((x) => x.name === nn?.parent))
                at = [at[0] + nn.at[0], at[1] + nn.at[1], at[2] + nn.at[2]];
            move(copy, at[0], at[1], at[2]);
            append(all, copy);
        }
        const bb = bounds(all);
        if (bb.min[1] < -0.02)
            throw new Error(`${d.id}: geometry below the ground (${bb.min[1].toFixed(3)})`);
        const lib = { min: [bb.min[2], bb.min[1], -bb.max[0]], max: [bb.max[2], bb.max[1], -bb.min[0]] };
        const size = [lib.max[0] - lib.min[0], lib.max[1], lib.max[2] - lib.min[2]].map((v) => Math.round(v * 1000) / 1000);
        // Centre in x / z by shifting the root.
        const cx = (lib.min[0] + lib.max[0]) / 2;
        const cz = (lib.min[2] + lib.max[2]) / 2;
        const rootNode = doc.getRoot().listNodes().find((n) => n.getName() === 'root');
        if (rootNode)
            rootNode.setTranslation([-cx, 0, -cz]);
        if (dump) {
            mkdirSync(dump, { recursive: true });
            writeFileSync(join(dump, `${d.id}.glb`), await nio.writeBinary(doc));
            console.log(`${d.id}: ${tris} tris, size ${size.join(' x ')} (dump only)`);
            continue;
        }
        const glb = await encode(nio, doc);
        const h = sha(glb);
        const rel = `m/${d.id}.${h.slice(0, 8)}.glb`;
        mkdirSync(join(LIB, 'm'), { recursive: true });
        for (const f of readdirSync(join(LIB, 'm')))
            if (new RegExp(`^${d.id}\\.[0-9a-f]{8}\\.glb$`).test(f) && `m/${f}` !== rel)
                unlinkSync(join(LIB, 'm', f));
        writeFileSync(join(LIB, rel), glb);
        const positions = new Float32Array(all.p.length);
        for (let k = 0; k < all.p.length; k += 3) {
            positions[k] = all.p[k + 2] - cx;
            positions[k + 1] = all.p[k + 1];
            positions[k + 2] = -all.p[k] - cz;
        }
        const entry = {
            id: d.id,
            name: d.name,
            kind: 'model',
            category: 'vehicles',
            tags: tagsFor(d.id, d.name, 'vehicles', `${d.tags} modelled realistic wheels glass paint`, 'realistic'),
            style: 'realistic',
            pack: 'aether-vehicles',
            size,
            tris,
            bytes: glb.byteLength,
            file: rel,
            lods: [],
            collider: colliderFor('hull', positions, hullPoints),
            placement: 'floor',
            facing: '-z',
            source: 'scripts/assets/vehicles.ts',
        };
        entries.push(entry);
        assets.push({ id: d.id, pack: 'aether-vehicles', licence: 'MIT', authors: null, source: { archive: 'Aether (code-authored)', path: 'scripts/assets/vehicles.ts' }, files: [{ path: rel, sha256: h, bytes: glb.byteLength }] });
        console.log(`${d.id}: ${tris} tris, ${(glb.byteLength / 1024).toFixed(0)} KB, size ${size.join(' x ')}`);
    }
    if (only.length > 0 || dump)
        return;
    Catalog.shape.entries.parse(entries);
    const out = {
        $comment: 'Modelled vehicles shipped with the library. Generated by scripts/assets/vehicles.ts; merged into catalog.json and manifest.json.',
        packs: [{ id: 'aether-vehicles', title: 'Aether vehicles', author: 'Aether (code-authored models)', licence: 'MIT', licenceUrl: 'https://opensource.org/license/mit', url: 'https://opensource.org/license/mit', version: '1' }],
        sources: [{ id: 'aether-vehicles', provider: 'Aether', title: 'Code-authored vehicles', version: '1', author: 'Aether', licence: 'MIT', licenceEvidence: 'generated by scripts/assets/vehicles.ts', archive: 'scripts/assets/vehicles.ts', sha256: null, retrieved: '2026-10-16' }],
        entries,
        assets,
    };
    writeFileSync(join(ROOT, 'assets', 'vehicles.json'), `${JSON.stringify(out, null, 1)}\n`);
    mergeIntoCatalog(out);
}
void existsSync;
void smooth;
void extrudeXY;
void triangles;
void sideLine;
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
    main().catch((err) => {
        console.error(err instanceof Error ? (err.stack ?? err.message) : err);
        process.exit(1);
    });
}
