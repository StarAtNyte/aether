import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CODEX_IMAGE_DISABLED_FEATURES, codexImageArgs, codexImagePrompt, createCodexImageBackend, scanEvents, sniffImage } from '../src/backends/codex-image';

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'codex-image-test-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]);

/** A stand-in `codex` that behaves like the CLI: reads the prompt, announces a thread, writes a picture where Codex does. */
function fakeCodex(name: string, body: string): string {
  const path = join(root, name);
  writeFileSync(path, `#!/bin/sh\ncat >/dev/null\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe('Codex image backend', () => {
  it('keeps only the image tool: everything else off, prompt on stdin, no key in the environment', () => {
    const args = codexImageArgs('/tmp/x');
    expect(args.slice(0, 3)).toEqual(['exec', '--json', '--skip-git-repo-check']);
    expect(args).toContain('--ignore-user-config');
    expect(args[args.indexOf('-s') + 1]).toBe('read-only');
    expect(args[args.length - 1]).toBe('-');
    expect(args).toContain('--enable');
    expect(CODEX_IMAGE_DISABLED_FEATURES).not.toContain('image_generation' as never);
    expect(CODEX_IMAGE_DISABLED_FEATURES).toContain('shell_tool');
    expect(codexImageArgs('/tmp/x', '/tmp/x/ref.png')).toContain('-i');
    expect(codexImagePrompt({ prompt: 'oak boards' })).toContain('oak boards');
  });

  it('reads the thread id and picture paths from the events', () => {
    const out = scanEvents(['{"type":"thread.started","thread_id":"01a084b3-b32b-7512"}', '{"type":"item.completed","item":{"saved_path":"/h/.codex/generated_images/01a084b3/exec-1.png"}}', 'not json'].join('\n'));
    expect(out.threadId).toBe('01a084b3-b32b-7512');
    expect(out.paths).toEqual(['/h/.codex/generated_images/01a084b3/exec-1.png']);
    expect(sniffImage(new Uint8Array(PNG))).toBe('image/png');
    expect(sniffImage(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('returns the picture Codex wrote under its home', async () => {
    const home = join(root, 'home1');
    mkdirSync(home, { recursive: true });
    const b64 = PNG.toString('base64');
    const cmd = fakeCodex('codex-ok', `mkdir -p "$CODEX_HOME/generated_images/thr-00000001"\nprintf '%s' '${b64}' | base64 -d > "$CODEX_HOME/generated_images/thr-00000001/exec-1.png"\necho '{"type":"thread.started","thread_id":"thr-00000001"}'\necho '{"type":"turn.completed"}'`);
    const backend = createCodexImageBackend({ command: cmd, codexHome: home, env: { PATH: process.env['PATH'] ?? '/usr/bin', CODEX_HOME: home }, tmpRoot: root, timeoutMs: 20_000 });
    const out = await backend.generate({ prompt: 'a swatch' });
    expect(out.mime).toBe('image/png');
    expect(Buffer.from(out.bytes).equals(PNG)).toBe(true);
  });

  it('reports the reason when Codex fails (usage limit) and when it makes no picture', async () => {
    const home = join(root, 'home2');
    mkdirSync(home, { recursive: true });
    const env = { PATH: process.env['PATH'] ?? '/usr/bin', CODEX_HOME: home };
    const limited = fakeCodex('codex-limit', `echo '{"type":"thread.started","thread_id":"thr-00000002"}'\necho '{"type":"turn.failed","error":{"message":"You have hit your usage limit. Try again later."}}'\nexit 1`);
    await expect(createCodexImageBackend({ command: limited, codexHome: home, env, tmpRoot: root, timeoutMs: 20_000 }).generate({ prompt: 'x' })).rejects.toThrow();
    const none = fakeCodex('codex-none', `echo '{"type":"thread.started","thread_id":"thr-00000003"}'`);
    await expect(createCodexImageBackend({ command: none, codexHome: home, env, tmpRoot: root, timeoutMs: 20_000 }).generate({ prompt: 'x' })).rejects.toThrow(/without making an image/);
  });

  it('refuses a file that is not an image', async () => {
    const home = join(root, 'home3');
    mkdirSync(home, { recursive: true });
    const cmd = fakeCodex('codex-bad', `mkdir -p "$CODEX_HOME/generated_images/thr-00000004"\necho 'hello' > "$CODEX_HOME/generated_images/thr-00000004/exec-1.png"\necho '{"type":"thread.started","thread_id":"thr-00000004"}'`);
    await expect(createCodexImageBackend({ command: cmd, codexHome: home, env: { PATH: process.env['PATH'] ?? '/usr/bin', CODEX_HOME: home }, tmpRoot: root, timeoutMs: 20_000 }).generate({ prompt: 'x' })).rejects.toThrow(/not a PNG/);
  });
});
