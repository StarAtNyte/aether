/**
 * First-run sign-in: decides whether the studio greets the user with the
 * "connect your AI" screen, and which variant.
 *
 * - **local**: the page is served by `aether start` (`/api/health` reports
 *   `local: true`): sign in with your own ChatGPT account (Codex) through the
 *   local server, use a signed-in Claude Code, or continue offline. Skipped
 *   entirely when a CLI is already signed in.
 * - **hosted**: any other origin (a static host has no `/api`): your own API
 *   key (called straight from the browser), your own Codex / Claude Code
 *   through the local bridge, or explore offline.
 *
 * The choice is remembered in localStorage (`aether.onboarding.v1`) so the
 * screen never nags again; a quiet "Sign in" chip stays while offline.
 * Deliberately free of the agent package: the projects home loads this.
 */
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { HEALTH_TIMEOUT_MS } from '../config';
import { readJson, writeJson, type StorageLike } from '../lib/storage';

/** localStorage key of the remembered choice. */
export const ONBOARDING_KEY = 'aether.onboarding.v1';

/** What the user picked on the first-run screen. */
export const FIRST_RUN_CHOICES = ['offline', 'codex', 'claude-code', 'byok', 'bridge'] as const;
/** A first-run choice. */
export type FirstRunChoice = (typeof FIRST_RUN_CHOICES)[number];

/** Remembered choice. */
export interface OnboardingMarker {
  choice: FirstRunChoice;
  at: number;
}

/** Which first-run screen applies. */
export type FirstRunVariant = 'local' | 'hosted';

/** Read and validate the remembered choice (null when absent or invalid). */
export function readMarker(storage: StorageLike | null): OnboardingMarker | null {
  const v = readJson(storage, ONBOARDING_KEY);
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const choice = r['choice'];
  const at = r['at'];
  if (typeof choice !== 'string' || !(FIRST_RUN_CHOICES as readonly string[]).includes(choice)) return null;
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) return null;
  return { choice: choice as FirstRunChoice, at };
}

/** Remember a choice. */
export function writeMarker(storage: StorageLike | null, choice: FirstRunChoice, now: number = Date.now()): OnboardingMarker {
  const m = { choice, at: Math.max(0, Math.floor(now)) };
  writeJson(storage, ONBOARDING_KEY, m);
  return m;
}

/** What the decision needs to know. */
export interface FirstRunFacts {
  marker: OnboardingMarker | null;
  /** `/api/health` says this server offers local AI (`aether start`). */
  local: boolean;
  /** A local CLI (Codex or Claude Code) is already signed in. */
  signedIn: boolean;
  /** Forced hosted build (`VITE_AETHER_HOSTED=1`). */
  hostedBuild: boolean;
}

/** Show the screen? Which variant? (pure). */
export function decideFirstRun(f: FirstRunFacts): { show: boolean; variant: FirstRunVariant } {
  const variant: FirstRunVariant = f.local && !f.hostedBuild ? 'local' : 'hosted';
  if (f.marker) return { show: false, variant };
  if (variant === 'local' && f.signedIn) return { show: false, variant };
  return { show: true, variant };
}

/** Parse untrusted `/api/health` → does it offer local AI? */
export function healthOffersLocal(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as Record<string, unknown>)['ok'] === true && (body as Record<string, unknown>)['local'] === true;
}

/** Parse untrusted `/api/local/status` → is any backend signed in? */
export function statusSignedIn(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const list = (body as Record<string, unknown>)['backends'];
  if (!Array.isArray(list)) return false;
  return list.slice(0, 8).some((b) => typeof b === 'object' && b !== null && (b as Record<string, unknown>)['installed'] === true && (b as Record<string, unknown>)['loggedIn'] === true);
}

async function getJson(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'application/json' }, credentials: 'same-origin' });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 256 * 1024 ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Gather the facts (health first; local status only when local AI is offered). Never throws. */
export async function probeFirstRun(fetchImpl: typeof fetch, storage: StorageLike | null, hostedBuild: boolean): Promise<FirstRunFacts> {
  const marker = readMarker(storage);
  if (hostedBuild) return { marker, local: false, signedIn: false, hostedBuild };
  const local = healthOffersLocal(await getJson(fetchImpl, '/api/health', HEALTH_TIMEOUT_MS));
  // The local status probes the CLIs (a few seconds on a cold start): skip it once a choice is remembered.
  const signedIn = local && !marker ? statusSignedIn(await getJson(fetchImpl, '/api/local/status', 25_000)) : false;
  return { marker, local, signedIn, hostedBuild };
}

/** Observable first-run state. */
export interface FirstRunState {
  /** Probe finished. */
  ready: boolean;
  open: boolean;
  variant: FirstRunVariant;
  marker: OnboardingMarker | null;
}

/** Page-wide first-run store. */
export const firstRunStore = createStore<FirstRunState>()(() => ({ ready: false, open: false, variant: 'hosted', marker: null }));

/** React access to the first-run state. */
export function useFirstRun<T>(selector: (s: FirstRunState) => T): T {
  return useStore(firstRunStore, selector);
}

/** Reopen the screen (the "Sign in" chip). */
export function openFirstRun(): void {
  firstRunStore.setState({ open: true });
}

/** Close the screen and remember `choice`. */
export function finishFirstRun(storage: StorageLike | null, choice: FirstRunChoice): void {
  firstRunStore.setState({ open: false, marker: writeMarker(storage, choice) });
}

/** True for the build flag that forces the hosted variant. */
export function hostedBuildFlag(): boolean {
  try {
    return import.meta.env?.['VITE_AETHER_HOSTED'] === '1';
  } catch {
    return false;
  }
}

/** Event the editor listens to so a first-run choice applies to the open project at once. */
export const AI_PREFS_EVENT = 'aether:ai-prefs';
