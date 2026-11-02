import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GeneratorDef, type Json } from '@aether/core';
import { createNodeSandbox } from '../src/node';
import {
  createWorkerSandbox, GENERATOR_API_DTS, GENERATOR_EXAMPLES, staticCheckSource, validateOutput, type WorkerLike,
} from '../src/index';
import { compileGenerator, errorMessage, runCompiled } from '../src/sandbox/runner';
import { parseRunRequest, parseWorkerMessage, transferables } from '../src/sandbox/protocol';

const FINISH = 'api.add(api.box(1, 1, 1), { color: "#336699" }); return api.build();';
const def = (source: string, params: GeneratorDef['params'] = {}): GeneratorDef => ({ id: 'test-gen', description: 'test', params, source });

describe('staticCheckSource', () => {
  it('accepts every bundled example', () => {
    for (const ex of GENERATOR_EXAMPLES) expect(staticCheckSource(ex.def.source), ex.def.id).toEqual({ ok: true, problems: [] });
  });

  it.each([
    ['import', `import x from 'y'; ${FINISH}`],
    ['dynamic import', `import('y'); ${FINISH}`],
    ['export', `export const a = 1; ${FINISH}`],
    ['require', `require('fs'); ${FINISH}`],
    ['fetch', `fetch('/x'); ${FINISH}`],
    ['XMLHttpRequest', `new XMLHttpRequest(); ${FINISH}`],
    ['WebSocket', `new WebSocket('ws://x'); ${FINISH}`],
    ['eval', `eval('1'); ${FINISH}`],
    ['Function', `Function('return this')(); ${FINISH}`],
    ['constructor', `api.box.constructor('x'); ${FINISH}`],
    ['globalThis', `globalThis.x = 1; ${FINISH}`],
    ['self', `self.postMessage(1); ${FINISH}`],
    ['window', `window.x = 1; ${FINISH}`],
    ['document', `document.cookie; ${FINISH}`],
    ['postMessage', `postMessage(1); ${FINISH}`],
    ['importScripts', `importScripts('x'); ${FINISH}`],
    ['Atomics', `Atomics.wait(); ${FINISH}`],
    ['SharedArrayBuffer', `new SharedArrayBuffer(8); ${FINISH}`],
    ['process', `process.exit(1); ${FINISH}`],
    ['__proto__', `({}).__proto__.x = 1; ${FINISH}`],
    ['prototype', `Object.prototype.x = 1; ${FINISH}`],
    ['with', `with (api) { box(1, 1, 1); } ${FINISH}`],
    ['unicode escape', `\\u0065val('1'); ${FINISH}`],
    ['hex escape', `api['constr\\x75ctor']; ${FINISH}`],
    ['timers', `setTimeout(() => 0); ${FINISH}`],
    ['async', `async function f() {} ${FINISH}`],
    ['Proxy', `new Proxy({}, {}); ${FINISH}`],
    ['fromCharCode', `String.fromCharCode(101); ${FINISH}`],
    ['control chars', `const a = 1; ${FINISH}`],
    ['missing build', 'const a = 1;'],
  ])('rejects %s', (_name, source) => {
    const r = staticCheckSource(source);
    expect(r.ok).toBe(false);
    expect(r.problems.length).toBeGreaterThan(0);
  });

  it('rejects oversized and empty sources', () => {
    expect(staticCheckSource(`${'//'.padEnd(70_000, 'x')}\n${FINISH}`).problems[0]).toMatch(/too long/);
    expect(staticCheckSource('   ').ok).toBe(false);
    expect(staticCheckSource(42 as unknown as string).ok).toBe(false);
  });

  it('does not reject ordinary identifiers like top, parent, constructorless names', () => {
    expect(staticCheckSource(`const top = 2; const parent = 1; const frames = 3; ${FINISH}`).ok).toBe(true);
  });
});

describe('GENERATOR_API_DTS', () => {
  it('documents every API and MeshHandle method plus materials and colliders', () => {
    for (const name of ['rng', 'seed', 'noise2', 'noise3', 'fbm2', 'box', 'roundedBox', 'sphere', 'cylinder', 'cone', 'torus', 'capsule', 'plane', 'lathe',
      'extrude', 'tube', 'ribbon', 'sdf', 'SdfNode', 'FigureNode', 'library', 'heightfield', 'icosphereRock', 'add', 'collider', 'autoColliders', 'color', 'mix', 'build',
      'translate', 'rotate', 'scale', 'displace', 'vertexColor', 'merge', 'clone', 'bounds', 'MaterialSpec', 'ColliderDesc',
      'emissiveIntensity', "'crystal'", 'halfExtents']) {
      expect(GENERATOR_API_DTS, name).toContain(name);
    }
  });
});

describe('createNodeSandbox', () => {
  it('runs every example and produces valid grounded output', async () => {
    const sb = createNodeSandbox();
    expect(GENERATOR_EXAMPLES.length).toBeGreaterThanOrEqual(4);
    for (const ex of GENERATOR_EXAMPLES) {
      expect(GeneratorDef.safeParse(ex.def).success).toBe(true);
      const out = await sb.run(ex.def, {}, 1);
      expect(validateOutput(out).ok).toBe(true);
      expect(out.bounds.min[1]).toBeCloseTo(0, 5);
      expect(out.colliders.length).toBeGreaterThan(0);
      expect(out.stats.triangles).toBeLessThan(5000);
      expect(ex.prompt.length).toBeGreaterThan(5);
    }
    sb.dispose();
  });

  it('is deterministic and resolves params against the def spec', async () => {
    const sb = createNodeSandbox();
    const ex = GENERATOR_EXAMPLES[1];
    if (!ex) throw new Error('missing example');
    const a = await sb.run(ex.def, { shelves: 3, ignored: 'x' }, 5);
    const b = await sb.run(ex.def, { shelves: 3 }, 5);
    expect(Array.from(a.parts[0]?.positions ?? [])).toEqual(Array.from(b.parts[0]?.positions ?? []));
    const big = await sb.run(ex.def, { shelves: 1000 }, 5);
    expect(big.stats.triangles).toBeGreaterThan(a.stats.triangles);
  });

  it('never lets host-realm errors reach generator code (membrane)', async () => {
    const sb = createNodeSandbox();
    const probe = (call: string): string => `
      const k = 'con' + 'struc' + 'tor';
      let r = 'none';
      try { ${call} } catch (e) {
        r = (e instanceof Error) ? 'ctx' : 'other';
        try { e[k][k]('return 1')(); r = 'escaped'; } catch (_) { /* expected: code generation disabled */ }
      }
      if (r !== 'ctx' && r !== 'other') throw new Error('membrane ' + r);
      if (r === 'none') throw new Error('membrane none');
      ${FINISH}`;
    // Host API throws (bad argument), host throws while exporting, and a callback throwing a non-Error.
    await expect(sb.run(def(probe('api.box(-1, "x", { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: 1 } } } } } } } } } });')), {}, 1)).resolves.toBeDefined();
    await expect(sb.run(def(probe('api.box(1, 1, 1).displace(() => { throw 42; });')), {}, 1)).resolves.toBeDefined();
    await expect(sb.run(def(probe('const deep = (n) => { try { return deep(n + 1); } catch (e) { api.box(1, 1, 1); throw e; } }; deep(0);')), {}, 1)).resolves.toBeDefined();
    sb.dispose();
  });

  it('kills infinite loops by timeout, including inside API callbacks', async () => {
    const sb = createNodeSandbox({ timeoutMs: 150 });
    const t0 = Date.now();
    await expect(sb.run(def(`while (true) {} ${FINISH}`), {}, 1)).rejects.toThrow(/timed out after 150 ms/);
    await expect(sb.run(def(`api.box(1, 1, 1).displace(() => { for (;;) {} }); ${FINISH}`), {}, 1)).rejects.toThrow(/timed out/);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('blocks constructor-chain escapes that slip past the static check', async () => {
    const sb = createNodeSandbox();
    const probes = [
      `const k = 'constr' + 'uctor'; api.box[k]('return 1')(); ${FINISH}`,
      `const k = 'constr' + 'uctor'; api.color('#ffffff')[k][k]('return 1')(); ${FINISH}`,
      `const k = 'constr' + 'uctor'; api.box(1, 1, 1).bounds()[k][k]('return 1')(); ${FINISH}`,
      `const k = 'constr' + 'uctor'; let e; try { api.box('x', 1, 1); } catch (err) { e = err; } e[k][k]('return 1')(); ${FINISH}`,
      `const k = 'constr' + 'uctor'; const tok = api.build(); tok[k][k]('return 1')(); ${FINISH}`,
      `const k = 'constr' + 'uctor'; api.box(1, 1, 1).displace((x) => { return 0; })[k][k]('return 1')(); ${FINISH}`,
    ];
    for (const source of probes) {
      await expect(sb.run(def(source), {}, 1), source).rejects.toThrow(/Code generation from strings disallowed|generator failed/);
    }
  });

  it('exposes exactly the documented api surface to untrusted code', async () => {
    const sb = createNodeSandbox();
    const expected = ['add', 'autoColliders', 'box', 'build', 'capsule', 'collider', 'color', 'cone', 'cylinder', 'extrude', 'fbm2',
      'heightfield', 'icosphereRock', 'lathe', 'library', 'mix', 'noise2', 'noise3', 'plane', 'ribbon', 'rng', 'roundedBox', 'sdf', 'seed', 'sphere', 'torus', 'tube'].join(',');
    const src = `const keys = Object.keys(api).sort().join(',');
if (keys !== '${expected}') throw new Error('unexpected api keys ' + keys);
const m = Object.keys(api.box(1, 1, 1)).sort().join(',');
if (m !== 'bounds,clone,displace,merge,rotate,scale,translate,vertexColor,warp') throw new Error('unexpected mesh keys ' + m);
if (Object.isFrozen(api) !== true) throw new Error('api facade must be frozen');
${FINISH}`;
    await expect(sb.run(def(src), {}, 1)).resolves.toBeDefined();
  });

  it('api.library hands a built-in piece to sculpt on, deterministically, and refuses building parts', async () => {
    const sb = createNodeSandbox({ timeoutMs: 20_000 });
    const src = `const parts = api.library('column', { variant: 0, height: 4 });
if (!Array.isArray(parts) || parts.length === 0) throw new Error('no parts');
for (const p of parts) api.add(p.mesh.displace((x, y, z) => 0.01 * api.noise3(x * 9, y * 9, z * 9)), p.material);
return api.build();`;
    const a = await sb.run(def(src), {}, 7);
    const b = await sb.run(def(src), {}, 7);
    expect(a.parts.length).toBeGreaterThan(0);
    expect(a.bounds.max[1] - a.bounds.min[1]).toBeGreaterThan(3.5);
    expect(Array.from(a.parts[0]!.positions.slice(0, 30))).toEqual(Array.from(b.parts[0]!.positions.slice(0, 30)));
    await expect(sb.run(def(`api.library('arch-wall'); ${FINISH}`), {}, 1)).rejects.toThrow(/building part/);
    await expect(sb.run(def(`api.library('nope'); ${FINISH}`), {}, 1)).rejects.toThrow(/unknown built-in/);
  });

  it('rejects dangerous sources statically before running', async () => {
    const sb = createNodeSandbox();
    await expect(sb.run(def(`fetch('/x'); ${FINISH}`), {}, 1)).rejects.toThrow(/rejected/);
    await expect(sb.run({ id: 'BAD ID', description: '', params: {}, source: FINISH } as GeneratorDef, {}, 1)).rejects.toThrow(/invalid generator definition/);
    await expect(sb.run(def(FINISH), JSON.parse('{"__proto__": {"x": 1}}') as Record<string, Json>, 1)).rejects.toThrow(/invalid params/);
  });

  it('surfaces generator errors, syntax errors and invalid returns with clear messages', async () => {
    const sb = createNodeSandbox();
    await expect(sb.run(def(`throw new Error('my bad'); ${FINISH}`), {}, 1)).rejects.toThrow(/my bad/);
    await expect(sb.run(def(`const = ; ${FINISH}`), {}, 1)).rejects.toThrow(/syntax error/);
    await expect(sb.run(def('api.add(api.box(1, 1, 1), {}); api.build(); return { parts: [] };'), {}, 1)).rejects.toThrow(/api\.build\(\)/);
    await expect(sb.run(def('return api.build();'), {}, 1)).rejects.toThrow(/no geometry/);
    await expect(sb.run(def(`api.add(api.box(1, 1, 1), { color: 'nope' }); ${FINISH}`), {}, 1)).rejects.toThrow(/material\.color/);
  });

  it('rejects oversize output (vertex budget / output caps)', async () => {
    const sb = createNodeSandbox({ timeoutMs: 5000 });
    const huge = `for (let i = 0; i < 40; i++) api.add(api.plane(10, 10, 512, 512), {}); ${FINISH}`;
    await expect(sb.run(def(huge), {}, 1)).rejects.toThrow(/exceeds|budget/);
  });

  it('refuses to run after dispose', async () => {
    const sb = createNodeSandbox();
    sb.dispose();
    await expect(sb.run(def(FINISH), {}, 1)).rejects.toThrow(/disposed/);
  });
});

/** In-process stand-in for the module worker (no lockdown; behavior only). */
class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  terminated = false;
  static created = 0;
  constructor(private readonly opts: { ready?: boolean } = {}) {
    FakeWorker.created++;
    if (opts.ready !== false) setTimeout(() => this.emit({ type: 'ready' }), 0);
  }
  private emit(data: unknown): void {
    if (!this.terminated) this.onmessage?.({ data } as MessageEvent);
  }
  postMessage(message: unknown): void {
    const req = parseRunRequest(message);
    if (!req || this.opts.ready === false) return;
    if (req.source.includes('HANG')) return;
    if (req.source.includes('CRASH')) {
      setTimeout(() => !this.terminated && this.onerror?.({ message: 'boom' } as unknown as Event), 0);
      return;
    }
    setTimeout(() => {
      try {
        const out = runCompiled(compileGenerator(req.source, Function), req.params, req.seed);
        this.emit({ type: 'result', id: req.id, ok: true, output: out });
      } catch (err) {
        this.emit({ type: 'result', id: req.id, ok: false, error: errorMessage(err) });
      }
    }, 1);
  }
  terminate(): void {
    this.terminated = true;
  }
}

describe('createWorkerSandbox (pool, watchdog, protocol)', () => {
  it('runs generators, validates output and reuses workers', async () => {
    FakeWorker.created = 0;
    const sb = createWorkerSandbox({ poolSize: 2, createWorker: () => new FakeWorker() });
    const results = await Promise.all([1, 2, 3, 4].map((seed) => sb.run(GENERATOR_EXAMPLES[0]?.def as GeneratorDef, {}, seed)));
    for (const r of results) expect(r.bounds.min[1]).toBeCloseTo(0, 5);
    expect(FakeWorker.created).toBe(2);
    sb.dispose();
  });

  it('terminates idle workers after the idle timeout and respawns them lazily', async () => {
    FakeWorker.created = 0;
    const workers: FakeWorker[] = [];
    const sb = createWorkerSandbox({ poolSize: 2, idleTimeoutMs: 80, createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    } });
    await sb.run(def(FINISH), {}, 1);
    expect(workers.length).toBe(1);
    expect(workers[0]?.terminated).toBe(false);
    await new Promise((r) => setTimeout(r, 160));
    expect(workers[0]?.terminated).toBe(true);
    const again = await sb.run(def(FINISH), {}, 2);
    expect(again.parts.length).toBe(1);
    expect(FakeWorker.created).toBe(2);
    // 0 disables the idle timeout.
    const keep = createWorkerSandbox({ poolSize: 1, idleTimeoutMs: 0, createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    } });
    await keep.run(def(FINISH), {}, 1);
    await new Promise((r) => setTimeout(r, 120));
    expect(workers[workers.length - 1]?.terminated).toBe(false);
    keep.dispose();
    sb.dispose();
  });

  it('terminates and respawns a worker on timeout', async () => {
    FakeWorker.created = 0;
    const workers: FakeWorker[] = [];
    const sb = createWorkerSandbox({ poolSize: 1, timeoutMs: 60, createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    } });
    await expect(sb.run(def(`/* HANG */ ${FINISH}`), {}, 1)).rejects.toThrow(/timed out after 60 ms/);
    expect(workers[0]?.terminated).toBe(true);
    const ok = await sb.run(def(FINISH), {}, 1);
    expect(ok.parts.length).toBe(1);
    expect(FakeWorker.created).toBe(2);
    sb.dispose();
  });

  it('reports worker crashes, boot failures and generator errors', async () => {
    const sb = createWorkerSandbox({ poolSize: 1, createWorker: () => new FakeWorker() });
    await expect(sb.run(def(`/* CRASH */ ${FINISH}`), {}, 1)).rejects.toThrow(/crashed: boom/);
    await expect(sb.run(def(`throw new Error('nope'); ${FINISH}`), {}, 1)).rejects.toThrow(/generator failed: Error: nope/);
    await expect(sb.run(def('return api.build();'), {}, 1)).rejects.toThrow(/no geometry/);
    sb.dispose();
    const neverReady = createWorkerSandbox({ poolSize: 1, bootTimeoutMs: 100, createWorker: () => new FakeWorker({ ready: false }) });
    await expect(neverReady.run(def(FINISH), {}, 1)).rejects.toThrow(/failed to start/);
    neverReady.dispose();
    const noFactory = createWorkerSandbox({ poolSize: 1, createWorker: () => { throw new Error('no workers here'); } });
    await expect(noFactory.run(def(FINISH), {}, 1)).rejects.toThrow('no workers here');
  });

  it('rejects statically-dangerous sources without touching a worker', async () => {
    let created = 0;
    const sb = createWorkerSandbox({ createWorker: () => {
      created++;
      return new FakeWorker();
    } });
    await expect(sb.run(def(`fetch('x'); ${FINISH}`), {}, 1)).rejects.toThrow(/rejected/);
    expect(created).toBe(0);
  });

  it('dispose rejects queued and in-flight runs; queue is bounded', async () => {
    const sb = createWorkerSandbox({ poolSize: 1, maxQueue: 2, createWorker: () => new FakeWorker() });
    const inflight = sb.run(def(`/* HANG */ ${FINISH}`), {}, 1);
    const q1 = sb.run(def(FINISH), {}, 1);
    const q2 = sb.run(def(FINISH), {}, 2);
    await expect(sb.run(def(FINISH), {}, 3)).rejects.toThrow(/queue is full/);
    sb.dispose();
    await expect(inflight).rejects.toThrow(/disposed/);
    await expect(q1).rejects.toThrow(/disposed/);
    await expect(q2).rejects.toThrow(/disposed/);
    await expect(sb.run(def(FINISH), {}, 1)).rejects.toThrow(/disposed/);
  });

  it('without a Worker global and no factory, runs reject clearly', async () => {
    const sb = createWorkerSandbox();
    await expect(sb.run(def(FINISH), {}, 1)).rejects.toThrow(/Web Workers are not available/);
    sb.dispose();
  });

  it('protocol parsers reject malformed messages; transferables are unique buffers', () => {
    expect(parseRunRequest(null)).toBeNull();
    expect(parseRunRequest({ type: 'run', id: 1.5, source: '', params: {}, seed: 1 })).toBeNull();
    expect(parseRunRequest({ type: 'run', id: 1, source: 'x', params: [], seed: 1 })).toBeNull();
    expect(parseWorkerMessage({ type: 'result', id: 1 })).toBeNull();
    expect(parseWorkerMessage({ type: 'result', id: 1, ok: false, error: 'x'.repeat(5000) })).toMatchObject({ ok: false });
    const out = runCompiled(compileGenerator(FINISH, Function), {}, 1);
    const bufs = transferables(out);
    expect(new Set(bufs).size).toBe(bufs.length);
    expect(bufs.length).toBeGreaterThanOrEqual(4);
  });
});

describe('worker lockdown (child process probe)', () => {
  it('neutralizes constructors, freezes intrinsics and removes network globals', () => {
    const probe = fileURLToPath(new URL('./fixtures/lockdown-probe.ts', import.meta.url));
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const res = spawnSync(process.execPath, ['--import', 'tsx', probe], { cwd: root, encoding: 'utf8', timeout: 20_000 });
    expect(res.status, res.stderr).toBe(0);
    const r = JSON.parse(res.stdout) as Record<string, string>;
    expect(r.normal).toBe('ok:1');
    for (const k of ['fnCtor', 'arrowCtor', 'asyncCtor', 'genCtor']) expect(r[k], k).toMatch(/blocked:.*code generation is disabled/);
    expect(r.protoPollution).toMatch(/^blocked:TypeError/);
    expect(r.arrayPollution).toMatch(/^blocked:TypeError/);
    expect(r.fetch).toMatch(/^blocked:TypeError/);
    expect(r.globalThisAccess).toMatch(/^blocked:TypeError/);
    expect(r.evalAccess).toMatch(/^blocked:TypeError/);
    expect(r.timer).toMatch(/^blocked:TypeError/);
    // Web APIs held on the global's prototype chain (browser workers) are gone too.
    for (const k of ['protoGetterEscape', 'protoMethodEscape', 'interfaceObject']) expect(r[k], k).not.toMatch(/LEAK|REACHED/);
    expect(r.protoGetterEscape).toMatch(/^blocked:TypeError/);
    expect(r.intrinsicsKept).toBe('ok:1');
    expect(r.pollutedAfter).toBe('undefined');
    expect(r.fetchType).toBe('undefined');
    expect(r.functionGlobal).toBe('undefined');
  });
});
