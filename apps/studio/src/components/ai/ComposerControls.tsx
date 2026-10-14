/**
 * Prompt composer controls (under the input): connection + model picker
 * with reasoning effort, and the refinement / repair budget. Selections are
 * remembered per project; the status dot shows whether the chosen
 * connection is usable right now.
 */
import { memo, useEffect, useMemo, type ReactElement } from 'react';
import { useStudio, useUI } from '../../app/context';
import { aiConnection, effectiveBridgeChoice } from '../../ai/connection';
import { BYOK_CATALOG } from '../../ai/byokCatalog';
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
  const local = useAi((s) => s.local);
  // Keep the bridge status fresh while the editor is open (focus + every minute while visible).
  useEffect(() => {
    const ai = aiConnection();
    const refresh = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (ai.store.getState().bridge.paired) void ai.refreshBridge();
      if (ai.store.getState().server.local) void ai.refreshLocal();
    };
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener('focus', refresh);
      clearInterval(timer);
    };
  }, []);
  const resolved = useMemo(() => studio.ai.resolve(prefs), [studio, prefs, bridge, server, webllm, byok, local]);
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
  ];
  // 1–2: Codex / Claude Code on this computer (local AI workers).
  const localChoice = effectiveBridgeChoice(prefs, local.backends);
  if (local.state !== 'off') {
    for (const backend of ['codex', 'claude-code'] as const) {
      const b = local.backends.find((x) => x.id === backend);
      const note = local.state === 'checking' ? 'checking' : !b ? '' : b.loggedIn ? '' : b.installed ? 'not signed in' : 'not installed';
      items.push({ kind: 'heading', id: `h-local-${backend}`, label: `${backend === 'codex' ? 'Codex' : 'Claude Code'} on this computer${note ? ` — ${note}` : ''}` });
      for (const m of b && b.models.length > 0 ? b.models : models(backend)) {
        const current = prefs.mode === 'local' && localChoice.backend === backend && localChoice.model === m.id;
        items.push({ id: `local:${backend}:${m.id}`, label: m.label, checked: current, onSelect: () => set({ mode: 'local', backend, ...(backend === 'codex' ? { codexModel: m.id } : { claudeModel: m.id }) }) });
      }
    }
  }
  const choice = effectiveBridgeChoice(prefs, bridge.backends);
  // 3: through the bridge.
  for (const backend of ['codex', 'claude-code'] as const) {
    const note = backendState(backend);
    if (!bridge.paired && local.state !== 'off') continue;
    items.push({ kind: 'heading', id: `h-${backend}`, label: `${backend === 'codex' ? 'Codex' : 'Claude Code'} via bridge${note ? ` — ${note}` : ''}` });
    for (const m of models(backend)) {
      const current = prefs.mode === 'bridge' && choice.backend === backend && choice.model === m.id;
      items.push({ id: `${backend}:${m.id}`, label: m.label, checked: current, onSelect: () => set({ mode: 'bridge', backend, ...(backend === 'codex' ? { codexModel: m.id } : { claudeModel: m.id }) }) });
    }
  }
  if (server.state === 'live') items.push({ id: 'server', label: `Server · ${server.providers[0] ?? 'model'}`, checked: prefs.mode === 'server', onSelect: () => set({ mode: 'server' }) });
  if (webllm.state === 'ready' || prefs.mode === 'webllm') {
    items.push({ kind: 'heading', id: 'h-webllm', label: 'On-device (experimental)' });
    for (const m of WEBLLM_MODELS) items.push({ id: `webllm:${m.id}`, label: m.label, checked: prefs.mode === 'webllm' && prefs.webllmModel === m.id, onSelect: () => set({ mode: 'webllm', webllmModel: m.id }) });
  }
  items.push({ id: 'offline', label: 'Offline planner', checked: prefs.mode === 'offline', onSelect: () => set({ mode: 'offline' }) });
  if (byok.providers.length > 0 || prefs.mode === 'byok') items.push({ id: 'byok', label: `Your API key · ${BYOK_CATALOG[prefs.byokProvider].label}`, checked: prefs.mode === 'byok', onSelect: () => set({ mode: 'byok' }) });
  const active = resolved.kind === 'local' ? localChoice : choice;
  if (resolved.kind === 'bridge' || resolved.kind === 'local' || prefs.mode === 'bridge' || prefs.mode === 'local') {
    items.push({ kind: 'heading', id: 'h-effort', label: 'Reasoning effort' });
    for (const e of ['low', 'medium', 'high'] as const) items.push({ id: `effort:${e}`, label: e === 'low' ? 'Low (fastest)' : e === 'medium' ? 'Medium' : 'High', checked: active.effort === e, onSelect: () => set({ effort: e }) });
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
        <button {...t} type="button" className="composer__select composer__model" data-tip={tip} data-testid="model-picker" data-ai-kind={resolved.kind} data-ai-status={resolved.ready ? 'ready' : 'unavailable'} data-bridge-state={bridge.state}>
          <span className={`status-dot${dot}`} aria-hidden="true" />
          <span className="composer__model-label">{resolved.ready ? resolved.label : prefs.mode === 'auto' ? 'Offline planner' : resolved.label}</span>
          {(resolved.kind === 'bridge' || resolved.kind === 'local') && resolved.ready && <span className="composer__effort">{active.effort}</span>}
          <Icon name="chevronDown" className="composer__chev" />
        </button>
      )}
    />
  );
});

/** Deep build toggle (shown while a local worker is connected), with the per-asset budget. */
export const DeepBuildToggle = memo(function DeepBuildToggle(): ReactElement | null {
  const studio = useStudio();
  const prefs = useUI((s) => s.aiPrefs);
  const local = useAi((s) => s.local);
  const bridge = useAi((s) => s.bridge);
  const server = useAi((s) => s.server);
  const resolved = useMemo(() => studio.ai.resolve(prefs), [studio, prefs, local, bridge, server]);
  if (resolved.kind !== 'local' || !resolved.ready || !resolved.worker) return null;
  const minutes = Math.min(20, 3 + prefs.deepTurns * 2);
  const items: MenuEntry[] = [
    { kind: 'heading', id: 'h-deep', label: 'Deep build (new assets)' },
    { id: 'deep-on', label: 'On: a coding agent writes, renders and checks', checked: prefs.deep, onSelect: () => studio.store.getState().setAiPrefs({ deep: true }) },
    { id: 'deep-off', label: 'Off: quick single answer', checked: !prefs.deep, onSelect: () => studio.store.getState().setAiPrefs({ deep: false }) },
    { kind: 'heading', id: 'h-budget', label: 'Budget per asset' },
    ...[1, 2, 3, 4, 6].map((n): MenuEntry => ({ id: `turns${n}`, label: `${n} round${n === 1 ? '' : 's'} · ≤ ${Math.min(20, 3 + n * 2)} min`, checked: prefs.deepTurns === n, onSelect: () => studio.store.getState().setAiPrefs({ deepTurns: n, deep: true }) })),
  ];
  return (
    <Menu
      label="Deep build"
      items={items}
      width={280}
      trigger={(t) => (
        <button {...t} type="button" className={`composer__select${prefs.deep ? ' is-on' : ''}`} data-tip={prefs.deep ? `Deep build on: up to ${prefs.deepTurns} rounds, ${minutes} min per new asset` : 'Deep build off'} data-testid="deep-build" aria-pressed={prefs.deep}>
          <Icon name="code" />
          <span>{prefs.deep ? `Deep ×${prefs.deepTurns}` : 'Quick'}</span>
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
