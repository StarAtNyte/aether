/**
 * The proof format (`aether-proof`, version 1; see docs/PROOFS.md).
 *
 * A proof is a *claim about a deterministic replay*: "this exact world
 * (content hash), simulated by this engine for this long, decided its tests
 * this way". It is not a formal proof of anything. A verifier re-runs the
 * simulation and compares; the proof is untrusted input and is validated
 * with zod and hard size caps before any of it is used.
 */
import { EvidenceWire } from '@aether/playtest/proof';
import { z } from 'zod';
/** Format marker. */
export const PROOF_FORMAT = 'aether-proof';
/** Format version. */
export const PROOF_VERSION = 1;
/**
 * Identity of the replay semantics. Bump it whenever a change to the physics
 * stepping, the verifier's tests, the logic runtime or the trace sampling
 * could change a replay's outcome; proofs sealed by another value are
 * reported as version-mismatched rather than as tampered or failed.
 */
export const REPLAY_ENGINE = 'aether-replay/1';
/** Physics engine the replay semantics were validated against (checked against `packages/physics` in tests). */
export const PHYSICS_ENGINE = 'rapier3d-compat@0.21.0';
/** Caps applied to every proof read from outside. */
export const PROOF_LIMITS = Object.freeze({
    /** Largest proof file / embedded proof the readers accept (bytes). */
    MAX_BYTES: 24 * 1024 * 1024,
    MAX_TESTS: 512,
    MAX_DIAGNOSTICS: 512,
    MAX_ENTITIES_PER_DIAGNOSTIC: 16,
    MAX_MESSAGE: 600,
    /** Colliders embedded for entities whose shapes only the renderer can derive (numbers in total). */
    MAX_COLLIDER_NUMBERS: 2_000_000,
    MAX_COLLIDER_ENTITIES: 2000,
    /** Longest simulated horizon a proof may claim (seconds). */
    MAX_SECONDS: 60,
});
const Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().max(PROOF_LIMITS.MAX_MESSAGE);
const TestClaim = z
    .object({
    id: z.string().max(200),
    kind: z.string().max(64),
    passed: z.boolean(),
    message: Text,
    atTime: z.number().finite().nonnegative().max(PROOF_LIMITS.MAX_SECONDS).optional(),
})
    .strict();
const DiagnosticClaim = z
    .object({
    severity: z.enum(['error', 'warning', 'info']),
    code: z.string().max(64),
    entities: z.array(z.string().max(200)).max(PROOF_LIMITS.MAX_ENTITIES_PER_DIAGNOSTIC),
})
    .strict();
/** Embedded renderer colliders (entity id + the validated collider list). Opaque here; the replay re-validates each one. */
const ColliderEntry = z.tuple([z.string().min(1).max(200), z.array(z.unknown()).max(2048)]);
const Signature = z
    .object({
    alg: z.literal('Ed25519'),
    /** Raw 32-byte public key, base64url. */
    publicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    /** 64-byte signature over the UTF-8 bytes of `hash`, base64url. */
    sig: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
})
    .strict();
/** The signed / hashed part of a proof. */
export const ProofBodySchema = z
    .object({
    format: z.literal(PROOF_FORMAT),
    v: z.literal(PROOF_VERSION),
    engine: z.object({ replay: z.string().max(64), physics: z.string().max(64) }).strict(),
    /** Epoch milliseconds the proof was sealed at (informational; covered by the hash, not trusted as a clock). */
    sealedAt: z.number().int().nonnegative().max(8.64e15).optional(),
    world: z
        .object({
        /** Content hash of the canonical world JSON. */
        hash: Digest,
        name: z.string().max(200),
        entities: z.number().int().nonnegative().max(1_000_000),
        tests: z.number().int().nonnegative().max(PROOF_LIMITS.MAX_TESTS),
    })
        .strict(),
    replay: z
        .object({
        /** Simulated-seconds horizon of the replay. */
        maxSeconds: z.number().finite().positive().max(PROOF_LIMITS.MAX_SECONDS),
        /** Fixed physics step (seconds). */
        fixedDt: z.number().finite().positive().max(1),
        /** Trace sampling rate (Hz). */
        traceHz: z.number().int().min(1).max(30),
    })
        .strict(),
    colliders: z
        .object({
        /**
         * `none`: every collider derives from the world document;
         * `embedded`: renderer colliders are carried in `entries`;
         * `external`: the world needed colliders the proof does not carry, so a verifier cannot re-simulate it.
         */
        mode: z.enum(['none', 'embedded', 'external']),
        hash: Digest.optional(),
        entries: z.array(ColliderEntry).max(PROOF_LIMITS.MAX_COLLIDER_ENTITIES).optional(),
    })
        .strict(),
    claim: z
        .object({
        passed: z.boolean(),
        simulatedSeconds: z.number().finite().nonnegative().max(PROOF_LIMITS.MAX_SECONDS),
        tests: z.array(TestClaim).max(PROOF_LIMITS.MAX_TESTS),
        diagnostics: z.array(DiagnosticClaim).max(PROOF_LIMITS.MAX_DIAGNOSTICS),
        /** Hash of the canonical `{ passed, simulatedSeconds, tests, diagnostics }`. */
        hash: Digest,
    })
        .strict(),
    /**
     * Optional: the playtest bot's winning run (`@aether/playtest`), sealed with the rest. It makes the
     * seal one story: the replay check reproduces the world's own tests, and this says a bot also
     * played the game to its win. Covered by the content hash and the signature.
     */
    playtest: EvidenceWire.optional(),
    /** Fingerprint of the recorded motion (quantised to 1 mm); absent when nothing moved. */
    trace: z
        .object({
        hash: Digest,
        frames: z.number().int().positive().max(1000),
        bodies: z.number().int().positive().max(64),
        dt: z.number().finite().positive().max(1),
    })
        .strict()
        .optional(),
})
    .strict();
/** A proof: the body, its content hash and an optional signature over that hash. */
export const ProofSchema = ProofBodySchema.extend({
    /** Content hash of the canonical body (everything except `hash` and `signature`). */
    hash: Digest,
    signature: Signature.optional(),
}).strict();
/** Validate an untrusted value as a proof. Never throws. */
export function parseProof(value) {
    const r = ProofSchema.safeParse(value);
    if (r.success)
        return { ok: true, proof: r.data };
    const issue = r.error.issues[0];
    const where = issue ? issue.path.join('.') || '(root)' : '(root)';
    return { ok: false, error: `not a valid Aether proof: ${where} ${issue ? issue.message : ''}`.slice(0, 300) };
}
