import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BridgeError, classifyCliFailure } from '../src/errors';
import { restrictedEnv, withTempDir } from '../src/sandbox';

let root: string;
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
    await expect(
      withTempDir(async (dir) => {
        seen = dir;
        await writeFile(join(dir, 'view-0.png'), 'x');
        throw new Error('boom');
      }, root),
    ).rejects.toThrow('boom');
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

describe('classifyCliFailure', () => {
  it.each([
    ['Not logged in · Please run /login', 'not_logged_in'],
    ['Error: 401 Unauthorized', 'not_logged_in'],
    ["You've hit your usage limit. Try again in 3 hours.", 'rate_limited'],
    ['429 Too Many Requests', 'rate_limited'],
    ['segfault at 0x0', 'backend_error'],
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
