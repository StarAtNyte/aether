/**
 * A synthetic heavy generated world: a hall with 150 framed art pieces (five subjects, many sizes and seeds),
 * 400 scattered instances (plaques, cases, columns, chairs) and 30 lights. Built as plain JSON so it needs no model.
 */
const SUBJECTS = ['abstract', 'round', 'blank', 'landscape', 'portrait'] as const;
const PARTS: Array<{ generator: string; params: Record<string, unknown> }> = [
  { generator: 'furn-plaque', params: {} },
  { generator: 'furn-vitrine', params: {} },
  { generator: 'furn-column', params: {} },
  { generator: 'furn-chair', params: {} },
];

function entity(id: string, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    id, name: id, parent: null, tags: [], transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    behaviors: [], state: {}, visible: true, castShadow: true, receiveShadow: true, template: false, ...extra,
  };
}

export function heavyWorld(): unknown {
  const entities: Record<string, unknown> = {};
  const add = (e: Record<string, unknown>): void => void (entities[e['id'] as string] = e);
  const W = 48, D = 36;
  add(entity('floor', { transform: { position: [W / 2, -0.05, D / 2], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { kind: 'primitive', primitive: 'box', size: [W, 0.1, D] }, material: { finish: 'stone', color: '#b9b2a4' } }));
  for (const [id, p, s] of [['wn', [W / 2, 3, 0], [W, 6, 0.3]], ['ws', [W / 2, 3, D], [W, 6, 0.3]], ['ww', [0, 3, D / 2], [0.3, 6, D]], ['we', [W, 3, D / 2], [0.3, 6, D]]] as const) {
    add(entity(id, { transform: { position: [...p], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { kind: 'primitive', primitive: 'box', size: [...s] }, material: { finish: 'paint', color: '#e4dccb' } }));
  }
  // 150 art pieces in 15 sets along the long walls.
  for (let i = 0; i < 15; i++) {
    const north = i % 2 === 0, row = Math.floor(i / 2);
    add(entity(`art-${i}`, {
      transform: { position: [2 + row * 5.6, 0, north ? 0.2 : D - 0.2], rotation: [0, north ? 0 : 180, 0], scale: [1, 1, 1] },
      shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'furn-frame', params: { subject: SUBJECTS[i % SUBJECTS.length] } }, count: 10, area: [1, 1], seed: 100 + i, scaleRange: [0.8, 1.3], randomYaw: false,
        points: Array.from({ length: 10 }, (_, k) => [(k % 5) * 1.05, 1.2 + Math.floor(k / 5) * 1.1, 0]) },
    }));
  }
  // 400 instances of small furniture.
  for (let i = 0; i < 10; i++) {
    const part = PARTS[i % PARTS.length]!;
    add(entity(`set-${i}`, {
      transform: { position: [3, 0, 4 + i * 2.8], rotation: [0, 0, 0], scale: [1, 1, 1] },
      shape: { kind: 'scatter', of: { kind: 'procedural', generator: part.generator, params: part.params }, count: 40, area: [W - 8, 2], seed: 900 + i, scaleRange: [0.9, 1.1], randomYaw: true },
    }));
  }
  for (let i = 0; i < 30; i++) {
    add(entity(`lamp-${i}`, {
      transform: { position: [3 + (i % 10) * 4.5, 4.6, 6 + Math.floor(i / 10) * 12], rotation: [0, 0, 0], scale: [1, 1, 1] },
      shape: { kind: 'none' }, light: { type: 'point', color: '#ffd9a0', intensity: 1.4, range: 9, angle: 60, castShadow: false },
    }));
  }
  return {
    version: 1, id: 'heavy', name: 'Heavy hall', description: 'synthetic heavy world', seed: 7,
    environment: { sky: 'day', timeOfDay: 14, fog: { color: '#cfd8e3', density: 0.002 }, weather: 'clear', ambientIntensity: 0.5, sunIntensity: 2.5, ground: { material: { preset: 'grass' }, size: 200 }, gravity: [0, -9.81, 0], bloom: 0.3, exposure: 1 },
    player: { spawn: [W / 2, 0.1, D - 4], mode: 'firstPerson', yaw: 0, moveSpeed: 3.2, jumpSpeed: 4 },
    entities, rules: [], state: {}, hud: [], generators: {}, scripts: {}, tests: [], meshes: {},
  };
}
