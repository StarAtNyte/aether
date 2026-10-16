/** Words that name a person in an entity's id, name, tags or NPC role. */
const PERSON_WORDS = /^(?:person|persons|people|human|humans|man|men|woman|women|boy|girl|child|children|kid|kids|guy|lady|npc|npcs|guard|guards|villager|villagers|townsperson|townspeople|citizen|citizens|resident|residents|inhabitant|stranger|visitor|visitors|customer|customers|shopkeeper|shopkeepers|merchant|merchants|vendor|trader|innkeeper|bartender|barman|waiter|waitress|chef|cook|baker|blacksmith|farmer|peasant|worker|workers|student|students|teacher|doctor|nurse|patient|pedestrian|pedestrians|passerby|spectator|spectators|crowd|knight|soldier|soldiers|sentry|bandit|bandits|thief|traveller|traveler|wanderer|elder|monk|priest|hunter|sailor|fisherman|miner|musician|dancer|hiker|camper|tourist|owner|clerk|receptionist|guest|guests|servant|maid|butler|shopper|diner|athlete|runner|skater)$/;
/** Words anywhere in the name that say it is not a living person (a statue of a guard, a guard zone). */
const NOT_A_PERSON = /^(?:statue|statues|scarecrow|snowman|figurine|toy|robot|silhouette|poster|painting|picture|sculpture|mannequin|dummy|puppet|ghost|skeleton|zombie|dog|cat|horse|bird|wolf|deer|trigger|zone|area|hitbox|collider|spawn|marker|waypoint|path|route|shadow|icon)$/;
/** Last words that make a match an object, not a person ("guard tower", "guard hat"): only the head noun counts. */
const OBJECT_HEAD = /^(?:tower|house|hut|post|rail|booth|station|room|gate|lamp|chair|table|desk|bench|bed|counter|cart|stall|shop|door|window|wall|floor|stand|hat|helmet|armor|armour|sword|shield|spear|bag|crate)$/;
const WARDROBE = [
    [/^(?:guard|guards|sentry|knight|soldier|soldiers|watchman)$/, 'guard'],
    [/^(?:shopkeeper|shopkeepers|merchant|merchants|vendor|trader|innkeeper|baker|blacksmith|clerk|bartender|barman|cook|chef)$/, 'merchant'],
    [/^(?:bandit|bandits|thief)$/, 'bandit'],
    [/^(?:villager|villagers|farmer|peasant|townsperson|townspeople|citizen|citizens|fisherman|miner)$/, 'villager'],
    [/^(?:traveller|traveler|wanderer|hiker|camper|tourist|sailor|hunter)$/, 'traveller'],
    [/^(?:elder|monk|priest)$/, 'elder'],
    [/^(?:worker|workers|servant|maid|butler)$/, 'worker'],
    [/^(?:waiter|waitress|receptionist|doctor|nurse|teacher)$/, 'formal'],
];
/** Lower-case words of an identifier or phrase ("guardJoe_2" → ["guard", "joe"]). */
function words(text) {
    return text
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter(Boolean);
}
function personWordsOf(e) {
    const out = [];
    const parts = [e.id, e.name, ...e.tags, e.npc?.role ?? ''];
    for (const p of parts)
        out.push(...words(p));
    return out;
}
/** Library models that are stylised stand-in people (blocky figures), not rigged humans: "man", "woman-b", "kid" … */
const STAND_IN_PERSON_ASSET = /^(?:man|woman|boy|girl|kid|child|person|human|people|character|npc)(?:-[a-z0-9]{1,3})?$/;
/** True when the shape is a stand-in body (capsule, cylinder or box of a person's size, or a stylised library figure), not a rigged person. */
function standInBody(e) {
    const s = e.shape;
    if (s.kind === 'asset')
        return STAND_IN_PERSON_ASSET.test(s.id);
    if (s.kind !== 'primitive')
        return false;
    if (s.primitive !== 'capsule' && s.primitive !== 'cylinder' && s.primitive !== 'box')
        return false;
    const sc = e.transform.scale;
    const w = Math.max(s.size[0] * Math.abs(sc[0]), s.size[2] * Math.abs(sc[2]));
    const h = s.size[1] * Math.abs(sc[1]);
    return h >= 0.8 && h <= 2.6 && w <= 1.4 && w > 0.05;
}
/** True when `e` is meant to be a person but has no character (and no modelled body). */
export function isBodylessPerson(e) {
    if (e.character || e.arch || e.physics?.sensor)
        return false;
    if (!standInBody(e))
        return false;
    const w = personWordsOf(e);
    if (w.length === 0 || w.some((x) => NOT_A_PERSON.test(x)))
        return false;
    if ([e.id, e.name].some((t) => OBJECT_HEAD.test(words(t).at(-1) ?? '')))
        return false;
    return w.some((x) => PERSON_WORDS.test(x));
}
/** The character a bodiless person gets: wardrobe, gender and age from the words that named it. */
export function characterFor(e) {
    const w = personWordsOf(e);
    const spec = {};
    for (const [re, wardrobe] of WARDROBE) {
        if (w.some((x) => re.test(x))) {
            spec.wardrobe = wardrobe;
            break;
        }
    }
    spec.wardrobe ??= 'casual';
    if (w.some((x) => /^(?:woman|women|girl|lady|waitress|maid|she)$/.test(x)))
        spec.gender = 'female';
    else if (w.some((x) => /^(?:man|men|boy|guy|butler|barman|he)$/.test(x)))
        spec.gender = 'male';
    if (w.some((x) => /^(?:child|children|kid|kids|boy|girl|student|students)$/.test(x)))
        spec.age = 'young';
    else if (w.some((x) => /^(?:elder|old)$/.test(x)))
        spec.age = 'old';
    return spec;
}
/** Ids of entities that are people without a character (all of the world, or only `scope`). */
export function bodilessPeople(world, scope) {
    const ids = scope ? [...scope] : Object.keys(world.entities);
    const out = [];
    for (const id of ids) {
        if (!Object.hasOwn(world.entities, id))
            continue;
        const e = world.entities[id];
        if (e && isBodylessPerson(e))
            out.push(id);
    }
    return out;
}
/** The patches that give every bodiless person a rigged character (empty when there is none). */
export function characterPatches(world, scope) {
    return bodilessPeople(world, scope).map((id) => ({ op: 'update', id, set: { character: characterFor(world.entities[id]) } }));
}
