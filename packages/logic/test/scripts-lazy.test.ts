import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

/** Files reachable from `entry` through static `import … from './x'` / `export … from './x'` statements. */
function staticGraph(entry: string): Map<string, string> {
  const seen = new Map<string, string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    const text = readFileSync(file, 'utf8');
    seen.set(file, text);
    // `import type` / `export type` are erased at runtime and never load a module.
    for (const m of text.matchAll(/^(?:import|export)(?!\s+type\b)[^'";]*?from\s+'(\.[^']+)'/gm)) {
      const spec = m[1] as string;
      const base = resolve(dirname(file), spec);
      const candidates = base.endsWith('.ts') ? [base] : [`${base}.ts`, `${base}/index.ts`];
      const found = candidates.find((c) => existsSync(c));
      if (!found) throw new Error(`unresolved import ${spec} in ${file}`);
      stack.push(found);
    }
  }
  return seen;
}

describe('script sandbox loading', () => {
  it('keeps QuickJS out of the static import graph of the package entry', () => {
    const graph = staticGraph(resolve(SRC, 'index.ts'));
    expect(graph.size).toBeGreaterThan(5);
    for (const [file, text] of graph) {
      expect({ file, quickjs: /^import(?!\s+type\b).*quickjs/m.test(text) }).toEqual({ file, quickjs: false });
    }
    expect([...graph.keys()].some((f) => f.endsWith('scripting/runner.ts'))).toBe(false);
  });

  it('ships exactly one QuickJS variant (release, sync)', () => {
    const runner = readFileSync(resolve(SRC, 'scripting/runner.ts'), 'utf8');
    const variants = [...runner.matchAll(/from '(@jitl\/quickjs-[^']+)'/g)].map((m) => m[1]);
    expect(variants).toEqual(['@jitl/quickjs-wasmfile-release-sync']);
    expect(runner).not.toMatch(/from 'quickjs-emscripten'/);
  });
});
