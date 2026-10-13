/**
 * Prompt composer controls (under the input): connection + model picker
 * with reasoning effort, and the refinement / repair budget. Selections are
 * remembered per project; the status dot shows whether the chosen
 * connection is usable right now.
 */
import { memo, useEffect, useMemo, type ReactElement } from 'react';
import { useStudio, useUI } from '../../app/context';
import { aiConnection } from '../../ai/connection';
import { MAX_REFINE, WEBLLM_MODELS, type AiPrefs } from '../../ai/prefs';
import { useAi } from '../../ai/useAi';
import { Icon } from '../Icon';
import { Menu, type MenuEntry } from '../ui/Menu';

/** Codex models offered before the bridge reports its catalog. */
const CODEX_DEFAULTS = [
  { id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol' },
  { id: 'gpt-6-luna', label: 'GPT-6-Luna' },
  { id: 'gpt-6-astra', label: 'GPT-6-Astra' },
];
const CLAUDE_DEFAULTS = [
  { id: 'haiku', label: 'Haiku (fastest)' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
  { id: 'fable', label: 'Fable (most capable)' },
];

/** Connection + model + effort picker. */
export const ModelPicker = memo(function ModelPicker(): ReactElement {
  const studio = useStudio();
  const prefs = useUI((s) => s.aiPrefs);
  const bridge = useAi((s) => s.bridge);
  const server = useAi((s) => s.server);
  const webllm = useAi((s) => s.webllm);
  const byok = useAi((s) => s.byok);
  // Keep the bridge status fresh while the editor is open (focus + every minute while visible).
  useEffect(() => {
    const ai = aiConnection();
    const refresh = (): void => {
      if (document.visibilityState === 'visible' && ai.store.getState().bridge.paired) void ai.refreshBridge();
    };
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener('focus', refresh);
      clearInterval(timer);
    };
  }, []);
  const resolved = useMemo(() => studio.ai.resolve(prefs), [studio, prefs, bridge, server, webllm, byok]);
  const set = (p: Partial<AiPrefs>): void => studio.store.getState().setAiPrefs(p);
  const models = (id: 'codex' | 'claude-code'): Array<{ id: string; label: string }> => {
    const b = bridge.backends.find((x) => x.id === id);
    return b && b.models.length > 0 ? b.models : id === 'codex' ? CODEX_DEFAULTS : CLAUDE_DEFAULTS;
  };
  const backendState = (id: 'codex' | 'claude-code'): string => {
    if (!bridge.paired) return 'not paired';
    const b = bridge.backends.find((x) => x.id === id);
    if (bridge.state === 'offline') return 'bridge offline';
    if (!b) return '';
    return b.loggedIn ? '' : b.installed ? 'not signed in' : 'not installed';
  };
  const items: MenuEntry[] = [
    { kind: 'heading', id: 'h-conn', label: 'Connection' },
    { id: 'auto', label: 'Automatic', checked: prefs.mode === 'auto', onSelect: () => set({ mode: 'auto' }) },
    { id: 'offline', label: 'Offline planner', checked: prefs.mode === 'offline', onSelect: () => set({ mode: 'offline' }) },
  ];
  if (server.state === 'live') items.push({ id: 'server', label: `Server · ${server.providers[0] ?? 'model'}`, checked: prefs.mode === 'server', onSelect: () => set({ mode: 'server' }) });
  for (const backend of ['codex', 'claude-code'] as const) {
    const note = backendState(backend);
    items.push({ kind: 'heading', id: `h-${backend}`, label: `${backend === 'codex' ? 'Codex' : 'Claude Code'}${note ? ` — ${note}` : ''}` });
    for (const m of models(backend)) {
      const current = prefs.mode === 'bridge' && prefs.backend === backend && (backend === 'codex' ? prefs.codexModel : prefs.claudeModel) === m.id;
      items.push({ id: `${backend}:${m.id}`, label: m.label, checked: current, onSelect: () => set({ mode: 'bridge', backend, ...(backend === 'codex' ? { codexModel: m.id } : { claudeModel: m.id }) }) });
    }
  }
  if (webllm.state === 'ready' || prefs.mode === 'webllm') {
    items.push({ kind: 'heading', id: 'h-webllm', label: 'On-device (experimental)' });
    for (const m of WEBLLM_MODELS) items.push({ id: `webllm:${m.id}`, label: m.label, checked: prefs.mode === 'webllm' && prefs.webllmModel === m.id, onSelect: () => set({ mode: 'webllm', webllmModel: m.id }) });
  }
  if (byok || prefs.mode === 'byok') items.push({ id: 'byok', label: `Your API key · ${prefs.byokProvider === 'anthropic' ? 'Anthropic' : 'OpenAI'}`, checked: prefs.mode === 'byok', onSelect: () => set({ mode: 'byok' }) });
  if (resolved.kind === 'bridge' || prefs.mode === 'bridge') {
    items.push({ kind: 'heading', id: 'h-effort', label: 'Reasoning effort' });
    for (const e of ['low', 'medium', 'high'] as const) items.push({ id: `effort:${e}`, label: e === 'low' ? 'Low (fastest)' : e === 'medium' ? 'Medium' : 'High', checked: prefs.effort === e, onSelect: () => set({ effort: e }) });
  }
  items.push({ kind: 'separator', id: 'sep' }, { id: 'setup', label: 'Set up connections…', icon: 'settings', onSelect: () => studio.store.getState().openSettings('ai') });

  const dot = resolved.kind === 'offline' ? '' : resolved.ready ? ' is-live' : ' is-warn';
  const tip = resolved.ready ? (resolved.kind === 'offline' ? 'Offline planner: runs in your browser' : `Using ${resolved.label}`) : `${resolved.label}: ${resolved.reason ?? 'unavailable'} — the offline planner will be used`;
  return (
    <Menu
      label="Connection and model"
      width={260}
      items={items}
      trigger={(t) => (
        <button {...t} type="button" className="composer__select composer__model" data-tip={tip} data-testid="model-picker">
          <span className={`status-dot${dot}`} aria-hidden="true" />
          <span className="composer__model-label">{resolved.ready ? resolved.label : prefs.mode === 'auto' ? 'Offline planner' : resolved.label}</span>
          {prefs.mode === 'bridge' && resolved.ready && <span className="composer__effort">{prefs.effort}</span>}
          <Icon name="chevronDown" className="composer__chev" />
        </button>
      )}
    />
  );
});

/** Refinement rounds + automatic repair rounds. */
export const RefineMenu = memo(function RefineMenu(): ReactElement {
  const studio = useStudio();
  const refine = useUI((s) => s.aiPrefs.refine);
  const repairs = useUI((s) => s.settings.repairs);
  const items: MenuEntry[] = [
    { kind: 'heading', id: 'h-refine', label: 'Quality refinement' },
    ...Array.from({ length: MAX_REFINE + 1 }, (_, n): MenuEntry => ({ id: `refine${n}`, label: n === 0 ? 'Review only' : `Refine up to ${n}×`, checked: refine === n, onSelect: () => studio.store.getState().setAiPrefs({ refine: n }) })),
    { kind: 'heading', id: 'h-repair', label: 'Physics repairs' },
    ...[0, 1, 2, 3].map((n): MenuEntry => ({ id: `r${n}`, label: n === 0 ? 'No repairs' : `Repair up to ${n}×`, checked: repairs === n, onSelect: () => studio.store.getState().updateSettings({ repairs: n }) })),
  ];
  return (
    <Menu
      label="Refinement and repairs"
      items={items}
      trigger={(t) => (
        <button {...t} type="button" className="composer__select" data-tip="Quality refinement rounds and physics repairs" data-testid="refine-menu">
          <Icon name="wand" />
          <span>{refine === 0 ? 'Review' : `Refine ×${refine}`}</span>
          <Icon name="chevronDown" className="composer__chev" />
        </button>
      )}
    />
  );
});
