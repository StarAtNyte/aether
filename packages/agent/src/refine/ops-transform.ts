/**
 * Geometry edits: move, rotate, resize, reshape. Parametric objects change
 * their own dimension parameters (a "wider sofa" gets a bigger `width`, not a
 * stretched mesh); everything else changes its transform. Moves are relative
 * to the viewer ("left" means the viewer's left).
 */
import type { Entity, EntityId, Json, ParamSpec, Vec3 } from '@aether/core';
import type { Command, Relation } from './command';
import { resolveRef } from './resolve';
import type { SceneItem } from './scene';
import { viewVectors } from './walls';
import { ask, describeTargets, failed, outcome, type OpEnv, type OpOutcome } from './ops-types';

const r2 = (n: number): number => Math.round(n * 100) / 100;

function toLocal(env: OpEnv, e: Entity, dx: number, dy: number, dz: number): Vec3 {
  const parent = e.parent !== null ? env.index.get(e.parent) : undefined;
  if (!parent) return [dx, dy, dz];
  const a = (-parent.yaw * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const sc = parent.entity.transform.scale;
  // parent's accumulated scale is the item's scale ratio; approximate with the parent's own scale.
  return [(dx * c + dz * s) / (sc[0] || 1), dy / (sc[1] || 1), (-dx * s + dz * c) / (sc[2] || 1)];
}

function worldDelta(env: OpEnv, dir: NonNullable<Extract<Command, { op: 'move' }>['direction']>, metres: number): [number, number, number] {
  const { forward, right } = viewVectors(env.ctx.heading);
  switch (dir) {
    case 'left':
      return [-right[0] * metres, 0, -right[1] * metres];
    case 'right':
      return [right[0] * metres, 0, right[1] * metres];
    case 'forward':
      return [forward[0] * metres, 0, forward[1] * metres];
    case 'back':
      return [-forward[0] * metres, 0, -forward[1] * metres];
    case 'up':
      return [0, metres, 0];
    case 'down':
      return [0, -metres, 0];
    case 'north':
      return [0, 0, -metres];
    case 'south':
      return [0, 0, metres];
    case 'east':
      return [metres, 0, 0];
    case 'west':
      return [-metres, 0, 0];
  }
}

function shift(env: OpEnv, item: SceneItem, d: [number, number, number]): void {
  const ent = env.draft.entity(item.id);
  const l = toLocal(env, ent, d[0], d[1], d[2]);
  const p = ent.transform.position;
  ent.transform.position = [r2(p[0] + l[0]), r2(p[1] + l[1]), r2(p[2] + l[2])];
}

/** True for things that stand on what is under them (not pickups, floating, flying, moving or building pieces). */
function restsOnGround(e: Entity): boolean {
  if (e.arch || e.npc || e.light) return false;
  if (e.tags.some((t) => /float|hover|fly|sky|cloud|bird|balloon|hanging|platform/.test(t))) return false;
  if (e.behaviors.some((b) => ['bob', 'orbit', 'spin', 'collectible', 'magnet', 'goal', 'checkpoint', 'path', 'patrol'].includes(b.type))) return false;
  return !(e.physics && (e.physics.sensor || e.physics.body === 'dynamic' || e.physics.body === 'kinematic'));
}

/** True when the entity origin sits at its centre (primitives, wall fixtures) rather than on the floor. */
function centred(item: SceneItem): boolean {
  return item.entity.shape.kind === 'primitive' || item.entity.arch?.role === 'fixture' || item.entity.arch?.role === 'light';
}

/** Destination (world) for putting `item` in `rel` of `anchor`. */
function destination(env: OpEnv, item: SceneItem, anchor: SceneItem, rel: Relation): [number, number, number] {
  const { forward, right } = viewVectors(env.ctx.heading);
  const reach = (a: SceneItem, b: SceneItem, along: [number, number]): number => {
    const ax = Math.abs(along[0]) * a.size[0] + Math.abs(along[1]) * a.size[2];
    const bx = Math.abs(along[0]) * b.size[0] + Math.abs(along[1]) * b.size[2];
    return ax / 2 + bx / 2 + 0.2;
  };
  const here: [number, number] = [item.pos[0] - anchor.pos[0], item.pos[2] - anchor.pos[2]];
  const side = here[0] * right[0] + here[1] * right[1] >= 0 ? 1 : -1;
  switch (rel) {
    case 'left of':
      return [anchor.pos[0] - right[0] * reach(anchor, item, right), item.pos[1], anchor.pos[2] - right[1] * reach(anchor, item, right)];
    case 'right of':
      return [anchor.pos[0] + right[0] * reach(anchor, item, right), item.pos[1], anchor.pos[2] + right[1] * reach(anchor, item, right)];
    case 'next to':
    case 'near': {
      const d = reach(anchor, item, right) * side;
      return [anchor.pos[0] + right[0] * d, item.pos[1], anchor.pos[2] + right[1] * d];
    }
    case 'behind':
      return [anchor.pos[0] + forward[0] * reach(anchor, item, forward), item.pos[1], anchor.pos[2] + forward[1] * reach(anchor, item, forward)];
    case 'in front of':
      return [anchor.pos[0] - forward[0] * reach(anchor, item, forward), item.pos[1], anchor.pos[2] - forward[1] * reach(anchor, item, forward)];
    case 'above':
    case 'on': {
      const top = anchor.pos[1] + anchor.size[1] * (centred(anchor) ? 0.5 : 1);
      const wall = item.entity.arch?.role === 'fixture';
      return [anchor.pos[0], top + (centred(item) ? item.size[1] / 2 : 0) + (wall ? 0.3 : 0), anchor.pos[2]];
    }
    case 'under':
    case 'below':
    case 'inside':
      return [anchor.pos[0], anchor.pos[1] + (centred(item) ? item.size[1] / 2 - (centred(anchor) ? anchor.size[1] / 2 : 0) : 0), anchor.pos[2]];
  }
}

/** Move commands. */
export function planMove(env: OpEnv, cmd: Extract<Command, { op: 'move' }>): OpOutcome {
  const res = resolveRef(env.index, cmd.ref, env.ctx);
  if (res.ambiguous && res.ambiguous.length > 0) return ask(res.reason ?? 'Which one?', res.ambiguous);
  if (res.items.length === 0) return failed(res.reason ?? `I can't find "${cmd.ref.text}"`);
  const items = res.items;
  const also: EntityId[] = [];
  if (cmd.to) {
    const a = resolveRef(env.index, cmd.to.anchor, env.ctx);
    const first = items[0] as SceneItem;
    // "closer to the window" with several windows means the nearest one.
    const anchor = a.ambiguous && a.ambiguous.length > 0 ? [...a.ambiguous].sort((p, q) => Math.hypot(p.pos[0] - first.pos[0], p.pos[2] - first.pos[2]) - Math.hypot(q.pos[0] - first.pos[0], q.pos[2] - first.pos[2]))[0] : a.items[0];
    if (!anchor) return failed(a.reason ?? `I can't find "${cmd.to.anchor.text}"`);
    const dest = destination(env, first, anchor, cmd.to.rel);
    const d: [number, number, number] = [dest[0] - first.pos[0], dest[1] - first.pos[1], dest[2] - first.pos[2]];
    for (const it of items) shift(env, it, d);
    // "Onto the hill": the anchor's box top is only a guess at the surface there (a hill's crown, a rock's slope);
    // outdoors the host settles the moved things on the real surface under them. Rooms place by their own rules.
    const onto = (cmd.to.rel === 'above' || cmd.to.rel === 'on') && !anchor.entity.arch ? items.filter((i) => restsOnGround(i.entity)).map((i) => i.id) : [];
    return outcome({ summary: `moved ${describeTargets(items)} ${cmd.to.rel} the ${anchor.label.toLowerCase()}`, targets: items.map((i) => i.id), cosmetic: false, also, ...(onto.length > 0 ? { ground: onto } : {}) });
  }
  if (cmd.toRoom) {
    const rr = resolveRef(env.index, cmd.toRoom, env.ctx);
    if (rr.ambiguous && rr.ambiguous.length > 0) return ask(rr.reason ?? 'Which room?', rr.ambiguous);
    const room = rr.items[0];
    if (!room) return failed(rr.reason ?? `I can't find "${cmd.toRoom.text}"`);
    const poly = room.entity.shape.kind === 'procedural' ? (room.entity.shape.params['polygon'] as Json) : undefined;
    let cx = room.pos[0];
    let cz = room.pos[2];
    if (Array.isArray(poly) && poly.length >= 3) {
      cx = room.pos[0] + (poly as number[][]).reduce((s, p) => s + (p[0] as number), 0) / poly.length;
      cz = room.pos[2] + (poly as number[][]).reduce((s, p) => s + (p[1] as number), 0) / poly.length;
    }
    const first = items[0] as SceneItem;
    for (const it of items) shift(env, it, [cx - first.pos[0], 0, cz - first.pos[2]]);
    return outcome({ summary: `moved ${describeTargets(items)} to the ${room.label.toLowerCase()}`, targets: items.map((i) => i.id), cosmetic: false });
  }
  if (!cmd.direction) return failed('I did not catch which way to move it');
  const d = worldDelta(env, cmd.direction, cmd.metres);
  for (const it of items) shift(env, it, d);
  const dist = cmd.metres < 1 ? `${Math.round(cmd.metres * 100)} cm` : `${r2(cmd.metres)} m`;
  return outcome({ summary: `moved ${describeTargets(items)} ${dist} ${cmd.direction}`, targets: items.map((i) => i.id), cosmetic: false });
}

/** Rotate commands. */
export function planRotate(env: OpEnv, cmd: Extract<Command, { op: 'rotate' }>): OpOutcome {
  const res = resolveRef(env.index, cmd.ref, env.ctx);
  if (res.ambiguous && res.ambiguous.length > 0) return ask(res.reason ?? 'Which one?', res.ambiguous);
  if (res.items.length === 0) return failed(res.reason ?? `I can't find "${cmd.ref.text}"`);
  for (const it of res.items) {
    const ent = env.draft.entity(it.id);
    const r = ent.transform.rotation;
    let y = r[1] + cmd.degrees;
    y = ((((y + 180) % 360) + 360) % 360) - 180;
    ent.transform.rotation = [r[0], r2(y), r[2]];
  }
  return outcome({ summary: `rotated ${describeTargets(res.items, cmd.ref)} ${Math.abs(cmd.degrees)}°`, targets: res.items.map((i) => i.id), cosmetic: false });
}

const DIM_KEYS: Readonly<Record<string, string[]>> = {
  height: ['height', 'h', 'size'],
  width: ['width', 'w', 'length', 'size'],
  depth: ['depth', 'd', 'width', 'size'],
  length: ['length', 'width', 'size'],
  radius: ['radius', 'diameter', 'size', 'width'],
  size: ['size', 'scale', 'width'],
  thickness: ['thickness', 'depth', 'thick'],
};

function dimKey(spec: Record<string, ParamSpec> | undefined, dimension: string): { key: string; spec: ParamSpec } | undefined {
  if (!spec) return undefined;
  for (const k of DIM_KEYS[dimension] ?? [dimension]) {
    const s = spec[k];
    if (s && (s.type === 'number' || s.type === 'int')) return { key: k, spec: s };
  }
  return undefined;
}

function clampTo(spec: ParamSpec, v: number): number {
  let n = v;
  if (spec.min !== undefined) n = Math.max(spec.min, n);
  if (spec.max !== undefined) n = Math.min(spec.max, n);
  return spec.type === 'int' ? Math.round(n) : r2(n);
}

function currentNumber(e: Entity, key: string, spec: ParamSpec): number {
  const sh = e.shape;
  const v = sh.kind === 'procedural' && Object.hasOwn(sh.params, key) ? sh.params[key] : spec.default;
  return typeof v === 'number' ? v : 1;
}

/** Scale (relative) commands. */
export function planScale(env: OpEnv, cmd: Extract<Command, { op: 'scale' }>): OpOutcome {
  const res = resolveRef(env.index, cmd.ref, env.ctx);
  if (res.ambiguous && res.ambiguous.length > 0) return ask(res.reason ?? 'Which one?', res.ambiguous);
  if (res.items.length === 0) return failed(res.reason ?? `I can't find "${cmd.ref.text}"`);
  const also: EntityId[] = [];
  // "Longer" is how far something hangs for curtains and the like, how far it runs for everything else.
  const hangs = res.items.every((i) => /curtain|drape|blind|banner|flag|rope|cable|chain/.test(i.kind));
  const dimension = cmd.axis === 'y' || (cmd.axis === 'z' && hangs) ? 'height' : cmd.axis === 'x' ? 'width' : cmd.axis === 'z' ? 'length' : undefined;
  let usedParams = 0;
  for (const it of res.items) {
    const ent = env.draft.entity(it.id);
    const sh = ent.shape;
    if (sh.kind === 'procedural' && dimension) {
      const spec = env.params(sh.generator);
      const dk = dimKey(spec, dimension);
      if (dk) {
        sh.params = { ...sh.params, [dk.key]: clampTo(dk.spec, currentNumber(it.entity, dk.key, dk.spec) * cmd.factor) };
        usedParams++;
        continue;
      }
    }
    if (sh.kind === 'procedural' && !dimension) {
      // Uniform growth of a parametric object: prefer its own size parameters.
      const spec = env.params(sh.generator);
      const dk = dimKey(spec, 'height');
      const wk = dimKey(spec, 'width');
      if (dk && spec) {
        const params: Record<string, Json> = { ...sh.params, [dk.key]: clampTo(dk.spec, currentNumber(it.entity, dk.key, dk.spec) * cmd.factor) };
        if (wk && wk.key !== dk.key) params[wk.key] = clampTo(wk.spec, currentNumber(it.entity, wk.key, wk.spec) * cmd.factor);
        sh.params = params;
        usedParams++;
        continue;
      }
    }
    // A scatter field grows its instances, not the field.
    if (sh.kind === 'scatter') {
      const [lo, hi] = sh.scaleRange;
      sh.scaleRange = [r2(Math.max(0.05, lo * cmd.factor)), r2(Math.min(50, hi * cmd.factor))];
      continue;
    }
    const s = ent.transform.scale;
    const f = cmd.factor;
    const next: Vec3 = cmd.axis === 'y' ? [s[0], r2(s[1] * f), s[2]] : cmd.axis === 'x' ? [r2(s[0] * f), s[1], s[2]] : cmd.axis === 'z' ? [s[0], s[1], r2(s[2] * f)] : [r2(s[0] * f), r2(s[1] * f), r2(s[2] * f)];
    ent.transform.scale = next.map((v) => Math.max(0.02, Math.min(100, v))) as Vec3;
    // Centred primitives keep their bottom where it was.
    if (sh.kind === 'primitive' && ent.parent === null) {
      const dy = ((next[1] - s[1]) * sh.size[1]) / 2;
      ent.transform.position = [ent.transform.position[0], r2(ent.transform.position[1] + dy), ent.transform.position[2]];
    }
  }
  const verb = cmd.factor >= 1 ? (cmd.axis === 'y' ? 'taller' : cmd.axis === 'x' ? 'wider' : cmd.axis === 'z' ? 'longer' : 'bigger') : cmd.axis === 'y' ? 'shorter' : cmd.axis === 'x' ? 'narrower' : cmd.axis === 'z' ? 'shorter' : 'smaller';
  void usedParams;
  return outcome({ summary: `made ${describeTargets(res.items, cmd.ref)} ${verb} (${cmd.factor >= 1 ? '+' : ''}${Math.round((cmd.factor - 1) * 100)}%)`, targets: res.items.map((i) => i.id), cosmetic: false, also });
}

/** Absolute dimension commands ("make the table 2 m wide"). */
export function planResize(env: OpEnv, cmd: Extract<Command, { op: 'resize' }>): OpOutcome {
  const res = resolveRef(env.index, cmd.ref, env.ctx);
  if (res.ambiguous && res.ambiguous.length > 0) return ask(res.reason ?? 'Which one?', res.ambiguous);
  if (res.items.length === 0) return failed(res.reason ?? `I can't find "${cmd.ref.text}"`);
  for (const it of res.items) {
    const ent = env.draft.entity(it.id);
    const sh = ent.shape;
    if (sh.kind === 'procedural') {
      const dk = dimKey(env.params(sh.generator), cmd.dimension);
      if (dk) {
        sh.params = { ...sh.params, [dk.key]: clampTo(dk.spec, cmd.value) };
        continue;
      }
    }
    const axis = cmd.dimension === 'height' ? 1 : cmd.dimension === 'width' || cmd.dimension === 'radius' ? 0 : 2;
    const current = Math.max(0.01, it.size[axis] ?? 1);
    const f = cmd.value / current;
    const s = ent.transform.scale;
    const next: Vec3 = axis === 1 ? [s[0], r2(s[1] * f), s[2]] : axis === 0 ? [r2(s[0] * f), s[1], s[2]] : [s[0], s[1], r2(s[2] * f)];
    ent.transform.scale = next;
    if (sh.kind === 'primitive' && axis === 1) ent.transform.position = [ent.transform.position[0], r2(ent.transform.position[1] + ((next[1] - s[1]) * sh.size[1]) / 2), ent.transform.position[2]];
  }
  return outcome({ summary: `set the ${cmd.dimension} of ${describeTargets(res.items, cmd.ref)} to ${r2(cmd.value)} m`, targets: res.items.map((i) => i.id), cosmetic: false });
}

const SHAPE_SYNONYMS: Readonly<Record<string, string[]>> = {
  round: ['round', 'circular', 'circle', 'oval', 'rounded'],
  circular: ['round', 'circular', 'circle'],
  oval: ['oval', 'round', 'elliptical'],
  elliptical: ['oval', 'elliptical'],
  square: ['square', 'rect', 'rectangular', 'rectangle'],
  rectangular: ['rectangular', 'rect', 'rectangle', 'square'],
  hexagonal: ['hexagon', 'hexagonal', 'hex'],
  octagonal: ['octagon', 'octagonal'],
  triangular: ['triangle', 'triangular'],
  rounded: ['rounded', 'round'],
  curved: ['curved', 'round'],
  straight: ['straight', 'rect', 'rectangular'],
};

/** Reshape commands ("make the table round"). */
export function planShape(env: OpEnv, cmd: Extract<Command, { op: 'shape' }>): OpOutcome {
  const res = resolveRef(env.index, cmd.ref, env.ctx);
  if (res.ambiguous && res.ambiguous.length > 0) return ask(res.reason ?? 'Which one?', res.ambiguous);
  if (res.items.length === 0) return failed(res.reason ?? `I can't find "${cmd.ref.text}"`);
  const words = SHAPE_SYNONYMS[cmd.word] ?? [cmd.word];
  const notes: string[] = [];
  let changed = 0;
  for (const it of res.items) {
    const ent = env.draft.entity(it.id);
    const sh = ent.shape;
    if (sh.kind === 'procedural') {
      const spec = env.params(sh.generator);
      let done = false;
      for (const [key, s] of Object.entries(spec ?? {})) {
        if (s.type !== 'enum' || !s.options) continue;
        const opt = s.options.find((o) => words.includes(o.toLowerCase()));
        if (opt && /shape|top|style|form|outline|plan/.test(`${key} ${s.description ?? ''}`.toLowerCase())) {
          sh.params = { ...sh.params, [key]: opt };
          done = true;
          break;
        }
      }
      if (done) {
        changed++;
        continue;
      }
      // Furniture "shape" is usually a string enum under another name: any enum offering the word.
      for (const [key, s] of Object.entries(spec ?? {})) {
        const opt = s.type === 'enum' ? s.options?.find((o) => words.includes(o.toLowerCase())) : undefined;
        if (opt) {
          sh.params = { ...sh.params, [key]: opt };
          done = true;
          break;
        }
      }
      if (done) changed++;
      else notes.push(`the ${it.label.toLowerCase()} has no ${cmd.word} variant`);
      continue;
    }
    if (sh.kind === 'primitive') {
      const target = /round|circular|oval|elliptical|rounded/.test(cmd.word) ? 'cylinder' : /square|rectangular|straight/.test(cmd.word) ? 'box' : undefined;
      if (target && sh.primitive !== target && (sh.primitive === 'box' || sh.primitive === 'cylinder')) {
        const [w, h, d] = sh.size;
        ent.shape = { kind: 'primitive', primitive: target, size: target === 'cylinder' ? [Math.max(w, d), h, Math.max(w, d)] : [w, h, d] };
        changed++;
        continue;
      }
    }
    notes.push(`I can't make the ${it.label.toLowerCase()} ${cmd.word}`);
  }
  if (changed === 0) return failed(notes[0] ? `${notes[0]}.` : `I can't make that ${cmd.word}`, { notes });
  return outcome({ summary: `made ${describeTargets(res.items, cmd.ref)} ${cmd.word}`, targets: res.items.map((i) => i.id), cosmetic: false, notes });
}
