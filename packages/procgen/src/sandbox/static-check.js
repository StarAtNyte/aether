/**
 * Static screening of LLM-written generator source. ADVISORY / defense in
 * depth only: it is a token denylist, and property names assembled at
 * runtime (e.g. `'con' + 'structor'`) are not caught. No threat model may
 * count on it. The real boundary is the browser Worker with lockdown; the
 * node:vm path additionally relies on its membrane and is not a security
 * boundary at all (see node.ts). Tokens are matched anywhere (including strings and comments)
 * on purpose — over-rejecting is cheap, the LLM simply rewrites the code.
 */
import { PROCGEN_LIMITS } from '../limits';
// Control characters, line/paragraph separators and BOM (built from escapes to keep the file ASCII).
// eslint-disable-next-line no-control-regex
const INVISIBLE = new RegExp('[\\u0000-\\u0008\\u000e-\\u001f\\u007f\\u2028\\u2029\\ufeff]');
const RULES = [
    [/\bimport\b/, 'module imports are not allowed'],
    [/\bexports?\b|\bmodule\b/, 'module syntax (export/module) is not allowed'],
    [/\brequire\b/, 'require is not allowed'],
    [/\bfetch\b|XMLHttpRequest|WebSocket|EventSource|\bsendBeacon\b|WebTransport|RTCPeerConnection/, 'network access is not allowed'],
    [/\beval\b/, 'eval is not allowed'],
    [/\bFunction\b/, 'the Function constructor is not allowed'],
    [/constructor/, 'constructor access is not allowed'],
    [/__proto__|prototype|__defineGetter__|__defineSetter__|__lookupGetter__|__lookupSetter__/, 'prototype manipulation is not allowed'],
    [/\bglobalThis\b|\bself\b|\bwindow\b|\bglobal\b/, 'access to the global object is not allowed'],
    [/\bdocument\b|\blocation\b|\bnavigator\b|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bcaches\b|\bcookie\b/, 'browser APIs are not allowed'],
    [/postMessage|importScripts|\bWorker\b|\bSharedWorker\b|BroadcastChannel|MessageChannel/, 'messaging and workers are not allowed'],
    [/\bAtomics\b|SharedArrayBuffer|\bWebAssembly\b/, 'shared memory and WebAssembly are not allowed'],
    [/\bprocess\b|\bBuffer\b|\bDeno\b|\bBun\b/, 'runtime internals are not allowed'],
    [/\bwith\s*\(/, 'with statements are not allowed'],
    [/\bsetTimeout\b|\bsetInterval\b|\bsetImmediate\b|\bqueueMicrotask\b|\brequestAnimationFrame\b/, 'timers are not allowed (generators must be synchronous)'],
    [/\basync\b|\bawait\b|\bPromise\b/, 'asynchronous code is not allowed (generators must be synchronous)'],
    [/\bReflect\b|\bProxy\b|\bSymbol\b/, 'reflection APIs are not allowed'],
    [/\bfromCharCode\b|\bfromCodePoint\b|\batob\b|\bbtoa\b|\bunescape\b|\bdecodeURI/, 'string decoding tricks are not allowed'],
    [/\\u|\\x|\\[0-7]/, 'escape sequences are not allowed (write characters directly)'],
    [/\barguments\b|\bcallee\b|\bcaller\b/, 'arguments/callee/caller are not allowed'],
    [/\bdebugger\b/, 'debugger statements are not allowed'],
];
/**
 * Screen generator source (the BODY of `function generate(params, api)`).
 * Returns every problem found; `ok` is true only when there are none.
 */
export function staticCheckSource(source) {
    const problems = [];
    if (typeof source !== 'string')
        return { ok: false, problems: ['source must be a string'] };
    if (source.trim().length === 0)
        problems.push('source is empty');
    if (source.length > PROCGEN_LIMITS.MAX_SOURCE_LENGTH) {
        problems.push(`source is too long (${source.length} > ${PROCGEN_LIMITS.MAX_SOURCE_LENGTH} characters)`);
        return { ok: false, problems };
    }
    if (INVISIBLE.test(source))
        problems.push('control or invisible characters are not allowed');
    for (const [re, message] of RULES) {
        const m = re.exec(source);
        if (m)
            problems.push(`${message} (found "${m[0]}")`);
    }
    if (!/\bapi\s*\.\s*build\s*\(/.test(source))
        problems.push('source must return api.build()');
    return { ok: problems.length === 0, problems };
}
