/**
 * End-to-end check of Aether as an MCP server, the way Claude Code or Codex
 * runs it: a real MCP client spawns `aether mcp` as a child process and talks
 * to it over stdio (offline planner, temp project folder). It then
 *
 *  1. lists the tools and resources,
 *  2. builds a small game from a prompt, verifies it (physics unit tests) and
 *     plays it with the bot,
 *  3. exports a glTF, a standalone web build (the studio's real production
 *     build when `apps/studio/dist` exists, else a stand-in player) and the
 *     project file, and checks the files on disk,
 *  4. renders a still, undoes the whole game, and checks that nothing was
 *     written outside the project folder and that bad input is refused with
 *     safe text.
 *
 * Needs no browser and no network. Run: `npm run e2e:mcp`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readZip } from '@aether/assets/zip';
import { REPO_ROOT } from './support/env';
const CLI = join(REPO_ROOT, 'apps/cli/bin/aether.mjs');
const startedAt = performance.now();
function log(line) {
    process.stdout.write(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}
class E2EFailure extends Error {
    name = 'E2EFailure';
}
function check(cond, message) {
    if (!cond)
        throw new E2EFailure(message);
}
async function main() {
    const root = mkdtempSync(join(tmpdir(), 'aether-mcp-e2e-'));
    const project = join(root, 'project');
    const state = join(root, 'state');
    mkdirSync(state, { recursive: true });
    // The web player: the real production build when present, else a stand-in with the same shape.
    let playerDir = join(REPO_ROOT, 'apps/studio/dist');
    if (existsSync(join(playerDir, 'play-manifest.json')))
        log(`using the real studio build at ${playerDir}`);
    else {
        playerDir = join(root, 'player');
        mkdirSync(join(playerDir, 'assets'), { recursive: true });
        writeFileSync(join(playerDir, 'play-manifest.json'), JSON.stringify({ version: 1, entry: 'play.html', files: ['play.html', 'assets/player.js'] }));
        writeFileSync(join(playerDir, 'play.html'), '<!doctype html><html><head><meta charset="UTF-8" /><title>Player</title><meta name="description" content="" /></head><body><script type="module" src="assets/player.js"></script></body></html>');
        writeFileSync(join(playerDir, 'assets/player.js'), 'export {};');
        log('the studio is not built: using a stand-in player');
    }
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [CLI, 'mcp', '--project-dir', project, '--provider', 'offline', '--state-dir', state, '--player-dir', playerDir],
        cwd: root,
        stderr: 'pipe',
        env: { ...process.env, AETHER_PROVIDER: 'mock' },
    });
    const stderr = [];
    transport.stderr?.on('data', (d) => stderr.push(String(d)));
    const client = new Client({ name: 'aether-e2e', version: '1.0.0' });
    const call = async (name, args = {}) => (await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 }));
    const ok = (r) => {
        check(!r.isError, `tool failed: ${JSON.stringify(r.content).slice(0, 400)}`);
        return r.structuredContent ?? {};
    };
    try {
        await client.connect(transport);
        const info = client.getServerVersion();
        check(info?.name === 'aether', `unexpected server name ${JSON.stringify(info)}`);
        log(`connected to ${info?.name} ${info?.version}`);
        const { tools } = await client.listTools();
        const names = tools.map((t) => t.name);
        for (const n of ['create_world', 'apply_patch', 'edit', 'list_entities', 'get_entity', 'verify', 'playtest', 'replay', 'render_still', 'export', 'undo'])
            check(names.includes(n), `missing tool ${n}`);
        const { resources } = await client.listResources();
        for (const u of ['aether://world/current', 'aether://schema/world', 'aether://schema/patch'])
            check(resources.some((r) => r.uri === u), `missing resource ${u}`);
        log(`${tools.length} tools, ${resources.length} resources`);
        const created = ok(await call('create_world', { prompt: 'a coin collecting game: grab 8 coins before time runs out' }));
        check(created['patchesApplied'] > 20 && created['errors'].length === 0, `create_world: ${JSON.stringify(created).slice(0, 400)}`);
        log(`create_world: ${created['patchesApplied']} patches via ${created['provider']}`);
        const coins = ok(await call('list_entities', { text: 'coin' }));
        check(coins['total'] === 8, `expected 8 coins, saw ${coins['total']}`);
        const verified = ok(await call('verify'));
        check(verified['passed'] === true, `verify failed: ${String(verified['summary']).slice(0, 400)}`);
        log(`verify: pass (${verified['tests'].length} tests, ${verified['simulatedSeconds']} s simulated in ${verified['ms']} ms)`);
        const played = ok(await call('playtest', { seconds: 90 }));
        check(played['outcome'] === 'win', `playtest: ${JSON.stringify(played).slice(0, 500)}`);
        log(`playtest: ${played['outcome']} in ${played['seconds']} s, state ${JSON.stringify(played['state'])}`);
        const gltf = ok(await call('export', { format: 'gltf', name: 'coin-game' }));
        const glbPath = join(project, 'exports/coin-game.glb');
        check(existsSync(glbPath) && readFileSync(glbPath).subarray(0, 4).toString('ascii') === 'glTF', 'the glb was not written');
        log(`export gltf: ${JSON.stringify(gltf['files'])}`);
        const built = ok(await call('export', { format: 'build', name: 'coin-game' }));
        const zip = readFileSync(join(project, 'exports/coin-game-web.zip'));
        const unzipped = await readZip(new Uint8Array(zip));
        check(unzipped.ok, 'the build zip is not readable');
        if (unzipped.ok) {
            const files = unzipped.entries.map((e) => e.name);
            for (const f of ['index.html', 'game.json', 'manifest.webmanifest', 'cover.png', 'README.md'])
                check(files.includes(f), `build is missing ${f}`);
            const game = JSON.parse(new TextDecoder().decode(unzipped.entries.find((e) => e.name === 'game.json')?.data));
            check(Object.keys(game.world?.entities ?? {}).length > 8, 'game.json does not carry the world');
            log(`export build: ${files.length} files (${JSON.stringify(built['notes'])})`);
        }
        const project2 = ok(await call('export', { format: 'project' }));
        check(project2['files'][0]?.path.endsWith('.aether.json') === true, 'project export path');
        const still = await call('render_still', { width: 640, height: 360, name: 'coin-game' });
        ok(still);
        check(still.content.some((c) => c.type === 'image' && c.mimeType === 'image/png'), 'render_still returned no inline image');
        check(readFileSync(join(project, 'renders/coin-game.png')).subarray(1, 4).toString('ascii') === 'PNG', 'png on disk');
        // Drop a ball on the ground by patch and replay the physics: it must fall and bounce to rest.
        ok(await call('apply_patch', { patches: [{ op: 'add', entity: { id: 'drop-ball', shape: { kind: 'primitive', primitive: 'sphere', size: [0.6, 0.6, 0.6] }, transform: { position: [0, 6, 0] }, physics: { body: 'dynamic', restitution: 0.3 } } }], message: 'drop a ball' }));
        const replay = ok(await call('replay'));
        const ball = replay['bodies'].find((b) => b.id === 'drop-ball');
        check(ball !== undefined && ball.end[1] < ball.start[1] - 4, `the ball did not fall: ${JSON.stringify(replay).slice(0, 300)}`);
        check(existsSync(join(project, 'replays/replay.json')), 'replay file missing');
        const mid = await call('render_still', { width: 320, height: 180, at: 0.5, name: 'mid-fall' });
        ok(mid);
        ok(await call('undo'));
        // Safety: refusals are plain text, with no paths or stack traces.
        const bad = await call('get_entity', { id: '../../etc/passwd' });
        check(bad.isError === true && !/\/home|\/tmp|node_modules|at .*:\d+:\d+/.test(bad.content[0]?.text ?? ''), 'unsafe error text');
        const traversal = ok(await call('export', { format: 'project', name: '../../../../tmp/evil' }));
        check(traversal['files'][0]?.path === 'exports/evil.aether.json', 'export name was not sanitized');
        // One undo takes the whole game back.
        ok(await call('undo'));
        const after = ok(await call('get_world_summary'));
        check(after['entities'] < 5, `undo left ${after['entities']} entities`);
        const entries = readdirSync(project).sort();
        check(entries.every((n) => ['.aether', 'exports', 'renders', 'replays'].includes(n)), `unexpected project folder content: ${entries.join(', ')}`);
        check(!existsSync('/tmp/evil.aether.json'), 'something was written outside the project folder');
        log('all checks passed');
    }
    finally {
        await client.close().catch(() => undefined);
        rmSync(root, { recursive: true, force: true });
        if (stderr.length > 0 && process.env['AETHER_E2E_VERBOSE'])
            process.stderr.write(stderr.join(''));
    }
}
main().then(() => process.exit(0), (e) => {
    process.stderr.write(`FAILED: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    process.exit(1);
});
