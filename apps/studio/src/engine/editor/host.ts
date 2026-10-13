/**
 * What the editor controllers need from the studio (kept as an interface so
 * they are testable with fakes).
 */
import type { History, Patch } from '@aether/core';
import type { StoreApi } from 'zustand/vanilla';
import type { StudioState } from '../../state/store';
import type { Simulation } from '../Simulation';

/** Studio services used by the editor. */
export interface EditorHost {
  readonly history: History;
  readonly store: StoreApi<StudioState>;
  /** The running simulation (null until the viewport exists). */
  readonly simulation: Simulation | null;
  /** Commit editor patches (source 'user'); returns error text or null. */
  commitUser(patches: Patch[] | unknown[], message: string): string | null;
}

/** Short display name of an entity for history messages. */
export function label(host: EditorHost, id: string): string {
  const e = Object.prototype.hasOwnProperty.call(host.history.current.entities, id) ? host.history.current.entities[id] : undefined;
  return (e?.name || id).slice(0, 60);
}
