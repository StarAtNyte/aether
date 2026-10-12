/**
 * Registry of built-in behaviors, in the order of the World IR enum.
 */
import { BuiltinBehavior } from '@aether/core';
import { CONTROL_BEHAVIORS } from './control';
import { FORCE_BEHAVIORS } from './forces';
import { INTERACT_BEHAVIORS } from './interact';
import { MOTION_BEHAVIORS } from './motion';
import type { BehaviorDef } from './types';

const ALL: readonly BehaviorDef[] = [...MOTION_BEHAVIORS, ...INTERACT_BEHAVIORS, ...CONTROL_BEHAVIORS, ...FORCE_BEHAVIORS];

/** Built-in behavior definitions keyed by type (null prototype: safe for untrusted keys). */
export const BEHAVIORS: Readonly<Record<string, BehaviorDef>> = (() => {
  const map = Object.create(null) as Record<string, BehaviorDef>;
  for (const def of ALL) map[def.type] = def;
  for (const type of BuiltinBehavior.options) {
    if (!(type in map)) throw new Error(`@aether/logic: built-in behavior '${type}' is not implemented`);
  }
  return Object.freeze(map);
})();

export type { BehaviorDef, BehaviorEnv, BehaviorInstance, BehaviorSlot, ContactInfo } from './types';
