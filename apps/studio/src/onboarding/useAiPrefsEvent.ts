/**
 * Listen for AI preference changes made on the first-run screen (a window
 * event, so the screen at the app root needs no handle on the editor). The
 * payload is treated as untrusted: only known preference keys pass, and the
 * receiver re-validates every value with the prefs schema.
 */
import { useEffect, useRef } from 'react';
import { AiPrefsSchema, type AiPrefs } from '../ai/prefs';
import { AI_PREFS_EVENT } from './firstRun';

const KEYS = new Set(Object.keys(AiPrefsSchema.shape));

/** Keep only known preference keys of an untrusted event payload. */
export function pickPrefsPatch(detail: unknown): Partial<AiPrefs> | null {
  if (typeof detail !== 'object' || detail === null || Array.isArray(detail)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) if (KEYS.has(k)) out[k] = v;
  return Object.keys(out).length > 0 ? (out as Partial<AiPrefs>) : null;
}

/** Call `onPatch` with each validated-key patch. */
export function useAiPrefsEvent(onPatch: (patch: Partial<AiPrefs>) => void): void {
  const cb = useRef(onPatch);
  cb.current = onPatch;
  useEffect(() => {
    const handler = (e: Event): void => {
      const patch = pickPrefsPatch((e as CustomEvent<unknown>).detail);
      if (patch) cb.current(patch);
    };
    window.addEventListener(AI_PREFS_EVENT, handler);
    return () => window.removeEventListener(AI_PREFS_EVENT, handler);
  }, []);
}
