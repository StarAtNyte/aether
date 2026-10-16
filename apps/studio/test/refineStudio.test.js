import { describe, expect, it } from 'vitest';
import { AiConnection } from '../src/ai/connection';
import { Studio } from '../src/engine/Studio';
import { isPristineStarter } from '../src/lib/starterWorld';
function mem() {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}
function newStudio() {
    const ai = new AiConnection({ fetch: (async () => { throw new TypeError('offline'); }), session: mem() });
    return new Studio({ storage: mem(), safeMode: false, ai });
}
function lastEvents(studio) {
    const chat = studio.store.getState().chat;
    const entry = chat[chat.length - 1];
    return entry?.role === 'assistant' ? entry.events : [];
}
describe('refining by prompt in the studio', () => {
    it('the first prompt replaces the default glade; the next ones refine what it built', async () => {
        const studio = newStudio();
        expect(isPristineStarter(studio.history.current)).toBe(true);
        await studio.send('A cozy lakeside camp at sunset with a campfire, tents and fireflies');
        expect(isPristineStarter(studio.history.current)).toBe(false);
        const built = Object.keys(studio.history.current.entities);
        expect(built).toContain('tent-1');
        expect(built).not.toContain('gem-1');
        await studio.send('make the first tent red');
        const events = lastEvents(studio);
        expect(events.map((e) => e.type)).toContain('edit');
        expect(events.map((e) => e.type)).not.toContain('quality');
        // Nothing else was rebuilt.
        expect(Object.keys(studio.history.current.entities).sort()).toEqual([...built].sort());
        studio.dispose();
    }, 60_000);
    it('a described scene in an existing world does not replace it', async () => {
        const studio = newStudio();
        await studio.send('A cozy lakeside camp at sunset with a campfire, tents and fireflies');
        await studio.send('a haunted forest at night with fog');
        expect(Object.keys(studio.history.current.entities)).toContain('tent-1');
        studio.dispose();
    }, 60_000);
    it('asks which one, then answers the question with the chosen object', async () => {
        const studio = newStudio();
        await studio.send('A cozy lakeside camp at sunset with a campfire, tents and fireflies');
        const before = studio.history.current;
        await studio.send('make the tent green');
        expect(studio.history.current).toBe(before);
        const q = studio.store.getState().clarify;
        expect(q?.items.length).toBeGreaterThanOrEqual(2);
        expect(lastEvents(studio).map((e) => e.type)).toContain('clarify');
        studio.answerClarify('tent-2');
        await new Promise((r) => setTimeout(r, 50));
        while (studio.store.getState().agentBusy)
            await new Promise((r) => setTimeout(r, 20));
        expect(studio.store.getState().clarify).toBeNull();
        const t2 = studio.history.current.entities['tent-2'];
        const t1 = studio.history.current.entities['tent-1'];
        expect(t2.shape.kind === 'procedural' && t2.shape.params['color']).not.toBe(before.entities['tent-2'].shape.kind === 'procedural' ? before.entities['tent-2'].shape.params['color'] : undefined);
        expect(t1).toBe(before.entities['tent-1']);
        studio.dispose();
    }, 60_000);
    it('"undo that" steps the history back', async () => {
        const studio = newStudio();
        await studio.send('A cozy lakeside camp at sunset with a campfire, tents and fireflies');
        const built = studio.history.current;
        await studio.send('make the campfire bigger');
        expect(studio.history.current).not.toBe(built);
        await studio.send('undo that');
        expect(studio.history.current).toBe(built);
        studio.dispose();
    }, 60_000);
    it('uses the viewport selection for "this"', async () => {
        const studio = newStudio();
        await studio.send('A cozy lakeside camp at sunset with a campfire, tents and fireflies');
        studio.store.getState().select(['tent-2']);
        await studio.send('make this red');
        const events = lastEvents(studio).find((e) => e.type === 'edit');
        expect(events).toBeDefined();
        expect(Object.keys(studio.history.current.entities)).toContain('tent-2');
        studio.dispose();
    }, 60_000);
});
