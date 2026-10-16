/**
 * AI connection manager (one per page): probes the Aether server and the
 * local bridge, holds the bridge pairing and the user's own API keys (this
 * browser only; sent straight to the provider, never to Aether's server),
 * loads the on-device model on request, and resolves the user's
 * preferences into a concrete provider — or explains why it cannot, so the
 * studio falls back to the offline planner with a visible notice.
 */
import { createStore } from 'zustand/vanilla';
import { createBridgeAccountApi, createBridgeProvider, createLocalAiApi, createLocalProvider, createHttpProvider, createMockProvider, createWebLlmProvider, fetchBridgeStatus, pairBridge, ProviderError, } from '@aether/agent';
// The catalog subpath only (not the procgen barrel), so this chunk stays small.
import { GENERATOR_LIBRARY } from '@aether/procgen/library';
import { API, HEALTH_TIMEOUT_MS } from '../config';
import { bridgeModel, WEBLLM_MODELS } from './prefs';
import { byokModelFor, createDirectProvider, listProviderModels, meteredProvider } from './byok';
import { BYOK_CATALOG, BYOK_KEY_RE, BYOK_SESSION_CALL_CAP, isByokProvider } from './byokCatalog';
import { browserSession, deviceStorage, loadBridgeSession, loadByokKeys, loadByokUsage, saveBridgeSession, saveByokKeys, saveByokUsage } from './session';
/** Default bridge address. */
export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8790';
/** Parse an untrusted `/api/health` body. */
export function parseServerHealth(body) {
    if (typeof body !== 'object' || body === null)
        return { state: 'offline', providers: [], byok: false, local: false };
    const b = body;
    const providers = Array.isArray(b['providers']) ? b['providers'].filter((p) => typeof p === 'string').slice(0, 8).map((p) => p.slice(0, 40)) : [];
    return { state: b['ok'] === true && b['mode'] === 'live' ? 'live' : 'mock', providers, byok: b['byok'] === true, local: b['local'] === true };
}
const BACKEND_LABEL = { codex: 'Codex', 'claude-code': 'Claude Code' };
/**
 * Reconcile the saved preferences with what the bridge reports: prefer the
 * chosen backend when it is signed in (else the first signed-in one), keep
 * the saved model only while that backend's catalog still lists it (a model
 * retired from the catalog would otherwise fail every call), and keep the
 * effort only when the model supports it.
 */
export function effectiveBridgeChoice(prefs, backends) {
    const ready = backends.filter((b) => b.installed && b.loggedIn);
    const status = ready.find((b) => b.id === prefs.backend) ?? ready[0] ?? backends.find((b) => b.id === prefs.backend);
    const backend = status?.id ?? prefs.backend;
    const wanted = backend === prefs.backend ? bridgeModel(prefs) : undefined;
    const catalog = status?.models ?? [];
    let model = wanted;
    if (catalog.length > 0 && (model === undefined || !catalog.some((m) => m.id === model)))
        model = status?.defaultModel ?? catalog[0]?.id;
    const efforts = catalog.find((m) => m.id === model)?.efforts;
    const effort = efforts && efforts.length > 0 && !efforts.includes(prefs.effort) ? (efforts.includes('low') ? 'low' : (efforts[0] ?? prefs.effort)) : prefs.effort;
    return { backend, model, effort };
}
/** The page's AI connection manager. */
export class AiConnection {
    deps;
    store;
    fetchImpl;
    session;
    token = null;
    byokKeys = {};
    device;
    modelLists = new Map();
    engine = null;
    refreshing = null;
    /** Local AI client (same origin). */
    localApi;
    constructor(deps = {}) {
        this.deps = deps;
        this.fetchImpl = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
        this.session = deps.session ?? null;
        this.device = deps.device ?? null;
        const bridge = loadBridgeSession(this.session);
        const byok = loadByokKeys(this.session, this.device);
        this.token = bridge?.token ?? null;
        this.byokKeys = byok.keys;
        this.localApi = createLocalAiApi({ fetch: this.fetchImpl });
        this.store = createStore()(() => ({
            local: { state: 'checking', detail: '', backends: [], account: null, jobs: 0, login: null },
            bridge: { url: bridge?.url ?? DEFAULT_BRIDGE_URL, paired: bridge !== null, state: bridge ? 'checking' : 'unpaired', detail: '', backends: [], login: null },
            server: { state: 'checking', providers: [], byok: false, local: false },
            webllm: { state: 'idle', progress: 0, detail: '', model: null },
            byok: byokState(byok.keys, byok.remembered, loadByokUsage(this.session)),
        }));
    }
    /** Probe the server and (when paired) the bridge. Never throws. */
    async refresh() {
        this.refreshing ??= Promise.all([this.probeServer(), this.refreshBridge()])
            .then(() => undefined)
            .finally(() => {
            this.refreshing = null;
        });
        return this.refreshing;
    }
    /** Probe `/api/health` (and local AI when the server offers it). */
    async probeServer() {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
        try {
            const res = await this.fetchImpl(API.health, { signal: ctrl.signal, headers: { accept: 'application/json' } });
            this.store.setState({ server: res.ok ? parseServerHealth(await res.json()) : { state: 'offline', providers: [], byok: false, local: false } });
        }
        catch {
            this.store.setState({ server: { state: 'offline', providers: [], byok: false, local: false } });
        }
        finally {
            clearTimeout(timer);
        }
        await this.refreshLocal();
    }
    /** Re-read local AI status (sign-in state, models, account). Never throws. */
    async refreshLocal() {
        if (!this.store.getState().server.local) {
            this.setLocal({ state: 'off', detail: '', backends: [], account: null, jobs: 0, login: null });
            return;
        }
        const cur = this.store.getState().local;
        if (cur.state === 'off')
            this.setLocal({ state: 'checking' });
        try {
            const st = await this.localApi.status();
            const ready = st.backends.some((b) => b.installed && b.loggedIn);
            const detail = ready ? st.backends.filter((b) => b.loggedIn).map((b) => b.label).join(' and ') + ' ready on this computer' : st.backends.map((b) => `${b.label}: ${b.detail}`).join(' · ');
            this.setLocal({ state: ready ? 'ready' : 'not_logged_in', detail: detail.slice(0, 240), backends: st.backends, account: st.account, jobs: st.jobs, login: st.login });
        }
        catch (err) {
            this.setLocal({ state: 'error', detail: err instanceof Error ? err.message.slice(0, 200) : 'local AI error' });
        }
    }
    setLocal(patch) {
        this.store.setState((s) => ({ local: { ...s.local, ...patch } }));
    }
    /** Address and pairing token of a ready, paired bridge (publishing through it), or null. */
    bridgeEndpoint() {
        const b = this.store.getState().bridge;
        return this.token && b.paired && b.state !== 'offline' && b.state !== 'unpaired' ? { url: b.url, token: this.token } : null;
    }
    /** Sign-in/sign-out API of the bridge (null when not paired). */
    bridgeAccounts() {
        if (!this.token)
            return null;
        try {
            return createBridgeAccountApi({ baseUrl: this.store.getState().bridge.url, token: this.token, fetch: this.fetchImpl });
        }
        catch {
            return null;
        }
    }
    /** Record the bridge's sign-in state (polled by the settings pane). */
    setBridgeLogin(login) {
        this.setBridge({ login });
    }
    /** Forget a deleted project's resumable conversations everywhere (best effort). */
    async forgetProject(projectId) {
        const key = projectSessionKey(projectId);
        if (!key)
            return;
        const tasks = [];
        if (this.store.getState().server.state === 'checking')
            await this.probeServer();
        if (this.store.getState().server.local)
            tasks.push(this.localApi.clearSessions(key));
        const bridge = this.bridgeAccounts();
        if (bridge)
            tasks.push(bridge.clearSessions(key));
        await Promise.allSettled(tasks);
    }
    /** Re-read the bridge status (login state, models). */
    async refreshBridge() {
        const cur = this.store.getState().bridge;
        if (!this.token) {
            this.setBridge({ paired: false, state: 'unpaired', detail: '', backends: [] });
            return;
        }
        this.setBridge({ state: cur.state === 'ready' ? 'ready' : 'checking' });
        try {
            const status = await fetchBridgeStatus(cur.url, this.token, this.fetchImpl);
            this.applyStatus(status);
        }
        catch (err) {
            const reason = err instanceof ProviderError ? err.reason : undefined;
            if (reason === 'unauthorized') {
                // The bridge restarted (tokens are in memory only): pairing is needed again.
                this.forgetPairing('The bridge restarted or the pairing expired. Pair again with the code it prints.');
                return;
            }
            this.setBridge({ state: reason === 'bridge_offline' || reason === 'timeout' ? 'offline' : 'error', detail: err instanceof Error ? err.message.slice(0, 200) : 'bridge error' });
        }
    }
    applyStatus(status) {
        const backends = status.backends;
        const ready = backends.some((b) => b.installed && b.loggedIn);
        const detail = ready ? backends.filter((b) => b.loggedIn).map((b) => b.label).join(' and ') + ' ready' : backends.map((b) => `${b.label}: ${b.detail}`).join(' · ');
        this.setBridge({ paired: true, state: ready ? 'ready' : 'not_logged_in', detail: detail.slice(0, 240), backends });
    }
    setBridge(patch) {
        this.store.setState((s) => ({ bridge: { ...s.bridge, ...patch } }));
    }
    forgetPairing(detail) {
        this.token = null;
        saveBridgeSession(this.session, null);
        this.setBridge({ paired: false, state: 'unpaired', detail, backends: [] });
    }
    /** Pair with a running bridge using the code it printed. Resolves to an error message or null. */
    async pair(url, code) {
        this.setBridge({ url, state: 'checking', detail: '' });
        try {
            const token = await pairBridge(url, code, this.fetchImpl);
            this.adoptPairing({ url, token });
            await this.refreshBridge();
            return null;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : 'pairing failed';
            this.setBridge({ state: this.token ? 'ready' : 'unpaired', detail: msg.slice(0, 200) });
            return msg;
        }
    }
    /** Use a pairing from a deep link (already validated). */
    adoptPairing(p) {
        this.token = p.token;
        saveBridgeSession(this.session, p);
        this.setBridge({ url: p.url, paired: true, state: 'checking' });
    }
    /** Forget the bridge pairing. */
    unpair() {
        this.forgetPairing('');
    }
    /**
     * Keep the user's own API key for `provider` in this browser (this tab
     * only, or on this device too with `remember`). Returns an error message,
     * or null on success. The key is only ever sent to that provider's API.
     */
    setByok(provider, key, opts = {}) {
        if (!isByokProvider(provider))
            return 'Unknown provider.';
        const k = key.trim();
        if (!BYOK_KEY_RE.test(k))
            return 'That does not look like an API key.';
        this.byokKeys = { ...this.byokKeys, [provider]: k };
        const remember = opts.remember ?? this.store.getState().byok.remembered;
        saveByokKeys(this.session, this.device, this.byokKeys, remember);
        this.store.setState((s) => ({ byok: { ...byokState(this.byokKeys, remember && Object.keys(this.byokKeys).length > 0, s.byok.usage), provider } }));
        return null;
    }
    /** Forget the key of `provider`, or every key (also from this device). */
    clearByok(provider) {
        if (provider === undefined)
            this.byokKeys = {};
        else {
            const next = { ...this.byokKeys };
            delete next[provider];
            this.byokKeys = next;
        }
        const remember = this.store.getState().byok.remembered;
        saveByokKeys(this.session, this.device, this.byokKeys, remember);
        this.store.setState((s) => ({ byok: byokState(this.byokKeys, remember && Object.keys(this.byokKeys).length > 0, s.byok.usage) }));
    }
    /** Keep (or stop keeping) the keys on this device. */
    setByokRemember(remember) {
        saveByokKeys(this.session, this.device, this.byokKeys, remember);
        this.store.setState((s) => ({ byok: { ...s.byok, remembered: remember && Object.keys(this.byokKeys).length > 0 } }));
    }
    /** Reset this session's key usage counter (lifts the per-session call cap). */
    resetByokUsage() {
        saveByokUsage(this.session, null);
        this.store.setState((s) => ({ byok: { ...s.byok, usage: { calls: 0, inputTokens: 0, outputTokens: 0 } } }));
    }
    /**
     * The provider's own model list, loaded with the key set for it (cached per
     * provider and key for this page). Rejects when no key is set or the call fails.
     */
    async listByokModels(provider, signal) {
        const key = this.keyFor(provider);
        if (!key)
            throw new ProviderError('auth', `No ${BYOK_CATALOG[provider].label} key is set.`);
        const cacheKey = `${provider}:${key.slice(-8)}`;
        const hit = this.modelLists.get(cacheKey);
        if (hit)
            return hit;
        const list = await listProviderModels(provider, key, this.fetchImpl, signal);
        if (this.modelLists.size >= 8)
            this.modelLists.clear();
        this.modelLists.set(cacheKey, list);
        return list;
    }
    /** The key set for `provider` in this browser (only for building a direct provider). */
    keyFor(provider) {
        return this.byokKeys[provider] ?? null;
    }
    /** The provider a key-based send uses: the chosen one when it has a key, else the last key set. */
    byokProviderFor(prefs) {
        if (this.keyFor(prefs.byokProvider))
            return prefs.byokProvider;
        const last = this.store.getState().byok.provider;
        return last && this.keyFor(last) ? last : null;
    }
    /** Download and start an on-device model (explicit opt-in). */
    async loadWebLlm(model) {
        if (!WEBLLM_MODELS.some((m) => m.id === model))
            return;
        const st = this.store.getState().webllm;
        if (st.state === 'loading' || (st.state === 'ready' && st.model === model))
            return;
        const support = await (this.deps.webGpu ?? (async () => (await import('./webllm')).webGpuSupport()))();
        if (!support.ok) {
            this.store.setState({ webllm: { state: 'unsupported', progress: 0, detail: support.reason, model: null } });
            return;
        }
        this.store.setState({ webllm: { state: 'loading', progress: 0, detail: 'Starting…', model } });
        try {
            const load = this.deps.loadEngine ?? (async (m, p) => (await import('./webllm')).loadWebLlmEngine(m, p));
            this.engine = await load(model, (progress, text) => this.store.setState({ webllm: { state: 'loading', progress, detail: text, model } }));
            this.store.setState({ webllm: { state: 'ready', progress: 1, detail: 'Ready', model } });
        }
        catch (err) {
            this.engine = null;
            this.store.setState({ webllm: { state: 'error', progress: 0, detail: (err instanceof Error ? err.message : 'failed to load').slice(0, 200), model: null } });
        }
    }
    /** Resolve preferences to a concrete connection (no network). */
    resolve(prefs) {
        const s = this.store.getState();
        const local = () => {
            const choice = effectiveBridgeChoice(prefs, s.local.backends);
            const id = choice.backend;
            const label = `${BACKEND_LABEL[id]} on this computer${choice.model ? ` · ${choice.model}` : ''}`;
            if (s.local.state === 'off')
                return { kind: 'local', label, ready: false, reason: 'local AI needs the Aether server running on this computer', vision: false };
            if (s.local.state === 'checking')
                return { kind: 'local', label, ready: false, reason: 'still checking local AI', vision: false };
            if (s.local.state === 'error')
                return { kind: 'local', label, ready: false, reason: s.local.detail || 'local AI is not responding', vision: false };
            const status = s.local.backends.find((b) => b.id === id);
            if (!status?.loggedIn)
                return { kind: 'local', label, ready: false, reason: `${BACKEND_LABEL[id]} is not signed in on this computer`, vision: false };
            const vision = status.models.find((m) => m.id === choice.model)?.vision ?? true;
            return { kind: 'local', label, ready: true, vision, worker: true };
        };
        const bridge = () => {
            const choice = effectiveBridgeChoice(prefs, s.bridge.backends);
            const id = choice.backend;
            const model = choice.model;
            const label = `${BACKEND_LABEL[id]}${model ? ` · ${model}` : ''}`;
            if (!s.bridge.paired)
                return { kind: 'bridge', label, ready: false, reason: 'the local bridge is not paired', vision: false };
            if (s.bridge.state === 'offline')
                return { kind: 'bridge', label, ready: false, reason: 'the local bridge is not running (start it with npx aether start --origin <this site>)', vision: false };
            if (s.bridge.state === 'not_logged_in')
                return { kind: 'bridge', label, ready: false, reason: `${BACKEND_LABEL[id]} is not signed in on this computer`, vision: false };
            const vision = s.bridge.backends.find((b) => b.id === id)?.models.find((m) => m.id === model)?.vision ?? true;
            return { kind: 'bridge', label, ready: true, vision };
        };
        const byok = (strict) => {
            // Explicit mode uses exactly the chosen provider; 'auto' may use any key that is set.
            const provider = strict ? prefs.byokProvider : (this.byokProviderFor(prefs) ?? prefs.byokProvider);
            const model = byokModelFor(provider, prefs.byokModels[provider]);
            const label = `Your key · ${BYOK_CATALOG[provider].label} · ${model}`;
            if (!this.keyFor(provider))
                return { kind: 'byok', label, ready: false, reason: `no ${BYOK_CATALOG[provider].label} API key is set in this browser`, vision: false };
            if (s.byok.usage.calls >= BYOK_SESSION_CALL_CAP)
                return { kind: 'byok', label, ready: false, reason: `this session used its ${BYOK_SESSION_CALL_CAP} model calls with your key (reset the counter in Settings → AI connection)`, vision: false };
            return { kind: 'byok', label, ready: true, vision: true };
        };
        switch (prefs.mode) {
            case 'offline':
                return { kind: 'offline', label: 'Offline planner', ready: true, vision: false };
            case 'server':
                return s.server.state === 'live'
                    ? { kind: 'server', label: s.server.providers[0] ?? 'Server model', ready: true, vision: true }
                    : { kind: 'server', label: 'Server model', ready: false, reason: 'this server has no model configured', vision: false };
            case 'bridge':
                return bridge();
            case 'local':
                return local();
            case 'webllm': {
                const m = WEBLLM_MODELS.find((x) => x.id === prefs.webllmModel);
                const label = `On-device · ${m?.label ?? prefs.webllmModel}`;
                if (s.webllm.state === 'ready' && s.webllm.model === prefs.webllmModel && this.engine)
                    return { kind: 'webllm', label, ready: true, vision: false };
                return { kind: 'webllm', label, ready: false, reason: s.webllm.state === 'unsupported' ? s.webllm.detail : 'the on-device model is not downloaded yet (Settings → AI connection)', vision: false };
            }
            case 'byok':
                return byok(true);
            case 'auto': {
                // Local AI first (Codex, then Claude Code, unless the user picked a backend that is signed in).
                const l = local();
                if (l.ready)
                    return l;
                const b = bridge();
                if (b.ready)
                    return b;
                if (s.server.state === 'live')
                    return { kind: 'server', label: s.server.providers[0] ?? 'Server model', ready: true, vision: true };
                const k = byok(false);
                if (k.ready)
                    return k;
                if (s.webllm.state === 'ready' && this.engine) {
                    const m = WEBLLM_MODELS.find((x) => x.id === s.webllm.model);
                    return { kind: 'webllm', label: `On-device · ${m?.label ?? s.webllm.model ?? ''}`, ready: true, vision: false };
                }
                return { kind: 'offline', label: 'Offline planner', ready: true, vision: false };
            }
        }
    }
    /** Build the primary provider for `prefs` (null for the offline planner or when unusable). */
    createProvider(prefs, resolved = this.resolve(prefs)) {
        if (!resolved.ready)
            return null;
        const s = this.store.getState();
        switch (resolved.kind) {
            case 'offline':
                return null;
            case 'server':
                return createHttpProvider({ endpoint: API.llm, fetch: this.fetchImpl, name: 'server' });
            case 'local': {
                const { backend, model, effort } = effectiveBridgeChoice(prefs, s.local.backends);
                return createLocalProvider({ backend, effort, fetch: this.fetchImpl, ...(model ? { model } : {}) });
            }
            case 'bridge': {
                if (!this.token)
                    return null;
                const { backend, model, effort } = effectiveBridgeChoice(prefs, s.bridge.backends);
                return createBridgeProvider({ baseUrl: s.bridge.url, token: this.token, backend, effort, fetch: this.fetchImpl, ...(model ? { model } : {}) });
            }
            case 'webllm':
                return this.engine ? createWebLlmProvider({ engine: this.engine, model: s.webllm.model ?? prefs.webllmModel }) : null;
            case 'byok': {
                const provider = prefs.mode === 'byok' ? prefs.byokProvider : this.byokProviderFor(prefs);
                const key = provider ? this.keyFor(provider) : null;
                if (!provider || !key)
                    return null;
                const direct = createDirectProvider(provider, key, byokModelFor(provider, prefs.byokModels[provider]), this.fetchImpl);
                return meteredProvider(direct, {
                    read: () => this.store.getState().byok.usage,
                    write: (usage) => {
                        saveByokUsage(this.session, usage);
                        this.store.setState((st) => ({ byok: { ...st.byok, usage } }));
                    },
                });
            }
        }
    }
    /**
     * The user's other signed-in assistants behind the same door as `resolved`
     * (local AI or the bridge): when the chosen one fails, a run tries these
     * before the offline planner. Each uses its own default model.
     */
    alternates(prefs, resolved) {
        if (!resolved.ready || (resolved.kind !== 'local' && resolved.kind !== 'bridge'))
            return [];
        const s = this.store.getState();
        const backends = resolved.kind === 'local' ? s.local.backends : s.bridge.backends;
        const chosen = effectiveBridgeChoice(prefs, backends).backend;
        const out = [];
        for (const b of backends) {
            if (b.id === chosen || !b.installed || !b.loggedIn)
                continue;
            const model = b.defaultModel ?? b.models[0]?.id;
            const efforts = b.models.find((m) => m.id === model)?.efforts;
            const effort = efforts && efforts.length > 0 ? (efforts.includes(prefs.effort) ? prefs.effort : efforts.includes('low') ? 'low' : (efforts[0] ?? prefs.effort)) : prefs.effort;
            const vision = b.models.find((m) => m.id === model)?.vision ?? true;
            if (resolved.kind === 'local') {
                out.push({ resolved: { kind: 'local', label: `${BACKEND_LABEL[b.id]} on this computer${model ? ` · ${model}` : ''}`, ready: true, vision, worker: true }, provider: createLocalProvider({ backend: b.id, effort, fetch: this.fetchImpl, ...(model ? { model } : {}) }) });
            }
            else if (this.token) {
                out.push({ resolved: { kind: 'bridge', label: `${BACKEND_LABEL[b.id]}${model ? ` · ${model}` : ''}`, ready: true, vision }, provider: createBridgeProvider({ baseUrl: s.bridge.url, token: this.token, backend: b.id, effort, fetch: this.fetchImpl, ...(model ? { model } : {}) }) });
            }
        }
        return out;
    }
    /** The offline planner. */
    offline() {
        return createMockProvider({ library: GENERATOR_LIBRARY });
    }
}
/** Session key of a project's resumable conversations (`p-<id>`), or null for an invalid id. */
export function projectSessionKey(projectId) {
    if (!projectId)
        return null;
    const key = `p-${projectId.toLowerCase()}`;
    return /^[a-z0-9][a-z0-9-]{7,79}$/.test(key) ? key : null;
}
/** Observable key state (never the keys themselves). */
function byokState(keys, remembered, usage) {
    const providers = Object.keys(keys).filter((p) => isByokProvider(p) && typeof keys[p] === 'string');
    return { provider: providers[providers.length - 1] ?? null, providers, remembered, usage };
}
let shared = null;
/** The page-wide connection manager (created on first use). */
export function aiConnection() {
    shared ??= new AiConnection({ session: browserSession(), device: deviceStorage() });
    return shared;
}
