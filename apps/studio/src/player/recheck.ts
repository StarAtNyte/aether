/**
 * Re-check a game's replay proof on this device. The replay engine
 * (`@aether/verifier`: physics, rules, hashing) is loaded only when a viewer
 * asks, so a page that never checks pays nothing for it.
 */
import type { WorldDoc } from '@aether/core';
import type { ProofCheck } from '@aether/verifier';

/** Re-simulate `world` and compare with `proof` (both untrusted). The returned check explains every step. */
export async function recheckProof(proof: unknown, world: WorldDoc, signal?: AbortSignal): Promise<ProofCheck> {
  const { checkProof } = await import('@aether/verifier');
  return checkProof(proof, world, signal ? { signal } : {});
}
