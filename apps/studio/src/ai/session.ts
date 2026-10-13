/**
 * Session-only secrets: the bridge pairing token and a bring-your-own API
 * key. They live in sessionStorage (gone when the tab closes, never in
 * localStorage, IndexedDB, exports, share links or logs) and are validated
 * on every read.
 */
import { BRIDGE_TOKEN_RE, normalizeBridgeUrl } from '@aether/agent';

/** sessionStorage subset (injectable for tests). */
export interface SessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const BRIDGE_KEY = 'aether.bridge.v1';
const BYOK_KEY = 'aether.byok.v1';
/** Same shape the server accepts. */
export const BYOK_KEY_RE = /^[A-Za-z0-9_.-]{20,300}$/;

/** The browser's sessionStorage, or null (private mode, blocked storage). */
export function browserSession(): SessionStore | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

function read(store: SessionStore | null, key: string): unknown {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function write(store: SessionStore | null, key: string, value: unknown): void {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the pairing lasts for this page only */
  }
}

/** Saved bridge pairing. */
export interface BridgeSession {
  url: string;
  token: string;
}

/** Read the bridge pairing (null when absent or invalid). */
export function loadBridgeSession(store: SessionStore | null): BridgeSession | null {
  const v = read(store, BRIDGE_KEY);
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const url = typeof r['url'] === 'string' ? normalizeBridgeUrl(r['url']) : null;
  const token = typeof r['token'] === 'string' && BRIDGE_TOKEN_RE.test(r['token']) ? r['token'] : null;
  return url && token ? { url, token } : null;
}

/** Save (or clear with null) the bridge pairing. */
export function saveBridgeSession(store: SessionStore | null, s: BridgeSession | null): void {
  write(store, BRIDGE_KEY, s);
}

/** Saved bring-your-own key. */
export interface ByokSession {
  provider: 'anthropic' | 'openai';
  key: string;
}

/** Read the BYO key (null when absent or invalid). */
export function loadByokSession(store: SessionStore | null): ByokSession | null {
  const v = read(store, BYOK_KEY);
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const provider = r['provider'] === 'anthropic' || r['provider'] === 'openai' ? r['provider'] : null;
  const key = typeof r['key'] === 'string' && BYOK_KEY_RE.test(r['key']) ? r['key'] : null;
  return provider && key ? { provider, key } : null;
}

/** Save (or clear with null) the BYO key. */
export function saveByokSession(store: SessionStore | null, s: ByokSession | null): void {
  write(store, BYOK_KEY, s);
}

/** Validate raw deep-link values (loopback URL + well-formed token). */
export function validateBridgeLink(link: { url: string | null; token: string | null }): BridgeSession | null {
  const url = link.url ? normalizeBridgeUrl(link.url) : null;
  return url && link.token && BRIDGE_TOKEN_RE.test(link.token) ? { url, token: link.token } : null;
}
