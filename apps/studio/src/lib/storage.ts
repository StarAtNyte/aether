/**
 * Defensive localStorage persistence. Every access is wrapped in try/catch
 * (private windows, quota errors, blocked storage) and everything read back
 * is treated as untrusted and re-validated by the caller-supplied reviver.
 */
import type { WorldDoc } from '@aether/core';
import { STORAGE_KEYS } from '../config';
import { reviveChat, type ChatEntry } from './chat';
import { validateImportedValue } from './worldIO';

/** Minimal subset of the Web Storage API (injectable for tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Largest value written to storage (characters); bigger payloads are skipped. */
export const MAX_STORED_CHARS = 4 * 1024 * 1024;

/** The browser's localStorage, or null when unavailable. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Read and JSON-parse a key; null on any failure. */
export function readJson(storage: StorageLike | null, key: string): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (raw === null || raw.length > MAX_STORED_CHARS) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** JSON-stringify and write a key. Returns false when skipped or failed. */
export function writeJson(storage: StorageLike | null, key: string, value: unknown): boolean {
  if (!storage) return false;
  try {
    const text = JSON.stringify(value);
    if (text.length > MAX_STORED_CHARS) return false;
    storage.setItem(key, text);
    return true;
  } catch {
    return false;
  }
}

/** Remove a key (ignores failures). */
export function removeKey(storage: StorageLike | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

/** Load the last world, validated; null when absent or invalid. */
export function loadWorld(storage: StorageLike | null): WorldDoc | null {
  const value = readJson(storage, STORAGE_KEYS.world);
  if (value === null) return null;
  const r = validateImportedValue(value);
  return r.ok ? r.world : null;
}

/**
 * Crash-loop guard: a marker written before the renderer starts and cleared
 * once the first world has rendered. If it is still present at the next boot,
 * the previous session died while starting (e.g. a world that hangs or kills
 * the GPU process), so the saved world must not be auto-loaded again.
 */
export function markBooting(storage: StorageLike | null): void {
  writeJson(storage, STORAGE_KEYS.booting, true);
}

/** Clear the boot marker (the studio started successfully). */
export function clearBooting(storage: StorageLike | null): void {
  removeKey(storage, STORAGE_KEYS.booting);
}

/** True when the previous boot never completed. */
export function previousBootFailed(storage: StorageLike | null): boolean {
  return readJson(storage, STORAGE_KEYS.booting) === true;
}

/** Keep a copy of a world that was skipped at boot so it can be restored later. */
export function saveRecoveryWorld(storage: StorageLike | null, world: WorldDoc): boolean {
  return writeJson(storage, STORAGE_KEYS.recovery, world);
}

/** Persist the world. */
export function saveWorld(storage: StorageLike | null, world: WorldDoc): boolean {
  return writeJson(storage, STORAGE_KEYS.world, world);
}

/** Load the chat transcript, validated. */
export function loadChat(storage: StorageLike | null): ChatEntry[] {
  return reviveChat(readJson(storage, STORAGE_KEYS.chat));
}

/** Persist the chat transcript. */
export function saveChat(storage: StorageLike | null, chat: readonly ChatEntry[]): boolean {
  return writeJson(storage, STORAGE_KEYS.chat, chat);
}

/** Rendering backend preference (see `@aether/render` backend policy). */
export type BackendSetting = 'auto' | 'webgpu' | 'webgl2';
/** Low-memory mode: decided by device detection, or forced on/off. */
export type LowMemorySetting = 'auto' | 'on' | 'off';

/** Interactive graphics quality: automatic from the GPU, or a fixed render tier. */
export type RenderTierSetting = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
/** The finishing-chain effects a user can switch individually. */
export type EffectSetting = 'ao' | 'gi' | 'taa' | 'contact' | 'ssr' | 'shafts' | 'halation' | 'aberration' | 'grain';
/** Per-effect overrides: true forces an effect on, false off; a missing key follows the tier. */
export type EffectSettings = Partial<Record<EffectSetting, boolean>>;

/** User preferences persisted across sessions. */
export interface StudioSettings {
  showPerf: boolean;
  pointerLock: boolean;
  shadows: boolean;
  showColliders: boolean;
  /** Rendering backend: automatic policy or forced (applies after a renderer restart). */
  backend: BackendSetting;
  /** Low-memory mode (smaller drawing buffer, no bloom/MSAA, smaller caches and history). */
  lowMemory: LowMemorySetting;
  /** Dark interface theme (the default follows the system on a first visit, then is remembered). */
  darkTheme: boolean;
  /** Floating name labels over entities in the viewport. */
  showLabels: boolean;
  /** First-use navigation hint over the viewport (turned off once dismissed). */
  showNavHint: boolean;
  /** Automatic repair rounds the agent may spend when physics checks fail (0–3). */
  repairs: number;
  /** Subtle interface sounds (prompt sent, proof passed, play). Off by default. */
  uiSounds: boolean;
  /** Play mode hides the side panels so the world fills the window. */
  immersivePlay: boolean;
  /** Accessibility: no camera shake, FOV kicks or screen flashes in play mode (the system's reduce-motion setting also turns them off). */
  reduceMotion: boolean;
  /** Graphics quality tier (auto follows the GPU). */
  renderTier: RenderTierSetting;
  /** Individual effect switches on top of the tier. */
  effects: EffectSettings;
}

/** Default preferences. */
export const DEFAULT_SETTINGS: Readonly<StudioSettings> = Object.freeze({
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
  reduceMotion: false,
  renderTier: 'auto',
  effects: Object.freeze({}) as EffectSettings,
});

/** Largest accepted value of the `repairs` setting. */
export const MAX_REPAIRS_SETTING = 3;

const BOOLEAN_SETTINGS = ['showPerf', 'pointerLock', 'shadows', 'showColliders', 'darkTheme', 'showLabels', 'showNavHint', 'uiSounds', 'immersivePlay', 'reduceMotion'] as const satisfies ReadonlyArray<keyof StudioSettings>;
const BACKENDS: readonly BackendSetting[] = ['auto', 'webgpu', 'webgl2'];
const LOW_MEMORY: readonly LowMemorySetting[] = ['auto', 'on', 'off'];
/** Tier values accepted from storage. */
export const RENDER_TIER_SETTINGS: readonly RenderTierSetting[] = ['auto', 'low', 'medium', 'high', 'ultra'];
/** Effects the settings can toggle, in display order. */
export const EFFECT_SETTINGS: readonly EffectSetting[] = ['ao', 'gi', 'taa', 'contact', 'ssr', 'shafts', 'halation', 'aberration', 'grain'];

/** Keep only known effect keys with boolean values (untrusted storage input; no prototype keys survive). */
export function parseEffectSettings(raw: unknown): EffectSettings {
  const out: EffectSettings = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const k of EFFECT_SETTINGS) {
    const v = Object.prototype.hasOwnProperty.call(raw, k) ? (raw as Record<string, unknown>)[k] : undefined;
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * Load settings, keeping only known fields of the right type and value.
 * Older saves are migrated: `preferWebGPU: false` → backend 'webgl2',
 * `lowPower: true` → low memory 'on'. Until a theme has been saved, the
 * theme follows `prefersDark` (the system color scheme).
 */
export function loadSettings(storage: StorageLike | null, prefersDark = false): StudioSettings {
  const raw = readJson(storage, STORAGE_KEYS.settings);
  const out: StudioSettings = { ...DEFAULT_SETTINGS, darkTheme: prefersDark === true };
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    const own = (k: string): unknown => (Object.prototype.hasOwnProperty.call(r, k) ? r[k] : undefined);
    for (const k of BOOLEAN_SETTINGS) {
      const v = own(k);
      if (typeof v === 'boolean') out[k] = v;
    }
    out.backend = oneOf(own('backend'), BACKENDS) ?? (own('preferWebGPU') === false ? 'webgl2' : DEFAULT_SETTINGS.backend);
    out.lowMemory = oneOf(own('lowMemory'), LOW_MEMORY) ?? (own('lowPower') === true ? 'on' : DEFAULT_SETTINGS.lowMemory);
    out.renderTier = oneOf(own('renderTier'), RENDER_TIER_SETTINGS) ?? DEFAULT_SETTINGS.renderTier;
    out.effects = parseEffectSettings(own('effects'));
    const repairs = own('repairs');
    if (typeof repairs === 'number' && Number.isInteger(repairs) && repairs >= 0 && repairs <= MAX_REPAIRS_SETTING) out.repairs = repairs;
  }
  return out;
}

/** True when the operating system asks for a dark color scheme (false outside a browser). */
export function systemPrefersDark(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** Persist settings. */
export function saveSettings(storage: StorageLike | null, settings: StudioSettings): boolean {
  return writeJson(storage, STORAGE_KEYS.settings, settings);
}
