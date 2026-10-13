/**
 * Compact, deterministic text rendering of a world for LLM context.
 *
 * Format (one fact per line, defaults omitted to save tokens):
 *
 *   world "Coin Run" seed=1 entities=3 rules=1 tests=1
 *   env sky=day weather=clear ground=grass gravity=0,-9.8,0
 *   player thirdPerson spawn=0,1,8 speed=6 jump=6
 *   state score=0
 *   hud score:"Score"
 *   entities:
 *   floor | Floor | box 20x1x20 | pos 0,-0.5,0 | static
 *     coin-1 | Coin | cylinder d=0.6 h=0.1 | pos 0,1,0 | rot 90,0,0 | static sensor | behaviors spin | tags coin
 *   rules:
 *   rule coin-pickup: when enter(zone=#coin) if score<10 then add(score,1), destroy(#coin)
 *   tests:
 *   test falls: staysAbove(target=#coin, y=-1, within=10)
 *
 * Entities are listed depth-first (roots and siblings sorted by id), children
 * indented two spaces per level. Past `maxEntities` the rest is elided with
 * "... N more entities", but `focus` entities (and their ancestors) are
 * always included.
 */
import type { Action, Entity, EntityId, Json, ShapeSpec, Trigger, Vec3, WorldDoc, WorldTest } from './schema';
import { hasOwn, isPlainObject, truncate } from './json';

/** Options for {@link summarizeWorld}. */
export interface SummaryOptions {
  /** Maximum entity lines (default 300). */
  maxEntities?: number;
  /** Entity ids that must always be listed. */
  focus?: EntityId[];
  /**
   * Entities the user edited by hand recently (see `userEditMarks`): listed
   * even past `maxEntities` and tagged `user-edited(paths)`, newest first.
   */
  userEdits?: ReadonlyMap<EntityId, { paths: readonly string[]; age: number }>;
}

const DEFAULT_MAX_ENTITIES = 300;
const MAX_TEXT = 60;

/** Round to one decimal and drop "-0" / trailing ".0". */
function n1(n: number): string {
  const r = Math.round(n * 10) / 10;
  return String(r === 0 ? 0 : r);
}

function vec(v: Vec3): string {
  return `${n1(v[0])},${n1(v[1])},${n1(v[2])}`;
}

function json(v: Json | undefined, max = 40): string {
  if (v === undefined) return '?';
  if (typeof v === 'string') return JSON.stringify(truncate(v, max));
  if (typeof v === 'number') return n1(v);
  if (typeof v === 'boolean' || v === null) return String(v);
  return truncate(JSON.stringify(v), max);
}

function params(p: Readonly<Record<string, Json>>, maxParams = 4): string {
  const keys = Object.keys(p).sort();
  const shown = keys.slice(0, maxParams).map((k) => `${k}=${json(p[k], 24)}`);
  if (keys.length > maxParams) shown.push(`+${keys.length - maxParams}`);
  return shown.join(',');
}

function shapeText(s: ShapeSpec): string {
  switch (s.kind) {
    case 'none':
      return 'empty';
    case 'primitive': {
      const [x, y, z] = s.size;
      switch (s.primitive) {
        case 'sphere': return `sphere d=${n1(x)}`;
        case 'cylinder':
        case 'cone':
        case 'capsule': return `${s.primitive} d=${n1(x)} h=${n1(y)}`;
        case 'torus': return `torus d=${n1(x)} t=${n1(y)}`;
        case 'plane': return `plane ${n1(x)}x${n1(z)}`;
        default: return `box ${n1(x)}x${n1(y)}x${n1(z)}`;
      }
    }
    case 'procedural': {
      const p = params(s.params);
      return `gen:${s.generator}(${p})${s.seed !== undefined ? ` seed=${s.seed}` : ''}`;
    }
    case 'model':
      return `model ${JSON.stringify(truncate(s.url, 48))}${s.fitSize !== undefined ? ` fit=${n1(s.fitSize)}` : ''}`;
    case 'scatter':
      return s.points
        ? `scatter ${s.points.length}x ${shapeText(s.of)} painted${s.onSurface ? ` on=${s.onSurface}` : ''}`
        : `scatter ${s.count}x ${shapeText(s.of)} area=${n1(s.area[0])}x${n1(s.area[1])}${s.onSurface ? ` on=${s.onSurface}` : ''}`;
    case 'mesh':
      return `mesh:${s.mesh}`;
  }
}

function meshText(world: WorldDoc, s: ShapeSpec): string | null {
  if (s.kind !== 'mesh' || !hasOwn(world.meshes, s.mesh)) return null;
  const m = world.meshes[s.mesh] as WorldDoc['meshes'][string];
  const src = m.source?.shape;
  const from = src ? (src.kind === 'procedural' ? ` baked from gen:${src.generator}` : ` baked from ${src.primitive}`) : '';
  return `mesh ${m.vertexCount}v/${m.triangleCount}t${from} (hand-edited geometry; change it with transform/material, not shape params)`;
}

function entityLine(world: WorldDoc, e: Entity, depth: number, mark: { paths: readonly string[]; age: number } | undefined): string {
  const parts = [e.id, e.name ? truncate(e.name, 40) : '-', meshText(world, e.shape) ?? shapeText(e.shape), `pos ${vec(e.transform.position)}`];
  const r = e.transform.rotation;
  if (r[0] !== 0 || r[1] !== 0 || r[2] !== 0) parts.push(`rot ${vec(r)}`);
  const s = e.transform.scale;
  if (s[0] !== 1 || s[1] !== 1 || s[2] !== 1) parts.push(`scale ${s[0] === s[1] && s[1] === s[2] ? n1(s[0]) : vec(s)}`);
  if (e.physics) {
    let ph: string = e.physics.body;
    if (e.physics.sensor) ph += ' sensor';
    if (e.physics.mass !== undefined) ph += ` m=${n1(e.physics.mass)}`;
    parts.push(ph);
  }
  if (e.behaviors.length > 0) {
    parts.push(`behaviors ${e.behaviors.map((b) => {
      const p = params(b.params, 3);
      return `${b.type}${p ? `(${p})` : ''}${b.enabled ? '' : '[off]'}`;
    }).join(',')}`);
  }
  if (e.tags.length > 0) parts.push(`tags ${e.tags.join(',')}`);
  if (e.material) {
    const m = [e.material.preset, e.material.color].filter((x) => x !== undefined).join(' ');
    if (m) parts.push(`mat ${m}`);
  }
  if (e.light) parts.push(`light ${e.light.type} ${e.light.color} i=${n1(e.light.intensity)}`);
  if (e.joint) parts.push(`joint ${e.joint.type}->${e.joint.target}`);
  const stateKeys = Object.keys(e.state);
  if (stateKeys.length > 0) parts.push(`state ${stateKeys.sort().slice(0, 6).map((k) => `${k}=${json(e.state[k], 20)}`).join(' ')}`);
  const flags = [e.template ? 'template' : '', e.visible ? '' : 'hidden', e.locked ? 'locked(by user: do not change)' : ''].filter(Boolean);
  if (flags.length > 0) parts.push(flags.join(' '));
  if (mark) parts.push(`user-edited(${mark.paths.slice(0, 4).join(',')}${mark.age === 0 ? ', just now' : ''})`);
  return `${'  '.repeat(depth)}${parts.join(' | ')}`;
}

// -- rules ------------------------------------------------------------------

/** Field values that are schema defaults and therefore omitted. */
const OMIT_DEFAULTS: Readonly<Record<string, Json>> = {
  who: 'player', b: '*', minImpulse: 0, every: 1, count: 1, spread: 0, delay: 0, duration: 3, force: 20, radius: 5,
};

function fields(obj: Readonly<Record<string, unknown>>, discriminant: string): string {
  const out: string[] = [];
  for (const k of Object.keys(obj)) {
    if (k === discriminant) continue;
    const v = obj[k] as Json | undefined;
    if (v === undefined) continue;
    if (hasOwn(OMIT_DEFAULTS, k) && OMIT_DEFAULTS[k] === v) continue;
    out.push(`${k}=${typeof v === 'string' && !/[\s,()"]/.test(v) ? v : json(v, MAX_TEXT)}`);
  }
  return out.join(',');
}

function triggerText(t: Trigger): string {
  if (t.on === 'start') return 'start';
  if (t.on === 'state') return `state(${t.key}${t.op}${json(t.value)})`;
  return `${t.on}(${fields(t, 'on')})`;
}

function actionText(a: Action): string {
  switch (a.do) {
    case 'set': return `set(${a.key}=${json(a.value)})`;
    case 'add': return `add(${a.key},${n1(a.amount)})`;
    case 'destroy': return `destroy(${a.target})`;
    case 'message': return `message(${json(a.text, MAX_TEXT)})`;
    case 'sound': return `sound(${a.sound})`;
    case 'win':
    case 'lose': return `${a.do}(${json(a.text, MAX_TEXT)})`;
    case 'reset': return 'reset';
    default: return `${a.do}(${fields(a, 'do')})`;
  }
}

function testText(t: WorldTest): string {
  const rest: Record<string, unknown> = { ...t };
  delete rest['id'];
  if (t.kind === 'eventually') {
    return `eventually(${t.condition.key}${t.condition.op}${json(t.condition.value)}, within=${n1(t.within)})`;
  }
  const zone = rest['zone'];
  if (isPlainObject(zone)) rest['zone'] = `sphere(${vec(zone['center'] as Vec3)} r=${n1(zone['radius'] as number)})`;
  const body = Object.keys(rest)
    .filter((k) => k !== 'kind')
    .map((k) => `${k}=${typeof rest[k] === 'number' ? n1(rest[k] as number) : String(rest[k])}`)
    .join(', ');
  return `${t.kind}(${body})`;
}

// -- main ---------------------------------------------------------------------

/** Deterministic, token-efficient summary of `world` (see module docs for the format). */
export function summarizeWorld(world: WorldDoc, opts: SummaryOptions = {}): string {
  const lines: string[] = [];
  const ids = Object.keys(world.entities);
  lines.push(`world ${JSON.stringify(truncate(world.name, 80))} seed=${world.seed} entities=${ids.length} rules=${world.rules.length} tests=${world.tests.length}`);
  if (world.description) lines.push(`about ${truncate(world.description, 200)}`);

  const env = world.environment;
  const envParts = [`sky=${env.sky}`, `weather=${env.weather}`];
  if (env.timeOfDay !== undefined) envParts.push(`time=${n1(env.timeOfDay)}`);
  if (env.fog) envParts.push(`fog=${env.fog.color}/${env.fog.density}`);
  envParts.push(env.ground ? `ground=${env.ground.material.preset ?? env.ground.material.color ?? 'custom'}` : 'ground=none');
  envParts.push(`gravity=${vec(env.gravity)}`);
  lines.push(`env ${envParts.join(' ')}`);

  const pl = world.player;
  lines.push(`player ${pl.mode} spawn=${vec(pl.spawn)}${pl.controls ? ` controls=${pl.controls}` : ''} speed=${n1(pl.moveSpeed)} jump=${n1(pl.jumpSpeed)}`);
  const stateKeys = Object.keys(world.state).sort();
  if (stateKeys.length > 0) lines.push(`state ${stateKeys.map((k) => `${k}=${json(world.state[k], 30)}`).join(' ')}`);
  if (world.hud.length > 0) lines.push(`hud ${world.hud.map((h) => `${h.key}:${JSON.stringify(truncate(h.label, 30))}`).join(' ')}`);
  const gens = Object.keys(world.generators).sort();
  if (gens.length > 0) lines.push(`generators ${gens.join(', ')}`);
  const scripts = Object.keys(world.scripts).sort();
  if (scripts.length > 0) lines.push(`scripts ${scripts.join(', ')}`);

  // Hierarchy (sorted DFS). Orphans (missing parent) are treated as roots.
  const children = new Map<string | null, string[]>();
  for (const id of ids) {
    const parent = (world.entities[id] as Entity).parent;
    const key = parent !== null && hasOwn(world.entities, parent) ? parent : null;
    const list = children.get(key);
    if (list) list.push(id);
    else children.set(key, [id]);
  }
  for (const list of children.values()) list.sort();
  const order: Array<{ id: string; depth: number }> = [];
  const visited = new Set<string>();
  const stack: Array<{ id: string; depth: number }> = (children.get(null) ?? []).map((id) => ({ id, depth: 0 })).reverse();
  while (stack.length > 0) {
    const item = stack.pop() as { id: string; depth: number };
    if (visited.has(item.id)) continue;
    visited.add(item.id);
    order.push(item);
    const kids = children.get(item.id) ?? [];
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ id: kids[i] as string, depth: item.depth + 1 });
  }

  const max = Math.max(0, Math.floor(opts.maxEntities ?? DEFAULT_MAX_ENTITIES));
  const include = new Set<string>();
  for (let i = 0; i < order.length && i < max; i++) include.add((order[i] as { id: string }).id);
  const marked = opts.userEdits ? [...opts.userEdits.keys()] : [];
  for (const f of [...(opts.focus ?? []), ...marked]) {
    let cur: string | null = hasOwn(world.entities, f) ? f : null;
    for (let guard = 0; cur !== null && guard < 128 && !include.has(cur); guard++) {
      include.add(cur);
      const p: string | null = (world.entities[cur] as Entity).parent;
      cur = p !== null && hasOwn(world.entities, p) ? p : null;
    }
  }
  if (order.length > 0) {
    lines.push('entities:');
    for (const { id, depth } of order) if (include.has(id)) lines.push(entityLine(world, world.entities[id] as Entity, depth, opts.userEdits?.get(id)));
    const omitted = order.length - include.size;
    if (omitted > 0) lines.push(`... ${omitted} more entities`);
  }

  if (world.rules.length > 0) {
    lines.push('rules:');
    for (const r of world.rules) {
      const cond = r.if.length > 0 ? ` if ${r.if.map((c) => `${c.key}${c.op}${json(c.value)}`).join(' and ')}` : '';
      const flags = `${r.once ? ' [once]' : ''}${r.enabled ? '' : ' [disabled]'}`;
      lines.push(`rule ${r.id}: when ${triggerText(r.when)}${cond} then ${r.then.map(actionText).join(', ')}${flags}`);
    }
  }
  if (world.tests.length > 0) {
    lines.push('tests:');
    for (const t of world.tests) lines.push(`test ${t.id}: ${testText(t)}`);
  }
  if (marked.length > 0) {
    const recent = [...(opts.userEdits as ReadonlyMap<EntityId, { age: number }>).entries()].sort((a, b) => a[1].age - b[1].age).slice(0, 6).map(([id]) => id);
    lines.push(`user recently edited by hand (newest first): ${recent.join(', ')} — "the one I just moved/changed" means these; keep their user-edited properties unless asked`);
  }
  return lines.join('\n');
}
