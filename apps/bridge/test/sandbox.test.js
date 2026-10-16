import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BridgeError, classifyCliFailure } from '../src/errors';
import { restrictedEnv, withTempDir } from '../src/sandbox';
let root;
beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'bridge-sandbox-test-'));
});
afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});
describe('withTempDir', () => {
    it('gives each run a fresh, empty, private directory and removes it afterwards', async () => {
        let seen = '';
        const out = await withTempDir(async (dir) => {
            seen = dir;
            expect(await readdir(dir)).toEqual([]);
            await writeFile(join(dir, 'system.txt'), 'x');
            return 42;
        }, root);
        expect(out).toBe(42);
        expect(existsSync(seen)).toBe(false);
    });
    it('removes the directory even when the run throws', async () => {
        let seen = '';
        await expect(withTempDir(async (dir) => {
            seen = dir;
            await writeFile(join(dir, 'view-0.png'), 'x');
            throw new Error('boom');
        }, root)).rejects.toThrow('boom');
        expect(existsSync(seen)).toBe(false);
        expect(await readdir(root)).toEqual([]);
    });
});
describe('restrictedEnv', () => {
    it('drops secret-looking names even when they are allowlisted extras', () => {
        const env = restrictedEnv({ PATH: '/bin', HOME: '/h', SESSION_MANAGER: 'x', XDG_SESSION_TYPE: 'wayland', OPENAI_API_KEY: 'sk' }, { AUTH_HEADER: 'x', SAFE: '1' });
        expect(env).toEqual({ PATH: '/bin', HOME: '/h', SAFE: '1' });
    });
});
describe('classifyCliFailure detail', () => {
    it('names the real reason instead of a bare "failed to answer"', () => {
        const e = classifyCliFailure('Codex', 'stream error: unexpected response format from backend');
        expect(e.code).toBe('backend_error');
        expect(e.message).toContain('Codex failed to answer: ');
        expect(e.message).toContain('unexpected response format');
        expect(e.message).not.toMatch(/\.\.$/);
    });
    it('says so when the CLI gave no detail, and scrubs paths, urls and tokens from the excerpt', () => {
        expect(classifyCliFailure('Codex', '').message).toBe('Codex failed to answer (no further detail from its output).');
        const e = classifyCliFailure('Codex', 'panic reading /home/me/.codex/auth.json via https://chatgpt.com/backend with abcdefghijklmnopqrstuvwxyz0123456789ABCDEF for me@example.com');
        expect(e.message).not.toMatch(/home|chatgpt\.com|abcdefghijkl|example\.com/);
    });
    it('model and context problems tell the user what to change', () => {
        expect(classifyCliFailure('Codex', 'model not supported').message).toMatch(/Pick another model/);
        expect(classifyCliFailure('Codex', 'prompt is too long').message).toMatch(/smaller world|shorten/);
    });
});
describe('classifyCliFailure', () => {
    it.each([
        ['Not logged in · Please run /login', 'not_logged_in'],
        ['Error: 401 Unauthorized', 'not_logged_in'],
        ["You've hit your usage limit. Try again in 3 hours.", 'rate_limited'],
        ['429 Too Many Requests', 'rate_limited'],
        ['segfault at 0x0', 'backend_error'],
        ['The model `gpt-6.1-sol` does not exist or you do not have access to it', 'model_unavailable'],
        ['unknown model: gpt-9', 'model_unavailable'],
        ['maximum context length is 400000 tokens, resulting in a prompt too long', 'context_too_large'],
        ['error sending request for url: connection reset by peer', 'network_error'],
        ['getaddrinfo ENOTFOUND chatgpt.com', 'network_error'],
        ['503 Service Unavailable', 'backend_error'],
    ])('%s → %s', (text, code) => {
        const e = classifyCliFailure('Codex', text);
        expect(e).toBeInstanceOf(BridgeError);
        expect(e.code).toBe(code);
    });
    it('never echoes raw CLI output (it may contain paths, prompts or account details)', () => {
        const secret = 'user@example.com /home/someone/.codex/auth.json sk-live-abc';
        for (const text of [`Not logged in ${secret}`, `usage limit ${secret}`, `crash ${secret}`]) {
            const e = classifyCliFailure('Claude Code', text);
            expect(e.message).not.toContain('example.com');
            expect(e.message).not.toContain('/home/');
            expect(e.message).not.toContain('sk-live');
        }
    });
});
