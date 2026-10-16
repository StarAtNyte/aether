import { describe, expect, it } from 'vitest';
import { PROOF_LIMITS, checkProof, createProof, generateNonExtractableKey } from '../src/index';
import { passingWorld } from './fixtures';
describe('browser-style keys', () => {
    it('signs with a non-extractable key whose private half cannot be exported', async () => {
        const key = await generateNonExtractableKey();
        expect(key.privateKey.extractable).toBe(false);
        await expect(crypto.subtle.exportKey('pkcs8', key.privateKey)).rejects.toThrow();
        const world = passingWorld();
        const proof = await createProof(world, { key });
        expect(proof.signature?.publicKey).toBe(key.publicKey);
        expect((await checkProof(proof, world)).signature?.valid).toBe(true);
    });
    it('the proof format carries every test a world can have', () => {
        // validateWorld caps tests at 100; the format must never be the tighter limit.
        expect(PROOF_LIMITS.MAX_TESTS).toBeGreaterThanOrEqual(100);
    });
});
