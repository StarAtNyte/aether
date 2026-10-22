/**
 * Copy for refining a world by prompt: the composer placeholder and the
 * one-tap follow-ups under a finished turn. Pure.
 */
import type { WorldDoc } from '@aether/core';

/** True when the world has anything in it (a prompt then refines it instead of starting from nothing). */
export function hasContent(world: Pick<WorldDoc, 'entities' | 'voxel'>): boolean {
  return world.voxel !== undefined || Object.keys(world.entities).length > 0;
}

/** Display name of an entity ("Sofa"), or null when it has none worth showing. */
function nameOf(world: Pick<WorldDoc, 'entities'>, id: string): string | null {
  const e = world.entities[id];
  const raw = e?.name || e?.arch?.name || '';
  return raw.trim() ? raw.trim().slice(0, 32) : null;
}

/** Placeholder of the composer. */
export function composerPlaceholder(world: Pick<WorldDoc, 'entities' | 'voxel'>, selection: readonly string[], busy: boolean): string {
  if (busy) return 'Working on it. Queue a message: it reaches the assistant between its steps…';
  if (!hasContent(world)) return 'Describe a world…';
  const first = selection[0];
  const name = first ? nameOf(world, first) : null;
  if (name) return `What should change about the ${name.toLowerCase()}? e.g. “make it red”, “a bit to the left”`;
  return 'Keep refining: “make the sofa dark green”, “add a rug”, “make it night”…';
}

/** One-tap follow-ups. */
export interface RefineChip {
  label: string;
  prompt: string;
}

/** Follow-ups for the current selection (or, with none, for the world). */
export function refineChips(world: Pick<WorldDoc, 'entities'>, selection: readonly string[]): RefineChip[] {
  if (selection.length > 0) {
    const many = selection.length > 1;
    const it = many ? 'these' : 'it';
    return [
      { label: `Make ${it} darker`, prompt: `make ${it} a bit darker` },
      { label: `Move ${it} left`, prompt: `move ${it} a bit to the left` },
      { label: `Make ${it} bigger`, prompt: `make ${it} a bit bigger` },
      { label: many ? 'Delete these' : 'Duplicate it', prompt: many ? 'delete these' : 'duplicate it' },
    ];
  }
  const named: string[] = [];
  for (const id of Object.keys(world.entities)) {
    const n = nameOf(world, id);
    if (n && !named.includes(n) && !/\d/.test(n) && world.entities[id]?.parent === null) named.push(n);
    if (named.length >= 2) break;
  }
  const out: RefineChip[] = [];
  const n = named[0];
  if (n) out.push({ label: `Make the ${n.toLowerCase()} red`, prompt: `make the ${n.toLowerCase()} red` });
  out.push({ label: 'Make it night', prompt: 'make it night' }, { label: 'Add some fog', prompt: 'add some fog' });
  return out.slice(0, 3);
}
