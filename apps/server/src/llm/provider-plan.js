/**
 * Select the provider per `AETHER_PROVIDER`:
 * - unset / `mock` → mock mode, even when keys are present;
 * - `codex` / `claude-code` → the headless CLI on this machine;
 * - `anthropic` / `openai` → that key if set, else the other key; no key → mock.
 */
export function planProviders(config) {
    if (config.provider === 'mock')
        return { mode: 'mock', active: null, available: [] };
    if (config.provider === 'codex' || config.provider === 'claude-code') {
        const label = config.headless.model ?? 'default';
        return {
            mode: 'live',
            active: { kind: 'headless', name: config.provider, ...(config.headless.model ? { model: config.headless.model } : {}), effort: config.headless.effort, models: { planner: label, coder: label, critic: label } },
            available: [config.provider],
        };
    }
    const order = config.provider === 'openai' ? ['openai', 'anthropic'] : ['anthropic', 'openai'];
    const available = [];
    for (const name of order)
        if (config.keys[name])
            available.push(name);
    if (available.length === 0)
        return { mode: 'mock', active: null, available };
    const name = available[0];
    const active = { kind: 'api', name, apiKey: config.keys[name], models: { ...config.models[name] } };
    const baseUrl = config.baseUrls[name];
    if (baseUrl !== undefined)
        active.baseUrl = baseUrl;
    return { mode: 'live', active, available };
}
