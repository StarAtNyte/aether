import { readFileSync } from 'node:fs';
import { createWorld, validateWorld } from '@aether/core';
/** A bundled template world (the exact file the studio ships). */
export function template(slug) {
    const raw = JSON.parse(readFileSync(new URL(`../../../apps/studio/public/templates/worlds/${slug}.json`, import.meta.url), 'utf8'));
    const r = validateWorld(raw.world);
    if (!r.ok)
        throw new Error(`${slug}: invalid template`);
    return r.world;
}
/** A tiny world whose single test cannot pass: a crate that never reaches a far zone. */
export function failingWorld() {
    return createWorld({
        name: 'Never arrives',
        entities: {
            crate: { id: 'crate', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, transform: { position: [0, 1, 0] }, physics: { body: 'dynamic' } },
            goal: { id: 'goal', shape: { kind: 'primitive', primitive: 'box', size: [2, 2, 2] }, transform: { position: [50, 1, 0] }, physics: { body: 'static' } },
        },
        tests: [{ id: 'arrive', kind: 'reaches', target: 'crate', zone: 'goal', within: 3 }],
    });
}
/** A tiny passing world: a crate that falls onto the ground and stays. */
export function passingWorld() {
    return createWorld({
        name: 'Resting crate',
        entities: {
            crate: { id: 'crate', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, transform: { position: [0, 3, 0] }, physics: { body: 'dynamic' } },
        },
        tests: [{ id: 'rests', kind: 'staysAbove', target: 'crate', y: 0, within: 2 }],
    });
}
/** Self-contained worlds whose replay results are pinned in golden.json (independent of the shipped templates). */
export function pinnedWorlds() {
    const dominoes = {};
    for (let i = 0; i < 8; i++) {
        dominoes[`d${i}`] = {
            id: `d${i}`,
            tags: ['domino'],
            shape: { kind: 'primitive', primitive: 'box', size: [0.1, 1, 0.5] },
            transform: { position: [i * 0.45, 0.5, 0] },
            physics: i === 0 ? { body: 'dynamic', initialAngularVelocity: [0, 0, -2.5] } : { body: 'dynamic' },
        };
    }
    const ramp = createWorld({
        name: 'Ramp',
        entities: {
            ramp: { id: 'ramp', shape: { kind: 'primitive', primitive: 'box', size: [6, 0.2, 2] }, transform: { position: [0, 1.2, 0], rotation: [0, 0, -12] }, physics: { body: 'static' } },
            ball: { id: 'ball', shape: { kind: 'primitive', primitive: 'sphere', size: [0.5, 0.5, 0.5] }, transform: { position: [-2.4, 3, 0] }, physics: { body: 'dynamic' } },
            goal: { id: 'goal', shape: { kind: 'primitive', primitive: 'box', size: [5, 1, 2] }, transform: { position: [5, 0.5, 0] }, physics: { body: 'static', sensor: true } },
        },
        tests: [{ id: 'rolls-home', kind: 'reaches', target: 'ball', zone: 'goal', within: 8 }],
    });
    const rules = createWorld({
        name: 'Ticker',
        state: { ticks: 0 },
        entities: {
            crate: { id: 'crate', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, transform: { position: [0, 4, 0] }, physics: { body: 'dynamic' } },
        },
        rules: [{ id: 'tick', when: { on: 'tick', every: 0.5 }, then: [{ do: 'add', key: 'ticks', amount: 1 }] }],
        tests: [{ id: 'counts', kind: 'eventually', condition: { key: 'ticks', op: '>=', value: 3 }, within: 4 }],
    });
    // Kinematic motion from the rules runtime (trigonometry in the host language) carrying a free body.
    const turntable = createWorld({
        name: 'Turntable',
        entities: {
            platform: {
                id: 'platform',
                shape: { kind: 'primitive', primitive: 'box', size: [4, 0.3, 4] },
                transform: { position: [0, 1, 0] },
                physics: { body: 'static' },
                behaviors: [
                    { type: 'bob', params: { amplitude: 0.4, period: 3 } },
                    { type: 'spin', params: { speed: 40 } },
                ],
            },
            crate: { id: 'crate', shape: { kind: 'primitive', primitive: 'box', size: [0.5, 0.5, 0.5] }, transform: { position: [1.2, 1.6, 0.4] }, physics: { body: 'dynamic' } },
        },
        tests: [{ id: 'moves', kind: 'moves', target: 'crate', distance: 0.5, within: 6 }],
    });
    return { turntable, dominoes: createWorld({ name: 'Dominoes', entities: dominoes, tests: [{ id: 'chain', kind: 'topples', target: '#domino', degrees: 45, within: 10 }] }), ramp, rules };
}
