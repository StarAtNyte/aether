import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { generationCode, markSchemasPure, type GenerationCode } from '../../../scripts/vite/gen-version';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
/** A change that survives tree shaking wherever the module is in the bundle (a module-level side effect). */
const touched = (rel: string): string => `${read(rel)}\n;(globalThis as { __genVersionProbe?: number }).__genVersionProbe = 1;\n`;
/**
 * An ordinary edit: a statement in the first exported function, or (a module without one, a barrel) a new export. A
 * module-level side effect would count anywhere the lane imports, even through a barrel, because it would run there.
 */
function edited(rel: string): string {
  const src = read(rel);
  const fn = /^export (?:async )?function [^\n]*\{$/m.exec(src);
  if (!fn) return `${src}\nexport const __genVersionProbe = { probe: 1 };\n`;
  const at = fn.index + fn[0].length;
  return `${src.slice(0, at)}\n  (globalThis as { __genVersionProbe?: number }).__genVersionProbe = 1;${src.slice(at)}`;
}

let base: GenerationCode;
beforeAll(async () => {
  base = await generationCode();
}, 30_000);

const versionWith = async (patch: Record<string, string>): Promise<string> => (await generationCode({ patch })).version;

/** Code that decides generator output or how it is stored: each must be an input of the version. */
const GEOMETRY = [
  ...readdirSync(join(ROOT, 'packages/procgen/src/generators')).filter((f) => f.endsWith('.ts')).map((f) => `packages/procgen/src/generators/${f}`),
  'packages/procgen/src/generate.ts',
  'packages/procgen/src/output.ts',
  'packages/procgen/src/api.ts',
  'packages/procgen/src/params.ts',
  'packages/procgen/src/cache.ts',
  'packages/procgen/src/noise.ts',
  'packages/procgen/src/sandbox/sandbox.worker.ts',
  'packages/arch/src/wall.ts',
  'packages/arch/src/roof.ts',
  'packages/arch/src/stair.ts',
  'packages/arch/src/mesh.ts',
  'packages/arch/src/openings.ts',
  'packages/core/src/random.ts',
  'packages/render/src/geometry/gen.worker.ts',
  'packages/render/src/geometry/buffer-geometry.ts',
  'packages/render/src/geometry/metre-uvs.ts',
  'packages/render/src/geometry/soften.ts',
  'packages/render/src/geometry/ddc.ts',
  'packages/render/src/geometry/ddc-codec.ts',
  'packages/render/src/geometry/fingerprint.ts',
  'packages/render/src/materials/presets.ts',
];

/** Code that never changes a generator output: players, views, the editor, scheduling, cooking, the lane's page side. */
const NOT_GEOMETRY = [
  'packages/render/src/view/view-stops.ts',
  'packages/render/src/view/opening-view.ts',
  'packages/render/src/world-renderer.ts',
  'packages/render/src/geometry/gen-pool.ts',
  'packages/render/src/cook/pack.ts',
  'packages/render/src/cook/cooked.ts',
  'packages/render/src/cook/manifest.ts',
  'packages/render/src/virtual/cluster-dag.ts',
  'packages/core/src/worker-scheduler.ts',
  'packages/core/src/diff.ts',
  'packages/core/src/history.ts',
  'packages/core/src/index.ts',
  'packages/procgen/src/index.ts',
  'apps/studio/src/player/PlayerApp.tsx',
];

describe('the generator code version', () => {
  it('is 16 hex and the same on every run', async () => {
    expect(base.version).toMatch(/^[0-9a-f]{16}$/);
    expect(await versionWith({})).toBe(base.version);
  });

  it.each(GEOMETRY)('counts %s', async (rel) => {
    expect(base.inputs).toContain(rel);
    expect(await versionWith({ [rel]: touched(rel) })).not.toBe(base.version);
  });

  it.each(NOT_GEOMETRY)('ignores %s', async (rel) => {
    expect(base.inputs).not.toContain(rel);
    expect(await versionWith({ [rel]: edited(rel) })).toBe(base.version);
  });

  it('reaches no player, view, editor or scheduling code', () => {
    const bad = base.inputs.filter((f) => /^apps\/|\/src\/(view|player|ui|gpu|sync|streaming|environment|characters)\/|worker-scheduler|world-renderer|gen-pool/.test(f));
    expect(bad).toEqual([]);
  });

  it('ignores comments in code it counts', async () => {
    const rel = 'packages/render/src/geometry/buffer-geometry.ts';
    expect(await versionWith({ [rel]: `// a note\n${read(rel)}\n/** another */\n` })).toBe(base.version);
  });

  it('counts a schema the generators use and ignores one they do not', async () => {
    const rel = 'packages/core/src/schema.ts';
    const src = read(rel);
    // Material finishes are parsed by the generators: another finish changes what they accept.
    const used = src.replace("export const MaterialFinish = z.enum([\n", "export const MaterialFinish = z.enum([\n  'probe-finish',\n");
    expect(used).not.toBe(src);
    expect(await versionWith({ [rel]: used })).not.toBe(base.version);
    // A tour stop is presentation only (the change of 7 November that made every package stale).
    const unused = src.replace('name: z.string().min(1).max(60).optional(),', 'name: z.string().min(1).max(80).optional(),');
    expect(unused).not.toBe(src);
    expect(await versionWith({ [rel]: unused })).toBe(base.version);
  });
});

describe('marking schemas pure', () => {
  it('wraps top-level schema declarations and nothing else', () => {
    const src = [
      "import { z } from 'zod';",
      'export const A = z.object({ a: z.string().regex(/[)]+/), b: `x${1}` });',
      'const B = A.extend({',
      "  c: z.number(), // )",
      '});',
      'export const C = z',
      '  .enum([\'x\'])',
      '  .optional()',
      'export const table = build();',
      'function f() {',
      '  const D = z.string();',
      '}',
    ].join('\n');
    const out = markSchemasPure(src);
    expect(out).toContain('export const A = /* @__PURE__ */ (() => (z.object({ a: z.string().regex(/[)]+/), b: `x${1}` })))();');
    expect(out).toContain("const B = /* @__PURE__ */ (() => (A.extend({\n  c: z.number(), // )\n})))();");
    expect(out).toContain("export const C = /* @__PURE__ */ (() => (z\n  .enum(['x'])\n  .optional()))()");
    expect(out).toContain('export const table = build();');
    expect(out).toContain('  const D = z.string();');
    expect(markSchemasPure('const A = z.object({});')).toBe('const A = z.object({});');
  });
});
