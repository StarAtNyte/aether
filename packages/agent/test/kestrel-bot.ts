/**
 * A human-like player for Kestrel Outpost, run headless (Rapier physics + the logic runtime): it reacts to a new
 * target after a delay, flicks toward it and settles (aim error that shrinks while it tracks, more at range), fires in
 * bursts, reloads in quiet moments, strafes, backs off from a rusher winding up, and walks to drops when hurt or low
 * on ammunition. Its skill (0 clumsy .. 1 sharp) scales the delay and the aim error. Deterministic per seed.
 */
import type { Entity, Vec3, WorldDoc } from '@aether/core';
import { Session } from '@aether/playtest';

export interface BotRun {
  outcome: string | null;
  /** The end screen's text (who brought the player down). */
  endText: string;
  /** Highest wave reached, and the last wave fully cleared. */
  waveMax: number;
  cleared: number;
  kills: number;
  minHealth: number;
  minRelay: number;
  drops: number;
  pickedUp: number;
  shots: number;
  hits: number;
  seconds: number;
  /** Game time when the first hit on the player landed (−1: never). */
  firstHurt: number;
}

export async function playKestrel(w: WorldDoc, opts: { seed: number; skill: number; limit?: number }): Promise<BotRun> {
  const limit = opts.limit ?? 600;
  const s = await Session.create(w, { trace: false });
  const rt = s.runtime;
  let seed = opts.seed >>> 0 || 1;
  const rand = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const gauss = (): number => (rand() + rand() + rand() + rand() - 2) * 0.87;
  const skill = Math.max(0, Math.min(1, opts.skill));
  const reaction = 0.55 - 0.3 * skill;
  const baseErr = ((3.2 - 2.2 * skill) * Math.PI) / 180;
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
  const run: BotRun = { outcome: null, endText: '', waveMax: 0, cleared: 0, kills: 0, minHealth: 100, minRelay: Infinity, drops: 0, pickedUp: 0, shots: 0, hits: 0, seconds: 0, firstHurt: -1 };
  const home: Vec3 = [1.5, 0, 5];
  let target: string | null = null;
  let trackT = 0;
  let errX = 0;
  let errY = 0;
  let burstT = 0;
  let strafe = 1;
  let strafeT = 0;
  let reloadTap = false;
  let lastWave = 0;
  // Firing at the same target without landing a hit for a while: it is behind something, so go round to it.
  let missT = 0;
  let hitsSeen = 0;
  while (s.time < limit && !s.over) {
    const dt = 1 / 60;
    const p = s.position;
    const eye: Vec3 = [p[0], p[1] + 1.6, p[2]];
    let best: { id: string; x: number; y: number; z: number; d: number; rusher: boolean; winding: boolean } | null = null;
    for (const b of rt.npcs.brains) {
      if (b.dead || b.spec.faction !== 'raiders') continue;
      const d = Math.hypot(b.x - p[0], b.z - p[2]);
      if (d > 60) continue;
      const rusher = b.spec.attack?.ranged !== true;
      // Rushers close in are the first priority, then the nearest.
      const score = d - (rusher && d < 12 ? 20 : 0);
      if (!best || score < best.d - (best.rusher && best.d < 12 ? 20 : 0)) best = { id: b.id, x: b.x, y: b.feetY + b.spec.height * 0.62, z: b.z, d, rusher, winding: b.animation === 'attack' };
    }
    if (best?.id !== target) {
      target = best?.id ?? null;
      trackT = 0;
      // A new target: the first look lands well off it.
      errX = gauss() * baseErr * 3;
      errY = gauss() * baseErr * 2;
    }
    trackT += dt;
    // Settle onto the target, with tremor; farther targets are harder.
    const settle = Math.exp(-dt / 0.35);
    const range = best ? 1 + best.d / 25 : 1;
    errX = errX * settle + gauss() * baseErr * 0.35 * range;
    errY = errY * settle + gauss() * baseErr * 0.25 * range;
    const health = rt.readState('health') as number;
    const ammo = rt.readState('ammo') as number;
    const reserve = rt.readState('reserve') as number;
    const hitsNow = rt.weapon?.hits ?? 0;
    if (hitsNow > hitsSeen || !best) missT = 0;
    else if (trackT > reaction) missT += dt;
    hitsSeen = hitsNow;
    let goal: Vec3 = missT > 4 && best ? [best.x, 0, best.z] : home;
    if ((health < 60 || reserve < 40) && drops.size > 0 && !(best && best.d < 10)) {
      let bd = Infinity;
      for (const at of drops.values()) {
        const d = Math.hypot(at[0] - p[0], at[2] - p[2]);
        if (d < bd && d < 25) {
          bd = d;
          goal = at;
        }
      }
    }
    let forward = 0;
    let right = 0;
    const gx = goal[0] - p[0];
    const gz = goal[2] - p[2];
    const away = Math.hypot(gx, gz);
    let moveYaw = (Math.atan2(-gx, -gz) * 180) / Math.PI;
    if (away > 1.5) forward = 1;
    else if (best && best.d < 30) {
      if (s.time - strafeT > 1.2 + rand()) {
        strafeT = s.time;
        strafe = -strafe;
      }
      right = strafe * 0.7;
      moveYaw = (Math.atan2(-(best.x - p[0]), -(best.z - p[2])) * 180) / Math.PI;
    }
    // A rusher winding up within reach: step back out of it (a sharp player more often than a clumsy one).
    if (best && best.rusher && best.winding && best.d < 2.6 && rand() < 0.04 + 0.08 * skill) {
      forward = -1;
      right = 0;
      moveYaw = (Math.atan2(-(best.x - p[0]), -(best.z - p[2])) * 180) / Math.PI;
    }
    let aim: { origin: Vec3; dir: Vec3 } | undefined;
    let fire = false;
    if (best && trackT > reaction) {
      const dx = best.x - eye[0];
      const dy = best.y - eye[1];
      const dz = best.z - eye[2];
      const yaw = Math.atan2(-dx, -dz) + errX;
      const pitch = Math.atan2(dy, Math.hypot(dx, dz)) + errY;
      aim = { origin: eye, dir: [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)] };
      // Bursts: hold for about a second, ease off for a moment.
      burstT += dt;
      if (burstT > 1.4) burstT = 0;
      fire = burstT < 1.05;
    }
    const wantReload = ammo < 8 && reserve > 0 && !(best && best.d < 15);
    const keys = wantReload && !reloadTap ? ['KeyR'] : [];
    reloadTap = wantReload;
    s.tick({ forward, right, jump: false, yawDeg: moveYaw, fire, ...(aim ? { aim } : {}), keys });
    const wave = rt.readState('wave') as number;
    if (wave > lastWave) {
      run.cleared = Math.max(run.cleared, wave - 1);
      lastWave = wave;
    }
    run.waveMax = Math.max(run.waveMax, wave);
    const h = rt.readState('health') as number;
    if (h < 100 && run.firstHurt < 0) run.firstHurt = Math.round(s.time * 10) / 10;
    run.minHealth = Math.min(run.minHealth, h);
    const relay = rt.readState('relay.health');
    if (typeof relay === 'number') run.minRelay = Math.min(run.minRelay, relay);
  }
  run.outcome = s.host.seen.outcome;
  run.endText = s.host.seen.endText;
  if (run.outcome === 'win') run.cleared = run.waveMax;
  run.kills = rt.readState('kills') as number;
  run.drops = dropCount;
  run.pickedUp = pickedUp;
  run.shots = rt.weapon?.shots ?? 0;
  run.hits = rt.weapon?.hits ?? 0;
  run.seconds = Math.round(s.time);
  return run;
}
