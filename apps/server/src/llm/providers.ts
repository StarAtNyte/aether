/**
 * Construct the live upstream provider from a {@link ProviderPlan}: the
 * raw-fetch API providers of @aether/agent, or the locked-down headless CLI
 * providers of @aether/bridge (imported lazily, only when configured).
 * Imported only by the process bootstrap (`main.ts`); the HTTP app receives
 * the provider via dependency injection so tests never touch the network.
 */
import { createAnthropicProvider, createOpenAIProvider } from '@aether/agent';
import type { ActiveProviderPlan } from './provider-plan';
import type { LlmProvider } from './schema';

/** Instantiate the provider described by `plan`. */
export async function createLiveProvider(plan: ActiveProviderPlan): Promise<LlmProvider> {
  if (plan.kind === 'headless') {
    const { createHeadlessProvider } = await import('@aether/bridge');
    return createHeadlessProvider(plan.name, { effort: plan.effort, ...(plan.model ? { model: plan.model } : {}) });
  }
  const opts = { apiKey: plan.apiKey, models: { ...plan.models }, ...(plan.baseUrl ? { baseUrl: plan.baseUrl } : {}) };
  return plan.name === 'anthropic' ? createAnthropicProvider(opts) : createOpenAIProvider(opts);
}
