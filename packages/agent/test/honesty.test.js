import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { WorldAgent } from '../src/agent';
import { claimsVerification, guardVerificationClaim, UNVERIFIED_NOTE } from '../src/honesty';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';
describe('verification claims', () => {
    it('recognises claims of checks', () => {
        for (const m of ['All checks passed!', 'I verified the level is playable.', 'The tests pass.', 'Physics checks passed', 'I have tested it'])
            expect(claimsVerification(m)).toBe(true);
        for (const m of ['Here is your forest.', 'I added 5 trees.', 'Checks are optional here.'])
            expect(claimsVerification(m)).toBe(false);
    });
    it('adds a note only when nothing ran and nothing is pending', () => {
        expect(guardVerificationClaim('All checks passed', { ran: false, pending: false })).toContain(UNVERIFIED_NOTE.trim());
        expect(guardVerificationClaim('All checks passed', { ran: true, pending: false })).toBe('All checks passed');
        expect(guardVerificationClaim('All checks passed', { ran: false, pending: true })).toBe('All checks passed');
        expect(guardVerificationClaim('Done.', { ran: false, pending: false })).toBe('Done.');
        const once = guardVerificationClaim('All checks passed', { ran: false, pending: false });
        expect(guardVerificationClaim(once, { ran: false, pending: false })).toBe(once);
    });
    it('a model that says "all checks passed" without changing anything gets the note in the agent loop', async () => {
        const provider = {
            name: 'fake',
            async complete() {
                return { content: [{ type: 'text', text: 'Everything is verified and all checks passed.' }], stopReason: 'end', model: 'fake-model' };
            },
        };
        const agent = new WorldAgent({ provider, catalogs: TEST_CATALOGS });
        const events = await collect(agent.run('make it nicer', new MemoryHost(createWorld())));
        const msg = events.find((e) => e.type === 'message');
        expect(msg && msg.type === 'message' ? msg.text : '').toContain('no checks were run');
        expect(events.some((e) => e.type === 'verify')).toBe(false);
    });
});
