/**
 * AI connection manager (one per page): probes the Aether server and the
 * local bridge, holds the bridge pairing and the optional BYO key (session
 * only), loads the on-device model on request, and resolves the user's
 * preferences into a concrete provider — or explains why it cannot, so the
 * studio falls back to the offline planner with a visible notice.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  createBridgeProvider,
  createHttpProvider,
  createMockProvider,
  createWebLlmProvider,
  fetchBridgeStatus,
  pairBridge,
  ProviderError,
  type BridgeBackendStatus,
  type BridgeStatus,
  type Provider,
  type WebLlmEngineLike,
} from '@aether/agent';
import { API, HEALTH_TIMEOUT_MS } from '../config';
import { bridgeModel, WEBLLM_MODELS, type AiPrefs } from './prefs';
import { browserSession, loadBridgeSession, loadByokSession, saveBridgeSession, saveByokSession, BYOK_KEY_RE, type SessionStore } from './session';

/** Default bridge address. */
export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8790';

/** Bridge connection states (shown as badges). */
export type BridgeState = 'unpaired' | 'checking' | 'ready' | 'not_logged_in' | 'offline' | 'error';

/** Observable connection state. */
export interface AiConnectionState {
  bridge: { url: string; paired: boolean; state: BridgeState; detail: string; backends: BridgeBackendStatus[] };
  server: { state: 'checking' | 'live' | 'mock' | 'offline'; providers: string[]; byok: boolean };
  webllm: { state: 'idle' | 'unsupported' | 'loading' | 'ready' | 'error'; progress: number; detail: string; model: string | null };
  byok: { provider: 'anthropic' | 'openai' } | null;
}

/** What a send will use. */
export interface ResolvedConnection {
  kind: 'offline' | 'server' | 'bridge' | 'webllm' | 'byok';
  /** Short label for badges, e.g. "Codex · gpt-6.1-sol". */
  label: string;
  /** False when the chosen connection is known to be unusable right now. */
  ready: boolean;
  /** Why it is not ready (shown in the fallback notice). */
  reason?: string;
  /** Whether the vision critic can see rendered views through it. */
  vision: boolean;
}

/** Collaborators (injectable for tests). */
export interface AiConnectionDeps {
  fetch?: typeof fetch;
  session?: SessionStore | null;
  loadEngine?: (model: string, onProgress: (p: number, text: string) => void) => Promise<WebLlmEngineLike>;
  webGpu?: () => Promise<{ ok: boolean; reason: string }>;
}

/** Parse an untrusted `/api/health` body. */
export function parseServerHealth(body: unknown): AiConnectionState['server'] {
  if (typeof body !== 'object' || body === null) return { state: 'offline', providers: [], byok: false };
  const b = body as Record<string, unknown>;
  const providers = Array.isArray(b['providers']) ? b['providers'].filter((p): p is string => typeof p === 'string').slice(0, 8).map((p) => p.slice(0, 40)) : [];
  return { state: b['ok'] === true && b['mode'] === 'live' ? 'live' : 'mock', providers, byok: b['byok'] === true };
}

const BACKEND_LABEL: Record<'codex' | 'claude-code', string> = { codex: 'Codex', 'claude-code': 'Claude Code' };

/** The page's AI connection manager. */
export class AiConnection {
  readonly store: StoreApi<AiConnectionState>;
  private readonly fetchImpl: typeof fetch;
  private readonly session: SessionStore | null;
  private token: string | null = null;
  private byokKey: string | null = null;
  private engine: WebLlmEngineLike | null = null;
  private refreshing: Promise<void> | null = null;

  constructor(private readonly deps: AiConnectionDeps = {}) {
    this.fetchImpl = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.session = deps.session ?? null;
    const bridge = loadBridgeSession(this.session);
    const byok = loadByokSession(this.session);
    this.token = bridge?.token ?? null;
    this.byokKey = byok?.key ?? null;
    this.store = createStore<AiConnectionState>()(() => ({
      bridge: { url: bridge?.url ?? DEFAULT_BRIDGE_URL, paired: bridge !== null, state: bridge ? 'checking' : 'unpaired', detail: '', backends: [] },
      server: { state: 'checking', providers: [], byok: false },
      webllm: { state: 'idle', progress: 0, detail: '', model: null },
      byok: byok ? { provider: byok.provider } : null,
    }));
  }

  /** Probe the server and (when paired) the bridge. Never throws. */
  async refresh(): Promise<void> {
    this.refreshing ??= Promise.all([this.probeServer(), this.refreshBridge()])
      .then(() => undefined)
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  /** Probe `/api/health`. */
  async probeServer(): Promise<void> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(API.health, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      this.store.setState({ server: res.ok ? parseServerHealth(await res.json()) : { state: 'offline', providers: [], byok: false } });
    } catch {
      this.store.setState({ server: { state: 'offline', providers: [], byok: false } });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Re-read the bridge status (login state, models). */
  async refreshBridge(): Promise<void> {
    const cur = this.store.getState().bridge;
    if (!this.token) {
      this.setBridge({ paired: false, state: 'unpaired', detail: '', backends: [] });
      return;
    }
    this.setBridge({ state: cur.state === 'ready' ? 'ready' : 'checking' });
    try {
      const status = await fetchBridgeStatus(cur.url, this.token, this.fetchImpl);
      this.applyStatus(status);
    } catch (err) {
      const reason = err instanceof ProviderError ? err.reason : undefined;
      if (reason === 'unauthorized') {
        // The bridge restarted (tokens are in memory only): pairing is needed again.
        this.forgetPairing('The bridge restarted or the pairing expired. Pair again with the code it prints.');
        return;
      }
      this.setBridge({ state: reason === 'bridge_offline' || reason === 'timeout' ? 'offline' : 'error', detail: err instanceof Error ? err.message.slice(0, 200) : 'bridge error' });
    }
  }

  private applyStatus(status: BridgeStatus): void {
    const backends = status.backends;
    const ready = backends.some((b) => b.installed && b.loggedIn);
    const detail = ready ? backends.filter((b) => b.loggedIn).map((b) => b.label).join(' and ') + ' ready' : backends.map((b) => `${b.label}: ${b.detail}`).join(' · ');
    this.setBridge({ paired: true, state: ready ? 'ready' : 'not_logged_in', detail: detail.slice(0, 240), backends });
  }

  private setBridge(patch: Partial<AiConnectionState['bridge']>): void {
    this.store.setState((s) => ({ bridge: { ...s.bridge, ...patch } }));
  }

  private forgetPairing(detail: string): void {
    this.token = null;
    saveBridgeSession(this.session, null);
    this.setBridge({ paired: false, state: 'unpaired', detail, backends: [] });
  }

  /** Pair with a running bridge using the code it printed. Resolves to an error message or null. */
  async pair(url: string, code: string): Promise<string | null> {
    this.setBridge({ url, state: 'checking', detail: '' });
    try {
      const token = await pairBridge(url, code, this.fetchImpl);
      this.adoptPairing({ url, token });
      await this.refreshBridge();
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'pairing failed';
      this.setBridge({ state: this.token ? 'ready' : 'unpaired', detail: msg.slice(0, 200) });
      return msg;
    }
  }

  /** Use a pairing from a deep link (already validated). */
  adoptPairing(p: { url: string; token: string }): void {
    this.token = p.token;
    saveBridgeSession(this.session, p);
    this.setBridge({ url: p.url, paired: true, state: 'checking' });
  }

  /** Forget the bridge pairing. */
  unpair(): void {
    this.forgetPairing('');
  }

  /** Store a BYO key for this session. Resolves to an error message or null. */
  setByok(provider: 'anthropic' | 'openai', key: string): string | null {
    const k = key.trim();
    if (!BYOK_KEY_RE.test(k)) return 'That does not look like an API key.';
    this.byokKey = k;
    saveByokSession(this.session, { provider, key: k });
    this.store.setState({ byok: { provider } });
    return null;
  }

  /** Forget the BYO key. */
  clearByok(): void {
    this.byokKey = null;
    saveByokSession(this.session, null);
    this.store.setState({ byok: null });
  }

  /** Download and start an on-device model (explicit opt-in). */
  async loadWebLlm(model: string): Promise<void> {
    if (!WEBLLM_MODELS.some((m) => m.id === model)) return;
    const st = this.store.getState().webllm;
    if (st.state === 'loading' || (st.state === 'ready' && st.model === model)) return;
    const support = await (this.deps.webGpu ?? (async () => (await import('./webllm')).webGpuSupport()))();
    if (!support.ok) {
      this.store.setState({ webllm: { state: 'unsupported', progress: 0, detail: support.reason, model: null } });
      return;
    }
    this.store.setState({ webllm: { state: 'loading', progress: 0, detail: 'Starting…', model } });
    try {
      const load = this.deps.loadEngine ?? (async (m: string, p: (x: number, t: string) => void) => (await import('./webllm')).loadWebLlmEngine(m, p));
      this.engine = await load(model, (progress, text) => this.store.setState({ webllm: { state: 'loading', progress, detail: text, model } }));
      this.store.setState({ webllm: { state: 'ready', progress: 1, detail: 'Ready', model } });
    } catch (err) {
      this.engine = null;
      this.store.setState({ webllm: { state: 'error', progress: 0, detail: (err instanceof Error ? err.message : 'failed to load').slice(0, 200), model: null } });
    }
  }

  /** Resolve preferences to a concrete connection (no network). */
  resolve(prefs: AiPrefs): ResolvedConnection {
    const s = this.store.getState();
    const bridgeBackend = (): BridgeBackendStatus | undefined => {
      const ready = s.bridge.backends.filter((b) => b.installed && b.loggedIn);
      return ready.find((b) => b.id === prefs.backend) ?? ready[0];
    };
    const bridge = (): ResolvedConnection => {
      const b = bridgeBackend();
      const id = b?.id ?? prefs.backend;
      const model = id === prefs.backend ? bridgeModel(prefs) : b?.defaultModel;
      const label = `${BACKEND_LABEL[id]}${model ? ` · ${model}` : ''}`;
      if (!s.bridge.paired) return { kind: 'bridge', label, ready: false, reason: 'the local bridge is not paired', vision: false };
      if (s.bridge.state === 'offline') return { kind: 'bridge', label, ready: false, reason: 'the local bridge is not running (start it with npm run bridge)', vision: false };
      if (s.bridge.state === 'not_logged_in') return { kind: 'bridge', label, ready: false, reason: `${BACKEND_LABEL[id]} is not signed in on this computer`, vision: false };
      const vision = b?.models.find((m) => m.id === model)?.vision ?? true;
      return { kind: 'bridge', label, ready: true, vision };
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
      case 'webllm': {
        const m = WEBLLM_MODELS.find((x) => x.id === prefs.webllmModel);
        const label = `On-device · ${m?.label ?? prefs.webllmModel}`;
        if (s.webllm.state === 'ready' && s.webllm.model === prefs.webllmModel && this.engine) return { kind: 'webllm', label, ready: true, vision: false };
        return { kind: 'webllm', label, ready: false, reason: s.webllm.state === 'unsupported' ? s.webllm.detail : 'the on-device model is not downloaded yet (Settings → AI connection)', vision: false };
      }
      case 'byok': {
        const label = `Your key · ${prefs.byokProvider === 'anthropic' ? 'Anthropic' : 'OpenAI'}`;
        if (!this.byokKey || s.byok?.provider !== prefs.byokProvider) return { kind: 'byok', label, ready: false, reason: 'no API key is set for this session', vision: false };
        if (!s.server.byok) return { kind: 'byok', label, ready: false, reason: 'this server does not accept personal keys', vision: false };
        return { kind: 'byok', label, ready: true, vision: true };
      }
      case 'auto': {
        const b = bridge();
        if (b.ready) return b;
        if (s.server.state === 'live') return { kind: 'server', label: s.server.providers[0] ?? 'Server model', ready: true, vision: true };
        return { kind: 'offline', label: 'Offline planner', ready: true, vision: false };
      }
    }
  }

  /** Build the primary provider for `prefs` (null for the offline planner or when unusable). */
  createProvider(prefs: AiPrefs, resolved: ResolvedConnection = this.resolve(prefs)): Provider | null {
    if (!resolved.ready) return null;
    const s = this.store.getState();
    switch (resolved.kind) {
      case 'offline':
        return null;
      case 'server':
        return createHttpProvider({ endpoint: API.llm, fetch: this.fetchImpl, name: 'server' });
      case 'bridge': {
        if (!this.token) return null;
        const ready = s.bridge.backends.filter((b) => b.installed && b.loggedIn);
        const backend = (ready.find((b) => b.id === prefs.backend) ?? ready[0])?.id ?? prefs.backend;
        const model = backend === prefs.backend ? bridgeModel(prefs) : undefined;
        return createBridgeProvider({ baseUrl: s.bridge.url, token: this.token, backend, effort: prefs.effort, fetch: this.fetchImpl, ...(model ? { model } : {}) });
      }
      case 'webllm':
        return this.engine ? createWebLlmProvider({ engine: this.engine, model: prefs.webllmModel }) : null;
      case 'byok':
        return this.byokKey
          ? createHttpProvider({ endpoint: `${API.llm}/byok`, fetch: this.fetchImpl, name: prefs.byokProvider, retry: { maxRetries: 0 }, headers: { 'x-aether-provider': prefs.byokProvider, 'x-aether-key': this.byokKey } })
          : null;
    }
  }

  /** The offline planner. */
  offline(): Provider {
    return createMockProvider();
  }
}

let shared: AiConnection | null = null;

/** The page-wide connection manager (created on first use). */
export function aiConnection(): AiConnection {
  shared ??= new AiConnection({ session: browserSession() });
  return shared;
}
