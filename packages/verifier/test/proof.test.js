import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createWorld, validateWorld } from '@aether/core';
import { PHYSICS_ENGINE, REPLAY_ENGINE, checkProof, createProof, generateSigningKey, hashJson, keyId, parseProof, proofBodyHash, signProof, worldHash, claimHash } from '../src/index';
import { failingWorld, passingWorld, template } from './fixtures';
const rehash = (p) => {
    const { signature: _s, ...rest } = p;
    return { ...rest, hash: proofBodyHash(rest) };
};
describe('constants', () => {
    it('PHYSICS_ENGINE names the Rapier version @aether/physics depends on', () => {
        const pkg = JSON.parse(readFileSync(new URL('../../physics/package.json', import.meta.url), 'utf8'));
        expect(PHYSICS_ENGINE).toBe(`rapier3d-compat@${pkg.dependencies['@dimforge/rapier3d-compat']}`);
    });
});
describe('sealing and checking', () => {
    it('a passing world seals, then an independent replay verifies it as playable', async () => {
        const world = passingWorld();
        const proof = await createProof(world);
        expect(proof.claim.passed).toBe(true);
        expect(proof.world.hash).toBe(worldHash(world));
        expect(proof.engine).toEqual({ replay: REPLAY_ENGINE, physics: PHYSICS_ENGINE });
        expect(parseProof(JSON.parse(JSON.stringify(proof))).ok).toBe(true);
        const check = await checkProof(JSON.parse(JSON.stringify(proof)), world);
        expect(check.status).toBe('verified');
        expect(check.ok).toBe(true);
        expect(check.playable).toBe(true);
        expect(check.steps.map((s) => s.result)).toEqual(['ok', 'ok', 'skip', 'ok', 'ok', 'ok']);
        expect(check.summary).toMatch(/not a formal proof/);
    });
    it('a real game (rules, moving bodies, trace) round-trips through JSON', async () => {
        const world = template('domino-run');
        const proof = await createProof(world);
        expect(proof.trace?.bodies).toBeGreaterThan(0);
        const check = await checkProof(JSON.parse(JSON.stringify(proof)), JSON.parse(JSON.stringify(world)));
        expect(check.status).toBe('verified');
        expect(check.playable).toBe(true);
    });
    it('a world with logic-driven state (rules) replays identically', async () => {
        const world = template('coin-rush');
        const a = await createProof(world, { now: 1 });
        const b = await createProof(world, { now: 1 });
        expect(a.hash).toBe(b.hash);
        expect((await checkProof(a, world)).status).toBe('verified');
    });
    it('is deterministic: sealing twice gives byte-identical proofs', async () => {
        const world = template('domino-bell');
        const a = await createProof(world, { now: 5 });
        const b = await createProof(world, { now: 5 });
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
    it('a sealed failure verifies as a faithful report, never as playable', async () => {
        const world = failingWorld();
        const proof = await createProof(world);
        expect(proof.claim.passed).toBe(false);
        const check = await checkProof(proof, world);
        expect(check.status).toBe('verified');
        expect(check.playable).toBe(false);
        expect(check.summary).toMatch(/FAIL/);
    });
    it('the world hash is stable under validation (normalised form)', () => {
        const world = template('kart-canyon');
        const again = validateWorld(JSON.parse(JSON.stringify(world)));
        expect(again.ok).toBe(true);
        if (again.ok)
            expect(hashJson(again.world)).toBe(worldHash(world));
    });
    it('integrity-only mode does not claim the outcome was checked', async () => {
        const world = passingWorld();
        const proof = await createProof(world);
        const check = await checkProof(proof, world, { replay: false });
        expect(check.status).toBe('intact');
        expect(check.ok).toBe(false);
        expect(check.playable).toBe(false);
    });
});
describe('tampering', () => {
    async function sealed() {
        const world = failingWorld();
        return { world, proof: await createProof(world) };
    }
    it('flipping the claimed outcome without re-hashing is tampering', async () => {
        const { world, proof } = await sealed();
        const forged = JSON.parse(JSON.stringify(proof));
        forged.claim.passed = true;
        for (const t of forged.claim.tests)
            t.passed = true;
        const check = await checkProof(forged, world);
        expect(check.status).toBe('tampered');
        expect(check.ok).toBe(false);
        expect(check.playable).toBe(false);
    });
    it('flipping the outcome AND re-hashing both hashes is caught by the replay', async () => {
        const { world, proof } = await sealed();
        const forged = JSON.parse(JSON.stringify(proof));
        forged.claim.passed = true;
        for (const t of forged.claim.tests)
            t.passed = true;
        forged.claim.hash = claimHash(forged.claim);
        const check = await checkProof(rehash(forged), world);
        expect(check.status).toBe('replay-diverged');
        expect(check.differences.join(' ')).toMatch(/arrive/);
        expect(check.playable).toBe(false);
    });
    it('a forged motion fingerprint is caught by the replay', async () => {
        const world = template('domino-bell');
        const proof = await createProof(world);
        const forged = JSON.parse(JSON.stringify(proof));
        if (!forged.trace)
            throw new Error('fixture has no trace');
        forged.trace.hash = `sha256:${'0'.repeat(64)}`;
        const check = await checkProof(rehash(forged), world);
        expect(check.status).toBe('replay-diverged');
        expect(check.differences.join(' ')).toMatch(/motion/);
    });
    it('a changed world no longer matches the sealed one', async () => {
        const world = passingWorld();
        const proof = await createProof(world);
        const moved = createWorld({ ...JSON.parse(JSON.stringify(world)), seed: world.seed + 1 });
        const check = await checkProof(proof, moved);
        expect(check.status).toBe('world-mismatch');
        expect((await checkProof(proof, { not: 'a world' })).status).toBe('world-mismatch');
        expect((await checkProof(proof, undefined)).status).toBe('world-mismatch');
    });
    it('a world edited so a test is easier cannot reuse the old proof', async () => {
        const world = failingWorld();
        const proof = await createProof(world);
        const edited = JSON.parse(JSON.stringify(world));
        const t = edited.tests[0];
        if (t && t.kind === 'reaches')
            t.within = 100;
        const check = await checkProof(proof, edited);
        expect(check.status).toBe('world-mismatch');
    });
    it('a proof from another engine version is a version mismatch, not tampering', async () => {
        const world = passingWorld();
        const proof = await createProof(world);
        const other = JSON.parse(JSON.stringify(proof));
        other.engine.replay = 'aether-replay/0';
        const check = await checkProof(rehash(other), world);
        expect(check.status).toBe('engine-mismatch');
        expect(check.summary).toMatch(/different version/);
        const phys = JSON.parse(JSON.stringify(proof));
        phys.engine.physics = 'rapier3d-compat@0.0.1';
        expect((await checkProof(rehash(phys), world)).status).toBe('engine-mismatch');
    });
    it('malformed, extended and oversized proofs are invalid', async () => {
        const world = passingWorld();
        const proof = await createProof(world);
        expect((await checkProof(null, world)).status).toBe('invalid');
        expect((await checkProof('proof', world)).status).toBe('invalid');
        expect((await checkProof({ ...proof, extra: 1 }, world)).status).toBe('invalid');
        expect((await checkProof({ ...proof, hash: 'sha256:xyz' }, world)).status).toBe('invalid');
        const long = JSON.parse(JSON.stringify(proof));
        long.claim.simulatedSeconds = 1e9;
        expect((await checkProof(long, world)).status).toBe('invalid');
        const prototype = JSON.parse('{"__proto__":{"polluted":true},"format":"aether-proof"}');
        expect((await checkProof(prototype, world)).status).toBe('invalid');
        expect({}['polluted']).toBeUndefined();
    });
    it('an unrelated hash string cannot stand in for the body hash', async () => {
        const world = passingWorld();
        const proof = await createProof(world);
        const forged = { ...proof, hash: `sha256:${'a'.repeat(64)}` };
        expect((await checkProof(forged, world)).status).toBe('tampered');
    });
});
describe('signatures', () => {
    let key;
    it('a signed proof verifies and reports the signing key', async () => {
        key = await generateSigningKey();
        const world = passingWorld();
        const proof = await createProof(world, { key });
        expect(proof.signature?.publicKey).toBe(key.publicKey);
        const check = await checkProof(JSON.parse(JSON.stringify(proof)), world, { trustedKeys: [key.publicKey] });
        expect(check.status).toBe('verified');
        expect(check.signature).toEqual({ valid: true, keyId: keyId(key.publicKey), publicKey: key.publicKey });
        expect(check.steps.find((s) => s.name === 'signature')?.detail).toMatch(/trusted/);
        const other = await generateSigningKey();
        const untrusted = await checkProof(proof, world, { trustedKeys: [other.publicKey] });
        expect(untrusted.status).toBe('verified');
        expect(untrusted.steps.find((s) => s.name === 'signature')?.detail).toMatch(/not in your trusted keys/);
    });
    it('re-hashing a signed proof after editing it breaks the signature', async () => {
        const world = failingWorld();
        const proof = await createProof(world, { key: await generateSigningKey() });
        const forged = JSON.parse(JSON.stringify(proof));
        forged.claim.passed = true;
        forged.claim.hash = claimHash(forged.claim);
        const { signature, ...rest } = forged;
        const edited = { ...rest, hash: proofBodyHash(rest), ...(signature ? { signature } : {}) };
        const check = await checkProof(edited, world);
        expect(check.status).toBe('bad-signature');
        expect(check.signature?.valid).toBe(false);
    });
    it('a signature copied onto another proof does not verify', async () => {
        const k = await generateSigningKey();
        const a = await createProof(passingWorld(), { key: k, now: 1 });
        const b = await createProof(failingWorld(), { now: 1 });
        const grafted = { ...b, ...(a.signature ? { signature: a.signature } : {}) };
        expect((await checkProof(grafted, failingWorld())).status).toBe('bad-signature');
    });
    it('a signature by a substituted key does not verify', async () => {
        const world = passingWorld();
        const proof = await createProof(world, { key: await generateSigningKey() });
        const attacker = await generateSigningKey();
        const swapped = JSON.parse(JSON.stringify(proof));
        if (swapped.signature)
            swapped.signature.publicKey = attacker.publicKey;
        expect((await checkProof(swapped, world)).status).toBe('bad-signature');
    });
    it('re-signing replaces the old signature', async () => {
        const world = passingWorld();
        const proof = await createProof(world, { key: await generateSigningKey() });
        const k2 = await generateSigningKey();
        const re = await signProof(proof, k2);
        expect(re.signature?.publicKey).toBe(k2.publicKey);
        expect((await checkProof(re, world)).status).toBe('verified');
    });
});
describe('limits', () => {
    it('refuses to seal a replay that the wall-clock budget cut short', async () => {
        await expect(createProof(template('domino-run'), { budgetMs: 1 })).rejects.toThrow(/ran out of time/);
    });
    it('reports an inconclusive replay as such, not as a divergence', async () => {
        const world = template('domino-run');
        const proof = await createProof(world);
        const check = await checkProof(proof, world, { budgetMs: 1 });
        expect(check.status).toBe('inconclusive');
        expect(check.ok).toBe(false);
    });
    it('a proof whose world needs shapes it does not carry cannot be re-simulated', async () => {
        const world = passingWorld();
        const proof = await createProof(world);
        const ext = JSON.parse(JSON.stringify(proof));
        ext.colliders = { mode: 'external', hash: `sha256:${'b'.repeat(64)}` };
        const check = await checkProof(rehash(ext), world);
        expect(check.status).toBe('unverifiable');
        expect(check.ok).toBe(false);
    });
    it('embedded renderer colliders are hashed and used by the replay', async () => {
        const world = createWorld({
            name: 'Embedded',
            entities: {
                crate: { id: 'crate', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, transform: { position: [0, 3, 0] }, physics: { body: 'dynamic' } },
                wall: { id: 'wall', shape: { kind: 'model', url: 'wall.glb' }, transform: { position: [0, 0, 0] }, physics: { body: 'static' } },
            },
            tests: [{ id: 'above', kind: 'staysAbove', target: 'crate', y: 0, within: 2 }],
        });
        const colliders = [['wall', [{ kind: 'box', halfExtents: [5, 0.5, 5], offset: [0, -0.5, 0] }]]];
        const proof = await createProof(world, { colliders });
        expect(proof.colliders.mode).toBe('embedded');
        expect((await checkProof(JSON.parse(JSON.stringify(proof)), world)).status).toBe('verified');
        const swapped = JSON.parse(JSON.stringify(proof));
        swapped.colliders.entries = [['wall', [{ kind: 'box', halfExtents: [9, 0.5, 9], offset: [0, -0.5, 0] }]]];
        expect((await checkProof(swapped, world)).status).toBe('tampered');
        const bad = rehash({ ...swapped, colliders: { mode: 'embedded', hash: hashJson(swapped.colliders.entries), entries: [['wall', [{ kind: 'box', halfExtents: [-1, 0, 0] }]]] } });
        const res = await checkProof(bad, world);
        expect(['tampered', 'replay-diverged']).toContain(res.status);
    });
});
