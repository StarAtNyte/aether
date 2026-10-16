import { edgeDistance, waterAt } from './water-bodies';
/** Species the level tools can place (their models are in the library). */
export const LIFE_SPECIES = Object.freeze({
    deer: { id: 'deer', habitat: 'ground', name: 'deer', radius: 0.5, speed: 1.4, maxSlope: 32, social: true },
    doe: { id: 'doe', habitat: 'ground', name: 'doe', radius: 0.45, speed: 1.4, maxSlope: 32, social: true },
    cat: { id: 'cat', habitat: 'ground', name: 'cat', radius: 0.25, speed: 1.0, maxSlope: 40, social: false },
    sheep: { id: 'sheep', habitat: 'ground', name: 'sheep', radius: 0.45, speed: 0.7, maxSlope: 30, social: true },
    cow: { id: 'cow', habitat: 'ground', name: 'cow', radius: 0.7, speed: 0.6, maxSlope: 25, social: true },
    horse: { id: 'horse', habitat: 'ground', name: 'horse', radius: 0.7, speed: 1.3, maxSlope: 28, social: true },
    pig: { id: 'pig', habitat: 'ground', name: 'pig', radius: 0.45, speed: 0.8, maxSlope: 30, social: true },
    dog: { id: 'dog', habitat: 'ground', name: 'dog', radius: 0.3, speed: 1.6, maxSlope: 40, social: false },
    fox: { id: 'fox', habitat: 'ground', name: 'fox', radius: 0.3, speed: 1.4, maxSlope: 40, social: false },
    bird: { id: 'bird', habitat: 'air', name: 'songbird', radius: 0.3, altitude: [3, 12], speed: 7, clip: 'fly', social: true },
    crow: { id: 'crow', habitat: 'air', name: 'crow', radius: 0.5, altitude: [6, 20], speed: 8, clip: 'fly', social: true },
    seagull: { id: 'seagull', habitat: 'air', name: 'seagull', radius: 0.6, altitude: [8, 26], speed: 9, clip: 'fly', social: true },
    hawk: { id: 'hawk', habitat: 'air', name: 'hawk', radius: 0.8, altitude: [25, 65], speed: 10, clip: 'glide', social: false },
    parrot: { id: 'parrot', habitat: 'air', name: 'parrot', radius: 0.5, altitude: [3, 10], speed: 7, clip: 'fly', social: true },
    butterfly: { id: 'butterfly', habitat: 'air', name: 'butterfly', radius: 0.2, altitude: [0.5, 1.7], speed: 0.8, clip: 'walk', social: true },
    fish: { id: 'fish', habitat: 'water', name: 'fish', radius: 0.25, speed: 0.6, minDepth: 0.3, social: true },
    koi: { id: 'koi', habitat: 'water', name: 'koi', radius: 0.3, speed: 0.4, minDepth: 0.4, social: true },
    duck: { id: 'duck', habitat: 'surface', name: 'duck', radius: 0.35, speed: 0.5, minDepth: 0.35, social: true },
});
/** Ids of the placeable species. */
export const LIFE_SPECIES_IDS = Object.freeze(Object.keys(LIFE_SPECIES));
/** Most animals one call places. */
export const MAX_LIFE_COUNT = 24;
const INVARIANT = new Set(['deer', 'sheep', 'fish', 'koi']);
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
/** Small seeded generator (mulberry32) from a string. */
export function seeded(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++)
        h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    let a = h >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** True when the species id can be placed. */
export function isLifeSpecies(id) {
    return Object.hasOwn(LIFE_SPECIES, id);
}
function base(sp, id, name, pos, yaw) {
    return {
        id,
        name,
        tags: ['animal', 'life', sp.id],
        transform: { position: pos, rotation: [0, yaw, 0], scale: [1, 1, 1] },
        shape: { kind: 'asset', id: sp.id, ...(sp.clip ? { animation: sp.clip } : {}) },
    };
}
/** Plan one group: scatter candidates, measure each, keep what fits. */
export function planLife(req, probe) {
    const sp = LIFE_SPECIES[req.species];
    if (!sp)
        return { placed: [], refused: [`${req.id}: unknown species "${req.species}". Available: ${LIFE_SPECIES_IDS.join(', ')}.`], summary: '' };
    const rand = seeded(`${req.id}:${req.species}`);
    const placed = [];
    const refused = [];
    const count = Math.max(1, Math.min(MAX_LIFE_COUNT, Math.round(req.count)));
    const taken = [];
    const spacing = Math.max(sp.radius * 2.2, sp.habitat === 'air' ? 1.5 : 0.5);
    const reasons = new Map();
    const why = (r) => void reasons.set(r, (reasons.get(r) ?? 0) + 1);
    const slopes = [];
    const depths = [];
    const alts = [];
    const perched = req.perch === true && sp.habitat === 'air' && req.species !== 'butterfly';
    for (let i = 0; i < count; i++) {
        let ok = false;
        for (let attempt = 0; attempt < 14 && !ok; attempt++) {
            // Golden-angle scatter in the disk, jittered; the first member sits at the centre of a perched or solitary group.
            const a = (i + attempt * 0.37) * 2.399963 + rand() * 0.6;
            const rr = perched || count === 1 ? (attempt === 0 ? 0 : rand() * req.radius) : Math.sqrt((i + 0.5 + rand() * 0.4) / count) * req.radius * (0.55 + 0.45 * rand());
            const x = req.x + Math.cos(a) * rr;
            const z = req.z + Math.sin(a) * rr;
            if (taken.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < spacing)) {
                why('too close to another member');
                continue;
            }
            const yaw = req.yaw !== 0 ? req.yaw : r1(rand() * 360);
            const member = `${req.id}-${i + 1}`;
            const label = `${sp.name} ${i + 1}`;
            const surface = probe.surface(x, z, req.below);
            const bodyAt = surface ? waterAt(probe.water, x, z, surface.y + 5) : waterAt(probe.water, x, z, 0);
            if (sp.habitat === 'ground') {
                if (!surface) {
                    why('nothing under it');
                    continue;
                }
                if (surface.slopeDeg > (sp.maxSlope ?? 30)) {
                    why(`ground too steep (${r1(surface.slopeDeg)} deg)`);
                    continue;
                }
                if (bodyAt && bodyAt.y - surface.y > 0.2) {
                    why('under water');
                    continue;
                }
                if (!probe.clear(x, surface.y + sp.radius + 0.35, z, sp.radius)) {
                    why('inside something solid');
                    continue;
                }
                const e = base(sp, member, label, [r2(x), r2(surface.y), r2(z)], yaw);
                e['physics'] = { body: 'kinematic', collider: req.collide === false ? 'none' : 'box' };
                e['npc'] = {
                    role: sp.name,
                    archetype: req.species === 'dog' ? 'follower' : req.species === 'fox' ? 'predator' : 'prey',
                    faction: 'wildlife',
                    speed: sp.speed,
                    runSpeed: Math.max(4, sp.speed * 4.5),
                    radius: sp.radius,
                    height: Math.max(0.4, sp.radius * 2.4),
                    health: 40,
                    perception: { sight: 16, fov: 300, hearing: 12, memory: 4 },
                    wander: r1(Math.max(2, Math.min(40, req.radius * 0.9))),
                };
                slopes.push(surface.slopeDeg);
                placed.push({ id: member, entity: e, position: [r2(x), r2(surface.y), r2(z)], fact: `ground y=${r2(surface.y)}, slope ${r1(surface.slopeDeg)} deg` });
                ok = true;
            }
            else if (sp.habitat === 'air') {
                const floor = req.floor ?? Math.max(surface ? surface.y : Number.NEGATIVE_INFINITY, bodyAt ? bodyAt.y : Number.NEGATIVE_INFINITY, 0);
                if (perched) {
                    if (!surface) {
                        why('nothing to perch on');
                        continue;
                    }
                    if (surface.slopeDeg > 28) {
                        why(`perch too steep (${r1(surface.slopeDeg)} deg)`);
                        continue;
                    }
                    if (bodyAt && bodyAt.y - surface.y > 0.1) {
                        why('over water');
                        continue;
                    }
                    const e = base({ ...sp, clip: 'perch' }, member, label, [r2(x), r2(surface.y), r2(z)], yaw);
                    placed.push({ id: member, entity: e, position: [r2(x), r2(surface.y), r2(z)], fact: `perched on ${surface.id ?? 'the ground'} at y=${r2(surface.y)}` });
                    ok = true;
                    continue;
                }
                const [lo, hi] = sp.altitude;
                const alt = lo + rand() * (hi - lo);
                const y = floor + alt;
                if (!probe.clear(x, y, z, sp.radius * 1.5)) {
                    why('inside something solid');
                    continue;
                }
                const e = base(sp, member, label, [r2(x), r2(y), r2(z)], yaw);
                const orbit = req.species === 'butterfly' ? null : r1(Math.max(6, req.radius * (0.35 + rand() * 0.65)));
                if (orbit !== null) {
                    const dir = rand() < 0.5 ? 1 : -1;
                    e['behaviors'] = [
                        { type: 'orbit', params: { center: [r2(req.x), r2(y), r2(req.z)], radius: 0, speed: r1(dir * ((sp.speed / orbit) * 57.3)), face: true } },
                        { type: 'bob', params: { amplitude: r2(0.25 + rand() * 0.5), period: r1(3 + rand() * 4), phase: r2(rand()) } },
                    ];
                }
                else {
                    e['behaviors'] = [
                        { type: 'wander', params: { radius: r1(Math.max(1.5, Math.min(8, req.radius * 0.6))), speed: sp.speed, pause: 0.4, face: true } },
                        { type: 'bob', params: { amplitude: 0.12, period: r1(1.4 + rand()), phase: r2(rand()) } },
                    ];
                }
                alts.push(alt);
                placed.push({ id: member, entity: e, position: [r2(x), r2(y), r2(z)], fact: `${r1(alt)} m above ${bodyAt ? 'the water' : 'the ground'}, clear air` });
                ok = true;
            }
            else {
                // Water: fish swim below the surface, ducks float on it.
                if (!bodyAt) {
                    why('no water there');
                    continue;
                }
                const bed = probe.surface(x, z, bodyAt.y - 0.02);
                const depth = bed ? bodyAt.y - bed.y : 6;
                const edge = edgeDistance(bodyAt, x, z);
                if (depth < (sp.minDepth ?? 0.5)) {
                    why(`too shallow (${r1(depth)} m)`);
                    continue;
                }
                if (edge < 0.8) {
                    why('too close to the bank');
                    continue;
                }
                const swimY = sp.habitat === 'surface' ? bodyAt.y - 0.03 : bodyAt.y - Math.min(Math.max(depth * 0.45, 0.12), 1.2, Math.max(0.1, depth - 0.12));
                const e = base(sp, member, label, [r2(x), r2(swimY), r2(z)], yaw);
                // The roaming circle must stay over water that is deep enough all the way round (a bank under a river plane is not in the footprint's edge).
                let roam = Math.max(0.8, Math.min(req.radius, edge - 0.5, 7));
                const ringOk = (rad) => {
                    for (let k = 0; k < 8; k++) {
                        const aa = (k / 8) * Math.PI * 2;
                        const px = x + Math.cos(aa) * (rad + 0.4);
                        const pz = z + Math.sin(aa) * (rad + 0.4);
                        const b2 = probe.surface(px, pz, bodyAt.y - 0.02);
                        if (!waterAt(probe.water, px, pz, bodyAt.y) || (b2 && bodyAt.y - b2.y < (sp.minDepth ?? 0.5) * 0.6))
                            return false;
                    }
                    return true;
                };
                while (roam > 0.8 && !ringOk(roam))
                    roam *= 0.75;
                if (!ringOk(roam)) {
                    why('too close to the bank');
                    continue;
                }
                e['behaviors'] = [{ type: 'wander', params: { radius: r1(roam), speed: r2(sp.speed * (0.7 + rand() * 0.6)), pause: sp.habitat === 'surface' ? 3 : 0.3, face: true } }];
                depths.push(depth);
                placed.push({ id: member, entity: e, position: [r2(x), r2(swimY), r2(z)], fact: `water ${r1(depth)} m deep, ${r1(edge)} m from the bank` });
                ok = true;
            }
            if (ok)
                taken.push([x, z]);
        }
        if (!ok)
            refused.push(`${req.id}-${i + 1}: no spot found for a ${sp.name} (${[...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([r, n]) => `${r} x${n}`).join(', ') || 'unknown'}).`);
    }
    const span = (v, unit) => (v.length === 0 ? '' : `${r1(Math.min(...v))} to ${r1(Math.max(...v))} ${unit}`);
    const facts = sp.habitat === 'ground' ? `slopes ${span(slopes, 'deg')}, none in water` : sp.habitat === 'air' ? (perched ? 'perched on solid surfaces' : `altitudes ${span(alts, 'm')}, clear air`) : `depths ${span(depths, 'm')}, away from the bank`;
    const summary = placed.length > 0 ? `${req.id}: ${placed.length} of ${count} ${sp.name}${placed.length === 1 || INVARIANT.has(sp.id) ? '' : 's'} placed (${facts}).` : '';
    return { placed, refused: refused.slice(0, 6), summary };
}
