import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, summarizeWorld } from '../src/index';
import { sampleWorld } from './helpers';

describe('summarizeWorld', () => {
  it('renders the documented compact format (snapshot)', () => {
    const w = sampleWorld({
      generators: { tower: { id: 'tower', description: 'd', source: 'x' } },
      environment: { fog: { color: '#888888', density: 0.02 }, timeOfDay: 18 },
    });
    expect(summarizeWorld(w)).toBe(
      [
        'world "Coin Run" seed=1 entities=6 rules=2 tests=1',
        'env sky=day weather=clear time=18 fog=#888888/0.02 ground=grass gravity=0,-9.8,0',
        'player vehicle spawn=0,1,8 controls=car speed=6 jump=6',
        'state score=0',
        'hud score:"Score"',
        'generators tower',
        'entities:',
        'car | Red Car | box 2x1x4 | pos 0,1,0 | dynamic | tags vehicle',
        '  wheel | - | cylinder d=0.6 h=0.3 | pos 0,0,0 | joint revolute->car',
        '    hub | - | empty | pos 0,0,0',
        'coin | - | empty | pos 0,0,0 | behaviors spin(speed=2) | tags coin | state value=1',
        'floor | Floor | box 20x1x20 | pos 0,-0.5,0 | static',
        'grass | - | scatter 100x cone d=1 h=1 area=10x10 on=floor | pos 0,0,0',
        'rules:',
        'rule pickup: when enter(zone=#coin) if score<10 then add(score,1), destroy(coin)',
        'rule crash: when collision(a=car,b=floor) then set(car.crashed=true)',
        'tests:',
        'test car-stays: staysAbove(target=car, y=-1, within=10)',
      ].join('\n'),
    );
  });

  it('shows rotation, scale, procedural params, lights, materials and flags', () => {
    const w = createWorld({
      name: 'Misc',
      environment: { ground: null },
      entities: {
        tree: { id: 'tree', name: 'Oak', shape: { kind: 'procedural', generator: 'tree', params: { height: 5.25, leaves: '#00ff00', seedy: true, a: 1, b: 2 }, seed: 3 }, transform: { position: [1.04, 0, -2.06], rotation: [0, 45, 0], scale: [2, 2, 2] } },
        lamp: { id: 'lamp', light: { type: 'point', intensity: 2 }, material: { preset: 'metal', color: '#cccccc' }, transform: { scale: [1, 2, 1] } },
        tpl: { id: 'tpl', template: true, visible: false, physics: { body: 'dynamic', sensor: true, mass: 3 } },
        ship: { id: 'ship', shape: { kind: 'model', url: '/models/ship.glb', fitSize: 4 } },
      },
      rules: [
        { id: 'r', when: { on: 'tick', every: 2 }, if: [{ key: 'door-1.open', op: '==', value: true }, { key: 'mode', op: '!=', value: 'x' }], then: [{ do: 'spawn', template: 'tpl', count: 3, at: [0, 1, 0] }, { do: 'message', text: 'Hello, world' }], once: true, enabled: false },
      ],
      tests: [{ id: 'reach', kind: 'reaches', target: 'player', zone: { center: [1, 2, 3], radius: 2 } }, { id: 'ev', kind: 'eventually', condition: { key: 'score', op: '>=', value: 3 } }],
    });
    const s = summarizeWorld(w);
    expect(s).toContain('env sky=day weather=clear ground=none gravity=0,-9.8,0');
    expect(s).toContain('tree | Oak | gen:tree(a=1,b=2,height=5.3,leaves="#00ff00",+1) seed=3 | pos 1,0,-2.1 | rot 0,45,0 | scale 2');
    expect(s).toContain('lamp | - | empty | pos 0,0,0 | scale 1,2,1 | mat metal #cccccc | light point #ffffff i=2');
    expect(s).toContain('tpl | - | empty | pos 0,0,0 | dynamic sensor m=3 | template hidden');
    expect(s).toContain('ship | - | model "/models/ship.glb" fit=4');
    expect(s).toContain('rule r: when tick(every=2) if door-1.open==true and mode!="x" then spawn(template=tpl,at=[0,1,0],count=3), message("Hello, world") [once] [disabled]');
    expect(s).toContain('test reach: reaches(target=player, zone=sphere(1,2,3 r=2), within=10)');
    expect(s).toContain('test ev: eventually(score>=3, within=10)');
  });

  it('truncates past maxEntities but always includes focus entities and their ancestors', () => {
    const w = sampleWorld();
    const s = summarizeWorld(w, { maxEntities: 1, focus: ['hub', 'missing'] });
    const lines = s.split('\n');
    expect(lines).toContain('car | Red Car | box 2x1x4 | pos 0,1,0 | dynamic | tags vehicle');
    expect(lines).toContain('    hub | - | empty | pos 0,0,0');
    expect(lines.some((l) => l.trim().startsWith('wheel |'))).toBe(true);
    expect(lines).toContain('... 3 more entities');
    expect(summarizeWorld(w, { maxEntities: 0 })).toContain('... 6 more entities');
  });

  it('is deterministic regardless of insertion order', () => {
    const a = applyPatches(createWorld(), [{ op: 'add', entity: { id: 'b' } }, { op: 'add', entity: { id: 'a' } }]).world;
    const b = applyPatches(createWorld(), [{ op: 'add', entity: { id: 'a' } }, { op: 'add', entity: { id: 'b' } }]).world;
    expect(summarizeWorld(a)).toBe(summarizeWorld(b));
    expect(summarizeWorld(a)).toBe(summarizeWorld(a));
  });

  it('stays compact for large worlds', () => {
    const big = applyPatches(createWorld(), Array.from({ length: 2000 }, (_, i) => ({ op: 'add', entity: { id: `e${i}`, shape: { kind: 'primitive', primitive: 'box' } } }))).world;
    const t0 = performance.now();
    const s = summarizeWorld(big);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(s.split('\n').filter((l) => /^e\d+ \|/.test(l)).length).toBe(300);
    expect(s).toContain('... 1700 more entities');
  });

  it('truncates long user-provided text', () => {
    const w = createWorld({ name: 'n'.repeat(500), description: 'd'.repeat(500), entities: { a: { id: 'a', name: 'x'.repeat(200) } } });
    const s = summarizeWorld(w);
    expect(s.split('\n').every((l) => l.length < 260)).toBe(true);
  });
});
