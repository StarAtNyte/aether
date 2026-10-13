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

/** User preferences persisted across sessions. */
export interface StudioSettings {
  showPerf: boolean;
  pointerLock: boolean;
  shadows: boolean;
  showColliders: boolean;
  preferWebGPU: boolean;
  /** Laptop/battery rendering: no bloom, smaller shadow maps, DPR 1. */
  lowPower: boolean;
  /** Dark interface theme (the default is light). */
  darkTheme: boolean;
}

/** Default preferences. */
export const DEFAULT_SETTINGS: Readonly<StudioSettings> = Object.freeze({
  showPerf: true,
  pointerLock: false,
  shadows: true,
  showColliders: false,
  preferWebGPU: true,
  lowPower: false,
  darkTheme: false,
});

/** Load settings, keeping only known boolean fields. */
export function loadSettings(storage: StorageLike | null): StudioSettings {
  const raw = readJson(storage, STORAGE_KEYS.settings);
  const out: StudioSettings = { ...DEFAULT_SETTINGS };
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    for (const k of Object.keys(DEFAULT_SETTINGS) as Array<keyof StudioSettings>) {
      if (Object.prototype.hasOwnProperty.call(r, k) && typeof r[k] === 'boolean') out[k] = r[k];
    }
  }
  return out;
}

/** Persist settings. */
export function saveSettings(storage: StorageLike | null, settings: StudioSettings): boolean {
  return writeJson(storage, STORAGE_KEYS.settings, settings);
}
