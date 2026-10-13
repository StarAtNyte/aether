/**
 * Parses the compact `summarizeWorld` text (the only world view a provider
 * receives) into a structured view the mock planner can reason about.
 * Best-effort and defensive: unknown lines are ignored.
 */
import type { Json } from '@aether/core';
import type { V3 } from './builder';

/** One entity as seen through the summary. */
export interface EntityView {
  id: string;
  name: string;
  /** "gen:tree-oak", "box", "sphere", "scatter", "empty", … */
  shape: string;
  /** Generator id for procedural/scatter-of-procedural shapes. */
  generator?: string;
  primitive?: string;
  /** Primitive size when known (box w×h×d; sphere d; cylinder d,h). */
  height?: number;
  pos: V3;
  scale: number;
  body?: 'static' | 'dynamic' | 'kinematic';
  sensor: boolean;
  mass?: number;
  behaviors: Array<{ type: string; params: Record<string, Json>; enabled: boolean }>;
  tags: string[];
  color?: string;
  hasLight: boolean;
  template: boolean;
  depth: number;
  /** Locked by the user: must not be changed. */
  locked: boolean;
  /** The user edited it by hand recently (commits ago; 0 = latest), when known. */
  userEditedAge?: number;
}

/** The parsed world. */
export interface WorldView {
  entityCount: number;
  entities: EntityView[];
  /** True when the summary elided some entities. */
  elided: boolean;
  stateKeys: string[];
  hud: Array<{ key: string; label: string }>;
  ruleIds: string[];
  testIds: string[];
  sky?: string;
  weather?: string;
  hasGround: boolean;
  /** Ids the user edited by hand recently, newest first. */
  recentEdits: string[];
}

function parseVec(text: string): V3 | undefined {
  const parts = text.split(',').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return undefined;
  return [parts[0] as number, parts[1] as number, parts[2] as number];
}

/** Split "a(x=1,y=[1,2]),b" on top-level commas. */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

function parseParamValue(raw: string): Json | undefined {
  try {
    return JSON.parse(raw) as Json;
  } catch {
    return undefined;
  }
}

/** Parse "spin(axis=[0,1,0],speed=90),bob[off]" (params past the summary's cap are lost). */
function parseBehaviors(text: string): EntityView['behaviors'] {
  const out: EntityView['behaviors'] = [];
  for (const item of splitTopLevel(text)) {
    const m = /^([A-Za-z]+)(?:\((.*)\))?(\[off\])?$/.exec(item);
    if (!m) continue;
    const params: Record<string, Json> = {};
    for (const kv of splitTopLevel(m[2] ?? '')) {
      const eq = kv.indexOf('=');
      if (eq <= 0) continue;
      const key = kv.slice(0, eq);
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const value = parseParamValue(kv.slice(eq + 1));
      if (value !== undefined) params[key] = value;
    }
    out.push({ type: m[1] as string, params, enabled: m[3] === undefined });
  }
  return out;
}

function parseShape(text: string, e: EntityView): void {
  e.shape = text;
  let m = /^gen:([a-z0-9-]+)/.exec(text);
  if (m) {
    e.generator = m[1] as string;
    e.shape = 'procedural';
    return;
  }
  m = /^scatter \d+x (?:gen:([a-z0-9-]+)|(\w+))/.exec(text);
  if (m) {
    e.shape = 'scatter';
    if (m[1]) e.generator = m[1];
    else if (m[2]) e.primitive = m[2];
    return;
  }
  m = /^(box|sphere|cylinder|cone|capsule|torus|plane)\b(.*)$/.exec(text);
  if (m) {
    e.primitive = m[1] as string;
    e.shape = 'primitive';
    const rest = m[2] ?? '';
    const box = /(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/.exec(rest);
    const h = /h=(\d+(?:\.\d+)?)/.exec(rest);
    const d = /d=(\d+(?:\.\d+)?)/.exec(rest);
    if (box) e.height = Number(box[2]);
    else if (h) e.height = Number(h[1]);
    else if (d && e.primitive === 'sphere') e.height = Number(d[1]);
  }
}

function parseEntityLine(line: string): EntityView | null {
  const depth = Math.floor((line.length - line.trimStart().length) / 2);
  const parts = line.trim().split(' | ');
  const id = parts[0];
  if (!id || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) || parts.length < 4) return null;
  const e: EntityView = { id, name: parts[1] === '-' ? '' : (parts[1] ?? ''), shape: '', pos: [0, 0, 0], scale: 1, sensor: false, behaviors: [], tags: [], hasLight: false, template: false, depth, locked: false };
  parseShape(parts[2] ?? '', e);
  for (const part of parts.slice(3)) {
    if (part.startsWith('pos ')) e.pos = parseVec(part.slice(4)) ?? e.pos;
    else if (part.startsWith('scale ')) {
      const s = part.slice(6);
      const v = s.includes(',') ? parseVec(s) : undefined;
      e.scale = v ? Math.max(v[0], v[1], v[2]) : Number(s) || 1;
    } else if (/^(static|dynamic|kinematic)\b/.test(part)) {
      e.body = part.split(' ')[0] as EntityView['body'];
      e.sensor = part.includes('sensor');
      const m = /m=(\d+(?:\.\d+)?)/.exec(part);
      if (m) e.mass = Number(m[1]);
    } else if (part.startsWith('behaviors ')) e.behaviors = parseBehaviors(part.slice(10));
    else if (part.startsWith('tags ')) e.tags = part.slice(5).split(',').filter(Boolean);
    else if (part.startsWith('mat ')) {
      const m = /#[0-9a-fA-F]{6}/.exec(part);
      if (m) e.color = m[0];
    } else if (part.startsWith('light ')) e.hasLight = true;
    else if (part.startsWith('user-edited(')) e.userEditedAge = part.includes('just now') ? 0 : 1;
    else {
      const words = part.split(' ');
      if (words.includes('template')) e.template = true;
      if (part.includes('locked(')) e.locked = true;
    }
  }
  return e;
}

/** Parse a world summary; an empty string yields an empty world. */
export function parseWorldSummary(summary: string): WorldView {
  const view: WorldView = { entityCount: 0, entities: [], elided: false, stateKeys: [], hud: [], ruleIds: [], testIds: [], hasGround: true, recentEdits: [] };
  let section: 'head' | 'entities' | 'rules' | 'tests' = 'head';
  for (const line of summary.split('\n')) {
    const t = line.trim();
    if (t === 'entities:') { section = 'entities'; continue; }
    if (t === 'rules:') { section = 'rules'; continue; }
    if (t === 'tests:') { section = 'tests'; continue; }
    const recent = /^user recently edited by hand \(newest first\): ([^—]+)/.exec(t);
    if (recent) {
      view.recentEdits = (recent[1] as string).split(',').map((s) => s.trim()).filter((s) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(s));
      continue;
    }
    if (section === 'head') {
      const count = /^world .* entities=(\d+)/.exec(t);
      if (count) view.entityCount = Number(count[1]);
      else if (t.startsWith('env ')) {
        view.sky = /sky=(\w+)/.exec(t)?.[1];
        view.weather = /weather=(\w+)/.exec(t)?.[1];
        view.hasGround = !t.includes('ground=none');
      } else if (t.startsWith('state ')) {
        for (const m of t.slice(6).matchAll(/(?:^|\s)([^\s=]+)=/g)) view.stateKeys.push(m[1] as string);
      } else if (t.startsWith('hud ')) {
        for (const m of t.slice(4).matchAll(/([^\s:]+):"((?:[^"\\]|\\.)*)"/g)) view.hud.push({ key: m[1] as string, label: m[2] as string });
      }
    } else if (section === 'entities') {
      if (t.startsWith('... ')) view.elided = true;
      else {
        const e = parseEntityLine(line);
        if (e) view.entities.push(e);
      }
    } else if (section === 'rules') {
      const m = /^rule ([^:]+):/.exec(t);
      if (m) view.ruleIds.push(m[1] as string);
    } else {
      const m = /^test ([^:]+):/.exec(t);
      if (m) view.testIds.push(m[1] as string);
    }
  }
  if (view.entityCount === 0) view.entityCount = view.entities.length;
  return view;
}
