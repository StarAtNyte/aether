/**
 * The picture shown behind the loading skeleton while a world opens: the card thumbnail the person just clicked (a
 * bundled example's WebP, already in the browser cache from the home page), so something real is on screen at once.
 * One value shared by the "new project" route (template URL), the editor route (the project's stored thumbnail) and
 * the viewport overlay; cleared when the editor leaves.
 */
import { useSyncExternalStore } from 'react';

let current: string | null = null;
const listeners = new Set<() => void>();

/** Set (or clear with null) the poster URL; blob URLs are the caller's to revoke. */
export function setLoadPoster(url: string | null): void {
  if (url === current) return;
  current = url;
  for (const fn of listeners) fn();
}

/** The poster URL now. */
export function getLoadPoster(): string | null {
  return current;
}

/** React binding. */
export function useLoadPoster(): string | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getLoadPoster,
    () => null,
  );
}

/** The three steps the person reads while a world opens. */
export const LOAD_STEPS = ['Loading editor', 'Loading world', 'Preparing light'] as const;

/** Where the loading text sits in the open: step (1-based), and 0..1 over the whole open (determinate-ish). */
export function loadProgress(text: string): { step: 1 | 2 | 3; fraction: number } {
  const t = text.toLowerCase();
  if (/almost/.test(t)) return { step: 3, fraction: 0.97 };
  if (/sky|shader|light|compil|model|texture|geometry/.test(t)) return { step: 3, fraction: /shader|geometry/.test(t) ? 0.9 : 0.8 };
  if (/camera/.test(t)) return { step: 2, fraction: 0.74 };
  if (/building|world/.test(t)) return { step: 2, fraction: 0.6 };
  if (/renderer|webgpu|webgl/.test(t)) return { step: 2, fraction: /ready/.test(t) ? 0.5 : 0.4 };
  if (/creating|project/.test(t)) return { step: 1, fraction: 0.22 };
  return { step: 1, fraction: 0.1 };
}
