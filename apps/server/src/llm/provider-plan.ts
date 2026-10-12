/**
 * Decide which upstream LLM provider (if any) the server uses.
 *
 * Pure function of the config so it is unit-testable without touching the
 * network or importing provider implementations.
 */
import type { RoleModels, ServerConfig } from '../config';

/** Names of live (networked) providers. */
export type LiveProviderName = 'anthropic' | 'openai';

/** Everything needed to construct the active provider. */
export interface ActiveProviderPlan {
  name: LiveProviderName;
  apiKey: string;
  models: RoleModels;
  baseUrl?: string;
}

/** Outcome of provider selection. */
export interface ProviderPlan {
  mode: 'live' | 'mock';
  active: ActiveProviderPlan | null;
  /** Live providers that have a key configured (in preference order). */
  available: LiveProviderName[];
}

/**
 * Select the provider per `AETHER_PROVIDER` and key presence:
 * - `mock` → always mock mode;
 * - otherwise the preferred provider if its key is set, else the other one;
 * - no key at all → mock mode (the studio uses its local mock provider).
 */
export function planProviders(config: ServerConfig): ProviderPlan {
  const available: LiveProviderName[] = [];
  const order: LiveProviderName[] = config.provider === 'openai' ? ['openai', 'anthropic'] : ['anthropic', 'openai'];
  for (const name of order) if (config.keys[name]) available.push(name);
  if (config.provider === 'mock' || available.length === 0) return { mode: 'mock', active: null, available };
  const name = available[0] as LiveProviderName;
  const active: ActiveProviderPlan = { name, apiKey: config.keys[name] as string, models: { ...config.models[name] } };
  const baseUrl = config.baseUrls[name];
  if (baseUrl !== undefined) active.baseUrl = baseUrl;
  return { mode: 'live', active, available };
}
