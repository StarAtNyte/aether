/**
 * Where proofs live and how they are read from outside: a standalone
 * `proof.json` (a proof, optionally with the world next to it), the `proof`
 * member of a published `game.json`, or the `proof` member of a share
 * payload. All inputs are untrusted; size caps apply before parsing.
 */
import { PROOF_LIMITS } from './proof';

/** A proof value and the world it may travel with. */
export interface Bundle {
  /** The untrusted proof value (validated by `checkProof`). */
  proof: unknown;
  /** The untrusted world value, when the file carries one. */
  world: unknown;
  /** Where the proof was found. */
  from: 'proof' | 'game' | 'share';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Split a parsed JSON file into a proof and (optionally) its world:
 * - a proof (`format: 'aether-proof'`), with an optional extra `worldDoc` member (the full world);
 * - a game manifest (`format: 'aether-game'`) with a `proof` and `world`;
 * - a share payload `{ world, proof }`.
 * Returns null when no proof is present.
 */
export function splitBundle(value: unknown): Bundle | null {
  if (!isRecord(value)) return null;
  if (value['format'] === 'aether-proof') {
    const { worldDoc: world, ...proof } = value;
    return { proof, world, from: 'proof' };
  }
  if (value['format'] === 'aether-game') return value['proof'] === undefined ? null : { proof: value['proof'], world: value['world'], from: 'game' };
  if (value['proof'] !== undefined && value['world'] !== undefined) return { proof: value['proof'], world: value['world'], from: 'share' };
  return null;
}

/** Parse JSON text with the proof size cap; returns null when too large or not JSON. */
export function parseProofJson(text: string): unknown {
  if (text.length > PROOF_LIMITS.MAX_BYTES) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Serialise a proof (optionally with its world) as a standalone `proof.json`. */
export function stringifyBundle(proof: object, world?: object): string {
  return JSON.stringify(world ? { ...proof, worldDoc: world } : proof, null, 2);
}
