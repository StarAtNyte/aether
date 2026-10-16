import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import * as bot from '@aether/playtest';
import { createPlaytestHandler } from '../src/engine/playtest/handler';
import { parsePlaytestReply, parsePlaytestRequest } from '../src/engine/playtest/protocol';
import { PlaytestClient } from '../src/engine/playtest/client';
function coinGame() {
    const entities = {};
    for (const [i, x] of [3, -3, 0].entries()) {
        entities[`coin-${i}`] = {
            id: `coin-${i}`,
            shape: { kind: 'primitive', primitive: 'sphere', size: [0.5, 0.5, 0.5] },
            transform: { position: [x, 1, i === 2 ? 4 : 0] },
            behaviors: [{ type: 'collectible', params: { scoreKey: 'score', value: 1 } }],
        };
    }
    return createWorld({
        entities,
        state: { score: 0 },
        player: { mode: 'thirdPerson', spawn: [0, 0.5, 0], moveSpeed: 6, jumpSpeed: 6 },
        rules: [{ id: 'win', when: { on: 'state', key: 'score', op: '>=', value: 3 }, then: [{ do: 'win', text: 'done' }], once: true }],
    });
}
const OPTIONS = { maxSimSeconds: 60, budgetMs: 20_000, trace: true };
function harness() {
    const replies = [];
    const handler = createPlaytestHandler({ bot: async () => bot, post: (r) => replies.push(r) });
    return { handler, replies };
}
/** A worker that runs the real handler in-process. */
function inProcessWorker() {
    const handler = createPlaytestHandler({ bot: async () => bot, post: (r) => w.onmessage?.({ data: structuredClone(r) }) });
    const w = {
        onmessage: null,
        onerror: null,
        postMessage: (m) => void handler.handle(structuredClone(m)),
        terminate: () => undefined,
    };
    queueMicrotask(() => w.onmessage?.({ data: { type: 'ready' } }));
    return w;
}
describe('playtest worker protocol (pure handler)', () => {
    it('plays a world: progress messages, then exactly one done reply with a trace', async () => {
        const { handler, replies } = harness();
        await handler.handle({ type: 'run', id: 3, kind: 'game', world: coinGame(), options: OPTIONS });
        const terminal = replies.filter((r) => r.type !== 'progress');
        expect(terminal).toHaveLength(1);
        const done = terminal[0];
        expect(done?.type).toBe('done');
        if (done?.type !== 'done')
            return;
        expect(done.report.status).toBe('passed');
        expect(done.report.trace?.frames).toBeGreaterThan(3);
        expect(replies.some((r) => r.type === 'progress')).toBe(true);
        expect(handler.running).toBe(0);
    }, 60_000);
    it('rejects an invalid world and a malformed request without throwing', async () => {
        const { handler, replies } = harness();
        await handler.handle({ type: 'run', id: 4, kind: 'game', world: { entities: 5 }, options: OPTIONS });
        await handler.handle({ type: 'run', id: 5, kind: 'nonsense', world: {}, options: OPTIONS });
        await handler.handle('garbage');
        const failed = replies.filter((r) => r.type === 'failed');
        expect(failed).toHaveLength(2);
        expect(failed[0]?.type === 'failed' && failed[0].error).toMatch(/invalid world/);
    });
    it('cancels a running request', async () => {
        const { handler, replies } = harness();
        const run = handler.handle({ type: 'run', id: 9, kind: 'game', world: coinGame(), options: OPTIONS });
        await handler.handle({ type: 'cancel', id: 9 });
        await run;
        const last = replies[replies.length - 1];
        expect(last?.type).toBe('failed');
        expect(last?.type === 'failed' && last.cancelled).toBe(true);
    }, 60_000);
    it('validates requests and replies strictly', () => {
        expect(parsePlaytestRequest({ type: 'run', id: 1, kind: 'game', world: {}, options: { ...OPTIONS, extra: 1 } })).toBeNull();
        expect(parsePlaytestRequest({ type: 'run', id: 1, kind: 'game', world: {}, options: { ...OPTIONS, budgetMs: 1e9 } })).toBeNull();
        expect(parsePlaytestRequest({ type: 'cancel', id: 2 })).not.toBeNull();
        expect(parsePlaytestReply({ type: 'done', id: 1, report: { v: 1 } })).toBeNull();
        expect(parsePlaytestReply({ type: 'progress', id: 1, progress: { phase: 'play', fraction: 2, seconds: 0, note: '' } })).toBeNull();
    });
});
describe('playtest client', () => {
    it('runs through a worker and streams progress', async () => {
        const client = new PlaytestClient({ createWorker: inProcessWorker, idleMs: 0 });
        const phases = [];
        const out = await client.run(coinGame(), { kind: 'game', onProgress: (p) => phases.push(p.phase) });
        expect(out.ok).toBe(true);
        if (!out.ok)
            return;
        expect(out.worker).toBe(true);
        expect(out.report.status).toBe('passed');
        expect(phases.length).toBeGreaterThan(0);
        client.dispose();
    }, 60_000);
    it('falls back to the main thread when no worker can start', async () => {
        const client = new PlaytestClient({ createWorker: null, mainThread: (w, o) => bot.playtest(w, { trace: o.trace !== false }) });
        const out = await client.run(coinGame(), { kind: 'game' });
        expect(out.ok).toBe(true);
        if (out.ok)
            expect(out.worker).toBe(false);
    }, 60_000);
    it('reports cancellation and a missing worker honestly', async () => {
        const none = new PlaytestClient({ createWorker: null });
        const out = await none.run(coinGame(), { kind: 'game' });
        expect(out).toMatchObject({ ok: false, cancelled: false });
        const ctrl = new AbortController();
        ctrl.abort();
        const client = new PlaytestClient({ createWorker: inProcessWorker, idleMs: 0 });
        expect(await client.run(coinGame(), { kind: 'game', signal: ctrl.signal })).toMatchObject({ ok: false, cancelled: true });
        client.dispose();
    });
    it('times out a runaway worker and then reports the failure', async () => {
        const silent = () => {
            const w = { onmessage: null, onerror: null, postMessage: () => undefined, terminate: () => undefined };
            queueMicrotask(() => w.onmessage?.({ data: { type: 'ready' } }));
            return w;
        };
        const client = new PlaytestClient({ createWorker: silent, slackMs: 0, idleMs: 0 });
        const out = await client.run(coinGame(), { kind: 'game', budgetMs: 500 });
        expect(out).toMatchObject({ ok: false, cancelled: false, worker: true });
        expect(out.ok === false && out.error).toMatch(/took longer than/);
        client.dispose();
    }, 20_000);
});
