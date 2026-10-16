import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../src/config';
import { HISTORY_ENTRIES, MAX_RECOVERIES } from '../src/lib/memory';
import { Simulation } from '../src/engine/Simulation';
import { Studio } from '../src/engine/Studio';
function memoryStorage(settings) {
    const m = new Map();
    if (settings !== undefined)
        m.set(STORAGE_KEYS.settings, JSON.stringify(settings));
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}
/** A stand-in simulation recording what the studio asks of it. */
function fakeSimulation() {
    const lowMemory = [];
    let disposed = false;
    const sim = {
        backend: 'webgl2',
        mode: 'edit',
        renderer: {
            gpu: { tier: 'integrated', description: 'Test GPU' },
            showJoint: () => undefined,
            showMeshComponents: () => true,
            setArchView: () => undefined,
            setRenderQuality: (q) => q,
            studioQualityAvailable: true,
            restoreEnvironment: () => undefined,
            setEnvironmentOverride: () => undefined,
            onQualityChange: null,
            showCameraPath: () => undefined,
        },
        stopProof: () => undefined,
        setShowColliders: () => undefined,
        setStatsWhileEditing: () => undefined,
        setPointerLock: () => undefined,
        setSelection: () => undefined,
        setGizmo: () => undefined,
        setGizmoOptions: () => undefined,
        setPickFilter: () => undefined,
        setViewportTool: () => undefined,
        setClickHandler: () => undefined,
        suspendEntityGizmo: () => undefined,
        setLowMemory: (on) => void lowMemory.push(on),
        frameWorld: async () => undefined,
        touch: () => undefined,
        memoryStats: () => null,
        dispose: () => {
            disposed = true;
        },
    };
    return { sim, lowMemory, disposed: () => disposed };
}
const canvas = {};
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
describe('Studio renderer lifecycle', () => {
    it('never creates a renderer for an attach superseded in the same tick (StrictMode remount)', async () => {
        const fake = fakeSimulation();
        const create = vi.spyOn(Simulation, 'create').mockResolvedValue(fake.sim);
        const studio = new Studio({ storage: memoryStorage(), safeMode: false });
        const first = studio.attachCanvas(canvas);
        const second = studio.attachCanvas(canvas);
        await Promise.all([first, second]);
        expect(create).toHaveBeenCalledTimes(1);
        expect(studio.simulation).toBe(fake.sim);
        studio.dispose();
    });
    it('recovers from a lost context with a new renderer epoch, then gives up after repeated losses', async () => {
        let listener = null;
        let options = null;
        vi.spyOn(Simulation, 'create').mockImplementation(async (_c, _h, l, o) => {
            listener = l;
            options = o ?? null;
            return fakeSimulation().sim;
        });
        const studio = new Studio({ storage: memoryStorage(), safeMode: false });
        await studio.attachCanvas(canvas);
        expect(options).toMatchObject({ backend: 'auto', lowMemory: false });
        const lose = (backend) => listener?.onContextLost?.({ backend, message: 'test loss' });
        lose('webgpu');
        await Promise.resolve();
        let st = studio.store.getState();
        expect(st.rendererEpoch).toBe(1);
        expect(st.memory).toMatchObject({ lowMemory: true, automatic: true, reason: 'The graphics context was lost' });
        expect(studio.history.entryLimit).toBe(HISTORY_ENTRIES.low);
        // The replacement renderer after a lost WebGPU device runs on WebGL2, in low-memory mode.
        await studio.attachCanvas(canvas);
        expect(options).toMatchObject({ backend: 'webgl2', lowMemory: true });
        for (let i = 1; i < MAX_RECOVERIES; i++)
            lose('webgl2');
        await Promise.resolve();
        st = studio.store.getState();
        expect(st.rendererEpoch).toBe(MAX_RECOVERIES);
        expect(st.fatal).toBeNull();
        lose('webgl2');
        st = studio.store.getState();
        expect(st.rendererEpoch).toBe(MAX_RECOVERIES);
        expect(st.fatal).toMatch(/keeps resetting/);
        studio.dispose();
    });
});
describe('Studio low-memory mode', () => {
    it('starts in low-memory mode when the setting says so and applies the history cap', () => {
        const studio = new Studio({ storage: memoryStorage({ lowMemory: 'on' }), safeMode: false });
        expect(studio.store.getState().memory).toMatchObject({ lowMemory: true, automatic: false });
        expect(studio.history.entryLimit).toBe(HISTORY_ENTRIES.low);
        studio.dispose();
    });
    it('turns on automatically for a small device and announces it', () => {
        vi.stubGlobal('navigator', { deviceMemory: 2 });
        const studio = new Studio({ storage: memoryStorage(), safeMode: false });
        const st = studio.store.getState();
        expect(st.memory).toMatchObject({ lowMemory: true, automatic: true });
        expect(st.toasts.some((t) => /Low memory mode is on/.test(t.text))).toBe(true);
        studio.dispose();
    });
    it('applies a settings change to the running simulation and the history', async () => {
        const fake = fakeSimulation();
        vi.spyOn(Simulation, 'create').mockResolvedValue(fake.sim);
        const studio = new Studio({ storage: memoryStorage(), safeMode: false });
        await studio.attachCanvas(canvas);
        expect(studio.history.entryLimit).toBe(HISTORY_ENTRIES.normal);
        studio.store.getState().updateSettings({ lowMemory: 'on' });
        expect(fake.lowMemory).toEqual([true]);
        expect(studio.history.entryLimit).toBe(HISTORY_ENTRIES.low);
        expect(studio.memoryReport()).toMatchObject({ historyLimit: HISTORY_ENTRIES.low, memory: { lowMemory: true } });
        studio.store.getState().updateSettings({ lowMemory: 'off' });
        expect(fake.lowMemory).toEqual([true, false]);
        expect(studio.history.entryLimit).toBe(HISTORY_ENTRIES.normal);
        studio.dispose();
        expect(fake.disposed()).toBe(true);
    });
    it('restarts the renderer when the backend setting changes', async () => {
        vi.spyOn(Simulation, 'create').mockResolvedValue(fakeSimulation().sim);
        const studio = new Studio({ storage: memoryStorage(), safeMode: false });
        await studio.attachCanvas(canvas);
        studio.store.getState().updateSettings({ backend: 'webgl2' });
        await Promise.resolve();
        expect(studio.store.getState().rendererEpoch).toBe(1);
        studio.dispose();
    });
});
describe('Studio title card', () => {
    /** A fake simulation that tracks play mode and the hold flag. */
    function playableSim() {
        const base = fakeSimulation().sim;
        const held = [];
        const calls = [];
        const sim = Object.assign(base, {
            mode: 'edit',
            setHeld(on) {
                held.push(on);
            },
            async play() {
                calls.push(`play(held=${String(held[held.length - 1])})`);
                sim.mode = 'play';
            },
            async stop() {
                calls.push('stop');
                sim.mode = 'edit';
            },
            async restart() {
                calls.push('restart');
            },
        });
        return { sim: sim, held, calls };
    }
    it('holds a world with a title card before the first tick and releases it on Start', async () => {
        const fake = playableSim();
        vi.spyOn(Simulation, 'create').mockResolvedValue(fake.sim);
        const studio = new Studio({ storage: memoryStorage(), safeMode: false });
        await studio.attachCanvas(canvas);
        studio.commitUser([{ op: 'setMeta', intro: { title: 'Lantern Isles', tagline: 'Light the way', controls: ['WASD — move'] } }], 'intro');
        await studio.togglePlay();
        expect(fake.calls).toEqual(['play(held=true)']);
        expect(studio.store.getState().game.intro).toBe(true);
        studio.startGame();
        expect(fake.held[fake.held.length - 1]).toBe(false);
        expect(studio.store.getState().game.intro).toBe(false);
        // Restart never shows the card again; stopping releases any hold.
        await studio.restart();
        expect(studio.store.getState().game.intro).toBe(false);
        await studio.togglePlay();
        expect(fake.calls.at(-1)).toBe('stop');
        expect(fake.held[fake.held.length - 1]).toBe(false);
        studio.dispose();
    });
    it('never holds a world without a title card', async () => {
        const fake = playableSim();
        vi.spyOn(Simulation, 'create').mockResolvedValue(fake.sim);
        const studio = new Studio({ storage: memoryStorage(), safeMode: false });
        await studio.attachCanvas(canvas);
        await studio.togglePlay();
        expect(fake.calls).toEqual(['play(held=false)']);
        expect(studio.store.getState().game.intro).toBe(false);
        studio.dispose();
    });
});
