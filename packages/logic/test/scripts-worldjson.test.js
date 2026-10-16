import { describe, expect, it } from 'vitest';
import { EMPTY_INPUT, LogicRuntime } from '../src';
import { serializeSnapshot } from '../src/scripting/runner';
import { FakeHost, worldOf } from './helpers';
const def = (id) => ({ id, description: 'test', source: 'return [];' });
/** Records what the runtime hands to the runner; scripts named 'scorer' add to the score. */
class RecordingRunner {
    calls = [];
    load() { }
    update(scriptId, entityId, snap, prepared) {
        this.calls.push({ script: scriptId, entity: entityId, worldJson: prepared?.worldJson, world: JSON.stringify(snap.world) });
        return scriptId === 'scorer' ? [{ do: 'add', key: 'score', amount: 1 }] : [];
    }
    dispose() { }
}
describe('script snapshots: world state serialized once per tick', () => {
    it('serializeSnapshot splices the prepared world JSON and equals a full serialization', () => {
        const snap = {
            dt: 1 / 60,
            time: 2,
            self: { id: 'e', position: [1, 2, 3], velocity: [0, 0, 0], state: { hp: 3 } },
            world: { score: 4, flags: { open: true }, list: [1, 'a', null] },
            nearby: [{ id: 'n', tags: ['t'], position: [0, 0, 1] }],
            input: { forward: 1, right: 0, jump: false, action: true },
            player: { position: [0, 1, 0] },
        };
        const spliced = serializeSnapshot(snap, JSON.stringify(snap.world));
        expect(JSON.parse(spliced)).toEqual(JSON.parse(JSON.stringify(snap)));
        expect(serializeSnapshot(snap)).toBe(JSON.stringify(snap));
        expect(serializeSnapshot(snap, '')).toBe(JSON.stringify(snap));
    });
    it('passes the same world JSON to every script call of a tick until state changes', () => {
        const runner = new RecordingRunner();
        const w = worldOf([
            { id: 'a', behaviors: [{ type: 'script', params: { script: 'watcher' } }] },
            { id: 'b', behaviors: [{ type: 'script', params: { script: 'watcher' } }] },
            { id: 'c', behaviors: [{ type: 'script', params: { script: 'scorer' } }] },
            { id: 'd', behaviors: [{ type: 'script', params: { script: 'watcher' } }] },
        ], [], { state: { score: 0 }, scripts: { watcher: def('watcher'), scorer: def('scorer') } });
        const rt = new LogicRuntime(w, new FakeHost(), { scripts: runner });
        rt.tick(1 / 60, EMPTY_INPUT, []);
        const first = runner.calls.slice();
        expect(first.map((c) => c.entity)).toEqual(['a', 'b', 'c', 'd']);
        // Every call got exactly the serialization of the world state it saw…
        for (const c of first)
            expect(c.worldJson).toBe(c.world);
        // …and calls before the scorer share one string instance (serialized once).
        expect(first[0]?.worldJson).toBe(first[1]?.worldJson);
        expect(first[1]?.worldJson).toBe(first[2]?.worldJson);
        // The scorer's write invalidates it, so 'd' sees the new score.
        expect(JSON.parse(first[3]?.worldJson ?? '{}')).toEqual({ score: 1 });
        runner.calls.length = 0;
        rt.tick(1 / 60, EMPTY_INPUT, []);
        expect(JSON.parse(runner.calls[0]?.worldJson ?? '{}')).toEqual({ score: 1 });
        expect(JSON.parse(runner.calls[3]?.worldJson ?? '{}')).toEqual({ score: 2 });
        rt.dispose();
    });
});
