/**
 * Display wording of proof states for the studio, the player, the share
 * page and the share card. Dependency-free and pure (no physics, no logic),
 * so every surface can import it without pulling the replay engine.
 */

/** What a surface shows for a proof before / after it was re-checked locally. */
export type BadgeState = 'sealed' | 'checking' | 'verified' | 'failed' | 'mismatch' | 'unverifiable' | 'none';

/** Wording of one badge state. */
export interface BadgeText {
  /** Short label of the badge. */
  label: string;
  /** One sentence for a tooltip / screen reader. */
  detail: string;
  tone: 'good' | 'neutral' | 'bad';
}

/** Appended wherever a proof is described, so nobody mistakes it for more than it is. */
export const PROOF_DISCLAIMER = 'A deterministic replay check, not a formal proof.';

/** Badge wording per state (honest by construction). */
export const BADGES: Readonly<Record<BadgeState, BadgeText>> = Object.freeze({
  sealed: { label: 'Sealed playable', detail: `The author sealed this world after a physics replay passed. Check it yourself to be sure. ${PROOF_DISCLAIMER}`, tone: 'neutral' },
  checking: { label: 'Checking…', detail: 'Re-simulating the world on this device.', tone: 'neutral' },
  verified: { label: 'Verified playable', detail: `Re-simulated on this device: the replay reproduced the sealed outcome. ${PROOF_DISCLAIMER}`, tone: 'good' },
  failed: { label: 'Verification failed', detail: 'The replay did not reproduce the sealed outcome, or the proof was altered. Do not trust the seal.', tone: 'bad' },
  mismatch: { label: 'Seal out of date', detail: 'The seal was made by another engine version or for another version of the world.', tone: 'bad' },
  unverifiable: { label: 'Cannot re-check', detail: 'This seal cannot be re-simulated here; only its integrity was checked.', tone: 'neutral' },
  none: { label: 'Not sealed', detail: 'This world carries no verification seal.', tone: 'neutral' },
});

/** Map a check status to the badge state to show. */
export function badgeFor(status: string, playable: boolean): BadgeState {
  switch (status) {
    case 'verified':
      return playable ? 'verified' : 'failed';
    case 'intact':
    case 'unverifiable':
      return 'unverifiable';
    case 'engine-mismatch':
    case 'world-mismatch':
      return 'mismatch';
    default:
      return 'failed';
  }
}
