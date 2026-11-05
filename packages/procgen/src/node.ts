/**
 * @aether/procgen/node — server/test-side generator sandbox on `node:vm`.
 *
 * IMPORTANT: `node:vm` is NOT a hard security boundary (it shares the
 * process, heap and event loop; memory exhaustion cannot be prevented). It is
 * used for server-side validation of LLM-written generators and for tests.
 * Defenses applied:
 * - code generation from strings and WebAssembly disabled in the context,
 * - wall-clock timeout covering the whole run (including host API calls),
 *   microtasks drained inside the timed evaluation,
 * - the context exposes ONLY `params` (a JSON copy) and `api` (a membrane:
 *   every host function/object handed in is re-parented onto the context's
 *   intrinsics so `.constructor` chains never reach the host realm; host
 *   errors are re-created as context errors; arguments are deep-copied),
 * - `Math.random` seeded from the run's seed and a frozen clock (sandbox/determinism.ts),
 * - static source screening (advisory only: a denylist that runtime-built
 *   property names bypass), params resolution and output validation.
 * Never import this module from browser code (index.ts does not).
 */
import vm from 'node:vm';
import { isForbiddenKey, type GeneratorDef, type Json } from '@aether/core';
import type { GeneratorApi, GeneratorOutput, MeshHandle, SandboxRunner } from './types';
import { createGeneratorApi } from './api';
import { Mesh } from './kernel/mesh';
import { PROCGEN_LIMITS } from './limits';
import { validateOutput } from './output';
import { prepareRun } from './sandbox/worker-sandbox';
import { installDeterminism } from './sandbox/determinism';

/**
 * Seeded `Math.random` and a frozen clock in the context (the same function as the worker's lockdown, from its
 * source text). `__name` is a local binding for transpilers that wrap named functions with it.
 */
const DETERMINISM_SCRIPT = new vm.Script(`(() => { const __name = (f) => f; return (${installDeterminism.toString()})(globalThis); })()`, { filename: 'aether-determinism.js' });

/** Methods of GeneratorApi exposed to untrusted code (allowlist). */
const API_METHODS = [
  'rng', 'noise2', 'noise3', 'fbm2', 'box', 'roundedBox', 'sphere', 'cylinder', 'cone', 'torus', 'capsule', 'plane', 'lathe', 'extrude',
  'tube', 'ribbon', 'sdf', 'library', 'heightfield', 'icosphereRock', 'add', 'collider', 'autoColliders', 'color', 'mix',
] as const satisfies ReadonlyArray<keyof GeneratorApi>;

/** Methods of MeshHandle exposed to untrusted code (allowlist). */
const MESH_METHODS = ['translate', 'rotate', 'scale', 'displace', 'warp', 'vertexColor', 'merge', 'clone', 'bounds'] as const satisfies ReadonlyArray<keyof MeshHandle>;

const MAX_IMPORT_DEPTH = 8;
const MAX_IMPORT_ITEMS = 200_000;
/** Max JSON length of an `api.sdf` tree (it crosses as one string: trees nest deeper than MAX_IMPORT_DEPTH). */
const MAX_SDF_JSON = 1_000_000;

type AnyFn = (...args: unknown[]) => unknown;

interface Realm {
  objectProto: object;
  functionProto: object;
  makeArray: () => unknown[];
  makeError: (message: string) => unknown;
  parse: (json: string) => unknown;
  /** The context's own JSON.stringify, captured before generator code runs. */
  stringify: (v: unknown) => unknown;
  /** Frozen context-realm error thrown when a host failure cannot be translated safely. */
  fallbackError: unknown;
}

const REALM_SETUP = `(() => {
  'use strict';
  for (const k of ['WebAssembly', 'SharedArrayBuffer', 'Atomics']) {
    try { delete globalThis[k]; } catch (e) { /* ignore */ }
  }
  for (const k of ['prepareStackTrace', 'captureStackTrace', 'stackTraceLimit']) {
    try { Object.defineProperty(Error, k, { value: undefined, writable: false, configurable: false }); } catch (e) { /* ignore */ }
  }
  const stringify = JSON.stringify;
  return {
    stringify: (v) => stringify(v),
    objectProto: Object.prototype,
    functionProto: Function.prototype,
    makeArray: () => [],
    makeError: (m) => new Error(m),
    parse: (s) => JSON.parse(s),
    fallbackError: Object.freeze(new Error('host call failed')),
  };
})()`;

const RUN_SCRIPT = new vm.Script(`(() => {
  'use strict';
  let result;
  let error;
  try {
    result = __aether_fn(__aether_params, __aether_api);
  } catch (err) {
    try {
      error = String(err !== null && typeof err === 'object' && 'message' in err ? err.message : err).slice(0, 500);
    } catch (e) {
      error = 'generator threw an unprintable value';
    }
  }
  return error === undefined ? { ok: true, result } : { ok: false, error };
})()`, { filename: 'aether-generator-runner.js' });

/** Cross-realm membrane between the host GeneratorApi and the vm context. */
class Membrane {
  private readonly facades = new WeakMap<Mesh, object>();
  private readonly meshes = new WeakMap<object, Mesh>();
  readonly outputs = new WeakMap<object, GeneratorOutput>();
  private items = 0;

  constructor(private readonly realm: Realm) {}

  /**
   * Host function → context-callable function whose prototype chain is the context's.
   *
   * The ENTIRE body (argument import, host call and result export) sits in one
   * try/catch, and the catch never rethrows the caught value: it throws either a
   * freshly made context-realm error or, if even that fails (e.g. stack
   * exhaustion), the pre-allocated frozen context error. The catch itself makes
   * no calls outside a nested try, so no host-realm object can ever escape.
   */
  exportFn(fn: AnyFn, jsonArg0 = false): AnyFn {
    const fallback = this.realm.fallbackError;
    const wrapper = (...args: unknown[]): unknown => {
      try {
        this.items = 0;
        const hostArgs = args.map((a, i) => (jsonArg0 && i === 0 ? this.importJson(a) : this.importValue(a, 0)));
        return this.exportValue(fn(...hostArgs), 0);
      } catch (err) {
        let safe = fallback;
        try {
          safe = this.toContextError(err);
        } catch {
          // keep the pre-allocated context error
        }
        throw safe;
      }
    };
    Object.setPrototypeOf(wrapper, this.realm.functionProto);
    return wrapper;
  }

  /**
   * Translate any caught value into a context-realm error. Only host `Error`s
   * contribute their message; everything else (including context values, which
   * could be proxies with hostile traps) maps to the generic fallback.
   */
  private toContextError(err: unknown): unknown {
    if (err instanceof Error && typeof err.message === 'string') return this.realm.makeError(err.message.slice(0, 500));
    return this.realm.fallbackError;
  }

  /** Host value → context-safe value. */
  exportValue(v: unknown, depth: number): unknown {
    if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return v;
    if (this.outputs.has(v)) return v;
    if (v instanceof Mesh) return this.facadeFor(v);
    if (typeof v === 'function') return this.exportFn(v as AnyFn);
    if (depth > MAX_IMPORT_DEPTH) throw new TypeError('value nested too deeply');
    if (Array.isArray(v)) {
      const arr = this.realm.makeArray();
      for (let i = 0; i < v.length; i++) arr[i] = this.exportValue(v[i], depth + 1);
      return arr;
    }
    const obj = Object.create(this.realm.objectProto) as Record<string, unknown>;
    for (const k of Object.keys(v)) {
      Object.defineProperty(obj, k, { value: this.exportValue((v as Record<string, unknown>)[k], depth + 1), enumerable: true, writable: true, configurable: true });
    }
    return obj;
  }

  /** Context value → host data (deep copy; facades map back to host meshes). */
  importValue(v: unknown, depth: number): unknown {
    if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return v;
    if (typeof v === 'function') {
      // Context callback handed to the host (e.g. a displace function): host
      // arguments are exported before the call and the result is deep-copied back.
      const f = v as AnyFn;
      return (...a: unknown[]) => this.importValue(f(...a.map((x) => this.exportValue(x, 0))), 0);
    }
    const mesh = this.meshes.get(v);
    if (mesh) return mesh;
    if (depth > MAX_IMPORT_DEPTH) throw new TypeError('argument nested too deeply');
    if (ArrayBuffer.isView(v)) {
      const src = v as unknown as ArrayLike<number>;
      const len = src.length;
      this.count(len);
      const out = new Float32Array(len);
      for (let i = 0; i < len; i++) out[i] = Number(src[i]);
      return out;
    }
    if (Array.isArray(v)) {
      const len = v.length;
      this.count(len);
      const out: unknown[] = new Array<unknown>(len);
      for (let i = 0; i < len; i++) out[i] = this.importValue(v[i], depth + 1);
      return out;
    }
    const out: Record<string, unknown> = {};
    const keys = Object.keys(v);
    this.count(keys.length);
    for (const k of keys) {
      if (isForbiddenKey(k)) continue;
      out[k] = this.importValue((v as Record<string, unknown>)[k], depth + 1);
    }
    return out;
  }

  /**
   * Context value → host data through one JSON round trip: the context serializes it (its getters run there, under
   * the timeout) and the host parses the string, so deep trees cross without the per-level import limits.
   */
  importJson(v: unknown): unknown {
    let json: unknown;
    try {
      json = this.realm.stringify(v);
    } catch {
      // a context error (cycle, BigInt): never rethrow it into the host
      json = null;
    }
    if (typeof json !== 'string') throw new TypeError('expected plain JSON data (objects, arrays, numbers, strings)');
    if (json.length > MAX_SDF_JSON) throw new RangeError('argument is too large');
    return JSON.parse(json) as unknown;
  }

  private count(n: number): void {
    this.items += n;
    if (this.items > MAX_IMPORT_ITEMS) throw new RangeError('argument is too large');
  }

  private facadeFor(mesh: Mesh): object {
    const existing = this.facades.get(mesh);
    if (existing) return existing;
    const facade = Object.create(this.realm.objectProto) as object;
    for (const name of MESH_METHODS) {
      const method = mesh[name] as unknown as AnyFn;
      Object.defineProperty(facade, name, { value: this.exportFn((...a) => method.apply(mesh, a)), enumerable: true });
    }
    Object.freeze(facade);
    this.facades.set(mesh, facade);
    this.meshes.set(facade, mesh);
    return facade;
  }

  /** Build the context-side `api` object. */
  apiFacade(api: GeneratorApi): object {
    const facade = Object.create(this.realm.objectProto) as object;
    for (const name of API_METHODS) {
      const method = api[name] as unknown as AnyFn;
      Object.defineProperty(facade, name, { value: this.exportFn((...a) => method.apply(api, a), name === 'sdf'), enumerable: true });
    }
    Object.defineProperty(facade, 'seed', { value: api.seed, enumerable: true });
    const build = this.exportFn(() => {
      const out = api.build();
      const token = Object.freeze(Object.create(this.realm.objectProto) as object);
      this.outputs.set(token, out);
      return token;
    });
    Object.defineProperty(facade, 'build', { value: build, enumerable: true });
    return Object.freeze(facade);
  }
}

function ownString(o: unknown, key: string): string {
  if (o === null || typeof o !== 'object') return '';
  const d = Object.getOwnPropertyDescriptor(o, key);
  return d && typeof d.value === 'string' ? d.value : '';
}

function runInVm(source: string, params: Record<string, Json>, seed: number, timeoutMs: number): GeneratorOutput {
  const context = vm.createContext(Object.create(null) as object, {
    name: 'aether-generator',
    codeGeneration: { strings: false, wasm: false },
    microtaskMode: 'afterEvaluate',
  });
  const realm = vm.runInContext(REALM_SETUP, context, { timeout: 1000 }) as Realm;
  const reseed = DETERMINISM_SCRIPT.runInContext(context, { timeout: 1000 }) as (seed: number) => void;
  reseed(seed);
  const membrane = new Membrane(realm);
  const api = createGeneratorApi(seed);
  let fn: unknown;
  try {
    fn = vm.compileFunction(`"use strict";\n${source}`, ['params', 'api'], { parsingContext: context, filename: 'generator.js' });
  } catch (err) {
    throw new Error(`generator has a syntax error: ${err instanceof Error ? err.message : 'unparseable source'}`);
  }
  const globals = context as Record<string, unknown>;
  globals.__aether_fn = fn;
  globals.__aether_params = realm.parse(JSON.stringify(params));
  globals.__aether_api = membrane.apiFacade(api);
  let res: unknown;
  try {
    res = RUN_SCRIPT.runInContext(context, { timeout: timeoutMs, breakOnSigint: false });
  } catch (err) {
    // Only engine/runtime errors reach here (RUN_SCRIPT catches script exceptions); they may
    // belong to the context realm, so read own data properties only.
    const code = ownString(err, 'code');
    const msg = ownString(err, 'message');
    if (code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' || /timed out/i.test(msg)) throw new Error(`generator timed out after ${timeoutMs} ms`);
    throw new Error(`generator failed: ${msg.slice(0, 300) || 'unknown error'}`);
  }
  const record = res as { ok?: unknown; result?: unknown; error?: unknown };
  if (record.ok !== true) throw new Error(`generator failed: ${typeof record.error === 'string' ? record.error : 'unknown error'}`);
  const token = record.result;
  const out = token !== null && typeof token === 'object' ? membrane.outputs.get(token) : undefined;
  if (!out) throw new Error('generator must return the result of api.build()');
  const v = validateOutput(out);
  if (!v.ok) throw new Error(`generator returned invalid output: ${v.error}`);
  return v.output;
}

/**
 * Create a `node:vm` sandbox runner (server-side validation and tests).
 * See the module documentation for the threat model and its limits.
 */
export function createNodeSandbox(opts: { timeoutMs?: number } = {}): SandboxRunner {
  const clampTimeout = (v: number | undefined, def: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : def;
    return Math.min(PROCGEN_LIMITS.MAX_TIMEOUT_MS, Math.max(10, Math.round(n)));
  };
  const defaultTimeout = clampTimeout(opts.timeoutMs, PROCGEN_LIMITS.DEFAULT_TIMEOUT_MS);
  let disposed = false;
  return {
    async run(def: GeneratorDef, params: Record<string, Json>, seed: number, runOpts?: { timeoutMs?: number }): Promise<GeneratorOutput> {
      if (disposed) throw new Error('sandbox disposed');
      const prepared = prepareRun(def, params);
      return runInVm(prepared.def.source, prepared.params, Number.isFinite(seed) ? Math.trunc(seed) : 0, clampTimeout(runOpts?.timeoutMs, defaultTimeout));
    },
    dispose(): void {
      disposed = true;
    },
  };
}

export type { SandboxRunner } from './types';
