/**
 * Builders for NPC tests: a world with kinematic capsule characters, a
 * fake player avatar and small stepping helpers.
 */
import type { EntityInput, NpcSpecInput, RuleInput, Vec3, WorldDocInput } from '@aether/core';
import { LogicRuntime } from '../src';
import { DT, FakeHost, input, worldOf } from './helpers';

/** A kinematic capsule character at (x, z) standing on the ground. */
export function npcEntity(id: string, x: number, z: number, npc: Readonly<Record<string, unknown>>, extra: Partial<EntityInput> = {}): EntityInput {
  return {
    id,
    name: id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    shape: { kind: 'primitive', primitive: 'capsule', size: [0.8, 1.8, 0.8] },
    transform: { position: [x, 0.9, z] },
    physics: { body: 'kinematic' },
    ...extra,
    npc: npc as NpcSpecInput,
  };
}

/** A solid box wall (static). */
export function wallEntity(id: string, x: number, z: number, w: number, d: number, h = 3): EntityInput {
  return {
    id,
    shape: { kind: 'primitive', primitive: 'box', size: [w, h, d] },
    transform: { position: [x, h / 2, z] },
    physics: { body: 'static' },
  };
}

/** A running NPC world with a controllable player avatar. */
export interface NpcRig {
  host: FakeHost;
  rt: LogicRuntime;
  /** Move the avatar (feet position). */
  player(x: number, z: number, y?: number): void;
  /** Tick `seconds` of simulated time; `keys` held for the whole span. */
  run(seconds: number, keys?: readonly string[]): void;
  /** One tick with a key tap. */
  tap(key: string): void;
  at(id: string): Vec3;
  state(key: string): unknown;
  mode(id: string): string | undefined;
}

/** Build a rig. The player starts far away (100, 100) unless `player` is given. */
export function rig(entities: EntityInput[], opts: { player?: [number, number]; rules?: RuleInput[]; extra?: WorldDocInput } = {}): NpcRig {
  const host = new FakeHost();
  const w = worldOf(entities, opts.rules ?? [], opts.extra ?? {});
  host.player = 'avatar';
  const [px, pz] = opts.player ?? [100, 100];
  host.place('avatar', [px, 0, pz]);
  const rt = new LogicRuntime(w, host);
  const r: NpcRig = {
    host,
    rt,
    player(x, z, y = 0) {
      host.place('avatar', [x, y, z]);
    },
    run(seconds, keys = []) {
      const n = Math.round(seconds / DT);
      const inp = keys.length > 0 ? input({ keys: new Set(keys) }) : input();
      for (let i = 0; i < n; i++) rt.tick(DT, inp, []);
    },
    tap(key) {
      rt.tick(DT, input({ keys: new Set([key]) }), []);
      rt.tick(DT, input(), []);
    },
    at(id) {
      const t = host.getTransform(id);
      if (t) return t.position;
      const info = rt.npcs.info(id);
      if (!info) throw new Error(`no transform for ${id}`);
      return [info.x, 0.9, info.z];
    },
    state(key) {
      return rt.readState(key);
    },
    mode(id) {
      return rt.npcs.info(id)?.mode;
    },
  };
  return r;
}

/** Walk the avatar along a straight line, one tick per step, `speed` m/s. */
export function walkPlayer(r: NpcRig, from: [number, number], to: [number, number], speed: number): void {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.max(1, Math.round(d / (speed * DT)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    r.player(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t);
    r.rt.tick(DT, input(), []);
  }
}
