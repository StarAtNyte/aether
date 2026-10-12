/**
 * Construct the live upstream provider from a {@link ProviderPlan} using the
 * raw-fetch implementations in @aether/agent. Imported only by the process
 * bootstrap (`main.ts`); the HTTP app receives the provider via dependency
 * injection so tests never touch the network.
 */
import { createAnthropicProvider, createOpenAIProvider } from '@aether/agent';
import type { ActiveProviderPlan } from './provider-plan';
import type { LlmProvider } from './schema';

/** Instantiate the provider described by `plan`. */
export function createLiveProvider(plan: ActiveProviderPlan): LlmProvider {
  const opts = { apiKey: plan.apiKey, models: { ...plan.models }, ...(plan.baseUrl ? { baseUrl: plan.baseUrl } : {}) };
  return plan.name === 'anthropic' ? createAnthropicProvider(opts) : createOpenAIProvider(opts);
}
