import { createWorld } from '@aether/core';
/** A world from entity inputs (ground on by default) with the player standing at `spawn`. */
export function gameWorld(entities, extra = {}, spawn = [0, 0.5, 0]) {
    const map = {};
    for (const e of entities)
        map[e.id] = e;
    const player = { mode: 'thirdPerson', spawn, moveSpeed: 6, jumpSpeed: 6, ...(extra.player ?? {}) };
    return createWorld({ ...extra, player, entities: map });
}
/** A static box (platform, wall) of `size` centred at `at`. */
export function slab(id, at, size, extra = {}) {
    return { id, shape: { kind: 'primitive', primitive: 'box', size }, transform: { position: at }, physics: { body: 'static' }, ...extra };
}
/** A coin that adds 1 to `score` when touched. */
export function coin(id, at, extra = {}) {
    return {
        id,
        shape: { kind: 'primitive', primitive: 'sphere', size: [0.5, 0.5, 0.5] },
        transform: { position: at },
        behaviors: [{ type: 'collectible', params: { scoreKey: 'score', value: 1 } }],
        ...extra,
    };
}
/** A pickup that adds 1 to the given state key. */
export function pickup(id, at, key) {
    return coin(id, at, { behaviors: [{ type: 'collectible', params: { scoreKey: key, value: 1 } }] });
}
/** A goal portal (sensor box) that wins on touch. */
export function goalAt(id, at) {
    return {
        id,
        shape: { kind: 'primitive', primitive: 'box', size: [1.5, 2, 1.5] },
        transform: { position: at },
        physics: { body: 'static', sensor: true },
        behaviors: [{ type: 'goal', params: { text: 'You win!' } }],
    };
}
/** Win when `score` reaches `n`. */
export function winAt(n) {
    return { id: 'win-score', when: { on: 'state', key: 'score', op: '>=', value: n }, then: [{ do: 'win', text: 'All collected!' }], once: true };
}
