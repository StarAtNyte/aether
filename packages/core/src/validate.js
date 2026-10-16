/**
 * Whole-document validation: schema (zod) + referential integrity + limits.
 */
import { WorldDoc as WorldDocSchema } from './schema';
import { LIMITS } from './limits';
import { inspectUntrusted, isForbiddenKey } from './guard';
import { hasOwn } from './json';
import { zodIssues, issuesText } from './issues';
import { isValidSelector } from './query';
import { isEntityId } from './ids';
import { forEachRuleSelector, forEachTestSelector } from './refs';
import { isAllowedModelUrl } from './urls';
import { checkMeshAssetSizes, meshAssetBytes } from './mesh/codec';
import { checkVoxelTerrain } from './patch/voxel-ops';
/** Thrown by {@link createWorld} when the input is not a valid world. */
export class WorldValidationError extends Error {
    /** Every problem found, with dotted paths. */
    issues;
    constructor(issues) {
        super(`invalid world: ${issuesText(issues)}`);
        this.name = 'WorldValidationError';
        this.issues = issues;
    }
}
/** Number of scatter instances an entity contributes to `MAX_SCATTER_TOTAL`. */
export function scatterCount(e) {
    if (e.shape.kind !== 'scatter')
        return 0;
    return e.shape.points ? e.shape.points.length : e.shape.count;
}
/** Ids of entities whose shape is the mesh asset `meshId`. */
export function meshUsers(entities, meshId) {
    const users = [];
    for (const id of Object.keys(entities)) {
        const s = entities[id].shape;
        if (s.kind === 'mesh' && s.mesh === meshId)
            users.push(id);
    }
    return users;
}
/** Total decoded bytes of every mesh asset of a world. */
export function meshTotalBytes(meshes) {
    let total = 0;
    for (const k of Object.keys(meshes))
        total += meshAssetBytes(meshes[k]);
    return total;
}
/** Ids of entities that use custom generator `generatorId` (directly or via scatter). */
export function generatorUsers(entities, generatorId) {
    const users = [];
    for (const id of Object.keys(entities)) {
        const s = entities[id].shape;
        const shape = s.kind === 'scatter' ? s.of : s;
        if (shape.kind === 'procedural' && shape.generator === generatorId)
            users.push(id);
    }
    return users;
}
/**
 * Referential integrity + limits of an already schema-valid world.
 * Returns an empty array when the world is consistent.
 */
export function checkIntegrity(world) {
    const issues = [];
    const ents = world.entities;
    const ids = Object.keys(ents);
    const exists = (id) => hasOwn(ents, id);
    if (ids.length > LIMITS.MAX_ENTITIES)
        issues.push({ path: 'entities', message: `has ${ids.length} entities (max ${LIMITS.MAX_ENTITIES})` });
    let scatter = 0;
    for (const key of ids) {
        const e = ents[key];
        const p = `entities.${key}`;
        if (e.id !== key)
            issues.push({ path: `${p}.id`, message: `must equal its key '${key}' (got '${e.id}')` });
        if (isForbiddenKey(key))
            issues.push({ path: p, message: `id '${key}' is reserved` });
        if (e.parent !== null) {
            if (e.parent === key)
                issues.push({ path: `${p}.parent`, message: 'cannot be the entity itself' });
            else if (!exists(e.parent))
                issues.push({ path: `${p}.parent`, message: `refers to missing entity '${e.parent}'` });
        }
        if (e.joint && e.joint.target !== 'world') {
            if (e.joint.target === key)
                issues.push({ path: `${p}.joint.target`, message: 'cannot be the entity itself' });
            else if (!exists(e.joint.target))
                issues.push({ path: `${p}.joint.target`, message: `refers to missing entity '${e.joint.target}'` });
        }
        if (e.shape.kind === 'scatter' && e.shape.onSurface !== undefined && !exists(e.shape.onSurface)) {
            issues.push({ path: `${p}.shape.onSurface`, message: `refers to missing entity '${e.shape.onSurface}'` });
        }
        if (e.shape.kind === 'mesh' && !hasOwn(world.meshes, e.shape.mesh)) {
            issues.push({ path: `${p}.shape.mesh`, message: `refers to missing mesh '${e.shape.mesh}'` });
        }
        if (e.shape.kind === 'model' && !isAllowedModelUrl(e.shape.url)) {
            issues.push({
                path: `${p}.shape.url`,
                message: 'model url must be a same-origin path, a blob:/glTF data: URL, or an https URL on an allowlisted asset host',
            });
        }
        scatter += scatterCount(e);
    }
    if (scatter > LIMITS.MAX_SCATTER_TOTAL)
        issues.push({ path: 'entities', message: `scatter instances total ${scatter} (max ${LIMITS.MAX_SCATTER_TOTAL})` });
    // Cycles and depth: iterative walk with memoized depths.
    const depth = new Map();
    for (const start of ids) {
        if (depth.has(start))
            continue;
        const chain = [];
        const onChain = new Set();
        let cur = start;
        let base = -1;
        while (cur !== null && exists(cur)) {
            const known = depth.get(cur);
            if (known !== undefined) {
                base = known;
                break;
            }
            if (onChain.has(cur)) {
                issues.push({ path: `entities.${cur}.parent`, message: `parent chain forms a cycle through '${cur}'` });
                base = Number.POSITIVE_INFINITY;
                break;
            }
            onChain.add(cur);
            chain.push(cur);
            cur = ents[cur].parent;
        }
        for (let i = chain.length - 1; i >= 0; i--) {
            base = base + 1;
            depth.set(chain[i], base);
        }
    }
    for (const [id, d] of depth) {
        if (Number.isFinite(d) && d > LIMITS.MAX_HIERARCHY_DEPTH) {
            issues.push({ path: `entities.${id}.parent`, message: `hierarchy is ${d} levels deep (max ${LIMITS.MAX_HIERARCHY_DEPTH})` });
            break;
        }
    }
    if (world.player.controls !== undefined && !exists(world.player.controls)) {
        issues.push({ path: 'player.controls', message: `refers to missing entity '${world.player.controls}'` });
    }
    if (world.rules.length > LIMITS.MAX_RULES)
        issues.push({ path: 'rules', message: `has ${world.rules.length} rules (max ${LIMITS.MAX_RULES})` });
    const ruleIds = new Set();
    world.rules.forEach((r, i) => {
        if (ruleIds.has(r.id))
            issues.push({ path: `rules.${i}.id`, message: `duplicate rule id '${r.id}'` });
        ruleIds.add(r.id);
        forEachRuleSelector(r, (s, where) => {
            const ok = where === 'template' ? isEntityId(s) : isValidSelector(s);
            if (!ok)
                issues.push({ path: `rules.${i}`, message: `invalid ${where} '${s}'` });
        });
    });
    if (world.tests.length > LIMITS.MAX_TESTS)
        issues.push({ path: 'tests', message: `has ${world.tests.length} tests (max ${LIMITS.MAX_TESTS})` });
    const testIds = new Set();
    world.tests.forEach((t, i) => {
        if (testIds.has(t.id))
            issues.push({ path: `tests.${i}.id`, message: `duplicate test id '${t.id}'` });
        testIds.add(t.id);
        forEachTestSelector(t, (s) => {
            if (!isValidSelector(s))
                issues.push({ path: `tests.${i}`, message: `invalid selector '${s}'` });
        });
    });
    const genIds = Object.keys(world.generators);
    if (genIds.length > LIMITS.MAX_GENERATORS)
        issues.push({ path: 'generators', message: `has ${genIds.length} generators (max ${LIMITS.MAX_GENERATORS})` });
    for (const k of genIds) {
        if (world.generators[k]?.id !== k)
            issues.push({ path: `generators.${k}.id`, message: `must equal its key '${k}'` });
        if (isForbiddenKey(k))
            issues.push({ path: `generators.${k}`, message: `id '${k}' is reserved` });
    }
    const scriptIds = Object.keys(world.scripts);
    if (scriptIds.length > LIMITS.MAX_SCRIPTS)
        issues.push({ path: 'scripts', message: `has ${scriptIds.length} scripts (max ${LIMITS.MAX_SCRIPTS})` });
    for (const k of scriptIds) {
        if (world.scripts[k]?.id !== k)
            issues.push({ path: `scripts.${k}.id`, message: `must equal its key '${k}'` });
        if (isForbiddenKey(k))
            issues.push({ path: `scripts.${k}`, message: `id '${k}' is reserved` });
    }
    const meshIds = Object.keys(world.meshes);
    if (meshIds.length > LIMITS.MAX_MESHES)
        issues.push({ path: 'meshes', message: `has ${meshIds.length} meshes (max ${LIMITS.MAX_MESHES})` });
    for (const k of meshIds) {
        const m = world.meshes[k];
        if (m.id !== k)
            issues.push({ path: `meshes.${k}.id`, message: `must equal its key '${k}'` });
        if (isForbiddenKey(k))
            issues.push({ path: `meshes.${k}`, message: `id '${k}' is reserved` });
        const sizes = checkMeshAssetSizes(m);
        if (sizes)
            issues.push({ path: `meshes.${k}`, message: sizes });
    }
    const meshBytes = meshTotalBytes(world.meshes);
    if (meshBytes > LIMITS.MAX_MESH_BYTES)
        issues.push({ path: 'meshes', message: `mesh data totals ${Math.round(meshBytes / 1024)} KiB (max ${LIMITS.MAX_MESH_BYTES / 1024} KiB)` });
    const stateKeys = Object.keys(world.state).length;
    if (stateKeys > LIMITS.MAX_STATE_KEYS)
        issues.push({ path: 'state', message: `has ${stateKeys} variables (max ${LIMITS.MAX_STATE_KEYS})` });
    if (world.hud.length > LIMITS.MAX_HUD)
        issues.push({ path: 'hud', message: `has ${world.hud.length} entries (max ${LIMITS.MAX_HUD})` });
    if (world.voxel) {
        let hints = 4;
        const bad = checkVoxelTerrain(world.voxel, { takeHint: () => hints-- > 0 });
        if (bad)
            issues.push({ path: 'voxel', message: bad });
    }
    return issues;
}
/**
 * Validate an untrusted document: safety screen (prototype keys, depth, size),
 * zod schema (defaults applied, unknown keys stripped), then referential
 * integrity and limits. Never throws.
 */
export function validateWorld(doc) {
    const guard = inspectUntrusted(doc);
    if (!guard.ok)
        return { ok: false, issues: [{ path: guard.path, message: guard.message }] };
    const parsed = WorldDocSchema.safeParse(doc);
    if (!parsed.success)
        return { ok: false, issues: zodIssues(parsed.error) };
    const integrity = checkIntegrity(parsed.data);
    return integrity.length > 0 ? { ok: false, issues: integrity } : { ok: true, world: parsed.data };
}
/**
 * Create a world with defaults filled in. Throws {@link WorldValidationError}
 * when the input is invalid (use {@link validateWorld} for untrusted data).
 */
export function createWorld(input = {}) {
    const r = validateWorld(input);
    if (!r.ok)
        throw new WorldValidationError(r.issues);
    return r.world;
}
