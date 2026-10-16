/**
 * AI connection preferences: which connection, which model, how much
 * reasoning effort and how many quality-refinement rounds. Persisted in
 * localStorage (nothing secret here) as a global default plus a per-project
 * override; everything read back is validated with zod.
 */
import { z } from 'zod';
import { readJson, writeJson } from '../lib/storage';
import { BYOK_MODEL_RE, BYOK_PROVIDERS } from './byokCatalog';
/**
 * Connection modes. 'auto' picks, in order: local AI on this computer (Codex,
 * then Claude Code), the paired bridge, the server model, the user's own API
 * key (when one is set for the chosen provider), an on-device model that is
 * already loaded, then the offline planner.
 */
export const AI_MODES = ['auto', 'local', 'offline', 'server', 'bridge', 'webllm', 'byok'];
/** Largest refinement budget offered. */
export const MAX_REFINE = 3;
/**
 * WebLLM models offered (small instruct models, q4f16). Only permissively
 * licensed weights (Apache-2.0 / MIT); the visitor's browser downloads them
 * directly from the model host after an explicit opt-in.
 */
export const WEBLLM_MODELS = [
    { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 1.5B', downloadMB: 1000, licence: 'Apache-2.0' },
    { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', label: 'Phi-3.5 mini (3.8B)', downloadMB: 2200, licence: 'MIT' },
    { id: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC', label: 'SmolLM2 1.7B', downloadMB: 1100, licence: 'Apache-2.0' },
];
/** Same as `MODEL_ID_RE` in @aether/agent (kept local so the home page does not load the agent package; a test asserts equality). */
export const PREF_MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const ModelId = z.string().regex(PREF_MODEL_ID_RE);
const ByokModelId = z.string().regex(BYOK_MODEL_RE).optional().catch(undefined);
/** zod schema of {@link AiPrefs}. Unknown or invalid fields fall back to defaults. */
export const AiPrefsSchema = z.object({
    mode: z.enum(AI_MODES).catch('auto'),
    backend: z.enum(['codex', 'claude-code']).catch('codex'),
    codexModel: ModelId.catch('gpt-6.1-sol'),
    claudeModel: ModelId.catch('sonnet'),
    effort: z.enum(['low', 'medium', 'high']).catch('low'),
    refine: z.number().int().min(0).max(MAX_REFINE).catch(1),
    webllmModel: z.enum(WEBLLM_MODELS.map((m) => m.id)).catch(WEBLLM_MODELS[0].id),
    byokProvider: z.enum(BYOK_PROVIDERS).catch('anthropic'),
    /** Model chosen per key provider (absent: the provider's default). */
    byokModels: z
        .object({ anthropic: ByokModelId, openai: ByokModelId, openrouter: ByokModelId, gemini: ByokModelId })
        .catch({ anthropic: undefined, openai: undefined, openrouter: undefined, gemini: undefined })
        .transform((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined))),
    /** Deep build: new assets are built by a coding agent that iterates with a checker (local AI only). */
    deep: z.boolean().catch(true),
    /** Iterations a deep build may spend (1–6). */
    deepTurns: z.number().int().min(1).max(6).catch(3),
});
/** Defaults: automatic connection, Codex/Sonnet when bridged, low effort, one refinement round. */
export const DEFAULT_AI_PREFS = Object.freeze(AiPrefsSchema.parse({}));
const GLOBAL_KEY = 'aether.ai.prefs.v1';
const PROJECT_ID = /^[a-z0-9]{8,32}$/;
/** Validate untrusted stored prefs (field by field). */
export function parsePrefs(raw) {
    const obj = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
    return AiPrefsSchema.parse(obj);
}
/** Load prefs: the project's own when saved, else the global default. */
export function loadAiPrefs(storage, projectId) {
    if (projectId && PROJECT_ID.test(projectId)) {
        const own = readJson(storage, `${GLOBAL_KEY}.${projectId}`);
        if (own !== null)
            return parsePrefs(own);
    }
    return parsePrefs(readJson(storage, GLOBAL_KEY));
}
/** Save prefs for a project (and as the global default for new projects). */
export function saveAiPrefs(storage, prefs, projectId) {
    const clean = parsePrefs(prefs);
    if (projectId && PROJECT_ID.test(projectId))
        writeJson(storage, `${GLOBAL_KEY}.${projectId}`, clean);
    writeJson(storage, GLOBAL_KEY, clean);
}
/** The model id of the selected bridge backend. */
export function bridgeModel(prefs) {
    return prefs.backend === 'codex' ? prefs.codexModel : prefs.claudeModel;
}
