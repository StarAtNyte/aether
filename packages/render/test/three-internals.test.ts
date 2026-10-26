import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { preparePresentation } from '../src/gpu/presentation';
import { prepareCompileTextures } from '../src/gpu/compile-textures';
import { deferRenderPreparation } from '../src/gpu/render-preparation';
import { installRenderPatches } from '../src/three-patches';

/**
 * The renderer hooks (presentation, render-preparation, compile-textures, three-patches and the buffer, binding-key,
 * pixel-store and uv-transform caches) wrap private three.js members. They are written against exactly this release.
 * When the three version moves, these tests fail first and say which member to re-verify (docs/CONTRACTS.md, "three.js internals").
 */
const PINNED = '0.186.1';
const pkgDir = new URL('../../../node_modules/three/', import.meta.url).pathname;
const source = readFileSync(`${pkgDir}build/three.webgpu.js`, 'utf8');

function classBody(name: string): string {
  const start = source.search(new RegExp(`^class ${name}\\b`, 'm'));
  if (start < 0) throw new Error(`three.js shape changed: class ${name} not found in three.webgpu.js. Re-verify the renderer hooks (docs/CONTRACTS.md, "three.js internals").`);
  const next = source.slice(start + 1).search(/^class \w+/m);
  return source.slice(start, next < 0 ? undefined : start + 1 + next);
}
const defines = (body: string, member: string): boolean => new RegExp(`^\\t(async )?${member}\\(`, 'm').test(body);

describe('three.js private members the renderer hooks wrap', () => {
  it('pins three exactly and the installed copy matches', () => {
    const installed = (JSON.parse(readFileSync(`${pkgDir}package.json`, 'utf8')) as { version: string }).version;
    expect(installed, `three is ${installed}, the renderer hooks were written for ${PINNED}. Re-verify packages/render/src/gpu/{presentation,render-preparation,compile-textures}.ts and three-patches.ts against the new release, then update PINNED here and in package.json.`).toBe(PINNED);
    for (const p of ['packages/render/package.json', 'apps/studio/package.json']) {
      const dep = (JSON.parse(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8')) as { dependencies: Record<string, string> }).dependencies['three'];
      expect(dep, `${p} must pin three exactly`).toBe(PINNED);
    }
  });
  const members: Array<[string, string[]]> = [
    ['Renderer', ['_renderScene', '_renderObjectDirect', 'compileAsync', 'getRenderTarget', 'getOutputRenderTarget', 'getMRT', 'setRenderTarget', 'setOutputRenderTarget', 'setMRT', 'initTexture']],
    ['NodeManager', ['updateBefore', 'updateAfter', 'getForRenderAsync', 'delete']],
    ['RenderObjects', ['get', 'createRenderObject']],
    ['WebGLBackend', ['beginRender', 'finishRender', 'draw']],
    ['WebGPUBackend', ['beginRender', 'finishRender', 'draw']],
  ];
  for (const [cls, names] of members) {
    it(`${cls} still defines ${names.join(', ')}`, () => {
      const body = classBody(cls);
      const missing = names.filter(n => !defines(body, n));
      expect(missing, `three.js shape changed: ${cls} no longer defines ${missing.join(', ')}. Re-verify the renderer hooks (docs/CONTRACTS.md, "three.js internals").`).toEqual([]);
    });
  }
});

describe('unsupported renderer shape', () => {
  const shapes: Record<string, unknown> = { empty: {}, 'no backend': { _renderScene() {} }, 'renamed members': { renderScene() {}, backend: { begin() {} }, _nodes: {} } };
  for (const [label, shape] of Object.entries(shapes)) {
    it(`leaves a renderer with ${label} untouched and never throws`, () => {
      const before = { ...(shape as object) };
      const presentation = preparePresentation(shape, () => false);
      expect(() => { presentation.beginFrame(); presentation.synchronous(() => 1); presentation.dispose(); }).not.toThrow();
      expect(presentation.skipped).toBe(false);
      expect(() => prepareCompileTextures(shape as never).dispose()).not.toThrow();
      const prep = deferRenderPreparation(shape as never, { ready() {} } as never);
      expect(prep.synchronous(() => 7)).toBe(7);
      expect(() => prep.dispose()).not.toThrow();
      expect(() => installRenderPatches(shape as never)).not.toThrow();
      expect(Object.keys(shape as object)).toEqual(Object.keys(before));
    });
  }
});
