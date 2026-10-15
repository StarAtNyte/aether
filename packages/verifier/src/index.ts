/**
 * @aether/verifier — independent replay verifier and signed proofs
 * (docs/PROOFS.md). Re-simulates a world with `@aether/physics` and the
 * headless logic host and checks content hash, signature, engine version and
 * outcome. Runs in Node (`aether-verify`) and in browsers.
 */
export { sha256, digest, toHex, toBase64Url, fromBase64Url, canonicalJson, hashJson, hashQuantized, utf8 } from './hash';
export {
  PROOF_FORMAT,
  PROOF_VERSION,
  PROOF_LIMITS,
  REPLAY_ENGINE,
  PHYSICS_ENGINE,
  ProofSchema,
  ProofBodySchema,
  parseProof,
  type Proof,
  type ProofBody,
  type ProofSignature,
  type ProofColliderEntries,
  type ParsedProof,
} from './proof';
export { resimulate, claimOf, claimHash, diffClaims, DEFAULT_REPLAY, REPLAY_BUDGET_MS, type ReplaySettings, type ReplayResult, type ResimulateOptions } from './resimulate';
export { createProof, signProof, verifySignature, generateSigningKey, generateNonExtractableKey, keyId, worldHash, proofBodyHash, REPLAY_FIXED_DT, type CreateProofOptions, type SigningKey, type SigningKeyPair } from './seal';
export { checkProof, describeClaim, statusSummary, type CheckOptions, type CheckStep, type ProofCheck, type ProofStatus } from './check';
export { splitBundle, parseProofJson, stringifyBundle, type Bundle } from './embed';
export { BADGES, PROOF_DISCLAIMER, badgeFor, type BadgeState, type BadgeText } from './format';
export { createVerifyLogic, HeadlessLogicHost, type HeadlessOutcome } from './headless-host';
