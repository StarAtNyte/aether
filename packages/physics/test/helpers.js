import { createWorld } from '@aether/core';
/** World with the given entities (and optional extra doc fields). */
export function world(entities, extra = {}) {
    const map = {};
    for (const e of entities)
        map[e.id] = e;
    return createWorld({ ...extra, entities: map });
}
/** Box entity input. */
export function box(id, position, size, physics = { body: 'dynamic' }, extra = {}) {
    return { id, shape: { kind: 'primitive', primitive: 'box', size }, transform: { position }, physics, ...extra };
}
/** Sphere entity input (diameter = 2r). */
export function ball(id, position, radius, physics = { body: 'dynamic' }, extra = {}) {
    return { id, shape: { kind: 'primitive', primitive: 'sphere', size: [radius * 2, radius * 2, radius * 2] }, transform: { position }, physics, ...extra };
}
/** Domino chain along +x; the first one gets a rotational kick toward +x. */
export function dominoes(count, spacing) {
    const list = [];
    for (let i = 0; i < count; i++) {
        list.push({
            id: `domino-${i}`,
            tags: ['domino'],
            shape: { kind: 'primitive', primitive: 'box', size: [0.1, 1, 0.5] },
            transform: { position: [i * spacing, 0.5, 0] },
            physics: i === 0 ? { body: 'dynamic', initialAngularVelocity: [0, 0, -2.5] } : { body: 'dynamic' },
        });
    }
    return world(list, { tests: [{ id: 'chain', kind: 'topples', target: '#domino', degrees: 45, within: 10 }] });
}
