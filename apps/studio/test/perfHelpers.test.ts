import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { MAX_POOLED_POSES, PosePool } from '../src/engine/posePool';
import { rapierWasm, rewriteRapierWasm } from '../../../scripts/vite/rapier-wasm';

describe('PosePool (allocation-free getTransform)', () => {
  it('reuses one record per entity id and fills it by copy', () => {
    const pool = new PosePool();
    const a = pool.slot('a');
    expect(pool.slot('a')).toBe(a);
    const src: [number, number, number] = [1, 2, 3];
    const q: [number, number, number, number] = [0, 0, 0, 1];
    const filled = pool.fill('a', src, q);
    expect(filled).toBe(a);
    src[0] = 99;
    expect(a.position).toEqual([1, 2, 3]);
    expect(pool.slot('b')).not.toBe(a);
    pool.release('a');
    expect(pool.slot('a')).not.toBe(a);
    pool.clear();
    expect(pool.size).toBe(0);
  });

  it('stops pooling past the cap instead of growing without bound', () => {
    const pool = new PosePool();
    for (let i = 0; i < MAX_POOLED_POSES + 10; i++) pool.slot(`e${i}`);
    expect(pool.size).toBe(MAX_POOLED_POSES);
    const extra = pool.slot('extra');
    expect(pool.slot('extra')).not.toBe(extra);
  });
});

describe('rapier-wasm build plugin', () => {
  const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, ...Array.from({ length: 1200 }, (_, i) => i & 255)]);
  const b64 = Buffer.from(wasm).toString('base64');
  const code = `function FC(){return DC(this,void 0,void 0,(function*(){yield EI({module_or_path:oC.toByteArray("${b64}")})}))}export{FC as init};`;

  it('replaces the inlined module with a ?url import of the identical shipped file', () => {
    const r = rewriteRapierWasm(code, '/pkg/dist/rapier_wasm3d_bg.wasm', () => wasm);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.wasmBytes).toBe(wasm.length);
    expect(r.code.startsWith('import __aetherRapierWasmUrl from "/pkg/dist/rapier_wasm3d_bg.wasm?url";\n')).toBe(true);
    expect(r.code).toContain('EI({module_or_path:__aetherRapierWasmUrl})');
    expect(r.code).not.toContain(b64);
    expect(rewriteRapierWasm(r.code, '/pkg/dist/rapier_wasm3d_bg.wasm', () => wasm).ok).toBe(false);
  });

  it('consumes the trailing .buffer of the real bundle (the argument must be the URL string itself)', () => {
    const real = code.replace(`toByteArray("${b64}")`, `toByteArray("${b64}").buffer`);
    const r = rewriteRapierWasm(real, '/w.wasm', () => wasm);
    expect(r.ok && r.code).toContain('EI({module_or_path:__aetherRapierWasmUrl})');
    expect(r.ok && r.code).not.toContain('.buffer');
  });

  it('keeps the module untouched when the shipped file differs, is missing or the pattern is absent', () => {
    const other = new Uint8Array(wasm);
    other[20] = 1 + ((other[20] ?? 0) % 200);
    expect(createHash('sha256').update(other).digest('hex')).not.toBe(createHash('sha256').update(wasm).digest('hex'));
    expect(rewriteRapierWasm(code, '/x.wasm', () => other)).toEqual({ ok: false, reason: 'shipped wasm differs from the inlined module' });
    expect(rewriteRapierWasm(code, '/x.wasm', () => {
      throw new Error('ENOENT');
    })).toEqual({ ok: false, reason: 'missing /x.wasm' });
    expect(rewriteRapierWasm('export const x = 1;', '/x.wasm', () => wasm)).toEqual({ ok: false, reason: 'inlined wasm not found' });
  });

  it('only transforms the compat bundle and verifies the real package', () => {
    const plugin = rapierWasm();
    expect(plugin.transform('const a = 1;', '/src/app.ts')).toBeNull();
    const real = new URL('../../../packages/physics/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs', import.meta.url).pathname;
    if (!existsSync(real)) return;
    const out = plugin.transform(readFileSync(real, 'utf8'), real);
    expect(out).not.toBeNull();
    expect(out?.code.length ?? Infinity).toBeLessThan(400_000);
    // The initialiser receives the URL string, not a property of it.
    expect(out?.code).toMatch(/module_or_path:__aetherRapierWasmUrl[})]/);
  });
});
