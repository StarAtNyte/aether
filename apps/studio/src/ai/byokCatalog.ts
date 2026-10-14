/**
 * Bring-your-own-key providers: who they are, where their API lives, where a
 * user gets a key and which models are offered before the live list loads.
 *
 * The studio calls these APIs straight from the browser with the user's own
 * key (all four allow CORS for the headers we send); the key is never sent to
 * Aether's server. The origins below are exactly the extra `connect-src`
 * entries of the Content-Security-Policy (a test keeps them in sync).
 *
 * No imports: the projects home and the first-run screen use this module
 * without loading the agent package.
 */

/** Providers a user can bring a key for. */
export const BYOK_PROVIDERS = ['anthropic', 'openai', 'openrouter', 'gemini'] as const;
/** A bring-your-own-key provider. */
export type ByokProvider = (typeof BYOK_PROVIDERS)[number];

/** One offered model. */
export interface ByokModel {
  id: string;
  label: string;
}

/** Static facts about a provider. */
export interface ByokProviderInfo {
  id: ByokProvider;
  label: string;
  /** API origin (also allowed in the page's CSP `connect-src`). */
  origin: string;
  /** Where the user creates a key. */
  keyPage: string;
  /** Placeholder showing the key's usual prefix. */
  keyHint: string;
  /** Models offered until the provider's own list is loaded. */
  models: readonly ByokModel[];
  defaultModel: string;
}

/** Provider catalog. */
export const BYOK_CATALOG: Readonly<Record<ByokProvider, ByokProviderInfo>> = Object.freeze({
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    origin: 'https://api.anthropic.com',
    keyPage: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-…',
    models: [
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    ],
    defaultModel: 'claude-sonnet-5-5',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    origin: 'https://api.openai.com',
    keyPage: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-…',
    models: [
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
      { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
    ],
    defaultModel: 'gpt-6.1-sol',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    origin: 'https://openrouter.ai',
    keyPage: 'https://openrouter.ai/keys',
    keyHint: 'sk-or-…',
    models: [
      { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5' },
      { id: 'openai/gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
      { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5' },
    ],
    defaultModel: 'anthropic/claude-sonnet-5.5',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    origin: 'https://generativelanguage.googleapis.com',
    keyPage: 'https://aistudio.google.com/apikey',
    keyHint: 'AIza…',
    models: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
      { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
    ],
    defaultModel: 'gemini-3.8-flash',
  },
});

/** API origins the page may call with a user's key (CSP `connect-src`). */
export const BYOK_ORIGINS: readonly string[] = Object.freeze(BYOK_PROVIDERS.map((p) => BYOK_CATALOG[p].origin));

/** Accepted key shape: printable token characters only (no whitespace, no header injection). */
export const BYOK_KEY_RE = /^[A-Za-z0-9_.-]{20,300}$/;
/** Accepted model id (OpenRouter ids contain a slash). */
export const BYOK_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
/** Most model calls a key may make per browser session before the user resets the counter. */
export const BYOK_SESSION_CALL_CAP = 150;

/** Type guard for a provider id. */
export function isByokProvider(v: unknown): v is ByokProvider {
  return typeof v === 'string' && (BYOK_PROVIDERS as readonly string[]).includes(v);
}

/** A key shown safely: its prefix and last four characters only. */
export function maskKey(key: string): string {
  if (key.length < 12) return '••••';
  const prefix = /^[A-Za-z]+-(?:[A-Za-z]+-)?/.exec(key)?.[0] ?? key.slice(0, 3);
  return `${prefix.slice(0, 10)}••••${key.slice(-4)}`;
}
