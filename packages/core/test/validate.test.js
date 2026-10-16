import { describe, expect, it } from 'vitest';
import { checkIntegrity, createWorld, isAllowedModelUrl, LIMITS, validateWorld, WorldValidationError } from '../src/index';
function issuesOf(doc) {
    const r = validateWorld(doc);
    if (r.ok)
        throw new Error('expected validation failure');
    return r.issues;
}
describe('createWorld', () => {
    it('fills every default', () => {
        const w = createWorld();
        expect(w.version).toBe(1);
        expect(w.name).toBe('Untitled world');
        expect(w.environment.sky).toBe('day');
        expect(w.environment.ground).toEqual({ material: { preset: 'grass' }, size: 400 });
        expect(w.player.spawn).toEqual([0, 1, 8]);
        expect(w.entities).toEqual({});
    });
    it('fills entity defaults', () => {
        const w = createWorld({ entities: { a: { id: 'a' } } });
        expect(w.entities['a']).toMatchObject({ name: '', parent: null, tags: [], visible: true, template: false, shape: { kind: 'none' } });
    });
    it('throws WorldValidationError with issues', () => {
        try {
            createWorld({ entities: { a: { id: 'b' } } });
            expect.unreachable();
        }
        catch (err) {
            expect(err).toBeInstanceOf(WorldValidationError);
            expect(err.issues[0]).toEqual({ path: 'entities.a.id', message: "must equal its key 'a' (got 'b')" });
            expect(err.message).toContain('entities.a.id');
        }
    });
});
describe('validateWorld', () => {
    it('accepts a valid world and returns parsed data', () => {
        const r = validateWorld({ name: 'x', entities: { a: { id: 'a' } } });
        expect(r.ok).toBe(true);
    });
    it('reports schema problems with dotted paths and actionable messages', () => {
        const issues = issuesOf({
            entities: {
                car: { id: 'car', physics: { body: 'flying' }, material: { color: 'red' }, shape: { kind: 'blob' }, transform: { position: [0, 'x', 0] } },
            },
            rules: [{ id: 'r', when: { on: 'start' }, then: [] }],
        });
        const byPath = Object.fromEntries(issues.map((i) => [i.path, i.message]));
        expect(byPath['entities.car.physics.body']).toBe('must be one of static|dynamic|kinematic');
        expect(byPath['entities.car.material.color']).toBe('must be a hex color "#rrggbb"');
        expect(byPath['entities.car.shape.kind']).toBe('must be one of primitive|procedural|model|scatter|none|mesh|asset');
        expect(byPath['entities.car.transform.position.1']).toBe('must be number (received string)');
        expect(byPath['rules.0.then']).toBe('must have at least 1 item(s)');
    });
    it('reports bad record keys and missing required fields', () => {
        const issues = issuesOf({ entities: { 'Bad Key': { id: 'bad-key' } }, generators: { g: { id: 'gg' } } });
        expect(issues.some((i) => i.path === 'entities' && i.message.startsWith('key "Bad Key" must be a lowercase slug'))).toBe(true);
        expect(issues.some((i) => i.path === 'generators.g.source' && i.message.startsWith('is required'))).toBe(true);
    });
    it('picks the closest union branch for nested unions', () => {
        const issues = issuesOf({ entities: { s: { id: 's', shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'boxx' }, count: 0, area: [1] } } } });
        const paths = issues.map((i) => i.path);
        expect(paths).toContain('entities.s.shape.of.primitive');
        expect(paths).toContain('entities.s.shape.count');
        expect(paths).toContain('entities.s.shape.area');
    });
    it('checks referential integrity', () => {
        const issues = issuesOf({
            player: { controls: 'ghost' },
            entities: {
                a: { id: 'a', parent: 'missing' },
                b: { id: 'b', joint: { type: 'fixed', target: 'nobody' } },
                c: { id: 'c', parent: 'c' },
                d: { id: 'd', joint: { type: 'fixed', target: 'd' } },
                s: { id: 's', shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'box' }, count: 2, area: [1, 1], onSurface: 'void' } },
            },
        });
        const text = issues.map((i) => `${i.path} ${i.message}`);
        expect(text).toContain("entities.a.parent refers to missing entity 'missing'");
        expect(text).toContain("entities.b.joint.target refers to missing entity 'nobody'");
        expect(text).toContain('entities.c.parent cannot be the entity itself');
        expect(text).toContain('entities.d.joint.target cannot be the entity itself');
        expect(text).toContain("entities.s.shape.onSurface refers to missing entity 'void'");
        expect(text).toContain("player.controls refers to missing entity 'ghost'");
    });
    it('detects parent cycles and excessive depth', () => {
        const cyc = issuesOf({ entities: { a: { id: 'a', parent: 'b' }, b: { id: 'b', parent: 'a' } } });
        expect(cyc.some((i) => i.message.includes('cycle'))).toBe(true);
        const entities = {};
        for (let i = 0; i <= LIMITS.MAX_HIERARCHY_DEPTH + 1; i++)
            entities[`n${i}`] = { id: `n${i}`, parent: i === 0 ? null : `n${i - 1}` };
        expect(issuesOf({ entities }).some((i) => i.message.includes('levels deep'))).toBe(true);
    });
    it('checks ids, duplicates, selectors and limits', () => {
        const issues = issuesOf({
            rules: [
                { id: 'r', when: { on: 'click', target: 'Bad Selector' }, then: [{ do: 'reset' }] },
                { id: 'r', when: { on: 'start' }, then: [{ do: 'destroy', target: '#' }] },
            ],
            tests: [{ id: 't', kind: 'noOverlap', target: '# bad' }, { id: 't', kind: 'noOverlap' }],
            generators: { gen: { id: 'other', description: '', source: 'return api.build()' } },
            scripts: { s1: { id: 's2', description: '', source: 'x' } },
            hud: Array.from({ length: LIMITS.MAX_HUD + 1 }, (_, i) => ({ key: `k${i}`, label: 'x' })),
        });
        const text = issues.map((i) => `${i.path} ${i.message}`);
        expect(text).toContain("rules.0 invalid selector 'Bad Selector'");
        expect(text).toContain("rules.1.id duplicate rule id 'r'");
        expect(text).toContain("rules.1 invalid selector '#'");
        expect(text).toContain("tests.0 invalid selector '# bad'");
        expect(text).toContain("tests.1.id duplicate test id 't'");
        expect(text).toContain("generators.gen.id must equal its key 'gen'");
        expect(text).toContain("scripts.s1.id must equal its key 's1'");
        expect(text).toContain(`hud has ${LIMITS.MAX_HUD + 1} entries (max ${LIMITS.MAX_HUD})`);
    });
    it('checkIntegrity flags reserved ids even when the guard is bypassed', () => {
        const base = createWorld({});
        const e = createWorld({ entities: { x: { id: 'x' } } }).entities['x'];
        const entities = Object.create(null);
        entities['constructor'] = { ...e, id: 'constructor' };
        const text = checkIntegrity({ ...base, entities }).map((i) => `${i.path} ${i.message}`);
        expect(text).toContain("entities.constructor id 'constructor' is reserved");
    });
    it('enforces scatter total', () => {
        const entities = {};
        // Three layers of 800k exceed LIMITS.MAX_SCATTER_TOTAL (2 000 000); each is within the per-layer cap.
        for (let i = 0; i < 3; i++)
            entities[`s${i}`] = { id: `s${i}`, shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'box' }, count: 800_000, area: [1, 1] } };
        expect(issuesOf({ entities }).some((i) => i.message.includes(`scatter instances total 2400000 (max ${LIMITS.MAX_SCATTER_TOTAL})`))).toBe(true);
        for (let i = 0; i < 2; i++)
            entities[`s${i}`] = { id: `s${i}`, shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'box' }, count: 1_000_000, area: [1, 1] } };
        delete entities['s2'];
        expect(validateWorld({ entities }).ok).toBe(true);
    });
    it('rejects hostile input before parsing', () => {
        expect(issuesOf(JSON.parse('{"state":{"__proto__":{"x":1}}}'))[0]).toEqual({ path: 'state.__proto__', message: 'forbidden key "__proto__"' });
        expect(issuesOf({ entities: { a: { id: 'a', state: { constructor: { prototype: 1 } } } } })[0]?.message).toBe('forbidden key "constructor"');
        expect(validateWorld(null).ok).toBe(false);
        expect(validateWorld(42).ok).toBe(false);
        expect(validateWorld(undefined).ok).toBe(false);
        expect(validateWorld({}).ok).toBe(true);
    });
});
describe('model URL policy', () => {
    const withModel = (url) => ({ entities: { m: { id: 'm', shape: { kind: 'model', url } } } });
    it('accepts same-origin paths, blob: and glTF data: URLs', () => {
        for (const url of ['/models/a.glb', './a.gltf', '../x/a.glb', 'models/tree.glb', 'blob:https://studio/1', 'data:model/gltf-binary;base64,AAAA']) {
            expect(isAllowedModelUrl(url), url).toBe(true);
            expect(validateWorld(withModel(url)).ok, url).toBe(true);
        }
    });
    it('rejects arbitrary hosts, plain http and dangerous schemes at validation time', () => {
        for (const url of ['https://tracker.example/a.glb', 'http://cdn.example/a.glb', '//evil.example/a.glb', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html;base64,AA']) {
            expect(isAllowedModelUrl(url), url).toBe(false);
            const r = validateWorld(withModel(url));
            expect(r.ok, url).toBe(false);
            if (!r.ok)
                expect(r.issues[0]?.path).toBe('entities.m.shape.url');
        }
    });
    it('allows https only on an explicit host allowlist', () => {
        expect(isAllowedModelUrl('https://assets.example/a.glb', ['assets.example'])).toBe(true);
        expect(isAllowedModelUrl('https://ASSETS.example/a.glb', ['assets.example'])).toBe(true);
        expect(isAllowedModelUrl('https://assets.example.evil/a.glb', ['assets.example'])).toBe(false);
        expect(isAllowedModelUrl('https://u:p@assets.example/a.glb', ['assets.example'])).toBe(false);
    });
});
