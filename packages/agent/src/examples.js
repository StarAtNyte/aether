function domino(i) {
    return {
        op: 'add',
        entity: {
            id: `domino-${i}`,
            tags: ['domino'],
            transform: { position: [i * 0.55, 0.5, 0] },
            shape: { kind: 'primitive', primitive: 'box', size: [0.15, 1, 0.5] },
            material: { preset: 'plastic', color: i % 2 === 0 ? '#e63946' : '#f1faee' },
            physics: i === 1 ? { body: 'dynamic', mass: 0.4, initialAngularVelocity: [0, 0, -2.5] } : { body: 'dynamic', mass: 0.4 },
        },
    };
}
function coin(i, x, z) {
    return {
        op: 'add',
        entity: {
            id: `coin-${i}`,
            name: 'Coin',
            tags: ['coin'],
            transform: { position: [x, 1, z], rotation: [90, 0, 0] },
            shape: { kind: 'primitive', primitive: 'cylinder', size: [0.8, 0.12, 0.8] },
            material: { preset: 'gold', emissive: '#ffb703', emissiveIntensity: 0.4 },
            behaviors: [{ type: 'spin', params: { axis: [0, 0, 1], speed: 120 } }, { type: 'bob', params: { amplitude: 0.2 } }, { type: 'collectible', params: { scoreKey: 'score' } }],
        },
    };
}
/** The worked examples shown to the planner. */
export const PROMPT_EXAMPLES = [
    {
        request: 'a domino run that knocks over a bell',
        message: 'Domino run ringing a bell',
        patches: [
            { op: 'setMeta', name: 'Domino Run' },
            { op: 'setEnvironment', set: { sky: 'day', timeOfDay: 16, ground: { material: { preset: 'wood', color: '#c8a27a' } } } },
            { op: 'setPlayer', set: { mode: 'orbit', spawn: [2, 3, 7] } },
            ...[1, 2, 3, 4, 5, 6].map(domino),
            {
                op: 'add',
                entity: {
                    id: 'bell',
                    name: 'Bell',
                    // Far enough that domino-6 passes 45° (topples) before its tip strikes the bell.
                    transform: { position: [4.1, 0.4, 0] },
                    shape: { kind: 'primitive', primitive: 'cone', size: [0.6, 0.8, 0.6] },
                    material: { preset: 'gold' },
                    physics: { body: 'dynamic', mass: 0.3 },
                },
            },
            { op: 'setState', key: 'rang', value: false },
            {
                op: 'addRule',
                rule: { id: 'ring-bell', when: { on: 'collision', a: '#domino', b: 'bell' }, then: [{ do: 'sound', sound: 'bell' }, { do: 'set', key: 'rang', value: true }, { do: 'message', text: 'Ding!' }], once: true },
            },
            { op: 'addTest', test: { id: 'chain-falls', kind: 'topples', target: 'domino-6', within: 8 } },
            { op: 'addTest', test: { id: 'bell-rings', kind: 'eventually', condition: { key: 'rang', op: '==', value: true }, within: 10 } },
        ],
    },
    {
        request: 'collect 5 coins before time runs out',
        message: 'Coin hunt with a 45 s timer',
        patches: [
            { op: 'setMeta', name: 'Coin Hunt' },
            { op: 'setEnvironment', set: { sky: 'day', timeOfDay: 10, bloom: 0.6 } },
            { op: 'setPlayer', set: { mode: 'thirdPerson', spawn: [0, 1, 10] } },
            coin(1, -6, 0), coin(2, 6, 0), coin(3, 0, -8), coin(4, -9, -12), coin(5, 9, -12),
            { op: 'add', entity: { id: 'rock-1', transform: { position: [3, 0, -4] }, shape: { kind: 'procedural', generator: 'rock', params: { size: 2, mossy: true } }, physics: { body: 'static' } } },
            { op: 'setState', key: 'score', value: 0 },
            { op: 'setState', key: 'timeLeft', value: 45 },
            { op: 'setHud', hud: [{ key: 'score', label: 'Coins' }, { key: 'timeLeft', label: 'Time' }] },
            { op: 'addRule', rule: { id: 'countdown', when: { on: 'tick', every: 1 }, if: [{ key: 'timeLeft', op: '>', value: 0 }], then: [{ do: 'add', key: 'timeLeft', amount: -1 }] } },
            { op: 'addRule', rule: { id: 'win', when: { on: 'state', key: 'score', op: '>=', value: 5 }, then: [{ do: 'win', text: 'All coins collected!' }], once: true } },
            { op: 'addRule', rule: { id: 'lose', when: { on: 'state', key: 'timeLeft', op: '<=', value: 0 }, then: [{ do: 'lose', text: "Time's up!" }], once: true } },
            { op: 'addTest', test: { id: 'timer-runs', kind: 'eventually', condition: { key: 'timeLeft', op: '<=', value: 43 }, within: 5 } },
            { op: 'addTest', test: { id: 'coins-float', kind: 'staysAbove', target: '#coin', y: 0.5, within: 5 } },
        ],
    },
    {
        request: 'a guard who patrols the gate and chases me, and a shopkeeper who sells a key',
        message: 'Gate guard and key seller',
        patches: [
            { op: 'setMeta', name: 'The Locked Gate' },
            { op: 'setPlayer', set: { mode: 'thirdPerson', spawn: [0, 1, 12] } },
            { op: 'add', entity: { id: 'gate-door', name: 'Locked gate', transform: { position: [0, 1.8, -6] }, shape: { kind: 'primitive', primitive: 'box', size: [3.6, 3.6, 0.3] }, material: { preset: 'wood' }, physics: { body: 'kinematic' }, behaviors: [{ type: 'door', params: { trigger: 'state', stateKey: 'gate-door-unlocked', slide: [0, 3.8, 0] } }] } },
            {
                op: 'add',
                entity: {
                    id: 'guard-1',
                    name: 'Bram',
                    tags: ['npc'],
                    transform: { position: [-4, 0.9, -2] },
                    shape: { kind: 'primitive', primitive: 'capsule', size: [0.56, 1.7, 0.56] },
                    material: { preset: 'fabric', color: '#3d5a80' },
                    physics: { body: 'kinematic' },
                    npc: { role: 'guard', archetype: 'guard', faction: 'watch', waypoints: [[-4, 0, -2], [4, 0, -2]], patrol: { mode: 'pingpong', wait: 1.5 }, attack: { damage: 10 }, barks: { spot: ['Halt!'] } },
                },
            },
            {
                op: 'add',
                entity: {
                    id: 'shopkeeper-1',
                    name: 'Mira',
                    tags: ['npc'],
                    transform: { position: [7, 0.9, 4] },
                    shape: { kind: 'primitive', primitive: 'capsule', size: [0.56, 1.7, 0.56] },
                    material: { preset: 'fabric', color: '#8c5a3c' },
                    physics: { body: 'kinematic' },
                    npc: {
                        role: 'shopkeeper',
                        archetype: 'merchant',
                        dialogue: {
                            start: 'start',
                            nodes: {
                                start: { text: 'Welcome! A key for 5 coins?', choices: [{ text: 'Buy the key (5 coins)', if: [{ key: 'coins', op: '>=', value: 5 }, { key: 'key', op: '<', value: 1 }], effects: [{ do: 'take', item: 'coins', count: 5 }, { do: 'give', item: 'key' }, { do: 'openDoor', target: 'gate-door' }], next: 'sold' }, { text: 'Not now.', next: null }] },
                                sold: { text: 'The gate is yours.', mode: 'trade' },
                            },
                        },
                    },
                },
            },
            { op: 'setState', key: 'coins', value: 5 },
            { op: 'setState', key: 'key', value: 0 },
            { op: 'setState', key: 'health', value: 100 },
            { op: 'setHud', hud: [{ key: 'health', label: 'Health' }, { key: 'coins', label: 'Coins' }, { key: 'key', label: 'Key' }] },
            { op: 'addTest', test: { id: 'npcs-work', kind: 'npcs', target: '#npc', seconds: 10 } },
        ],
    },
    {
        request: '(edit) make it a foggy night and light the lamps',
        message: 'Foggy night',
        patches: [
            { op: 'setEnvironment', set: { sky: 'night', timeOfDay: 22, fog: { color: '#0b1026', density: 0.025 }, weather: 'fireflies', bloom: 1.2 } },
            { op: 'update', id: 'lamp-1', set: { light: { type: 'point', color: '#ffd27a', intensity: 3, range: 12 } } },
        ],
    },
];
