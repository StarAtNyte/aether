/**
 * The Aether MCP server driven by a real MCP client over the SDK's in-memory
 * transport: tool listing, the offline create/verify/playtest/export loop,
 * patches and undo, resources, and the safety rules (strict input, size
 * caps, safe error text, no paths outside the project folder).
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMcpServer } from '../src/mcp/server';
const dirs = [];
function tmp() {
    const d = mkdtempSync(join(tmpdir(), 'aether-mcp-'));
    dirs.push(d);
    return d;
}
async function connect(dir = join(tmp(), 'project'), providerOverride) {
    const [a, b] = InMemoryTransport.createLinkedPair();
    const running = await startMcpServer({ projectDir: dir, provider: 'offline', stateDir: tmp(), playerDir: join(tmp(), 'no-player'), ...(providerOverride ? { providerOverride } : {}) }, b);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(a);
    return {
        client,
        dir: running.session.project.root,
        async close() {
            await client.close();
            await running.close();
        },
    };
}
function textOf(c) {
    return c && typeof c.text === 'string' ? c.text : '';
}
async function call(rig, name, args = {}) {
    return (await rig.client.callTool({ name, arguments: args }));
}
function data(r) {
    expect(r.isError, JSON.stringify(r.content)).not.toBe(true);
    return r.structuredContent;
}
afterAll(() => {
    for (const d of dirs.splice(0))
        rmSync(d, { recursive: true, force: true });
});
const BOX = { op: 'add', entity: { id: 'crate', name: 'Crate', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, transform: { position: [0, 0.5, 0] }, physics: { body: 'dynamic' } } };
describe('MCP server: surface', () => {
    let rig;
    beforeAll(async () => {
        rig = await connect();
    }, 60_000);
    afterAll(async () => {
        await rig.close();
    });
    it('lists the documented tools with descriptions and strict schemas', async () => {
        const { tools } = await rig.client.listTools();
        const names = tools.map((t) => t.name).sort();
        for (const n of ['apply_patch', 'create_world', 'edit', 'export', 'get_entity', 'list_entities', 'playtest', 'render_still', 'replay', 'undo', 'verify'])
            expect(names).toContain(n);
        for (const t of tools) {
            expect(t.description?.length ?? 0, t.name).toBeGreaterThan(30);
            expect(t.inputSchema.type).toBe('object');
        }
    });
    it('serves the world, the summary, both schemas and the guide as resources', async () => {
        const { resources } = await rig.client.listResources();
        const uris = resources.map((r) => r.uri);
        for (const u of ['aether://world/current', 'aether://world/summary', 'aether://schema/world', 'aether://schema/patch', 'aether://guide'])
            expect(uris).toContain(u);
        const world = await rig.client.readResource({ uri: 'aether://world/current' });
        expect(JSON.parse(textOf(world.contents[0]))).toMatchObject({ version: 1 });
        const patch = await rig.client.readResource({ uri: 'aether://schema/patch' });
        const schema = JSON.stringify(JSON.parse(textOf(patch.contents[0])));
        expect(schema).toContain('addRule');
        const ws = await rig.client.readResource({ uri: 'aether://schema/world' });
        expect(textOf(ws.contents[0]).length).toBeGreaterThan(1000);
    });
});
describe('MCP server: the loop, offline', () => {
    let rig;
    beforeAll(async () => {
        rig = await connect();
    }, 60_000);
    afterAll(async () => {
        await rig.close();
    });
    it('applies patches, lists and reads entities, and undoes one action per step', async () => {
        const r = data(await call(rig, 'apply_patch', { patches: [BOX], message: 'add crate' }));
        expect(r['applied']).toBe(1);
        const list = data(await call(rig, 'list_entities', { text: 'crate' }));
        expect(list['total']).toBe(1);
        expect(list['rows'][0]).toMatchObject({ id: 'crate', body: 'dynamic' });
        const one = data(await call(rig, 'get_entity', { id: 'crate' }));
        expect(one['entity']).toMatchObject({ id: 'crate', shape: { kind: 'primitive' } });
        const uri = await rig.client.readResource({ uri: 'aether://entity/crate' });
        expect(JSON.parse(textOf(uri.contents[0]))).toMatchObject({ id: 'crate' });
        data(await call(rig, 'undo'));
        expect(data(await call(rig, 'list_entities', {}))['total']).toBe(0);
        data(await call(rig, 'redo'));
        expect(data(await call(rig, 'list_entities', {}))['total']).toBe(1);
    });
    it('rejects a bad patch atomically with a readable reason and changes nothing', async () => {
        const before = data(await call(rig, 'list_entities', {}))['total'];
        const r = await call(rig, 'apply_patch', { patches: [{ op: 'add', entity: { id: 'ok-one', shape: { kind: 'none' } } }, { op: 'update', id: 'ghost', set: { visible: false } }] });
        expect(r.isError).toBe(true);
        expect(r.content[0]?.text).toMatch(/invalid_patch/);
        expect(r.content[0]?.text).toMatch(/ghost/);
        expect(data(await call(rig, 'list_entities', {}))['total']).toBe(before);
    });
    it('rejects prototype-pollution keys, oversized batches and unknown arguments', async () => {
        const polluted = JSON.parse('{"op":"update","id":"crate","set":{"__proto__":{"x":1}}}');
        const a = await call(rig, 'apply_patch', { patches: [polluted] });
        expect(a.isError).toBe(true);
        const many = await rig.client.callTool({ name: 'apply_patch', arguments: { patches: Array.from({ length: 201 }, () => ({ op: 'setState', key: 'a', value: 1 })) } }).catch((e) => e);
        expect(JSON.stringify(many)).toMatch(/too_big|200|Too big|isError|invalid/i);
        const big = await call(rig, 'apply_patch', { patches: [{ op: 'setState', key: 'a', value: 'x'.repeat(600_000) }] });
        expect(big.isError).toBe(true);
        expect(big.content[0]?.text).toMatch(/too_large|invalid_patch/);
        const extra = await rig.client.callTool({ name: 'get_entity', arguments: { id: 'crate', path: '/etc/passwd' } }).catch((e) => e);
        // Unknown keys must never be honoured: either refused or ignored, never read as a path.
        expect(JSON.stringify(extra)).not.toMatch(/root:/);
    });
    it('keeps error text free of server paths and stack traces', async () => {
        const r = await call(rig, 'get_entity', { id: 'nope' });
        expect(r.isError).toBe(true);
        const t = r.content[0]?.text ?? '';
        expect(t).toMatch(/not_found/);
        expect(t).not.toMatch(/\/home|\/tmp|at .*\(.*:\d+:\d+\)|node_modules/);
    });
    it('creates a small game from a prompt, verifies it, plays it and exports it', async () => {
        const created = data(await call(rig, 'create_world', { prompt: 'a coin collecting game: grab 8 coins before time runs out' }));
        expect(created['provider']).toBe('offline planner');
        expect(created['patchesApplied']).toBeGreaterThan(0);
        expect(created['errors']).toEqual([]);
        const verify = data(await call(rig, 'verify'));
        expect(verify['passed']).toBe(true);
        expect(verify['tests'].length).toBeGreaterThan(0);
        const play = data(await call(rig, 'playtest', { seconds: 90 }));
        expect(['win', 'incomplete']).toContain(play['outcome']);
        expect(play['objectives'].some((o) => o.reached)).toBe(true);
        const gltf = data(await call(rig, 'export', { format: 'gltf', name: 'coins' }));
        const files = gltf['files'];
        expect(files[0]?.path).toBe('exports/coins.glb');
        const glb = readFileSync(join(rig.dir, 'exports/coins.glb'));
        expect(glb.subarray(0, 4).toString('ascii')).toBe('glTF');
        expect(glb.length).toBeGreaterThan(2000);
        const proj = data(await call(rig, 'export', { format: 'project' }));
        expect(proj['files'][0]?.path).toMatch(/^exports\/.*\.aether\.json$/);
        // The whole create is one undo step; the earlier crate world comes back.
        data(await call(rig, 'undo'));
        expect(data(await call(rig, 'get_world_summary'))['entities'] < 5).toBe(true);
    }, 120_000);
    it('renders a PNG still, inline and on disk', async () => {
        data(await call(rig, 'create_world', { prompt: 'a cozy forest camp with a campfire and tents' }));
        const r = await call(rig, 'render_still', { width: 320, height: 200, name: 'camp' });
        const meta = data(r);
        expect(meta['file']).toBe('renders/camp.png');
        const img = r.content.find((c) => c.type === 'image');
        expect(img?.mimeType).toBe('image/png');
        const png = readFileSync(join(rig.dir, 'renders/camp.png'));
        expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
        // Not a blank image: sky, ground and objects differ.
        expect(new Set(Buffer.from(String(img?.data), 'base64').subarray(100, 4000)).size).toBeGreaterThan(8);
    }, 120_000);
    it('replays the physics and shows a moment of it', async () => {
        data(await call(rig, 'create_world', { prompt: 'a domino run that knocks over a bell' }));
        const rep = data(await call(rig, 'replay'));
        expect(rep['bodies'].length).toBeGreaterThan(0);
        expect(rep['file']).toBe('replays/replay.json');
        const still = data(await call(rig, 'render_still', { width: 200, height: 120, at: 2 }));
        expect(still['width']).toBe(200);
        const none = await call(rig, 'apply_patch', { patches: [{ op: 'setState', key: 'x', value: 1 }] });
        data(none);
        // A change invalidates the replay.
        const stale = await call(rig, 'render_still', { width: 100, height: 80, at: 2 });
        expect(stale.isError).toBe(true);
    }, 120_000);
});
describe('MCP server: files stay inside the project folder', () => {
    it('sanitizes names and never writes outside exports/, renders/ and .aether/', async () => {
        const rig = await connect();
        try {
            data(await call(rig, 'apply_patch', { patches: [BOX] }));
            const r = data(await call(rig, 'export', { format: 'project', name: '../../../etc/passwd' }));
            const path = r['files'][0]?.path ?? '';
            expect(path).toBe('exports/passwd.aether.json');
            const r2 = data(await call(rig, 'export', { format: 'project', name: '..\\..\\evil' }));
            expect(r2['files'][0]?.path).toBe('exports/evil.aether.json');
            const top = readdirSync(rig.dir).sort();
            expect(top.every((n) => ['.aether', 'exports', 'renders', 'replays'].includes(n))).toBe(true);
        }
        finally {
            await rig.close();
        }
    }, 60_000);
    it('refuses to write through a symbolic link planted in the project folder', async () => {
        const outside = tmp();
        const rig = await connect();
        try {
            data(await call(rig, 'apply_patch', { patches: [BOX] }));
            mkdirSync(join(rig.dir, 'exports'), { recursive: true });
            symlinkSync(join(outside, 'stolen.aether.json'), join(rig.dir, 'exports/leak.aether.json'));
            const r = await call(rig, 'export', { format: 'project', name: 'leak' });
            expect(r.isError).toBe(true);
            expect(r.content[0]?.text).toMatch(/path_denied/);
            expect(() => statSync(join(outside, 'stolen.aether.json'))).toThrow();
            // An exports/ folder that is itself a link out of the project is refused too.
            rmSync(join(rig.dir, 'exports'), { recursive: true, force: true });
            symlinkSync(outside, join(rig.dir, 'exports'));
            const r2 = await call(rig, 'export', { format: 'project', name: 'again' });
            expect(r2.isError).toBe(true);
            expect(readdirSync(outside)).toEqual([]);
        }
        finally {
            await rig.close();
        }
    }, 60_000);
    it('saves the world in the project folder and restores it on the next start', async () => {
        const dir = join(tmp(), 'persist');
        const first = await connect(dir);
        data(await call(first, 'apply_patch', { patches: [BOX] }));
        await first.close();
        const second = await connect(dir);
        try {
            expect(data(await call(second, 'list_entities', {}))['total']).toBe(1);
        }
        finally {
            await second.close();
        }
    }, 60_000);
    it('ignores a corrupt saved world instead of failing to start', async () => {
        const dir = join(tmp(), 'corrupt');
        mkdirSync(join(dir, '.aether'), { recursive: true });
        const { writeFileSync } = await import('node:fs');
        writeFileSync(join(dir, '.aether/world.json'), '{"format":"aether-world","world":{"entities":{"x":1}}}');
        const rig = await connect(dir);
        try {
            expect(data(await call(rig, 'list_entities', {}))['total']).toBe(0);
        }
        finally {
            await rig.close();
        }
    }, 60_000);
});
/** A model that follows a script: each completion returns the next list of tool calls. */
function scripted(steps) {
    let i = 0;
    const provider = {
        name: 'scripted',
        async complete(_req) {
            const calls = steps[Math.min(i, steps.length - 1)] ?? [];
            i++;
            return { content: calls.map((c, k) => ({ type: 'tool_use', id: `t${i}-${k}`, name: c.name, input: c.input })), stopReason: 'tool_use' };
        },
    };
    return { provider, kind: 'offline', label: 'scripted model' };
}
describe('MCP server: the agent loop with a model of our choosing', () => {
    it('runs a model through create_world and edit; one undo reverts each whole request', async () => {
        const tower = (id, y) => ({ op: 'add', entity: { id, shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, transform: { position: [0, y, 0] } } });
        const provider = scripted([
            [{ name: 'apply_patches', input: { message: 'first block', patches: [tower('block-1', 0.5)] } }],
            [{ name: 'apply_patches', input: { message: 'second block', patches: [tower('block-2', 1.5)] } }],
            [{ name: 'finish', input: { message: 'Built a two-block tower.' } }],
        ]);
        const rig = await connect(undefined, async () => provider);
        try {
            const made = data(await call(rig, 'create_world', { prompt: 'a tiny tower' }));
            expect(made).toMatchObject({ provider: 'scripted model', patchesApplied: 2, patchesRejected: 0, message: 'Built a two-block tower.' });
            expect(data(await call(rig, 'list_entities', {}))['total']).toBe(2);
            data(await call(rig, 'undo'));
            expect(data(await call(rig, 'list_entities', {}))['total']).toBe(0);
        }
        finally {
            await rig.close();
        }
    }, 60_000);
    it('reports rejected model patches without losing the valid ones, and refuses empty or oversized prompts', async () => {
        const provider = scripted([
            [{ name: 'apply_patches', input: { message: 'mixed', patches: [{ op: 'add', entity: { id: 'good-one', shape: { kind: 'none' } } }, { op: 'update', id: 'missing', set: { visible: false } }] } }],
            [{ name: 'finish', input: { message: 'done' } }],
        ]);
        const rig = await connect(undefined, async () => provider);
        try {
            const r = data(await call(rig, 'edit', { prompt: 'do something half wrong' }));
            expect(r['patchesApplied']).toBe(1);
            expect(r['patchesRejected']).toBe(1);
            expect(String(r['rejected'][0])).toMatch(/missing/);
            const empty = await rig.client.callTool({ name: 'edit', arguments: { prompt: '   ' } }).catch((e) => ({ isError: true, e }));
            expect(empty.isError).toBe(true);
            const long = await rig.client.callTool({ name: 'create_world', arguments: { prompt: 'x'.repeat(4001) } }).catch((e) => ({ isError: true, e }));
            expect(long.isError).toBe(true);
        }
        finally {
            await rig.close();
        }
    }, 60_000);
    it('answers a provider that is down with advice, not a stack trace', async () => {
        const rig = await connect(undefined, async () => {
            const { ToolError } = await import('../src/mcp/errors');
            throw new ToolError('unavailable', 'The local Aether server is not running. Start it with "aether start".');
        });
        try {
            const r = await call(rig, 'create_world', { prompt: 'a castle' });
            expect(r.isError).toBe(true);
            expect(r.content[0]?.text).toMatch(/unavailable: .*aether start/);
        }
        finally {
            await rig.close();
        }
    }, 60_000);
});
describe('MCP server: exports', () => {
    it('draws floor plans of a building as SVG and refuses a world without one', async () => {
        const rig = await connect();
        try {
            const none = await call(rig, 'export', { format: 'plan' });
            expect(none.isError).toBe(true);
            expect(none.content[0]?.text).toMatch(/not_found/);
            data(await call(rig, 'create_world', { prompt: 'a two-storey villa with a pool' }));
            const r = data(await call(rig, 'export', { format: 'plan', name: 'villa' }));
            const files = r['files'];
            expect(files.length).toBeGreaterThanOrEqual(2);
            const svg = readFileSync(join(rig.dir, files[0]?.path ?? ''), 'utf8');
            expect(svg.startsWith('<svg') || svg.startsWith('<?xml')).toBe(true);
            expect(svg).not.toMatch(/<script/i);
        }
        finally {
            await rig.close();
        }
    }, 120_000);
    it('explains how to get the web player when it is not built', async () => {
        const rig = await connect();
        try {
            data(await call(rig, 'create_world', { prompt: 'a coin collecting game: grab 8 coins before time runs out' }));
            const r = await call(rig, 'export', { format: 'build' });
            expect(r.isError).toBe(true);
            expect(r.content[0]?.text).toMatch(/unavailable: .*aether start/);
            const empty = connect();
            const e = await empty;
            try {
                const nothing = await call(e, 'export', { format: 'gltf' });
                expect(nothing.isError).toBe(true);
                expect(nothing.content[0]?.text).toMatch(/nothing to export/);
            }
            finally {
                await e.close();
            }
        }
        finally {
            await rig.close();
        }
    }, 120_000);
    it('rejects out-of-range render requests', async () => {
        const rig = await connect();
        try {
            for (const args of [{ width: 20000, height: 100 }, { width: 100, height: 8 }, { from: [0, 1, 0] }, { fovDeg: 3 }]) {
                const r = await rig.client.callTool({ name: 'render_still', arguments: args }).catch((e) => ({ isError: true, e }));
                expect(r.isError, JSON.stringify(args)).toBe(true);
            }
        }
        finally {
            await rig.close();
        }
    }, 60_000);
});
