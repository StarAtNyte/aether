/**
 * @aether/verifier — independent replay verifier and signed proofs
 * (docs/PROOFS.md). Re-simulates a world with `@aether/physics` and the
 * headless logic host and checks content hash, signature, engine version and
 * outcome. Runs in Node (`aether-verify`) and in browsers.
 */
export { sha256, digest, toHex, toBase64Url, fromBase64Url, canonicalJson, hashJson, hashQuantized, utf8 } from './hash';
export { PROOF_FORMAT, PROOF_VERSION, PROOF_LIMITS, REPLAY_ENGINE, PHYSICS_ENGINE, ProofSchema, ProofBodySchema, parseProof, } from './proof';
export { resimulate, claimOf, claimHash, diffClaims, DEFAULT_REPLAY, replaySettingsFor, REPLAY_BUDGET_MS } from './resimulate';
export { createProof, signProof, verifySignature, generateSigningKey, generateNonExtractableKey, keyId, worldHash, proofBodyHash, REPLAY_FIXED_DT } from './seal';
export { checkProof, describeClaim, statusSummary } from './check';
export { splitBundle, parseProofJson, stringifyBundle } from './embed';
export { BADGES, PROOF_DISCLAIMER, badgeFor } from './format';
export { createVerifyLogic, HeadlessLogicHost } from './headless-host';
