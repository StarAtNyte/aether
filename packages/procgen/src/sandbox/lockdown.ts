/**
 * Worker hardening applied BEFORE any untrusted code runs:
 * 1. capture the capabilities the sandbox itself needs (postMessage, the
 *    Function constructor for compiling) in closures,
 * 2. shadow every network / storage / messaging / code-loading global with a
 *    non-configurable `undefined`,
 * 3. neutralize the constructors reachable from any function
 *    (`fn.constructor('...')`) and indirect eval,
 * 4. freeze the shared intrinsics so one run cannot tamper with the next.
 */

/** Globals removed from the worker scope. */
export const BLOCKED_GLOBALS: readonly string[] = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'importScripts', 'indexedDB', 'caches',
  'BroadcastChannel', 'MessageChannel', 'Worker', 'SharedWorker', 'navigator', 'location', 'close', 'postMessage',
  'RTCPeerConnection', 'Notification', 'Request', 'Response', 'Headers', 'FileReader', 'FileReaderSync',
  'WebAssembly', 'Atomics', 'SharedArrayBuffer', 'eval', 'Function', 'setTimeout', 'setInterval', 'queueMicrotask',
  'requestAnimationFrame', 'onmessage', 'onmessageerror', 'onerror', 'addEventListener', 'removeEventListener',
  'dispatchEvent', 'reportError', 'structuredClone', 'crypto', 'performance', 'self', 'globalThis',
];

/** Capabilities captured before lockdown. */
export interface SandboxCapabilities {
  post(message: unknown, transfer: Transferable[]): void;
  FunctionCtor: FunctionConstructor;
  now(): number;
}

/** Minimal view of a worker global scope (also satisfiable by a plain object in tests). */
export interface LockableScope {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
}

function blocked(): never {
  throw new TypeError('code generation is disabled in the generator sandbox');
}

function shadow(scope: object, name: string): void {
  try {
    Object.defineProperty(scope, name, { value: undefined, writable: false, configurable: false, enumerable: false });
  } catch {
    // some host properties may be non-configurable already; shadowing them is best effort
  }
}

/** Freeze an object if possible (best effort; never throws). */
function freeze(v: unknown): void {
  try {
    if ((typeof v === 'object' && v !== null) || typeof v === 'function') Object.freeze(v);
  } catch {
    // exotic host objects may refuse
  }
}

/**
 * Lock down `scope` after registering `onMessage`. Returns the captured
 * capabilities. Idempotent per scope only in the sense that a second call
 * finds the globals already removed; call it exactly once at worker start.
 */
export function lockdown(scope: LockableScope, onMessage: (e: MessageEvent, caps: SandboxCapabilities) => void): SandboxCapabilities {
  const rawPost = scope.postMessage.bind(scope);
  const FunctionCtor = Function;
  const perf = typeof performance !== 'undefined' ? performance : undefined;
  const caps: SandboxCapabilities = {
    post: (message, transfer) => rawPost(message, transfer),
    FunctionCtor,
    now: () => (perf ? perf.now() : 0),
  };
  scope.addEventListener('message', (e) => onMessage(e, caps));

  // 3. neutralize constructors reachable through any function value
  const fnProtos = [
    FunctionCtor.prototype,
    Object.getPrototypeOf(async function () {}) as object,
    Object.getPrototypeOf(function* () {}) as object,
    Object.getPrototypeOf(async function* () {}) as object,
  ];
  for (const proto of fnProtos) {
    try {
      Object.defineProperty(proto, 'constructor', { value: blocked, writable: false, configurable: false });
    } catch {
      // already locked
    }
  }

  // 2. remove dangerous globals
  for (const name of BLOCKED_GLOBALS) shadow(scope, name);

  // 4. freeze intrinsics shared between runs (globals such as `Function` are shadowed by now:
  //    only use values captured above or names that are not blocked)
  const intrinsics: unknown[] = [
    Object, Object.prototype, FunctionCtor.prototype, Array, Array.prototype, String, String.prototype, Number, Number.prototype,
    Boolean, Boolean.prototype, Symbol, Symbol.prototype, Error, Error.prototype, TypeError, TypeError.prototype,
    RangeError, RangeError.prototype, SyntaxError, SyntaxError.prototype, ReferenceError, ReferenceError.prototype,
    Math, JSON, Reflect, Promise, Promise.prototype, Map, Map.prototype, Set, Set.prototype, WeakMap, WeakMap.prototype,
    WeakSet, WeakSet.prototype, RegExp, RegExp.prototype, Date, Date.prototype, ArrayBuffer, ArrayBuffer.prototype,
    Object.getPrototypeOf(Int8Array), Object.getPrototypeOf(Int8Array.prototype),
    Float32Array, Float32Array.prototype, Float64Array, Float64Array.prototype, Uint32Array, Uint32Array.prototype,
    Uint16Array, Uint16Array.prototype, Uint8Array, Uint8Array.prototype, Int32Array, Int32Array.prototype,
    Object.getPrototypeOf([][Symbol.iterator]()), Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())),
    ...fnProtos,
  ];
  for (const v of intrinsics) freeze(v);
  return caps;
}
