/**
 * Browser-held secrets: the bridge pairing token and bring-your-own API
 * keys. They live in sessionStorage (gone when the tab closes); a key is
 * kept in localStorage only when the user ticks "remember on this device".
 * Never in IndexedDB, exports, share links or logs, never sent to Aether's
 * server, and validated on every read.
 */
import { BRIDGE_TOKEN_RE, normalizeBridgeUrl } from '@aether/agent';
import { BYOK_KEY_RE, BYOK_PROVIDERS } from './byokCatalog';
const BRIDGE_KEY = 'aether.bridge.v1';
const BYOK_KEY = 'aether.byok.v2';
export { BYOK_KEY_RE };
/** The browser's sessionStorage, or null (private mode, blocked storage). */
export function browserSession() {
    try {
        return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    }
    catch {
        return null;
    }
}
function read(store, key) {
    try {
        const raw = store?.getItem(key);
        return raw ? JSON.parse(raw) : null;
    }
    catch {
        return null;
    }
}
function write(store, key, value) {
    try {
        if (value === null)
            store?.removeItem(key);
        else
            store?.setItem(key, JSON.stringify(value));
    }
    catch {
        /* storage unavailable: the pairing lasts for this page only */
    }
}
/** Read the bridge pairing (null when absent or invalid). */
export function loadBridgeSession(store) {
    const v = read(store, BRIDGE_KEY);
    if (typeof v !== 'object' || v === null)
        return null;
    const r = v;
    const url = typeof r['url'] === 'string' ? normalizeBridgeUrl(r['url']) : null;
    const token = typeof r['token'] === 'string' && BRIDGE_TOKEN_RE.test(r['token']) ? r['token'] : null;
    return url && token ? { url, token } : null;
}
/** Save (or clear with null) the bridge pairing. */
export function saveBridgeSession(store, s) {
    write(store, BRIDGE_KEY, s);
}
const BYOK_DEVICE_KEY = 'aether.byok.device.v1';
const BYOK_USAGE_KEY = 'aether.byok.usage.v1';
const LEGACY_BYOK_KEY = 'aether.byok.v1';
const MAX_COUNTER = 1e12;
function parseKeys(v) {
    const out = {};
    if (typeof v !== 'object' || v === null || Array.isArray(v))
        return out;
    const keys = v['keys'];
    if (typeof keys !== 'object' || keys === null || Array.isArray(keys))
        return out;
    for (const p of BYOK_PROVIDERS) {
        const k = keys[p];
        if (typeof k === 'string' && BYOK_KEY_RE.test(k))
            out[p] = k;
    }
    return out;
}
/**
 * Read the saved keys: this tab's (sessionStorage) merged over the ones
 * remembered on this device (localStorage). Invalid entries are dropped; a
 * key saved by an older version (one provider, session only) is migrated.
 */
export function loadByokKeys(session, device) {
    const remembered = parseKeys(read(device, BYOK_DEVICE_KEY));
    const keys = { ...remembered, ...parseKeys(read(session, BYOK_KEY)) };
    const legacy = read(session, LEGACY_BYOK_KEY);
    if (typeof legacy === 'object' && legacy !== null) {
        const r = legacy;
        if ((r['provider'] === 'anthropic' || r['provider'] === 'openai') && typeof r['key'] === 'string' && BYOK_KEY_RE.test(r['key']))
            keys[r['provider']] ??= r['key'];
        write(session, LEGACY_BYOK_KEY, null);
    }
    return { keys, remembered: Object.keys(remembered).length > 0 };
}
/**
 * Save the keys for this tab, and on this device too when `remember` is set
 * (otherwise any device copy is removed). An empty map clears both.
 */
export function saveByokKeys(session, device, keys, remember) {
    const clean = parseKeys({ keys });
    const empty = Object.keys(clean).length === 0;
    write(session, BYOK_KEY, empty ? null : { keys: clean });
    write(device, BYOK_DEVICE_KEY, empty || !remember ? null : { keys: clean });
}
function counter(v) {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(MAX_COUNTER, Math.floor(v)) : 0;
}
/** This session's key usage (zero when absent or invalid). */
export function loadByokUsage(session) {
    const v = read(session, BYOK_USAGE_KEY);
    const r = typeof v === 'object' && v !== null ? v : {};
    return { calls: counter(r['calls']), inputTokens: counter(r['inputTokens']), outputTokens: counter(r['outputTokens']) };
}
/** Save (or clear with null) this session's key usage. */
export function saveByokUsage(session, usage) {
    write(session, BYOK_USAGE_KEY, usage);
}
/** The browser's localStorage for keys the user chose to remember, or null. */
export function deviceStorage() {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    }
    catch {
        return null;
    }
}
/** Validate raw deep-link values (loopback URL + well-formed token). */
export function validateBridgeLink(link) {
    const url = link.url ? normalizeBridgeUrl(link.url) : null;
    return url && link.token && BRIDGE_TOKEN_RE.test(link.token) ? { url, token: link.token } : null;
}
