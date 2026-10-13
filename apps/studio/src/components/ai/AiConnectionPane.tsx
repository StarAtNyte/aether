/**
 * Settings → AI connection: every way to drive the agent, with live status
 * badges and guided setup. Nothing here costs the site owner anything: the
 * offline planner runs in the browser, the bridge uses the visitor's own
 * Codex / Claude Code subscription, the on-device model runs on their GPU,
 * and a personal API key is billed to its owner.
 */
import { memo, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { aiConnection, DEFAULT_BRIDGE_URL, effectiveBridgeChoice } from '../../ai/connection';
import { hostedBridgeNote, isLocalOrigin } from '../../ai/messages';
import { MAX_REFINE, WEBLLM_MODELS, type AiMode, type AiPrefs } from '../../ai/prefs';
import { bridgeBadge, useAi } from '../../ai/useAi';
import { Icon } from '../Icon';
import { Segmented } from '../ui/Segmented';

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
  const command = local ? 'npm run bridge' : `npm run bridge -- --origin ${origin}`;
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
          <ul className="backend-list">
            {bridge.backends.map((b) => (
              <li key={b.id} className="backend-list__row">
                <Badge text={b.loggedIn ? 'Ready' : b.installed ? 'Not signed in' : 'Not installed'} tone={b.loggedIn ? 'ok' : 'warn'} />
                <span className="backend-list__name">{b.label}</span>
                <span className="backend-list__detail">{b.detail}</span>
              </li>
            ))}
          </ul>
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
            <strong>Bridge offline:</strong> keep the terminal with <code>npm run bridge</code> open; it listens on 127.0.0.1 only.
          </li>
          <li>
            <strong>Hosted page cannot connect:</strong> Safari blocks HTTPS pages from reaching local services; use Chrome, Edge or Firefox, or run the studio locally. Chrome may first ask to allow access to your local network.
          </li>
          <li>
            <strong>Not signed in:</strong> run <code>codex login</code> (ChatGPT account) or start <code>claude</code> once and sign in.
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

const ByokSetup = memo(function ByokSetup({ prefs, update }: { prefs: AiPrefs; update: (p: Partial<AiPrefs>) => void }): ReactElement {
  const byok = useAi((s) => s.byok);
  const serverByok = useAi((s) => s.server.byok);
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="byok-setup">
      <p className="setup-note">Optional. Your key stays in this tab only (session storage) and is sent per request to the provider through this site&apos;s server, never saved or logged. Usage is billed to your account.</p>
      {!serverByok && <p className="setup-error">This server does not accept personal keys.</p>}
      <div className="setting-row">
        <span className="setting-row__text">
          <span className="setting-row__label">Provider</span>
        </span>
        <Segmented<'anthropic' | 'openai'>
          label="Key provider"
          value={prefs.byokProvider}
          onChange={(v) => update({ byokProvider: v })}
          options={[
            ['anthropic', 'Anthropic'],
            ['openai', 'OpenAI'],
          ]}
        />
      </div>
      {byok && byok.provider === prefs.byokProvider ? (
        <div className="bridge-status">
          <Badge text="Key set for this tab" tone="ok" />
          <span className="spacer" />
          <button type="button" className="btn btn--sm" onClick={() => aiConnection().clearByok()}>
            Forget key
          </button>
        </div>
      ) : (
        <form
          className="pair-form"
          onSubmit={(e) => {
            e.preventDefault();
            const err = aiConnection().setByok(prefs.byokProvider, key);
            setError(err);
            if (!err) setKey('');
          }}
        >
          <input className="input input--sm input--mono" type="password" autoComplete="off" aria-label="API key" placeholder="API key" value={key} maxLength={300} onChange={(e) => setKey(e.target.value)} />
          <button type="submit" className="btn btn--sm btn--primary" disabled={key.trim().length < 20}>
            Use key
          </button>
        </form>
      )}
      {error && <p className="setup-error" role="alert">{error}</p>}
    </div>
  );
});

/** The AI connection settings pane. */
export const AiConnectionPane = memo(function AiConnectionPane({ prefs, update, repairs, setRepairs }: { prefs: AiPrefs; update: (p: Partial<AiPrefs>) => void; repairs?: number; setRepairs?: (n: number) => void }): ReactElement {
  const bridge = useAi((s) => s.bridge);
  const server = useAi((s) => s.server);
  const webllm = useAi((s) => s.webllm);
  const byok = useAi((s) => s.byok);
  useEffect(() => {
    void aiConnection().refresh();
  }, []);
  const b = bridgeBadge(bridge.state);
  return (
    <div className="settings__pane ai-pane">
      <section className="settings__group">
        <h3 className="settings__heading">Connection</h3>
        <div className="ai-modes" role="radiogroup" aria-label="AI connection">
          <ModeCard mode="auto" prefs={prefs} update={update} title="Automatic" hint="Uses your local bridge when it is paired and signed in, otherwise the offline planner." badge={<Badge text="Recommended" tone="quiet" />} />
          <ModeCard mode="offline" prefs={prefs} update={update} title="Offline planner" hint="Always available, instant, runs in your browser. Best for the built-in themes and common objects." badge={<Badge text="Available" tone="ok" />} />
          <ModeCard mode="bridge" prefs={prefs} update={update} title="Local bridge · Codex or Claude Code" hint="Open-ended prompts with the model from your own ChatGPT or Claude subscription, through a small service on your computer." badge={<Badge text={b.text} tone={b.tone} />}>
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
          <ModeCard mode="byok" prefs={prefs} update={update} title="Your own API key" hint="Optional: use your own Anthropic or OpenAI key." badge={<Badge text={byok ? 'Key set' : 'Optional'} tone={byok ? 'ok' : 'quiet'} />}>
            <ByokSetup prefs={prefs} update={update} />
          </ModeCard>
          {server.state === 'live' && <ModeCard mode="server" prefs={prefs} update={update} title="Server model" hint={`The model configured on this server (${server.providers.join(', ')}).`} badge={<Badge text="Connected" tone="ok" />} />}
        </div>
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
