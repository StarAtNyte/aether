/**
 * Player settings of published games (volume, music, look sensitivity,
 * graphics quality), remembered per browser in localStorage. Storage is
 * optional (private modes, blocked storage) and everything read back is
 * validated; bad data falls back to the defaults.
 */
import { z } from 'zod';
/** Graphics quality presets. */
export const QUALITIES = ['low', 'medium', 'high'];
export const PlayerSettings = z.object({
    volume: z.number().min(0).max(1).catch(0.8),
    music: z.number().min(0).max(1).catch(0.5),
    sensitivity: z.number().min(0.25).max(3).catch(1),
    quality: z.enum(QUALITIES).catch('high'),
});
/** Defaults (high quality unless the device is short on memory). */
export function defaultSettings(deviceMemoryGB) {
    return { volume: 0.8, music: 0.5, sensitivity: 1, quality: deviceMemoryGB !== undefined && deviceMemoryGB <= 4 ? 'medium' : 'high' };
}
const KEY = 'aether.player.settings.v1';
/** Load settings (defaults when absent or invalid). */
export function loadSettings(storage, fallback) {
    try {
        const raw = storage?.getItem(KEY);
        if (!raw || raw.length > 2000)
            return fallback;
        const r = PlayerSettings.safeParse({ ...fallback, ...JSON.parse(raw) });
        return r.success ? r.data : fallback;
    }
    catch {
        return fallback;
    }
}
/** Save settings (ignored when storage is unavailable). */
export function saveSettings(storage, s) {
    try {
        storage?.setItem(KEY, JSON.stringify(s));
    }
    catch {
        /* storage full or blocked: settings last for this visit */
    }
}
/** Renderer options of a quality preset. */
export function qualityPlan(q) {
    if (q === 'low')
        return { lowMemory: true, pixelRatioCap: 1 };
    if (q === 'medium')
        return { lowMemory: false, pixelRatioCap: 1.25 };
    return { lowMemory: false, pixelRatioCap: Number.POSITIVE_INFINITY };
}
/** The browser's storage, or null. */
export function browserSettingsStorage() {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    }
    catch {
        return null;
    }
}
