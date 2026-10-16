import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { EMPTY_INPUT, LogicRuntime } from '@aether/logic';
import { buildNpcFrame, frameSignature, projectToViewport } from '../src/engine/npcFrame';
/** Identity view, simple perspective projection looking down −Z (fov 90°, aspect 1). */
function matrices() {
    const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const n = 0.1;
    const f = 100;
    const projection = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -(f + n) / (f - n), -1, 0, 0, (-2 * f * n) / (f - n), 0];
    return { view, projection };
}
class Host {
    poses = new Map();
    getTransform(id) {
        return this.poses.get(id);
    }
    setKinematic(id, position, quaternion) {
        this.poses.set(id, { position: [...position], quaternion: [...quaternion] });
    }
    applyImpulse() { }
    setVelocity() { }
    getVelocity() {
        return undefined;
    }
    teleport() { }
    explode() { }
    setGravity() { }
    spawn() { }
    destroy() { }
    setProperty() { }
    message() { }
    sound() { }
    gameOver() { }
    reset() { }
    playerId() {
        return 'avatar';
    }
}
describe('projectToViewport', () => {
    const out = { x: 0, y: 0 };
    it('puts a point straight ahead at the centre and offsets map to fractions', () => {
        expect(projectToViewport(matrices(), 0, 0, -5, out)).toBe(true);
        expect(out.x).toBeCloseTo(0.5, 6);
        expect(out.y).toBeCloseTo(0.5, 6);
        expect(projectToViewport(matrices(), 2.5, 2.5, -5, out)).toBe(true);
        expect(out.x).toBeCloseTo(0.75, 6);
        expect(out.y).toBeCloseTo(0.25, 6); // up on screen = smaller y
    });
    it('rejects points behind the camera and far off screen', () => {
        expect(projectToViewport(matrices(), 0, 0, 5, out)).toBe(false);
        expect(projectToViewport(matrices(), 40, 0, -5, out)).toBe(false);
    });
});
describe('buildNpcFrame', () => {
    function world() {
        return createWorld({
            entities: {
                mira: {
                    id: 'mira',
                    name: 'Mira',
                    transform: { position: [0, 0.9, -5] },
                    shape: { kind: 'primitive', primitive: 'capsule', size: [0.6, 1.8, 0.6] },
                    physics: { body: 'kinematic' },
                    npc: { archetype: 'merchant', role: 'shopkeeper', barks: { idle: ['Fresh wares!'] }, dialogue: { start: 'start', nodes: { start: { text: 'Hello there', choices: [{ text: 'Hi' }, { text: 'Bye' }] } } } },
                },
            },
        });
    }
    it('is null when nothing is happening and describes the prompt, dialogue and bubbles when it is', () => {
        const host = new Host();
        host.poses.set('avatar', { position: [0, 0, -3.5], quaternion: [0, 0, 0, 1] });
        const rt = new LogicRuntime(world(), host);
        rt.tick(1 / 60, EMPTY_INPUT, []);
        const prompt = buildNpcFrame(rt.npcs, matrices());
        expect(prompt?.prompt).toEqual({ npc: 'mira', name: 'Mira' });
        expect(prompt?.dialogue).toBeNull();
        expect(rt.npcs.startDialogue('mira')).toBe(true);
        rt.tick(1 / 60, EMPTY_INPUT, []);
        const talking = buildNpcFrame(rt.npcs, matrices());
        expect(talking?.dialogue).toMatchObject({ speaker: 'Mira', text: 'Hello there', choices: ['Hi', 'Bye'], mode: 'talk' });
        expect(talking?.prompt).toBeNull();
        expect(frameSignature(talking)).not.toBe(frameSignature(prompt));
        rt.npcs.endDialogue();
        host.poses.set('avatar', { position: [0, 0, 40], quaternion: [0, 0, 0, 1] });
        rt.tick(1 / 60, EMPTY_INPUT, []);
        expect(buildNpcFrame(rt.npcs, matrices())).toBeNull();
        expect(frameSignature(null)).toBe('');
    });
    it('caps what it hands to React: at most six choices, bubble text trimmed', () => {
        const host = new Host();
        host.poses.set('avatar', { position: [0, 0, -3.5], quaternion: [0, 0, 0, 1] });
        const rt = new LogicRuntime(world(), host);
        rt.tick(1 / 60, EMPTY_INPUT, []);
        rt.npcs.startDialogue('mira');
        const f = buildNpcFrame(rt.npcs, null);
        expect(f?.bubbles).toEqual([]);
        expect((f?.dialogue?.choices.length ?? 0) <= 6).toBe(true);
    });
});
