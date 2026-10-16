import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { STORAGE_KEYS } from '../src/config';
import { DEFAULT_SETTINGS, loadChat, loadSettings, loadWorld, readJson, saveChat, saveSettings, saveWorld, writeJson } from '../src/lib/storage';
class MemoryStorage {
    map = new Map();
    getItem(k) {
        return this.map.get(k) ?? null;
    }
    setItem(k, v) {
        this.map.set(k, v);
    }
    removeItem(k) {
        this.map.delete(k);
    }
}
const throwing = {
    getItem: () => {
        throw new Error('blocked');
    },
    setItem: () => {
        throw new Error('quota');
    },
    removeItem: () => {
        throw new Error('blocked');
    },
};
describe('storage', () => {
    it('round-trips a valid world', () => {
        const s = new MemoryStorage();
        const w = createWorld({ name: 'Saved' });
        expect(saveWorld(s, w)).toBe(true);
        expect(loadWorld(s)).toEqual(w);
    });
    it('rejects tampered or corrupt worlds', () => {
        const s = new MemoryStorage();
        s.setItem(STORAGE_KEYS.world, '{"entities":{"X":{}}}');
        expect(loadWorld(s)).toBeNull();
        s.setItem(STORAGE_KEYS.world, '{"__proto__":{"a":1}}');
        expect(loadWorld(s)).toBeNull();
        s.setItem(STORAGE_KEYS.world, 'not json');
        expect(loadWorld(s)).toBeNull();
    });
    it('survives storage that throws', () => {
        expect(loadWorld(throwing)).toBeNull();
        expect(saveWorld(throwing, createWorld())).toBe(false);
        expect(loadChat(throwing)).toEqual([]);
        expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
        expect(readJson(null, 'x')).toBeNull();
        expect(writeJson(null, 'x', 1)).toBe(false);
    });
    it('keeps only known boolean settings', () => {
        const s = new MemoryStorage();
        s.setItem(STORAGE_KEYS.settings, JSON.stringify({ showPerf: false, shadows: 'yes', evil: true }));
        const settings = loadSettings(s);
        expect(settings.showPerf).toBe(false);
        expect(settings.shadows).toBe(true);
        expect('evil' in settings).toBe(false);
        saveSettings(s, settings);
        expect(loadSettings(s)).toEqual(settings);
    });
    it('round-trips chat through revive', () => {
        const s = new MemoryStorage();
        saveChat(s, [{ id: 1, role: 'user', text: 'hi' }]);
        expect(loadChat(s)).toEqual([{ id: 1, role: 'user', text: 'hi' }]);
    });
});
describe('settings: backend and low-memory preferences', () => {
    function mem() {
        const m = new Map();
        return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
    }
    it('defaults to automatic backend and low-memory detection', () => {
        expect(DEFAULT_SETTINGS.backend).toBe('auto');
        expect(DEFAULT_SETTINGS.lowMemory).toBe('auto');
        expect(loadSettings(mem())).toEqual(DEFAULT_SETTINGS);
    });
    it('round-trips valid values and rejects unknown ones', () => {
        const s = mem();
        saveSettings(s, { ...DEFAULT_SETTINGS, backend: 'webgl2', lowMemory: 'on' });
        expect(loadSettings(s)).toMatchObject({ backend: 'webgl2', lowMemory: 'on' });
        s.setItem(STORAGE_KEYS.settings, JSON.stringify({ backend: 'vulkan', lowMemory: true }));
        expect(loadSettings(s)).toMatchObject({ backend: 'auto', lowMemory: 'auto' });
        s.setItem(STORAGE_KEYS.settings, JSON.stringify({ backend: { toString: 'webgpu' }, lowMemory: ['on'] }));
        expect(loadSettings(s)).toMatchObject({ backend: 'auto', lowMemory: 'auto' });
    });
    it('migrates the old preferWebGPU and lowPower flags', () => {
        const s = mem();
        s.setItem(STORAGE_KEYS.settings, JSON.stringify({ preferWebGPU: false, lowPower: true }));
        const settings = loadSettings(s);
        expect(settings).toMatchObject({ backend: 'webgl2', lowMemory: 'on' });
        expect('preferWebGPU' in settings).toBe(false);
        expect('lowPower' in settings).toBe(false);
        s.setItem(STORAGE_KEYS.settings, JSON.stringify({ preferWebGPU: true, lowPower: false }));
        expect(loadSettings(s)).toMatchObject({ backend: 'auto', lowMemory: 'auto' });
        // New fields win over the old flags.
        s.setItem(STORAGE_KEYS.settings, JSON.stringify({ preferWebGPU: false, backend: 'webgpu', lowPower: true, lowMemory: 'off' }));
        expect(loadSettings(s)).toMatchObject({ backend: 'webgpu', lowMemory: 'off' });
    });
    it('ignores a prototype-polluting settings object', () => {
        const s = mem();
        s.setItem(STORAGE_KEYS.settings, '{"__proto__":{"backend":"webgpu","lowMemory":"on"}}');
        expect(loadSettings(s)).toMatchObject({ backend: 'auto', lowMemory: 'auto' });
        expect({}['backend']).toBeUndefined();
    });
});
