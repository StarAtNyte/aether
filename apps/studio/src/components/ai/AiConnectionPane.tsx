/**
 * Settings → AI connection: every way to drive the agent, with live status
 * badges and guided setup. Nothing here costs the site owner anything: the
 * offline planner runs in the browser, the bridge uses the visitor's own
 * Codex / Claude Code subscription, the on-device model runs on their GPU,
 * and a personal API key is billed to its owner.
 */
import { lazy, memo, Suspense, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { aiConnection, DEFAULT_BRIDGE_URL, effectiveBridgeChoice } from '../../ai/connection';
import { hostedBridgeNote, isLocalOrigin } from '../../ai/messages';
import { byokModelFor } from '../../ai/byok';
import { BYOK_CATALOG, BYOK_PROVIDERS, BYOK_SESSION_CALL_CAP, isByokProvider, type ByokModel, type ByokProvider } from '../../ai/byokCatalog';
import { MAX_REFINE, WEBLLM_MODELS, type AiMode, type AiPrefs } from '../../ai/prefs';
import { Toggle } from '../fields';
import { bridgeBadge, localBadge, useAi } from '../../ai/useAi';
import { Icon } from '../Icon';
import { Segmented } from '../ui/Segmented';
import { BridgeSignIn, LocalAiSetup } from './LocalAiSetup';

// Blender (local only) loads on its own chunk: nothing of it reaches pages that never open these settings.
const BlenderSettings = lazy(async () => ({ default: (await import('../../blender/BlenderSettings')).BlenderSettings }));

/** Copy-to-clipboard command line. */
function Command({ text }: { text: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <span className="cmd">
      <code className="cmd__text">{text}</code>
      <button
        type="button"
        className="icon-btn icon-btn--sm"
        aria-label={`Copy ${text}`}
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            },
            () => undefined,
          );
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} />
      </button>
    </span>
  );
}

function Badge({ text, tone }: { text: string; tone: 'ok' | 'warn' | 'bad' | 'quiet' }): ReactElement {
  return <span className={`status-chip${tone === 'quiet' ? '' : ` is-${tone}`}`}>{text}</span>;
}

/** One selectable connection card. */
function ModeCard({ mode, prefs, update, title, hint, badge, children }: { mode: AiMode; prefs: AiPrefs; update: (p: Partial<AiPrefs>) => void; title: string; hint: string; badge?: ReactNode; children?: ReactNode }): ReactElement {
  const selected = prefs.mode === mode;
  return (
    <div className={`ai-mode${selected ? ' is-selected' : ''}`} data-mode={mode}>
      <label className="ai-mode__head">
        <input type="radio" name="ai-mode" className="ai-mode__radio" checked={selected} onChange={() => update({ mode })} />
        <span className="ai-mode__text">
          <span className="ai-mode__title">
            {title} {badge}
          </span>
          <span className="ai-mode__hint">{hint}</span>
        </span>
      </label>
      {selected && children && <div className="ai-mode__body">{children}</div>}
    </div>
  );
}

const BridgeSetup = memo(function BridgeSetup({ prefs, update }: { prefs: AiPrefs; update: (p: Partial<AiPrefs>) => void }): ReactElement {
  const bridge = useAi((s) => s.bridge);
  const [url, setUrl] = useState(bridge.url || DEFAULT_BRIDGE_URL);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const origin = typeof location !== 'undefined' ? location.origin : '';
  const local = isLocalOrigin(origin);
  const browserNote = hostedBridgeNote(origin, typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const choice = effectiveBridgeChoice(prefs, bridge.backends);
  const command = local ? 'npx aether start' : `npx aether start --origin ${origin}`;
  const backend = bridge.backends.find((b) => b.id === prefs.backend);
  const models = backend?.models ?? [];
  const pair = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const err = await aiConnection().pair(url, code);
    setBusy(false);
    if (err) setError(err);
    else setCode('');
  };
  return (
    <div className="bridge-setup">
      {!bridge.paired ? (
        <ol className="setup-steps">
          <li>
            <span className="setup-steps__text">On this computer, in the Aether folder, start the bridge (uses the Codex or Claude Code login you already have):</span>
            <Command text={command} />
          </li>
          <li>
            <span className="setup-steps__text">Enter the pairing code it prints (or open the link it prints).</span>
            <form
              className="pair-form"
              onSubmit={(e) => {
                e.preventDefault();
                void pair();
              }}
            >
              <input className="input input--sm input--mono pair-form__url" aria-label="Bridge address" value={url} maxLength={200} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
              <input className="input input--sm input--mono pair-form__code" aria-label="Pairing code" placeholder="ABCD-EFGH" value={code} maxLength={9} onChange={(e) => setCode(e.target.value.toUpperCase())} spellCheck={false} autoComplete="off" />
              <button type="submit" className="btn btn--sm btn--primary" disabled={busy || code.replace('-', '').length !== 8}>
                {busy ? 'Pairing…' : 'Pair'}
              </button>
            </form>
            {error && <p className="setup-error" role="alert">{error}</p>}
          </li>
        </ol>
      ) : (
        <>
          <div className="bridge-status">
            <span className="bridge-status__url">{bridge.url}</span>
            <span className="spacer" />
            <button type="button" className="btn btn--sm" onClick={() => void aiConnection().refreshBridge()}>
              <Icon name="refresh" /> Refresh
            </button>
            <button type="button" className="btn btn--sm" onClick={() => aiConnection().unpair()}>
              Unpair
            </button>
          </div>
          <BridgeSignIn />
          <div className="setting-row">
            <span className="setting-row__text">
              <span className="setting-row__label">Agent</span>
            </span>
            <Segmented<'codex' | 'claude-code'>
              label="Bridge agent"
              value={prefs.backend}
              onChange={(v) => update({ backend: v })}
              options={[
                ['codex', 'Codex'],
                ['claude-code', 'Claude Code'],
              ]}
            />
          </div>
          {models.length > 0 && (
            <div className="setting-row">
              <span className="setting-row__text">
                <span className="setting-row__label">Model</span>
              </span>
              <select
                className="select select--sm"
                aria-label="Model"
                value={choice.backend === prefs.backend && choice.model ? choice.model : prefs.backend === 'codex' ? prefs.codexModel : prefs.claudeModel}
                onChange={(e) => update(prefs.backend === 'codex' ? { codexModel: e.target.value } : { claudeModel: e.target.value })}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="setting-row">
            <span className="setting-row__text">
              <span className="setting-row__label">Reasoning effort</span>
              <span className="setting-row__hint">Low is fastest; higher effort is slower but plans more carefully.</span>
            </span>
            <Segmented<'low' | 'medium' | 'high'>
              label="Reasoning effort"
              value={choice.effort}
              onChange={(v) => update({ effort: v })}
              options={[
                ['low', 'Low'],
                ['medium', 'Medium'],
                ['high', 'High'],
              ]}
            />
          </div>
        </>
      )}
      {browserNote && (
        <p className={`setup-note${browserNote.tone === 'warn' ? ' setup-note--warn' : ''}`} data-testid="bridge-browser-note">
          {browserNote.text}
        </p>
      )}
      {bridge.detail && bridge.state !== 'ready' && <p className="setup-note">{bridge.detail}</p>}
      <details className="troubleshoot">
        <summary>Troubleshooting</summary>
        <ul>
          <li>
            <strong>Bridge offline:</strong> start it with <code>npx aether start --origin &lt;this site&gt;</code> (it runs in the background; <code>npx aether status</code> / <code>npx aether pair</code>). It listens on 127.0.0.1 only.
          </li>
          <li>
            <strong>Hosted page cannot connect:</strong> Safari blocks HTTPS pages from reaching local services; use Chrome, Edge or Firefox, or run the studio locally. Chrome may first ask to allow access to your local network.
          </li>
          <li>
            <strong>Not signed in:</strong> use the sign-in buttons above, or run <code>codex login</code> (ChatGPT account) or <code>claude auth login</code> in a terminal.
          </li>
          <li>
            <strong>Origin not allowed:</strong> when using a hosted copy of the studio, start the bridge with <code>--origin {origin || 'https://your-site'}</code>.
          </li>
          <li>
            <strong>Usage limit reached:</strong> your subscription&apos;s limit applies; switch models or try later. Aether falls back to the offline planner meanwhile.
          </li>
          <li>The bridge runs the CLIs with every tool disabled, read-only, in an empty temporary folder: the model can only return text.</li>
        </ul>
      </details>
    </div>
  );
});

const WebLlmSetup = memo(function WebLlmSetup({ prefs, update }: { prefs: AiPrefs; update: (p: Partial<AiPrefs>) => void }): ReactElement {
  const w = useAi((s) => s.webllm);
  const model = WEBLLM_MODELS.find((m) => m.id === prefs.webllmModel) ?? WEBLLM_MODELS[0];
  return (
    <div className="webllm-setup">
      <p className="setup-note">
        Experimental. Downloads about {(model.downloadMB / 1000).toFixed(1)} GB once (cached by the browser) and runs on your GPU with WebGPU. Small models follow instructions less reliably than the bridge.
      </p>
      <div className="setting-row">
        <span className="setting-row__text">
          <span className="setting-row__label">Model</span>
        </span>
        <select className="select select--sm" aria-label="On-device model" value={prefs.webllmModel} onChange={(e) => update({ webllmModel: e.target.value })}>
          {WEBLLM_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} · {(m.downloadMB / 1000).toFixed(1)} GB · {m.licence}
            </option>
          ))}
        </select>
      </div>
      {w.state === 'loading' ? (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w.progress * 100)} aria-label="Model download">
          <span className="progress__fill" style={{ width: `${Math.round(w.progress * 100)}%` }} />
          <span className="progress__text">{w.detail}</span>
        </div>
      ) : (
        <button type="button" className="btn btn--sm" disabled={w.state === 'ready' && w.model === prefs.webllmModel} onClick={() => void aiConnection().loadWebLlm(prefs.webllmModel)}>
          {w.state === 'ready' && w.model === prefs.webllmModel ? 'Loaded' : 'Download and start'}
        </button>
      )}
      {(w.state === 'unsupported' || w.state === 'error') && (
        <p className="setup-error" role="alert">
          {w.detail}
        </p>
      )}
    </div>
  );
});

/** Compact count (1 234 → "1.2k"). */
function compact(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Model picker for the chosen key provider: the provider's live list once a key is set, else the built-in shortlist. */
function ByokModelPicker({ provider, prefs, update, hasKey }: { provider: ByokProvider; prefs: AiPrefs; update: (p: Partial<AiPrefs>) => void; hasKey: boolean }): ReactElement {
  const [live, setLive] = useState<{ provider: ByokProvider; models: ByokModel[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!hasKey) return;
    const ctrl = new AbortController();
    setError(null);
    aiConnection()
      .listByokModels(provider, ctrl.signal)
      .then(
        (models) => setLive({ provider, models }),
        (err: unknown) => {
          if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message.slice(0, 160) : 'The model list could not be loaded.');
        },
      );
    return () => ctrl.abort();
  }, [provider, hasKey]);
  const current = byokModelFor(provider, prefs.byokModels[provider]);
  const base = live?.provider === provider && live.models.length > 0 ? live.models : BYOK_CATALOG[provider].models;
  const options = base.some((m) => m.id === current) ? base : [{ id: current, label: current }, ...base];
  return (
    <div className="setting-row">
      <span className="setting-row__text">
        <span className="setting-row__label">Model</span>
        {error && <span className="setting-row__hint">{error} Showing the usual models.</span>}
      </span>
      <select className="select select--sm" aria-label="Key model" value={current} onChange={(e) => update({ byokModels: { ...prefs.byokModels, [provider]: e.target.value } })}>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Bring your own API key: provider, key (kept in this browser only), model, usage. */
export const ByokSetup = memo(function ByokSetup({ prefs, update }: { prefs: AiPrefs; update: (p: Partial<AiPrefs>) => void }): ReactElement {
  const byok = useAi((s) => s.byok);
  const [key, setKey] = useState('');
  const [remember, setRemember] = useState(byok.remembered);
  const [error, setError] = useState<string | null>(null);
  const provider = prefs.byokProvider;
  const info = BYOK_CATALOG[provider];
  const hasKey = byok.providers.includes(provider);
  return (
    <div className="byok-setup" data-testid="byok-setup">
      <p className="setup-note">Your key stays in this browser and goes straight to {info.label}; Aether&apos;s server never sees it. Usage is billed to your account.</p>
      <div className="setting-row">
        <span className="setting-row__text">
          <span className="setting-row__label">Provider</span>
        </span>
        <select className="select select--sm" aria-label="Key provider" value={provider} onChange={(e) => isByokProvider(e.target.value) && update({ byokProvider: e.target.value })}>
          {BYOK_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {BYOK_CATALOG[p].label}
              {byok.providers.includes(p) ? ' · key set' : ''}
            </option>
          ))}
        </select>
      </div>
      {hasKey ? (
        <div className="bridge-status">
          <Badge text={byok.remembered ? 'Key saved on this device' : 'Key set for this tab'} tone="ok" />
          <span className="spacer" />
          <button type="button" className="btn btn--sm" onClick={() => aiConnection().clearByok(provider)}>
            Forget key
          </button>
        </div>
      ) : (
        <form
          className="pair-form"
          onSubmit={(e) => {
            e.preventDefault();
            const err = aiConnection().setByok(provider, key, { remember });
            setError(err);
            if (!err) setKey('');
          }}
        >
          <input
            className="input input--sm input--mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={`${info.label} API key`}
            placeholder={info.keyHint}
            value={key}
            maxLength={300}
            onChange={(e) => setKey(e.target.value)}
          />
          <button type="submit" className="btn btn--sm btn--primary" disabled={key.trim().length < 20}>
            Use key
          </button>
        </form>
      )}
      {!hasKey && (
        <p className="setup-note">
          <a href={info.keyPage} target="_blank" rel="noopener noreferrer">
            Get a {info.label} key
          </a>
        </p>
      )}
      {error && (
        <p className="setup-error" role="alert">
          {error}
        </p>
      )}
      <Toggle
        label="Remember on this device"
        hint="Keeps your keys in this browser's local storage after the tab closes. Leave it off on a shared computer."
        checked={hasKey ? byok.remembered : remember}
        onChange={(v) => {
          setRemember(v);
          if (byok.providers.length > 0) aiConnection().setByokRemember(v);
        }}
      />
      <ByokModelPicker provider={provider} prefs={prefs} update={update} hasKey={hasKey} />
      <div className="setting-row" data-testid="byok-usage">
        <span className="setting-row__text">
          <span className="setting-row__label">
            This session: {byok.usage.calls} / {BYOK_SESSION_CALL_CAP} calls
          </span>
          <span className="setting-row__hint">
            About {compact(byok.usage.inputTokens)} tokens in, {compact(byok.usage.outputTokens)} out (estimated; your provider&apos;s dashboard has the exact bill).
          </span>
        </span>
        <button type="button" className="btn btn--sm" disabled={byok.usage.calls === 0} onClick={() => aiConnection().resetByokUsage()}>
          Reset
        </button>
      </div>
    </div>
  );
});

/** The AI connection settings pane. */
export const AiConnectionPane = memo(function AiConnectionPane({ prefs, update, repairs, setRepairs }: { prefs: AiPrefs; update: (p: Partial<AiPrefs>) => void; repairs?: number; setRepairs?: (n: number) => void }): ReactElement {
  const bridge = useAi((s) => s.bridge);
  const server = useAi((s) => s.server);
  const webllm = useAi((s) => s.webllm);
  const byok = useAi((s) => s.byok);
  const local = useAi((s) => s.local);
  useEffect(() => {
    void aiConnection().refresh();
  }, []);
  const b = bridgeBadge(bridge.state);
  const lb = localBadge(local.state);
  return (
    <div className="settings__pane ai-pane">
      <section className="settings__group">
        <h3 className="settings__heading">Connection</h3>
        <div className="ai-modes" role="radiogroup" aria-label="AI connection">
          <ModeCard mode="auto" prefs={prefs} update={update} title="Automatic" hint="Picks the best connection: Codex or Claude Code on this computer, then the local bridge, then your own API key, then an on-device model, then the offline planner." badge={<Badge text="Recommended" tone="quiet" />} />
          <ModeCard mode="local" prefs={prefs} update={update} title="Codex or Claude Code on this computer" hint="Your own ChatGPT or Claude subscription, run by Aether on this computer. Deep builds let a coding agent write, render and check new assets." badge={<Badge text={lb.text} tone={lb.tone} />}>
            <LocalAiSetup prefs={prefs} update={update} />
          </ModeCard>
          <ModeCard mode="bridge" prefs={prefs} update={update} title="Local bridge · Codex or Claude Code" hint="Use your subscription from a hosted copy of the studio, through a small service on your computer." badge={<Badge text={b.text} tone={b.tone} />}>
            <BridgeSetup prefs={prefs} update={update} />
          </ModeCard>
          <ModeCard
            mode="webllm"
            prefs={prefs}
            update={update}
            title="On-device model"
            hint="A small model running in this browser on your GPU. Experimental."
            badge={<Badge text={webllm.state === 'ready' ? 'Loaded' : webllm.state === 'loading' ? 'Downloading' : webllm.state === 'unsupported' ? 'Unsupported' : 'Experimental'} tone={webllm.state === 'ready' ? 'ok' : webllm.state === 'unsupported' ? 'warn' : 'quiet'} />}
          >
            <WebLlmSetup prefs={prefs} update={update} />
          </ModeCard>
          <ModeCard mode="offline" prefs={prefs} update={update} title="Offline planner" hint="Always available, instant, runs in your browser. Best for the built-in themes and common objects." badge={<Badge text="Available" tone="ok" />} />
          <ModeCard mode="byok" prefs={prefs} update={update} title="Your own API key" hint="Anthropic, OpenAI, OpenRouter or Google Gemini, called straight from this browser." badge={<Badge text={byok.providers.length > 0 ? 'Key set' : 'Optional'} tone={byok.providers.length > 0 ? 'ok' : 'quiet'} />}>
            <ByokSetup prefs={prefs} update={update} />
          </ModeCard>
          {server.state === 'live' && <ModeCard mode="server" prefs={prefs} update={update} title="Server model" hint={`The model configured on this server (${server.providers.join(', ')}).`} badge={<Badge text="Connected" tone="ok" />} />}
        </div>
      </section>
      <section className="settings__group">
        <h3 className="settings__heading">Blender</h3>
        <Suspense fallback={null}>
          <BlenderSettings />
        </Suspense>
      </section>
      <section className="settings__group">
        <h3 className="settings__heading">Quality</h3>
        <div className="setting-row">
          <span className="setting-row__text">
            <span className="setting-row__label">Refinement rounds</span>
            <span className="setting-row__hint">After building, Aether renders four views, scores them against a rubric and spends up to this many rounds improving the weakest points.</span>
          </span>
          <Segmented<string>
            label="Refinement rounds"
            value={String(prefs.refine)}
            onChange={(v) => update({ refine: Number(v) })}
            options={Array.from({ length: MAX_REFINE + 1 }, (_, i) => [String(i), i === 0 ? 'Off' : `${i}`] as [string, string])}
          />
        </div>
        <Toggle
          label="Review the plan before building"
          hint="A new world starts with a written plan: what the place needs, with counts and sizes. Turn this on to edit it before the build; off, it carries on by itself and you can still read the plan in the chat."
          checked={prefs.reviewPlan}
          onChange={(v) => update({ reviewPlan: v })}
        />
        <Toggle
          label="No assets"
          hint="Build everything from scratch: shapes and generated code, no library models. Applies to every connection, the offline planner included. The same switch sits next to the prompt."
          checked={prefs.noAssets}
          onChange={(v) => update({ noAssets: v })}
        />
        {repairs !== undefined && setRepairs && (
          <div className="setting-row">
            <span className="setting-row__text">
              <span className="setting-row__label">Automatic repairs</span>
              <span className="setting-row__hint">Rounds the agent may spend fixing a world that fails its physics checks.</span>
            </span>
            <Segmented<string>
              label="Automatic repairs"
              value={String(repairs)}
              onChange={(v) => setRepairs(Number(v))}
              options={[
                ['0', 'Off'],
                ['1', '1'],
                ['2', '2'],
                ['3', '3'],
              ]}
            />
          </div>
        )}
      </section>
    </div>
  );
});
