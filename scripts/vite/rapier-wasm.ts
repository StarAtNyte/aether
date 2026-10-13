/**
 * Vite plugin: ship Rapier's WebAssembly as a real `.wasm` asset instead of
 * the base64 string that `@dimforge/rapier3d-compat` inlines in its JS.
 *
 * The compat bundle calls its wasm-bindgen initialiser with
 * `{ module_or_path: <b64>.toByteArray("AGFzbQ…") }`. This plugin replaces
 * that argument with the URL of the package's own `rapier_wasm3d_bg.wasm`
 * (imported with `?url`, so Vite hashes and emits it), after checking that
 * the file is byte-identical to the inlined module (SHA-256). The
 * initialiser then fetches the URL and compiles it with
 * `WebAssembly.instantiateStreaming` (off the main thread in every engine)
 * instead of decoding a 4 MB string on the calling thread.
 *
 * Measured on rapier3d-compat 0.21: the chunk shrinks from 4.34 MB
 * (1.67 MB gzip) to about 0.23 MB plus a 3.08 MB wasm file (1.17 MB gzip),
 * and the wasm is one cached file shared by the page and the verification
 * worker. Anything unexpected (pattern not found, hash mismatch, file
 * missing) leaves the module untouched, so the app keeps working.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Matches the compat initialiser's inlined module argument. */
const INLINED_WASM = /module_or_path:([A-Za-z_$][\w$]*)\.toByteArray\("([A-Za-z0-9+/=]{1024,})"\)/;
/** Module ids the plugin rewrites. */
const RAPIER_MODULE = /[\\/]@dimforge[\\/]rapier3d-compat[\\/]dist[\\/]rapier\.mjs$/;
/** Identifier of the injected URL import (cannot collide with minified names). */
const URL_BINDING = '__aetherRapierWasmUrl';

/** Result of {@link rewriteRapierWasm}. */
export type RewriteResult = { ok: true; code: string; wasmBytes: number } | { ok: false; reason: string };

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Rewrite the compat bundle `code` to load `wasmFile` by URL.
 * @param code source of `rapier.mjs`
 * @param wasmFile absolute path of the package's `rapier_wasm3d_bg.wasm`
 * @param readFile file reader (tests)
 */
export function rewriteRapierWasm(code: string, wasmFile: string, readFile: (path: string) => Uint8Array = readFileSync): RewriteResult {
  const m = INLINED_WASM.exec(code);
  if (!m || m[2] === undefined) return { ok: false, reason: 'inlined wasm not found' };
  if (code.includes(URL_BINDING)) return { ok: false, reason: 'already rewritten' };
  const inlined = Buffer.from(m[2], 'base64');
  let file: Uint8Array;
  try {
    file = readFile(wasmFile);
  } catch {
    return { ok: false, reason: `missing ${wasmFile}` };
  }
  if (sha256(inlined) !== sha256(file)) return { ok: false, reason: 'shipped wasm differs from the inlined module' };
  const replaced = code.slice(0, m.index) + `module_or_path:${URL_BINDING}` + code.slice(m.index + m[0].length);
  const importLine = `import ${URL_BINDING} from ${JSON.stringify(`${wasmFile.split('\\').join('/')}?url`)};\n`;
  return { ok: true, code: importLine + replaced, wasmBytes: file.length };
}

/** Minimal plugin shape (avoids a type dependency on vite from the scripts project). */
export interface RapierWasmPlugin {
  name: string;
  enforce: 'pre';
  transform(code: string, id: string): { code: string; map: null } | null;
}

/** The Vite plugin (add to `plugins` and to `worker.plugins`). */
export function rapierWasm(opts: { warn?: (message: string) => void } = {}): RapierWasmPlugin {
  return {
    name: 'aether:rapier-wasm',
    enforce: 'pre',
    transform(code: string, id: string) {
      const file = id.split('?')[0] ?? id;
      if (!RAPIER_MODULE.test(file)) return null;
      const wasm = join(dirname(file), 'rapier_wasm3d_bg.wasm');
      if (!existsSync(wasm)) {
        opts.warn?.(`rapier-wasm: ${wasm} not found; keeping the inlined module`);
        return null;
      }
      const r = rewriteRapierWasm(code, wasm);
      if (!r.ok) {
        opts.warn?.(`rapier-wasm: ${r.reason}; keeping the inlined module`);
        return null;
      }
      return { code: r.code, map: null };
    },
  };
}
