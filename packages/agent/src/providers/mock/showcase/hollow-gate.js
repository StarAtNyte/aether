import { r2 } from '../builder';
import { campfire, lamp } from '../decor';
import { addTorch, guardDialogue, NPC_KINDS, placeNpc, shopDialogue } from '../npc-kinds';
import { makeGate, makeStall } from '../npc';
import { finish, flagshipBuilder, segment } from './kit';
const WALL = { preset: 'stone', color: '#7d7a73' };
const kind = (id) => NPC_KINDS.find((k) => k.id === id);
/** A stretch of the compound wall. */
function wall(b, from, to) {
    segment(b, 'wall', from, to, 1.2, 4.2, WALL, { physics: 'static', tags: ['wall'], castShadow: true });
}
/** Small-talk dialogue of a villager who knows the hollow's rules. */
function lore(hello, tips) {
    const nodes = {
        start: { text: hello, choices: [...tips.map(([q], i) => ({ text: q, next: `tip-${i}` })), { text: 'Goodbye.', next: null }] },
    };
    tips.forEach(([, a], i) => {
        nodes[`tip-${i}`] = { text: a, next: 'start' };
    });
    return { start: 'start', nodes };
}
/** Plan The Hollow Gate. */
export function hollowGate() {
    const b = flagshipBuilder(0x401a, { night: true, fog: true });
    b.env({
        sky: 'night',
        timeOfDay: 22,
        ambientIntensity: 0.34,
        sunIntensity: 0.5,
        fog: { color: '#0d1424', density: 0.014 },
        weather: 'fireflies',
        bloom: 1.2,
        exposure: 1.05,
        ground: { material: { preset: 'grass', color: '#2e4636' }, size: 260 },
    });
    b.player({ mode: 'thirdPerson', spawn: [0, 1, 28], moveSpeed: 5.4, jumpSpeed: 6 });
    b.state('health', 100);
    b.state('coins', 0);
    b.state('key', 0);
    b.hud('health', 'Health');
    b.hud('coins', 'Gold');
    b.hud('key', 'Key');
    // --- The compound: a wall with one way out ------------------------------------------------------
    wall(b, [-34, 0, -14], [-2.9, 0, -14]);
    wall(b, [2.9, 0, -14], [34, 0, -14]);
    wall(b, [-34, 0, 34], [34, 0, 34]);
    wall(b, [-34, 0, -14], [-34, 0, 34]);
    wall(b, [34, 0, -14], [34, 0, 34]);
    const gate = makeGate(b, 0, -14, true);
    // Beyond the gate: the road out, and the way to win.
    b.prim('road-out', 'box', [3.4, 0.04, 14], [0, 0.02, -23], { material: { preset: 'dirt', color: '#5b4a3a' }, castShadow: false });
    b.gen('exit', 'portal', { size: 3, glowColor: '#ffd166' }, [0, 0, -26], {
        name: 'The road out',
        physics: { body: 'static', sensor: true },
        behaviors: [{ type: 'goal', params: { text: 'Through the Hollow Gate. The wolves howl behind you; you are out.' } }],
        tags: ['goal'],
    });
    b.light(b.empty('exit-glow', [0, 1.5, -24], { name: 'Exit glow' }), [0, 0, 0], '#ffd166', 2.2, 14);
    b.scatter('pines-out', 'tree-pine', { height: 7 }, 90, [120, 36], [0, 0, -40], { scaleRange: [0.8, 1.35], minSpacing: 3 });
    b.scatter('pines-sides', 'tree-pine', { height: 7 }, 120, [30, 90], [-52, 0, 10], { scaleRange: [0.8, 1.35], minSpacing: 3 });
    b.scatter('pines-sides-e', 'tree-pine', { height: 7 }, 120, [30, 90], [52, 0, 10], { scaleRange: [0.8, 1.35], minSpacing: 3 });
    // --- The road and the lamps ---------------------------------------------------------------------------
    b.prim('road', 'box', [3.6, 0.04, 44], [0, 0.02, 10], { material: { preset: 'dirt', color: '#5b4a3a' }, castShadow: false });
    for (const [x, z] of [[-3.6, 24], [3.6, 24], [-3.6, 12], [3.6, 12], [-3.6, -4], [3.6, -4]])
        lamp(b, x, z, '#ffcf8a', 3.4, true);
    // --- Houses ---------------------------------------------------------------------------------------------
    b.gen('house', 'house', { width: 6, depth: 5, floors: 1, lights: true, variant: 0 }, [24, 0, 22], { yaw: 90, physics: 'static', tags: ['house'], footprint: 5 });
    b.gen('house', 'house', { width: 6, depth: 5, floors: 2, lights: true, variant: 1 }, [25, 0, 3], { yaw: 90, physics: 'static', tags: ['house'], footprint: 5 });
    b.gen('house', 'house', { width: 6, depth: 5, floors: 1, lights: true, variant: 2 }, [-24, 0, 28], { yaw: -90, physics: 'static', tags: ['house'], footprint: 5 });
    // --- The west woods, where the wolves live ------------------------------------------------------
    b.reserve(-28, 4, 4.4); // the pack's clearing
    for (let i = 0; i < 14; i++) {
        const p = b.spot(-28.5, 4, 1, 9.5, 1.6);
        if (p)
            b.gen('pine', 'tree-pine', { height: r2(b.rand(6, 9)) }, [p[0], 0, p[1]], { yaw: r2(b.rand(0, 360)), physics: 'static', tags: ['tree'] });
    }
    for (let i = 0; i < 5; i++) {
        const p = b.spot(-22, 4, 3, 12, 1.2);
        if (p)
            b.gen('rock', 'rock', { size: r2(b.rand(0.9, 1.7)), mossy: true }, [p[0], 0, p[1]], { yaw: r2(b.rand(0, 360)), physics: 'static', tags: ['rock'] });
    }
    // --- Fire: the one thing the wolves respect -----------------------------------------------------
    campfire(b, -5, 16);
    campfire(b, 7, -6);
    b.gen('barrel', 'barrel', {}, [-8.6, 0, 20], { physics: 'static', footprint: 0.7 });
    b.gen('crate', 'crate', { size: 1 }, [-9.6, 0, 20.4], { physics: 'static', footprint: 0.8 });
    // --- The characters ----------------------------------------------------------------------------------------
    // Marek the guard: patrols the road before the gate with a torch.
    const guard = placeNpc(b, kind('guard'), -9, -10.8, {
        name: 'Marek',
        yaw: -90,
        waypoints: [[-9, 0, -10.8], [9, 0, -10.8]],
        patrol: 'pingpong',
        carries: ['torch'],
        dialogue: guardDialogue(b, 'Marek', 'gate'),
        tags: ['guard-post'],
    });
    addTorch(b, guard.id, 1.7);
    // Mira the shopkeeper: a stall by the fire, the key for five gold.
    placeNpc(b, kind('merchant'), -12.5, 18.5, {
        name: 'Mira',
        yaw: -80,
        dialogue: shopDialogue('Mira', { item: 'key', price: 5, currency: 'coins', door: gate.id, greeting: 'Welcome to the hollow, traveller! Mira, at your service. Looking for the way out? Only one key opens that gate, and I sell it.' }),
    });
    makeStall(b, -11.3, 18.3, -80);
    // Three wolves hunt the west woods at night.
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        placeNpc(b, kind('wolf'), r2(-28 + Math.cos(a) * 2.6), r2(4 + Math.sin(a) * 2.6), { name: `Wolf ${i + 1}`, yaw: r2((-a * 180) / Math.PI + 90), hours: [19, 6], wander: 8 });
    }
    // Two villagers who know how it all works.
    placeNpc(b, kind('villager'), 15, 14, {
        name: 'Ada',
        yaw: 90,
        wander: 4,
        dialogue: lore('Evening. You look like someone who wants out.', [
            ['How do I leave?', 'The gate answers to a key, and Mira sells it for five gold. There is gold lying about the hollow, if you are brave enough to pick it up.'],
            ['What about the guard?', 'Marek hears boots, not footsteps. Hold Shift to creep and he will not hear you at all. He does see well, though, in front of him.'],
        ]),
    });
    placeNpc(b, kind('villager'), 13, 25, {
        name: 'Bram',
        yaw: 180,
        wander: 3,
        dialogue: lore('Mind the west woods after dark.', [
            ['Why?', 'Wolves. Three of them, and they hunt as one. If one sees you, they all know.'],
            ['How do I stay safe?', 'Fire. The wolves will not come near a flame, not even the guard’s torch. Keep close to a campfire and they will circle at a distance.'],
        ]),
    });
    // --- Gold to pay for the key (a handful are close to the wolves) --------------------------------------
    const GOLD = [[3, 0.9, 21], [-2, 0.9, 10], [11, 0.9, 7], [-8, 0.9, 6], [14, 0.9, -3], [-16, 0.9, 12]];
    for (const p of GOLD) {
        b.prim('gold', 'cylinder', [0.7, 0.1, 0.7], p, {
            name: 'Gold coin',
            rot: [90, 0, 0],
            material: { preset: 'gold', emissive: '#ffb703', emissiveIntensity: 0.9 },
            behaviors: [
                { type: 'spin', params: { axis: [0, 0, 1], speed: 140 } },
                { type: 'bob', params: { amplitude: 0.15 } },
                { type: 'collectible', params: { scoreKey: 'coins', value: 2, margin: 1.1, message: 'Gold!' } },
            ],
            tags: ['coin'],
            castShadow: false,
        });
    }
    // --- Rules and proof ----------------------------------------------------------------------------------------------
    b.rule({ id: 'welcome', when: { on: 'start' }, then: [{ do: 'message', text: 'The gate is locked. Mira sells the key, if you can pay.', duration: 5 }] });
    b.rule({ id: 'got-key', when: { on: 'state', key: 'key', op: '>=', value: 1 }, then: [{ do: 'message', text: 'You have the key. Get to the gate!', duration: 4 }], once: true });
    b.rule({ id: 'reset-key', when: { on: 'key', key: 'r' }, then: [{ do: 'reset' }] });
    b.test({ id: 'npcs-work', kind: 'npcs', target: '#npc', seconds: 16, stuckAfter: 5 });
    b.test({ id: 'gold-stays', kind: 'staysAbove', target: '#coin', y: 0.4, within: 5 });
    return finish(b, {
        name: 'The Hollow Gate',
        description: 'A walled hamlet at night: earn gold, buy the key from Mira, slip past Marek the guard, outwit the wolves and leave through the gate.',
        intro: {
            title: 'The Hollow Gate',
            tagline: 'A walled hamlet at night. A locked gate. A guard who listens, a shopkeeper who sells, wolves that fear fire.',
            objective: 'Collect gold (five buys the key), buy the key from Mira, slip past Marek and leave through the gate.',
            controls: ['WASD — walk', 'Shift — sneak', 'E — talk', '1–3 — choose', 'Esc — stop'],
            accent: '#f2c46d',
        },
        plan: 'Plan: The Hollow Gate — walled hamlet, locked gate, guard + shopkeeper + wolf pack + villagers.',
        message: 'Built The Hollow Gate: Marek patrols with a torch and chases what he sees or hears, Mira sells the gate key for five gold, three wolves hunt the west woods after dark and fear fire. Collect gold, press E to talk, hold Shift to sneak, and leave through the gate.',
    });
}
