import { describe, expect, it } from 'vitest';
import { ProviderError, createMockProvider } from '@aether/agent';
import { createProviderChain } from '../src/ai/chain';
import { fallbackText } from '../src/ai/messages';
const REQ = { role: 'planner', system: 's', messages: [{ role: 'user', content: 'hi' }] };
const reply = (text) => ({ content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 }, model: 'm' });
const ok = (name) => ({ name, complete: async () => reply(name) });
const failing = (name, err) => ({ name, complete: async () => Promise.reject(err) });
const link = (label, provider) => ({ label, provider, vision: true });
const text = (r) => r.content[0].text;
describe('provider chain', () => {
    it('Codex fails, Claude Code answers: the user sees why and the other assistant runs before the offline planner', async () => {
        const switches = [];
        const codexErr = new ProviderError('server', 'Codex failed to answer: stream error: unexpected response format.', { reason: 'backend_error', status: 502 });
        const chain = createProviderChain([link('Codex · gpt-6.1-sol', failing('codex', codexErr)), link('Claude Code · sonnet', ok('claude'))], createMockProvider(), (s) => switches.push(s));
        expect(text(await chain.complete(REQ))).toBe('claude');
        expect(switches).toHaveLength(1);
        expect(switches[0]?.to?.label).toBe('Claude Code · sonnet');
        const msg = fallbackText(switches[0].from.label, switches[0].notice, switches[0].to?.label);
        expect(msg).toContain('Codex · gpt-6.1-sol could not answer: Codex failed to answer: stream error: unexpected response format.');
        expect(msg).toContain('Trying Claude Code · sonnet instead.');
        expect(msg).not.toContain('..');
        expect(msg).not.toMatch(/offline planner/);
        expect(chain.active()?.label).toBe('Claude Code · sonnet');
        expect(chain.offlineNotice).toBeNull();
        // Later calls of the same run stay on the working assistant.
        expect(text(await chain.complete(REQ))).toBe('claude');
        expect(switches).toHaveLength(1);
    });
    it('both fail: reports each reason and only then uses the offline planner', async () => {
        const switches = [];
        const chain = createProviderChain([link('Codex', failing('codex', new ProviderError('not_found', 'no model', { reason: 'model_unavailable' }))), link('Claude Code', failing('claude', new ProviderError('rate_limit', 'limit', { reason: 'rate_limited' })))], ok('offline'), (s) => switches.push(s));
        expect(text(await chain.complete(REQ))).toBe('offline');
        expect(switches.map((s) => s.to?.label ?? 'offline')).toEqual(['Claude Code', 'offline']);
        expect(fallbackText('Codex', switches[0].notice, 'Claude Code')).toMatch(/does not offer the selected model/);
        expect(fallbackText('Claude Code', switches[1].notice)).toMatch(/usage limit.*offline planner/);
        expect(chain.active()).toBeNull();
        expect(chain.offlineNotice?.reason).toBe('rate_limited');
    });
    it('a dead bridge or expired pairing skips the other assistant (it sits behind the same door)', async () => {
        const calls = [];
        const alt = { name: 'claude', complete: async () => (calls.push('claude'), reply('claude')) };
        const chain = createProviderChain([link('Codex', failing('codex', new ProviderError('network', 'down', { reason: 'bridge_offline' }))), link('Claude Code', alt)], ok('offline'), () => undefined);
        expect(text(await chain.complete(REQ))).toBe('offline');
        expect(calls).toEqual([]);
    });
    it('caller aborts are not failures', async () => {
        const ctrl = new AbortController();
        const slow = { name: 'codex', complete: async () => { ctrl.abort(); throw new ProviderError('aborted', 'aborted'); } };
        const switches = [];
        const chain = createProviderChain([link('Codex', slow), link('Claude Code', ok('claude'))], ok('offline'), (s) => switches.push(s));
        await expect(chain.complete(REQ, ctrl.signal)).rejects.toThrow();
        expect(switches).toEqual([]);
    });
    it('no links is just the offline planner', async () => {
        const chain = createProviderChain([], ok('offline'), () => undefined);
        expect(text(await chain.complete(REQ))).toBe('offline');
    });
});
