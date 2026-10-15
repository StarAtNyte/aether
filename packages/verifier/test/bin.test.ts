import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProof, stringifyBundle } from '../src/index';
import { passingWorld } from './fixtures';

const BIN = new URL('../bin/aether-verify.mjs', import.meta.url).pathname;

describe('the aether-verify executable', () => {
  it('runs from a shell: exit 0 for a good proof, 1 for a forged one, 2 without arguments', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aether-bin-'));
    try {
      const world = passingWorld();
      const proof = await createProof(world);
      const good = join(dir, 'good.json');
      writeFileSync(good, stringifyBundle(proof, world));
      const ok = spawnSync(process.execPath, [BIN, good], { encoding: 'utf8', timeout: 60_000 });
      expect(ok.status, ok.stderr).toBe(0);
      expect(ok.stdout).toMatch(/VERIFIED/);
      const forged = join(dir, 'forged.json');
      writeFileSync(forged, stringifyBundle({ ...proof, claim: { ...proof.claim, passed: false } }, world));
      const bad = spawnSync(process.execPath, [BIN, forged], { encoding: 'utf8', timeout: 60_000 });
      expect(bad.status).toBe(1);
      expect(bad.stdout).toMatch(/tampered/);
      const none = spawnSync(process.execPath, [BIN], { encoding: 'utf8', timeout: 60_000 });
      expect(none.status).toBe(2);
      expect(none.stdout).toMatch(/aether-verify/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
