import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { deadZone, GamepadPoller } from '../src/engine/gamepad';
import { defaultSettings, loadSettings, qualityPlan, saveSettings } from '../src/player/settings';
import { loadGame } from '../src/player/source';
import { encodeShare } from '../src/publish/share';
import { gameJson } from '../src/publish/manifest';
function pad(axes, pressed = []) {
    return { connected: true, mapping: 'standard', axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) };
}
describe('gamepad', () => {
    it('applies a scaled dead zone', () => {
        expect(deadZone(0.1)).toBe(0);
        expect(deadZone(-0.18)).toBe(0);
        expect(deadZone(1)).toBe(1);
        expect(deadZone(-1)).toBe(-1);
        expect(deadZone(0.59)).toBeCloseTo(0.5, 2);
        expect(deadZone(Number.NaN)).toBe(0);
    });
    it('maps sticks, D-pad and buttons (edges only) and stays idle until a pad connects', () => {
        let current = pad([0.5, -1, 0.9, 0], [0]);
        const poller = new GamepadPoller(() => [null, current]);
        expect(poller.poll().active).toBe(false);
        poller.markConnected();
        let s = poller.poll();
        expect(s.active).toBe(true);
        expect(s.forward).toBe(1);
        expect(s.right).toBeGreaterThan(0.3);
        expect(s.lookX).toBeGreaterThan(0.8);
        expect(s.jump).toBe(true);
        s = poller.poll();
        expect(s.jump).toBe(false);
        current = pad([0, 0, 0, 0], [12, 14, 2, 9]);
        s = poller.poll();
        expect([s.forward, s.right, s.action, s.pause]).toEqual([1, -1, true, true]);
        current = null;
        s = poller.poll();
        expect(s.active).toBe(false);
        expect(s.forward).toBe(0);
        poller.dispose();
    });
});
class MemStorage {
    map = new Map();
    getItem(k) {
        return this.map.get(k) ?? null;
    }
    setItem(k, v) {
        this.map.set(k, v);
    }
}
describe('player settings', () => {
    it('persist, clamp bad values to defaults and map quality to renderer options', () => {
        const st = new MemStorage();
        const d = defaultSettings();
        expect(loadSettings(st, d)).toEqual(d);
        saveSettings(st, { ...d, volume: 0.3, quality: 'low' });
        expect(loadSettings(st, d)).toMatchObject({ volume: 0.3, quality: 'low' });
        st.setItem('aether.player.settings.v1', JSON.stringify({ volume: 7, sensitivity: -1, quality: 'ultra', music: 'x' }));
        expect(loadSettings(st, d)).toEqual(d);
        st.setItem('aether.player.settings.v1', '{not json');
        expect(loadSettings(st, d)).toEqual(d);
        expect(loadSettings(null, d)).toEqual(d);
        expect(defaultSettings(2).quality).toBe('medium');
        expect(qualityPlan('low')).toEqual({ lowMemory: true, pixelRatioCap: 1 });
        expect(qualityPlan('high').pixelRatioCap).toBe(Number.POSITIVE_INFINITY);
    });
});
describe('player sources', () => {
    const world = createWorld({ name: 'Arena', entities: { a: { id: 'a', shape: { kind: 'primitive', primitive: 'box' } } } });
    it('plays a share link from the fragment without fetching anything', async () => {
        const enc = await encodeShare(world, { title: 'Arena!', music: 'playful' });
        let fetched = 0;
        const r = await loadGame(`#w=${enc.value}`, async () => {
            fetched++;
            return new Response('{}');
        });
        expect(fetched).toBe(0);
        expect(r.kind).toBe('game');
        if (r.kind === 'game') {
            expect(r.from).toBe('link');
            expect(r.game.title).toBe('Arena!');
            expect(r.game.music).toBe('playful');
            expect(r.game.controls.length).toBeGreaterThan(5);
        }
    });
    it('reads game.json next to a build, and treats an HTML fallback page as "nothing here"', async () => {
        const json = gameJson({ title: 'Arena', description: '', author: '', controls: '', music: null, world });
        const ok = await loadGame('', async () => new Response(json, { headers: { 'content-type': 'application/json' } }));
        expect(ok.kind === 'game' && ok.from === 'build').toBe(true);
        const html = await loadGame('', async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }));
        expect(html.kind).toBe('none');
        const missing = await loadGame('', async () => new Response('', { status: 404 }));
        expect(missing.kind).toBe('none');
        const broken = await loadGame('', async () => new Response('{"format":"aether-game"', { headers: { 'content-type': 'application/json' } }));
        expect(broken.kind).toBe('error');
        const bad = await loadGame('#w=Xabc', async () => new Response(''));
        expect(bad.kind).toBe('error');
        // The studio's own /play route has no game.json: nothing is fetched there.
        let fetched = 0;
        const route = await loadGame('', async () => (fetched++, new Response(json, { headers: { 'content-type': 'application/json' } })), '/play');
        expect(route.kind).toBe('none');
        expect(fetched).toBe(0);
    });
});
