import { STORAGE_KEYS } from '../config';
import { reviveChat } from './chat';
import { validateImportedValue } from './worldIO';
/** Largest value written to storage (characters); bigger payloads are skipped. */
export const MAX_STORED_CHARS = 4 * 1024 * 1024;
/** The browser's localStorage, or null when unavailable. */
export function browserStorage() {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    }
    catch {
        return null;
    }
}
/** Read and JSON-parse a key; null on any failure. */
export function readJson(storage, key) {
    if (!storage)
        return null;
    try {
        const raw = storage.getItem(key);
        if (raw === null || raw.length > MAX_STORED_CHARS)
            return null;
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/** JSON-stringify and write a key. Returns false when skipped or failed. */
export function writeJson(storage, key, value) {
    if (!storage)
        return false;
    try {
        const text = JSON.stringify(value);
        if (text.length > MAX_STORED_CHARS)
            return false;
        storage.setItem(key, text);
        return true;
    }
    catch {
        return false;
    }
}
/** Remove a key (ignores failures). */
export function removeKey(storage, key) {
    try {
        storage?.removeItem(key);
    }
    catch {
        /* storage unavailable */
    }
}
/** Load the last world, validated; null when absent or invalid. */
export function loadWorld(storage) {
    const value = readJson(storage, STORAGE_KEYS.world);
    if (value === null)
        return null;
    const r = validateImportedValue(value);
    return r.ok ? r.world : null;
}
/**
 * Crash-loop guard: a marker written before the renderer starts and cleared
 * once the first world has rendered. If it is still present at the next boot,
 * the previous session died while starting (e.g. a world that hangs or kills
 * the GPU process), so the saved world must not be auto-loaded again.
 */
export function markBooting(storage) {
    writeJson(storage, STORAGE_KEYS.booting, true);
}
/** Clear the boot marker (the studio started successfully). */
export function clearBooting(storage) {
    removeKey(storage, STORAGE_KEYS.booting);
}
/** True when the previous boot never completed. */
export function previousBootFailed(storage) {
    return readJson(storage, STORAGE_KEYS.booting) === true;
}
/** Keep a copy of a world that was skipped at boot so it can be restored later. */
export function saveRecoveryWorld(storage, world) {
    return writeJson(storage, STORAGE_KEYS.recovery, world);
}
/** Persist the world. */
export function saveWorld(storage, world) {
    return writeJson(storage, STORAGE_KEYS.world, world);
}
/** Load the chat transcript, validated. */
export function loadChat(storage) {
    return reviveChat(readJson(storage, STORAGE_KEYS.chat));
}
/** Persist the chat transcript. */
export function saveChat(storage, chat) {
    return writeJson(storage, STORAGE_KEYS.chat, chat);
}
/** Default preferences. */
export const DEFAULT_SETTINGS = Object.freeze({
    showPerf: false,
    pointerLock: false,
    shadows: true,
    showColliders: false,
    backend: 'auto',
    lowMemory: 'auto',
    darkTheme: false,
    showLabels: false,
    showNavHint: true,
    repairs: 2,
    uiSounds: false,
    immersivePlay: true,
    renderTier: 'auto',
    effects: Object.freeze({}),
});
/** Largest accepted value of the `repairs` setting. */
export const MAX_REPAIRS_SETTING = 3;
const BOOLEAN_SETTINGS = ['showPerf', 'pointerLock', 'shadows', 'showColliders', 'darkTheme', 'showLabels', 'showNavHint', 'uiSounds', 'immersivePlay'];
const BACKENDS = ['auto', 'webgpu', 'webgl2'];
const LOW_MEMORY = ['auto', 'on', 'off'];
/** Tier values accepted from storage. */
export const RENDER_TIER_SETTINGS = ['auto', 'low', 'medium', 'high', 'ultra'];
/** Effects the settings can toggle, in display order. */
export const EFFECT_SETTINGS = ['ao', 'gi', 'taa', 'ssr', 'shafts', 'halation', 'aberration', 'grain'];
/** Keep only known effect keys with boolean values (untrusted storage input; no prototype keys survive). */
export function parseEffectSettings(raw) {
    const out = {};
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
        return out;
    for (const k of EFFECT_SETTINGS) {
        const v = Object.prototype.hasOwnProperty.call(raw, k) ? raw[k] : undefined;
        if (typeof v === 'boolean')
            out[k] = v;
    }
    return out;
}
function oneOf(value, allowed) {
    return typeof value === 'string' && allowed.includes(value) ? value : undefined;
}
/**
 * Load settings, keeping only known fields of the right type and value.
 * Older saves are migrated: `preferWebGPU: false` → backend 'webgl2',
 * `lowPower: true` → low memory 'on'. Until a theme has been saved, the
 * theme follows `prefersDark` (the system color scheme).
 */
export function loadSettings(storage, prefersDark = false) {
    const raw = readJson(storage, STORAGE_KEYS.settings);
    const out = { ...DEFAULT_SETTINGS, darkTheme: prefersDark === true };
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        const r = raw;
        const own = (k) => (Object.prototype.hasOwnProperty.call(r, k) ? r[k] : undefined);
        for (const k of BOOLEAN_SETTINGS) {
            const v = own(k);
            if (typeof v === 'boolean')
                out[k] = v;
        }
        out.backend = oneOf(own('backend'), BACKENDS) ?? (own('preferWebGPU') === false ? 'webgl2' : DEFAULT_SETTINGS.backend);
        out.lowMemory = oneOf(own('lowMemory'), LOW_MEMORY) ?? (own('lowPower') === true ? 'on' : DEFAULT_SETTINGS.lowMemory);
        out.renderTier = oneOf(own('renderTier'), RENDER_TIER_SETTINGS) ?? DEFAULT_SETTINGS.renderTier;
        out.effects = parseEffectSettings(own('effects'));
        const repairs = own('repairs');
        if (typeof repairs === 'number' && Number.isInteger(repairs) && repairs >= 0 && repairs <= MAX_REPAIRS_SETTING)
            out.repairs = repairs;
    }
    return out;
}
/** True when the operating system asks for a dark color scheme (false outside a browser). */
export function systemPrefersDark() {
    try {
        return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    catch {
        return false;
    }
}
/** Persist settings. */
export function saveSettings(storage, settings) {
    return writeJson(storage, STORAGE_KEYS.settings, settings);
}
