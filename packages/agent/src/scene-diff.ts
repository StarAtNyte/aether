/**
 * What changed in a world since the model's last turn, as a few compact
 * lines: the new user turn of a continued conversation carries this instead
 * of the whole world summary (the conversation already holds the scene the
 * model built). Too many changes and the caller sends the full summary.
 */
import { summarizeEntity, type WorldDoc } from '@aether/core';
import { worldChanges, type WorldChange } from './refine/changes';

/** Limits of {@link sceneChangesText}. */
export interface SceneDiffLimits {
  /** Most characters of the text (default 6 000). */
  maxChars?: number;
  /** Most changed entities (default 40). */
  maxEntities?: number;
}

/** Changed paths listed per modified entity before "+N more". */
const PATHS_PER_ENTITY = 6;

function value(v: unknown, max = 60): string {
  let t: string;
  try {
    t = JSON.stringify(v) ?? 'null';
  } catch {
    t = '?';
  }
  if (typeof v === 'number') t = String(Math.round(v * 100) / 100);
  else if (Array.isArray(v) && v.every((x) => typeof x === 'number')) t = `[${v.map((x) => Math.round(x * 100) / 100).join(', ')}]`;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function changeText(c: WorldChange): string {
  const path = c.path || '(whole)';
  if (c.kind === 'add') return `${path} = ${value(c.to)}`;
  if (c.kind === 'remove') return `${path} removed`;
  return `${path} ${value(c.from)} → ${value(c.to)}`;
}

/**
 * The changes from `before` (the world the model last saw) to `after`, or
 * null when they are too many for a short note (the caller then sends the full
 * summary). An unchanged world gives a one-line note.
 */
export function sceneChangesText(before: WorldDoc, after: WorldDoc, limits: SceneDiffLimits = {}): string | null {
  const maxChars = limits.maxChars ?? 6_000;
  const maxEntities = limits.maxEntities ?? 40;
  const count = Object.keys(after.entities).length;
  if (before === after) return `Nothing changed since your last turn (${count} entities).`;
  const changes = worldChanges(before, after);
  if (changes.length === 0) return `Nothing changed since your last turn (${count} entities).`;
  const added: string[] = [];
  const removed: string[] = [];
  const modified = new Map<string, WorldChange[]>();
  const other = new Map<string, WorldChange[]>();
  for (const c of changes) {
    if (c.scope === 'entity') {
      if (c.path === '' && c.kind === 'add') added.push(c.id);
      else if (c.path === '' && c.kind === 'remove') removed.push(c.id);
      else modified.set(c.id, [...(modified.get(c.id) ?? []), c]);
    } else {
      const key = c.scope === 'voxel' ? 'voxel' : `${c.scope}${c.id ? ` ${c.id}` : ''}`;
      other.set(key, [...(other.get(key) ?? []), c]);
    }
  }
  if (added.length + removed.length + modified.size > maxEntities) return null;
  const lines = [`${count} entities now: ${added.length} added, ${removed.length} removed, ${modified.size} changed since your last turn (by the user, a local edit or an automatic repair).`];
  for (const id of added) lines.push(`+ ${summarizeEntity(after, id)}`);
  for (const id of removed) lines.push(`- ${id} removed`);
  for (const [id, list] of modified) {
    const shown = list.slice(0, PATHS_PER_ENTITY).map(changeText).join('; ');
    lines.push(`~ ${id}: ${shown}${list.length > PATHS_PER_ENTITY ? `; +${list.length - PATHS_PER_ENTITY} more` : ''}`);
  }
  for (const [key, list] of other) {
    if (key === 'voxel') {
      lines.push(`~ block terrain: ${list.length} change${list.length === 1 ? '' : 's'} (query_scene shows it)`);
      continue;
    }
    if (list.length === 1 && list[0]?.path === '') {
      const c = list[0];
      lines.push(`${c.kind === 'add' ? '+' : c.kind === 'remove' ? '-' : '~'} ${key}${c.kind === 'add' ? ` = ${value(c.to, 200)}` : c.kind === 'remove' ? ' removed' : ` → ${value(c.to, 200)}`}`);
      continue;
    }
    lines.push(`~ ${key}: ${list.slice(0, PATHS_PER_ENTITY).map(changeText).join('; ')}${list.length > PATHS_PER_ENTITY ? `; +${list.length - PATHS_PER_ENTITY} more` : ''}`);
  }
  const text = lines.join('\n');
  return text.length > maxChars ? null : text;
}
