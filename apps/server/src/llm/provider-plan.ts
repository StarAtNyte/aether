/**
 * Decide which upstream LLM provider (if any) the server uses.
 *
 * Pure function of the config so it is unit-testable without touching the
 * network or importing provider implementations.
 *
 * Cost policy: the server never spends owner-paid API keys unless
 * `AETHER_PROVIDER` explicitly names that provider. Without it the server is
 * in mock mode and visitors use the offline planner, their own local bridge
 * (Codex / Claude Code subscription) or their own key (`/api/llm/byok`).
 */
import type { RoleModels, ServerConfig } from '../config';

/** Names of live API providers (paid keys). */
export type LiveProviderName = 'anthropic' | 'openai';
/** Names of headless CLI providers (the local machine's subscription login). */
export type HeadlessProviderName = 'codex' | 'claude-code';

/** Everything needed to construct the active provider. */
export type ActiveProviderPlan =
  | { kind: 'api'; name: LiveProviderName; apiKey: string; models: RoleModels; baseUrl?: string }
  | { kind: 'headless'; name: HeadlessProviderName; model?: string; effort: 'low' | 'medium' | 'high'; models: RoleModels };

/** Outcome of provider selection. */
export interface ProviderPlan {
  mode: 'live' | 'mock';
  active: ActiveProviderPlan | null;
  /** Live providers usable right now (in preference order). */
  available: string[];
}

/**
 * Select the provider per `AETHER_PROVIDER`:
 * - unset / `mock` → mock mode, even when keys are present;
 * - `codex` / `claude-code` → the headless CLI on this machine;
 * - `anthropic` / `openai` → that key if set, else the other key; no key → mock.
 */
export function planProviders(config: ServerConfig): ProviderPlan {
  if (config.provider === 'mock') return { mode: 'mock', active: null, available: [] };
  if (config.provider === 'codex' || config.provider === 'claude-code') {
    const label = config.headless.model ?? 'default';
    return {
      mode: 'live',
      active: { kind: 'headless', name: config.provider, ...(config.headless.model ? { model: config.headless.model } : {}), effort: config.headless.effort, models: { planner: label, coder: label, critic: label } },
      available: [config.provider],
    };
  }
  const order: LiveProviderName[] = config.provider === 'openai' ? ['openai', 'anthropic'] : ['anthropic', 'openai'];
  const available: LiveProviderName[] = [];
  for (const name of order) if (config.keys[name]) available.push(name);
  if (available.length === 0) return { mode: 'mock', active: null, available };
  const name = available[0] as LiveProviderName;
  const active: ActiveProviderPlan = { kind: 'api', name, apiKey: config.keys[name] as string, models: { ...config.models[name] } };
  const baseUrl = config.baseUrls[name];
  if (baseUrl !== undefined) active.baseUrl = baseUrl;
  return { mode: 'live', active, available };
}
