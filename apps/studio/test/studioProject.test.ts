import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorldDoc } from '@aether/core';
import { PERSIST_DEBOUNCE_MS, STORAGE_KEYS } from '../src/config';
import type { ChatEntry } from '../src/lib/chat';
import { createStarterWorld } from '../src/lib/starterWorld';
import { DEFAULT_SETTINGS, loadSettings, MAX_REPAIRS_SETTING, type StorageLike } from '../src/lib/storage';
import { createAppStore } from '../src/app/appStore';
import { Simulation } from '../src/engine/Simulation';
import { Studio } from '../src/engine/Studio';

function memoryStorage(entries: Record<string, unknown> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)]));
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

/** A stand-in simulation for placement and thumbnails. */
function fakeSim(thumb: string | null): Simulation {
  return {
    backend: 'webgl2',
    mode: 'edit',
    renderer: { gpu: { tier: 'integrated', description: 'Test GPU' } },
    setShowColliders: () => undefined,
    setStatsWhileEditing: () => undefined,
    setPointerLock: () => undefined,
    setSelection: () => undefined,
    setGizmo: () => undefined,
    setLowMemory: () => undefined,
    frameWorld: async () => undefined,
    revealEntities: async () => undefined,
    placementPoint: () => [3, 0, -2],
    thumbnail: async () => thumb,
    viewPreset: vi.fn(),
    touch: () => undefined,
    memoryStats: () => null,
    dispose: () => undefined,
  } as unknown as Simulation;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Studio in project mode', () => {
  it('opens the project world and chat, and autosaves through onSave (not localStorage)', async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const saves: Array<{ world: WorldDoc; chat: readonly ChatEntry[] }> = [];
    const chat: ChatEntry[] = [{ id: 1, role: 'user', text: 'hi' }];
    const studio = new Studio({ storage, safeMode: false, project: { world: { ...createStarterWorld(), name: 'Mine' }, chat }, onSave: async (world, c) => (saves.push({ world, chat: c }), null) });
    expect(studio.history.current.name).toBe('Mine');
    expect(studio.store.getState().chat).toHaveLength(1);
    expect(studio.store.getState().save.status).toBe('saved');
    studio.renameWorld('Renamed');
    expect(studio.store.getState().save.status).toBe('unsaved');
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS + 10);
    expect(saves).toHaveLength(1);
    expect(saves[0]?.world.name).toBe('Renamed');
    expect(studio.store.getState().save.status).toBe('saved');
    expect(storage.map.has(STORAGE_KEYS.world)).toBe(false);
    studio.dispose();
  });

  it('reports a failed save and flushes pending edits on dispose', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const studio = new Studio({ storage: memoryStorage(), safeMode: false, project: { world: createStarterWorld(), chat: [] }, onSave: async () => (++calls === 1 ? 'Browser storage is full.' : null) });
    studio.renameWorld('One');
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS + 10);
    expect(studio.store.getState().save).toEqual({ status: 'error', error: 'Browser storage is full.' });
    studio.renameWorld('Two');
    studio.dispose();
    await vi.runAllTimersAsync();
    expect(calls).toBe(2);
  });

  it('serializes overlapping saves and only reports "saved" when nothing is pending', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    let release: (() => void) | null = null;
    const studio = new Studio({
      storage: memoryStorage(),
      safeMode: false,
      project: { world: createStarterWorld(), chat: [] },
      onSave: (world) =>
        new Promise((ok) => {
          order.push(world.name);
          release = () => ok(null);
        }),
    });
    studio.renameWorld('A');
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS + 10);
    expect(studio.store.getState().save.status).toBe('saving');
    studio.renameWorld('B');
    const flushed = studio.flush();
    (release as (() => void) | null)?.();
    await vi.advanceTimersByTimeAsync(1);
    (release as (() => void) | null)?.();
    await flushed;
    expect(order).toEqual(['A', 'B']);
    expect(studio.store.getState().save.status).toBe('saved');
    studio.dispose();
  });

  it('keeps the legacy localStorage persistence without a project', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const studio = new Studio({ storage, safeMode: false });
    studio.renameWorld('Legacy');
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS + 10);
    expect(JSON.parse(storage.map.get(STORAGE_KEYS.world) ?? '{}')).toMatchObject({ name: 'Legacy' });
    studio.dispose();
  });

  it('places palette items at the focus point as one undoable edit and selects them', async () => {
    vi.spyOn(Simulation, 'create').mockResolvedValue(fakeSim(null));
    const studio = new Studio({ storage: memoryStorage(), safeMode: false, project: { world: createStarterWorld(), chat: [] }, onSave: async () => null });
    await studio.attachCanvas({} as HTMLCanvasElement);
    const before = Object.keys(studio.history.current.entities).length;
    const id = studio.addFromPalette('crate');
    expect(id).toBe('crate');
    expect(studio.history.current.entities['crate']?.transform.position).toEqual([3, 0, -2]);
    expect(studio.store.getState().selection).toEqual(['crate']);
    const second = studio.addFromPalette('crate');
    expect(second).toMatch(/^crate-\d+$/);
    expect(Object.keys(studio.history.current.entities)).toHaveLength(before + 2);
    studio.undo();
    studio.undo();
    expect(Object.keys(studio.history.current.entities)).toHaveLength(before);
    expect(studio.addFromPalette('not-a-thing')).toBeNull();
    studio.dispose();
  });

  it('captures thumbnails within budget and refuses oversize ones', async () => {
    vi.spyOn(Simulation, 'create').mockResolvedValue(fakeSim('data:image/webp;base64,AAECAwQF'));
    const studio = new Studio({ storage: memoryStorage(), safeMode: false });
    expect(await studio.captureThumbnail()).toBeNull();
    await studio.attachCanvas({} as HTMLCanvasElement);
    const blob = await studio.captureThumbnail();
    expect(blob?.type).toBe('image/webp');
    expect(blob?.size).toBe(6);
    studio.dispose();
  });

  it('commits a gizmo drag as one undoable edit and ignores no-op drags', () => {
    const studio = new Studio({ storage: memoryStorage(), safeMode: false });
    const id = Object.keys(studio.history.current.entities).find((k) => studio.history.current.entities[k]?.parent === null) ?? '';
    const e = studio.history.current.entities[id];
    if (!e) throw new Error('no entity');
    const head = studio.history.head;
    studio.applyGizmoTransform(id, { position: [...e.transform.position], rotation: [...e.transform.rotation], scale: [...e.transform.scale], mode: 'translate' });
    expect(studio.history.head).toBe(head);
    studio.applyGizmoTransform(id, { position: [9, 1, -4], rotation: [...e.transform.rotation], scale: [...e.transform.scale], mode: 'translate' });
    expect(studio.history.current.entities[id]?.transform.position).toEqual([9, 1, -4]);
    expect(studio.history.entries().at(-1)?.message).toMatch(/^Move /);
    studio.undo();
    expect(studio.history.current.entities[id]?.transform.position).toEqual(e.transform.position);
    studio.applyGizmoTransform('missing', { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], mode: 'scale' });
    studio.dispose();
  });

  it('forwards camera presets to the simulation (reset re-frames)', async () => {
    const sim = fakeSim(null);
    const frame = vi.spyOn(sim, 'frameWorld');
    vi.spyOn(Simulation, 'create').mockResolvedValue(sim);
    const studio = new Studio({ storage: memoryStorage(), safeMode: false });
    await studio.attachCanvas({} as HTMLCanvasElement);
    frame.mockClear();
    studio.viewPreset('top');
    expect(sim.viewPreset).toHaveBeenCalledWith('top');
    studio.viewPreset('reset');
    expect(frame).toHaveBeenCalledTimes(1);
    studio.dispose();
  });

  it('applies settings changed while the renderer was starting (regression)', async () => {
    let resolve: ((sim: Simulation) => void) | null = null;
    const sim = fakeSim(null);
    const stats: boolean[] = [];
    const colliders: boolean[] = [];
    Object.assign(sim, { setStatsWhileEditing: (on: boolean) => void stats.push(on), setShowColliders: (on: boolean) => void colliders.push(on) });
    const create = vi.spyOn(Simulation, 'create').mockImplementation((_c, _h, _l, opts) => {
      expect(opts?.statsWhileEditing).toBe(false);
      return new Promise((ok) => (resolve = ok));
    });
    const studio = new Studio({ storage: memoryStorage(), safeMode: false });
    const attached = studio.attachCanvas({} as HTMLCanvasElement);
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    // The performance overlay and colliders are switched on before the renderer is ready.
    studio.store.getState().updateSettings({ showPerf: true, showColliders: true });
    (resolve as ((s: Simulation) => void) | null)?.(sim);
    await attached;
    expect(stats.at(-1)).toBe(true);
    expect(colliders.at(-1)).toBe(true);
    studio.dispose();
  });

  it('mirrors settings changes to the app shell', () => {
    const seen: boolean[] = [];
    const studio = new Studio({ storage: memoryStorage(), safeMode: false, onSettings: (s) => seen.push(s.darkTheme) });
    studio.store.getState().updateSettings({ darkTheme: true });
    expect(seen).toEqual([true]);
    studio.dispose();
  });
});

describe('settings', () => {
  it('hides the performance overlay by default and follows the system theme until one is saved', () => {
    expect(DEFAULT_SETTINGS.showPerf).toBe(false);
    expect(loadSettings(memoryStorage(), true).darkTheme).toBe(true);
    expect(loadSettings(memoryStorage({ [STORAGE_KEYS.settings]: { darkTheme: false } }), true).darkTheme).toBe(false);
    expect(loadSettings(null, true).darkTheme).toBe(true);
  });
  it('validates the new fields', () => {
    const s = loadSettings(memoryStorage({ [STORAGE_KEYS.settings]: { repairs: 2.5, showLabels: 'yes', showNavHint: false } }));
    expect(s.repairs).toBe(DEFAULT_SETTINGS.repairs);
    expect(s.showLabels).toBe(false);
    expect(s.showNavHint).toBe(false);
    expect(loadSettings(memoryStorage({ [STORAGE_KEYS.settings]: { repairs: MAX_REPAIRS_SETTING + 1 } })).repairs).toBe(DEFAULT_SETTINGS.repairs);
    expect(loadSettings(memoryStorage({ [STORAGE_KEYS.settings]: { repairs: 0 } })).repairs).toBe(0);
  });
});

describe('app store', () => {
  it('parses the route, persists settings and mirrors without writing', () => {
    const storage = memoryStorage();
    const store = createAppStore({ storage, hash: '#/projects', prefersDark: false });
    expect(store.getState().route).toEqual({ name: 'projects' });
    store.getState().updateSettings({ darkTheme: true });
    expect(JSON.parse(storage.map.get(STORAGE_KEYS.settings) ?? '{}')).toMatchObject({ darkTheme: true });
    storage.map.clear();
    store.getState().mirrorSettings({ ...DEFAULT_SETTINGS, showLabels: true });
    expect(store.getState().settings.showLabels).toBe(true);
    expect(storage.map.size).toBe(0);
  });
  it('caps toasts and keeps actions', () => {
    const store = createAppStore({ storage: null, hash: '' });
    for (let i = 0; i < 10; i++) store.getState().toast(`t${i}`, 'info', 99, { label: 'Undo', run: () => undefined });
    const toasts = store.getState().toasts;
    expect(toasts.length).toBeLessThanOrEqual(4);
    expect(toasts[toasts.length - 1]?.text).toBe('t9');
    expect(toasts[0]?.duration).toBe(30);
    store.getState().dismissToast(toasts[0]?.id ?? -1);
    expect(store.getState().toasts.length).toBe(toasts.length - 1);
  });
});
