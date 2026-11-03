/**
 * Kestrel Outpost plays as a shooter, headless: Rapier physics, the logic runtime and a bot that stays at the outpost,
 * aims at the nearest raider's chest and fires, walks to drops when it runs low, and reloads. The waves must come and
 * advance, raiders must die and drop loot, the player and the relay must take fire, and the session must end.
 */
import { applyPatches, createWorld, type Entity, type Vec3, type WorldDoc } from '@aether/core';
import { initPhysics } from '@aether/physics';
import { Session } from '@aether/playtest';
import { beforeAll, describe, expect, it } from 'vitest';
import { KESTREL_WAVES, kestrelOutpost } from '../src/providers/mock/showcase/kestrel-outpost';

function world(): WorldDoc {
  const r = applyPatches(createWorld(), kestrelOutpost().patches);
  expect(r.errors.map((e) => e.message)).toEqual([]);
  return r.world;
}

interface Run {
  outcome: string | null;
  waveMax: number;
  kills: number;
  minHealth: number;
  minRelay: number;
  drops: number;
  pickedUp: number;
  shots: number;
  hits: number;
  seconds: number;
}

/** Play up to `limit` game seconds. */
async function play(w: WorldDoc, limit: number): Promise<Run> {
  const s = await Session.create(w, { trace: false });
  const rt = s.runtime;
  const drops = new Map<string, Vec3>();
  let dropCount = 0;
  let pickedUp = 0;
  const spawn = s.host.spawn.bind(s.host);
  s.host.spawn = (e: Entity): void => {
    spawn(e);
    if (e.id.startsWith('ammo-drop') || e.id.startsWith('medkit-drop')) {
      drops.set(e.id, [e.transform.position[0], e.transform.position[1], e.transform.position[2]]);
      dropCount++;
    }
  };
  const destroy = s.host.destroy.bind(s.host);
  s.host.destroy = (id: string): void => {
    destroy(id);
    if (drops.delete(id)) pickedUp++;
  };
  const run: Run = { outcome: null, waveMax: 0, kills: 0, minHealth: 100, minRelay: 1600, drops: 0, pickedUp: 0, shots: 0, hits: 0, seconds: 0 };
  const home: Vec3 = [0, 0, 6];
  let seed = 12345;
  const rand = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let reloadTap = false;
  while (s.time < limit && !s.over) {
    const p = s.position;
    const eye: Vec3 = [p[0], p[1] + 1.6, p[2]];
    // Nearest live raider.
    let best: { x: number; y: number; z: number; d: number } | null = null;
    for (const b of rt.npcs.brains) {
      if (b.dead || b.spec.faction !== 'raiders') continue;
      const d = Math.hypot(b.x - p[0], b.z - p[2]);
      if (!best || d < best.d) best = { x: b.x, y: b.feetY + b.spec.height * 0.62, z: b.z, d };
    }
    const health = rt.readState('health') as number;
    const ammo = rt.readState('ammo') as number;
    const reserve = rt.readState('reserve') as number;
    // Low on something: go for the nearest drop; otherwise hold near the relay.
    let goal: Vec3 = home;
    if ((health < 70 || reserve < 60) && drops.size > 0) {
      let bd = Infinity;
      for (const at of drops.values()) {
        const d = Math.hypot(at[0] - p[0], at[2] - p[2]);
        if (d < bd && d < 30) {
          bd = d;
          goal = at;
        }
      }
    }
    const gx = goal[0] - p[0];
    const gz = goal[2] - p[2];
    const far = Math.hypot(gx, gz) > 1.2;
    const yawDeg = (Math.atan2(-gx, -gz) * 180) / Math.PI;
    let aim: { origin: Vec3; dir: Vec3 } | undefined;
    // A human-like shooter: engages inside 38 m and aims with a couple of degrees of error (seeded).
    if (best && best.d < 38) {
      const err = (): number => (rand() + rand() + rand() - 1.5) * 0.05;
      const d: Vec3 = [best.x - eye[0], best.y - eye[1], best.z - eye[2]];
      const l = Math.hypot(d[0], d[1], d[2]);
      const dx = d[0] / l + err();
      const dy = d[1] / l + err() * 0.6;
      const dz = d[2] / l + err();
      const m = Math.hypot(dx, dy, dz);
      aim = { origin: eye, dir: [dx / m, dy / m, dz / m] };
    }
    const wantReload = ammo < 8 && reserve > 0 && !best;
    const keys = wantReload && !reloadTap ? ['KeyR'] : [];
    reloadTap = wantReload;
    s.tick({ forward: far ? 1 : 0, right: 0, jump: false, yawDeg, fire: aim !== undefined, ...(aim ? { aim } : {}), keys });
    run.waveMax = Math.max(run.waveMax, rt.readState('wave') as number);
    run.minHealth = Math.min(run.minHealth, rt.readState('health') as number);
    const relay = rt.readState('relay.health');
    if (typeof relay === 'number') run.minRelay = Math.min(run.minRelay, relay);
  }
  run.outcome = s.host.seen.outcome;
  run.kills = rt.readState('kills') as number;
  run.drops = dropCount;
  run.pickedUp = pickedUp;
  run.shots = rt.weapon?.shots ?? 0;
  run.hits = rt.weapon?.hits ?? 0;
  run.seconds = Math.round(s.time);
  return run;
}

describe('Kestrel Outpost', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('is a shooter world: a weapon, an over-the-shoulder player, raider templates for every pass, a relay to defend', () => {
    const w = world();
    expect(w.player.weapon?.magazine).toBeGreaterThan(0);
    expect(w.player.character?.hold).toBe('rifle');
    expect(w.intro?.button).toBe('Play');
    const templates = Object.values(w.entities).filter((e) => e.template && e.npc);
    expect(templates.length).toBe(9);
    for (const t of templates) {
      expect(t.character).toBeDefined();
      expect(t.npc?.enemies).toContain('player');
      expect(t.npc?.drops?.length).toBeGreaterThan(0);
    }
    expect(w.entities['relay']?.npc?.allies).toContain('player');
    expect(w.hud.map((h) => h.key)).toEqual(['wave', 'alive', 'relay.health', 'health', 'score']);
  });

  it('plays: waves advance, raiders die and drop loot, the player and the relay take fire, and the game ends', async () => {
    const r = await play(world(), 420);
    // eslint-disable-next-line no-console
    console.log('kestrel run', r);
    expect(r.waveMax).toBeGreaterThanOrEqual(3);
    expect(r.kills).toBeGreaterThanOrEqual(10);
    expect(r.hits).toBeGreaterThan(r.shots * 0.3);
    expect(r.drops).toBeGreaterThan(0);
    expect(r.minHealth).toBeLessThan(100);
    expect(r.outcome === 'win' || r.outcome === 'lose').toBe(true);
    if (r.outcome === 'win') expect(r.waveMax).toBe(KESTREL_WAVES);
  }, 240_000);
});
