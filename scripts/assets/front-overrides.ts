/**
 * The per-model front and mounting decided by the vision check (`front-fix.ts`), checked in as `simready-fronts.json`.
 * `rot` is the build's absolute turn about Y (degrees, multiple of 90) that puts the model's front on +Z; `mounting` the
 * kind of surface it hangs on or stands on. Read by the bulk converter and by the library build; the file is small text.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Mounting = 'floor' | 'wall' | 'ceiling' | 'table';

export interface FrontOverride {
  rot: number;
  mounting: Mounting;
  confidence: number;
  reason: string;
  model: string;
}

export const FRONTS_FILE = join(import.meta.dirname, 'simready-fronts.json');

export function loadFrontOverrides(file = FRONTS_FILE): Record<string, FrontOverride> {
  if (!existsSync(file)) return {};
  const j = JSON.parse(readFileSync(file, 'utf8')) as { fronts?: Record<string, FrontOverride> };
  return j.fronts ?? {};
}

/** The catalog's placement for a mounting. */
export const placeOf = (m: Mounting): 'floor' | 'wall' | 'ceiling' | 'surface' => (m === 'table' ? 'surface' : m);
