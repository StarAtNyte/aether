/**
 * Chain Reaction — five Rube-Goldberg machines on a long workshop stage,
 * wired into one chain: each machine's finale presses a plate that starts
 * the next. Press Space (or click a machine's start button) to set the
 * first one off; it starts by itself after a moment. Every machine is
 * proven by the physics verifier: the whole chain must complete headless.
 *
 *  1. Domino spiral — a curving domino line topples onto a plate.
 *  2. Marble run — a marble rolls down two switchback ramps into a cup.
 *  3. Wrecking ball — a pendulum swings into a crate tower.
 *  4. Crate avalanche — a gate drops and crates slide down a chute.
 *  5. Strike — a bowling ball rolls down a ramp into ten pins.
 */
import { r2, type Builder, type V3 } from '../builder';
import type { MockPlan } from '../planner';
import { finish, flagshipBuilder } from './kit';

const COLORS = ['#ff5d73', '#ffb547', '#3ddc97', '#4cc9f0', '#b388ff'] as const;
const NAMES = ['Domino spiral', 'Marble run', 'Wrecking ball', 'Crate avalanche', 'Strike'] as const;
/** Machine centres along X. */
const XS = [-30, -15, 0, 15, 30] as const;

/** The finale plate of machine `i` (pressed by any body: emits `done-i`). */
function plate(b: Builder, i: number, pos: V3, size: [number, number] = [1.6, 1.6]): string {
  return b.prim(`plate-${i + 1}`, 'box', [size[0], 0.08, size[1]], pos, {
    name: `Finale plate ${i + 1}`,
    material: { preset: 'neon', color: COLORS[i] as string, emissive: COLORS[i] as string, emissiveIntensity: 1.4 },
    physics: 'static',
    behaviors: [{ type: 'pressurePlate', params: { who: '*', event: `done-${i + 1}`, height: 1.4, depth: 0.03 } }],
    tags: ['plate'],
    castShadow: false,
  });
}

/** Start button of machine `i` on a pedestal in front of it (click starts the machine). */
function startButton(b: Builder, i: number, x: number, z: number): string {
  const ped = b.prim(`pedestal-${i + 1}`, 'cylinder', [0.7, 0.9, 0.7], [x, 0.45, z], { material: { preset: 'metal', color: '#2b2f3a', roughness: 0.35 }, physics: 'static' });
  return b.prim(`start-${i + 1}`, 'cylinder', [0.5, 0.14, 0.5], [0, 0.52, 0], {
    parent: ped,
    name: `Start ${NAMES[i]}`,
    material: { preset: 'neon', color: COLORS[i] as string, emissive: COLORS[i] as string, emissiveIntensity: 2.2 },
    behaviors: [{ type: 'pulseLight', params: { min: 0.6, max: 2.6, period: 1.2, phase: i * 0.2, property: 'material.emissiveIntensity' } }],
    tags: ['button'],
    castShadow: false,
  });
}

/** Plan Chain Reaction. */
export function chainReaction(): MockPlan {
  const b = flagshipBuilder(0xc4a1);
  b.env({
    sky: 'sunset',
    timeOfDay: 17.6,
    sunIntensity: 2.6,
    ambientIntensity: 0.5,
    fog: { color: '#f0c7a8', density: 0.004 },
    bloom: 0.95,
    exposure: 1.05,
    weather: 'clear',
    ground: { material: { finish: 'concrete', color: '#c9c4bd' }, size: 220 },
  });
  // The stage: a long timber deck with a neon edge.
  b.prim('stage', 'box', [80, 0.3, 16], [0, 0.15, -1], { name: 'Workshop stage', material: { finish: 'oak', color: '#c69c6d' }, physics: { body: 'static', friction: 0.6 }, tags: ['stage'] });
  b.prim('stage-edge', 'box', [80, 0.06, 0.12], [0, 0.31, 7], { material: { preset: 'neon', color: '#ffffff', emissive: '#ffe6c4', emissiveIntensity: 1.2 }, castShadow: false });
  const S = 0.3; // stage top

  // --- 1. Domino spiral ------------------------------------------------------------
  {
    const i = 0;
    const cx = XS[i];
    const dominoes: string[] = [];
    const pts: V3[] = [];
    const n = 20;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const a = -Math.PI * 0.9 + t * Math.PI * 1.25;
      const r = 4.2 - t * 1.6;
      const x = r2(cx + Math.cos(a) * r);
      const z = r2(-1 + Math.sin(a) * r);
      // Tangent of the spiral: each domino faces along the path.
      const da = 0.01;
      const tx = Math.cos(a + da) * (r - 0.016) - Math.cos(a) * r;
      const tz = Math.sin(a + da) * (r - 0.016) - Math.sin(a) * r;
      const yaw = r2((Math.atan2(-tz, tx) * 180) / Math.PI);
      pts.push([x, 0, z]);
      dominoes.push(b.prim('domino', 'box', [0.18, 1.2, 0.6], [x, r2(S + 0.6), z], { yaw, material: { preset: 'plastic', color: COLORS[k % COLORS.length] as string, roughness: 0.3 }, physics: { body: 'dynamic', mass: 0.5, friction: 0.45 }, tags: ['domino', 'm1'] }));
    }
    // The finale plate just past where the last domino lands (its centre crosses onto it only when it falls).
    const pl = pts[n - 1] as V3;
    const pp = pts[n - 2] as V3;
    const ld = Math.hypot(pl[0] - pp[0], pl[2] - pp[2]);
    plate(b, i, [r2(pl[0] + ((pl[0] - pp[0]) / ld) * 1.05), r2(S + 0.04), r2(pl[2] + ((pl[2] - pp[2]) / ld) * 1.05)], [1.2, 1.2]);
    startButton(b, i, cx, 5);
    // Tip the first domino along the path.
    const p0 = pts[0] as V3;
    const p1 = pts[1] as V3;
    const dl = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
    const push: V3 = [r2(((p1[0] - p0[0]) / dl) * 1.8), 0, r2(((p1[2] - p0[2]) / dl) * 1.8)];
    b.rule({ id: 'run-1', description: 'Machine 1: tip the first domino', when: { on: 'event', name: 'start-1' }, then: [{ do: 'setVelocity', target: dominoes[0] as string, vector: push }, { do: 'sound', sound: 'whoosh' }], once: true });
    b.test({ id: 'dominoes-fall', kind: 'topples', target: dominoes[n - 1] as string, within: 12 });
  }

  // --- 2. Marble run ---------------------------------------------------------------------
  {
    const i = 1;
    const cx = XS[i];
    // A tower, one long railed ramp with a rumble of speed bumps, and a catch box with the plate.
    const top = S + 2.6;
    const x0 = cx - 5.2;
    const x1 = cx + 3;
    const drop = 2.25;
    const len = x1 - x0;
    const angle = r2((Math.atan2(drop, len) * 180) / Math.PI);
    const rad = (angle * Math.PI) / 180;
    const mx = r2((x0 + x1) / 2);
    const my = r2(top - drop / 2);
    // The tower top sits a little above the ramp's lip so the marble rolls straight on.
    const towerTop = top + 0.12;
    b.prim('tower', 'box', [1.2, r2(towerTop - S), 1.2], [r2(x0 - 0.6), r2(S + (towerTop - S) / 2), -1], { material: { preset: 'wood', color: '#8b5a2b' }, physics: 'static' });
    b.prim('ramp', 'box', [r2(Math.hypot(len, drop)), 0.12, 1], [mx, my, -1], { rot: [0, 0, r2(-angle)], material: { preset: 'wood', color: '#e9d5b7', roughness: 0.4 }, physics: { body: 'static', friction: 0.3 }, tags: ['ramp'] });
    for (const side of [-1, 1]) b.prim('ramp-rail', 'box', [r2(Math.hypot(len, drop)), 0.32, 0.08], [mx, r2(my + 0.2), r2(-1 + side * 0.54)], { rot: [0, 0, r2(-angle)], material: { preset: 'neon', color: COLORS[i] as string, emissive: COLORS[i] as string, emissiveIntensity: 0.7 }, physics: 'static' });
    for (let k = 1; k <= 3; k++) {
      const x = x0 + (len * k) / 4;
      b.prim('ramp-pillar', 'box', [0.16, r2(top - drop * (k / 4) - S - 0.1), 0.16], [r2(x), r2(S + (top - drop * (k / 4) - S - 0.1) / 2), -1.6], { material: { preset: 'metal', color: '#3c3f4a' }, physics: 'static' });
    }
    const marble = b.prim('marble', 'sphere', [0.42, 0.42, 0.42], [r2(x0 - 0.6), r2(towerTop + 0.22), -1], { name: 'Marble', material: { preset: 'glass', color: '#9be7ff', opacity: 0.85, roughness: 0.05 }, physics: { body: 'dynamic', mass: 0.4, friction: 0.3, restitution: 0.1, ccd: true }, tags: ['marble', 'm2'] });
    void rad;
    const catchX = r2(x1 + 1.3);
    b.prim('catch-back', 'box', [0.25, 1, 2.2], [r2(catchX + 1), r2(S + 0.5), -1], { material: { preset: 'metal', color: '#3c3f4a', roughness: 0.3 }, physics: { body: 'static', restitution: 0 } });
    for (const side of [-1, 1]) b.prim('catch-side', 'box', [2.2, 0.6, 0.2], [catchX, r2(S + 0.3), r2(-1 + side * 1)], { material: { preset: 'metal', color: '#3c3f4a', roughness: 0.3 }, physics: 'static' });
    plate(b, i, [catchX, r2(S + 0.04), -1], [1.8, 1.8]);
    startButton(b, i, cx, 5);
    b.rule({ id: 'run-2', description: 'Machine 2: nudge the marble off the tower', when: { on: 'event', name: 'start-2' }, then: [{ do: 'setVelocity', target: marble, vector: [2, 0, 0] }, { do: 'sound', sound: 'whoosh' }], once: true });
    b.test({ id: 'marble-arrives', kind: 'reaches', target: marble, zone: { center: [catchX, r2(S + 0.3), -1], radius: 1.2 }, within: 25 });
  }

  // --- 3. Wrecking ball -------------------------------------------------------------------
  {
    const i = 2;
    const cx = XS[i];
    const pivot: V3 = [r2(cx - 2.5), r2(S + 6), -1];
    b.prim('gantry', 'box', [0.3, 6, 0.3], [r2(cx - 2.5), r2(S + 3), -2.6], { material: { preset: 'metal', color: '#2b2f3a' }, physics: 'static' });
    b.prim('gantry-beam', 'box', [0.3, 0.3, 3.4], [r2(cx - 2.5), r2(S + 6), -1], { material: { preset: 'metal', color: '#2b2f3a' }, physics: 'static' });
    const ball = b.prim('wrecking-ball', 'sphere', [1.1, 1.1, 1.1], [pivot[0], r2(pivot[1] - 4.2), pivot[2]], {
      name: 'Wrecking ball',
      material: { preset: 'metal', color: '#3a3d46', roughness: 0.35, metalness: 0.8 },
      physics: { body: 'dynamic', mass: 40, friction: 0.4, angularDamping: 0.1 },
      joint: { type: 'spherical', target: 'world', anchor: [0, 4.2, 0], targetAnchor: pivot },
      tags: ['m3'],
    });
    // The chain is part of the ball's collider (children join their body): keep it clear of the beam.
    b.prim('chain', 'cylinder', [0.06, 3.5, 0.06], [0, 2.3, 0], { parent: ball, material: { preset: 'metal', color: '#9aa0aa' }, castShadow: false });
    // A crate tower just past the bottom of the swing.
    let top = '';
    for (let level = 0; level < 5; level++) {
      for (let j = 0; j < 2; j++) {
        top = b.prim('tower-crate', 'box', [0.7, 0.7, 0.7], [r2(cx - 1.35 + j * 0.72), r2(S + 0.35 + level * 0.71), -1], { material: { preset: 'wood', color: COLORS[(level + j) % COLORS.length] as string }, physics: { body: 'dynamic', mass: 1.2, friction: 0.6 }, tags: ['tower-crate', 'm3'] });
      }
    }
    plate(b, i, [r2(cx + 2.2), r2(S + 0.04), -1], [3, 4]);
    startButton(b, i, cx, 5);
    b.rule({ id: 'run-3', description: 'Machine 3: swing the wrecking ball', when: { on: 'event', name: 'start-3' }, then: [{ do: 'setVelocity', target: ball, vector: [7, 0, 0] }, { do: 'sound', sound: 'whoosh' }], once: true });
    b.test({ id: 'tower-falls', kind: 'moves', target: top, distance: 1, within: 22 });
  }

  // --- 4. Crate avalanche ------------------------------------------------------------------
  {
    const i = 3;
    const cx = XS[i];
    const angle = 24;
    const len = 7;
    const rise = r2(Math.sin((angle * Math.PI) / 180) * len);
    const run = r2(Math.cos((angle * Math.PI) / 180) * len);
    b.prim('chute', 'box', [len, 0.2, 2.4], [r2(cx - run / 2 + 1), r2(S + rise / 2), -1], { rot: [0, 0, -angle], material: { preset: 'metal', color: '#9aa0aa', roughness: 0.25 }, physics: { body: 'static', friction: 0.08 }, tags: ['chute'] });
    for (const side of [-1, 1]) b.prim('chute-wall', 'box', [len, 0.8, 0.12], [r2(cx - run / 2 + 1), r2(S + rise / 2 + 0.45), r2(-1 + side * 1.25)], { rot: [0, 0, -angle], material: { preset: 'neon', color: COLORS[i] as string, emissive: COLORS[i] as string, emissiveIntensity: 0.5 }, physics: 'static' });
    b.prim('chute-support', 'box', [0.6, rise, 2.4], [r2(cx - run + 1.3), r2(S + rise / 2), -1], { material: { preset: 'wood', color: '#8b5a2b' }, physics: 'static' });
    const gateX = cx - run * 0.45 + 1;
    const gate = b.prim('gate', 'box', [0.15, 1.1, 2.3], [r2(gateX), r2(S + rise / 2 + 0.1 / Math.cos((angle * Math.PI) / 180) - (gateX - (cx - run / 2 + 1)) * Math.tan((angle * Math.PI) / 180) + 0.55), -1], { name: 'Gate', rot: [0, 0, -angle], material: { preset: 'metal', color: '#2b2f3a' }, physics: 'static', tags: ['gate'] });
    // Crates resting on the chute behind the gate (centres on the sloped surface).
    const rad = (angle * Math.PI) / 180;
    const chuteX = cx - run / 2 + 1;
    const chuteY = S + rise / 2;
    const surface = (x: number): number => chuteY + 0.1 / Math.cos(rad) - (x - chuteX) * Math.tan(rad);
    let lastCrate = '';
    for (let k = 0; k < 4; k++) {
      const x = r2(cx - run * 0.45 + 1 - 0.45 - k * 0.66);
      lastCrate = b.prim('slide-crate', 'box', [0.55, 0.55, 0.55], [x, r2(surface(x) + 0.32), r2(-1 + (k % 2 ? 0.45 : -0.45))], { rot: [0, 0, -angle], material: { preset: 'wood', color: COLORS[k % COLORS.length] as string }, physics: { body: 'dynamic', mass: 1, friction: 0.08 }, tags: ['slide-crate', 'm4'] });
    }
    plate(b, i, [r2(cx + 2.6), r2(S + 0.04), -1], [2.6, 3]);
    startButton(b, i, cx, 5);
    b.rule({ id: 'run-4', description: 'Machine 4: open the gate', when: { on: 'event', name: 'start-4' }, then: [{ do: 'destroy', target: gate }, { do: 'sound', sound: 'whoosh' }], once: true });
    b.test({ id: 'avalanche', kind: 'moves', target: lastCrate, distance: 2, within: 25 });
  }

  // --- 5. Strike ----------------------------------------------------------------------------
  {
    const i = 4;
    const cx = XS[i];
    b.prim('alley', 'box', [9, 0.08, 2], [r2(cx + 0.5), r2(S + 0.04), -1], { material: { finish: 'oak', color: '#e2b98a', roughness: 0.25 }, physics: { body: 'static', friction: 0.25 } });
    const bowl = b.prim('bowling-ball', 'sphere', [0.5, 0.5, 0.5], [r2(cx - 3.6), r2(S + 0.33), -1], { name: 'Bowling ball', material: { preset: 'plastic', color: '#3a0ca3', roughness: 0.15 }, physics: { body: 'dynamic', mass: 7, friction: 0.3, ccd: true }, tags: ['m5'] });
    let head = '';
    for (let row = 0; row < 4; row++) {
      for (let j = 0; j <= row; j++) {
        const id = b.prim('pin', 'cylinder', [0.22, 0.7, 0.22], [r2(cx + 2.4 + row * 0.42), r2(S + 0.43), r2(-1 + (j - row / 2) * 0.44)], { material: { preset: 'plastic', color: '#f8f9fa', roughness: 0.3 }, physics: { body: 'dynamic', mass: 1.4, friction: 0.4 }, tags: ['pin', 'm5'] });
        if (row === 0) head = id;
      }
    }
    plate(b, i, [r2(cx + 4.8), r2(S + 0.04), -1], [1.6, 2.6]);
    b.prim('backstop', 'box', [0.3, 1.4, 3], [r2(cx + 5.8), r2(S + 0.7), -1], { material: { preset: 'neon', color: COLORS[i] as string, emissive: COLORS[i] as string, emissiveIntensity: 0.8 }, physics: 'static' });
    startButton(b, i, cx, 5);
    b.rule({ id: 'run-5', description: 'Machine 5: roll the bowling ball', when: { on: 'event', name: 'start-5' }, then: [{ do: 'setVelocity', target: bowl, vector: [6.5, 0, 0] }, { do: 'sound', sound: 'whoosh' }], once: true });
    b.test({ id: 'strike', kind: 'topples', target: head, within: 25 });
  }

  // --- The chain: each finale starts the next machine --------------------------------------
  b.state('machines', 0);
  b.state('started', false);
  b.hud('machines', 'Machines / 5');
  b.rule({ id: 'hint', when: { on: 'start' }, then: [{ do: 'message', text: 'Press SPACE to start the chain — or click a glowing button.', duration: 4 }] });
  b.rule({ id: 'space', when: { on: 'key', key: 'space' }, if: [{ key: 'started', op: '==', value: false }], then: [{ do: 'set', key: 'started', value: true }, { do: 'emit', event: 'start-1' }] });
  b.rule({ id: 'auto', description: 'Starts by itself if nobody presses a key', when: { on: 'timer', at: 2 }, if: [{ key: 'started', op: '==', value: false }], then: [{ do: 'set', key: 'started', value: true }, { do: 'emit', event: 'start-1' }] });
  for (let i = 0; i < 5; i++) {
    b.rule({ id: `click-${i + 1}`, when: { on: 'click', target: `start-${i + 1}` }, then: [{ do: 'set', key: 'started', value: true }, { do: 'emit', event: `start-${i + 1}` }] });
    const then: Parameters<Builder['rule']>[0]['then'] = [
      { do: 'add', key: 'machines', amount: 1 },
      { do: 'set', key: `machine${i + 1}`, value: true },
      { do: 'message', text: `${NAMES[i]} complete!`, duration: 2 },
      { do: 'sound', sound: 'bell' },
    ];
    if (i < 4) then.push({ do: 'emit', event: `start-${i + 2}`, delay: 0.6 });
    b.state(`machine${i + 1}`, false);
    b.rule({ id: `done-${i + 1}`, when: { on: 'event', name: `done-${i + 1}` }, then, once: true });
    b.test({ id: `machine-${i + 1}-completes`, kind: 'eventually', condition: { key: `machine${i + 1}`, op: '==', value: true }, within: 25 });
  }
  b.rule({ id: 'finale', when: { on: 'state', key: 'machines', op: '>=', value: 5 }, then: [{ do: 'sound', sound: 'win' }, { do: 'win', text: 'Five machines, one chain reaction. Press R to watch it again.' }], once: true });
  b.rule({ id: 'reset-key', when: { on: 'key', key: 'r' }, then: [{ do: 'reset' }] });

  // Workshop dressing: lights over every machine, crates and a tool bench behind.
  XS.forEach((x, i) => {
    b.light(b.empty('machine-light', [x, 7.5, 2]), [0, 0, 0], '#fff1dc', 2.2, 16);
    b.prim('backdrop-panel', 'box', [13, 5, 0.2], [x, r2(S + 2.5), -8.6], { material: { preset: 'plastic', color: i % 2 ? '#2b2d42' : '#33364d', roughness: 0.8 }, physics: 'static' });
    b.prim('backdrop-stripe', 'box', [13, 0.16, 0.06], [x, r2(S + 4.6), -8.45], { material: { preset: 'neon', color: COLORS[i] as string, emissive: COLORS[i] as string, emissiveIntensity: 1.6 }, castShadow: false });
  });
  b.player({ mode: 'orbit', spawn: [0, 12, 24] });

  return finish(b, {
    name: 'Chain Reaction',
    description: 'Five Rube-Goldberg machines wired into one physics chain reaction.',
    intro: {
      title: 'Chain Reaction',
      tagline: 'Five machines. One push. Every bounce simulated and checked.',
      objective: 'Start the chain and watch dominoes, a marble, a wrecking ball, an avalanche and a strike set each other off.',
      controls: ['Space — start', 'Click — start a machine', 'Drag — orbit', 'R — reset', 'Esc — editor'],
      accent: '#ffb547',
    },
    plan: 'Plan: five physics machines on a workshop stage (domino spiral, marble run, pendulum wrecking ball, crate avalanche, bowling strike), wired by finale plates and events into one chain, each verified by a test.',
    message: 'Built Chain Reaction: five Rube-Goldberg machines in a row, each finale starting the next. Press Play, then SPACE (or click a glowing button). Every machine is verified to complete in the physics check.',
  });
}
