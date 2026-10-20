/**
 * The first-run "connect your AI" screen (lazy-loaded; see `firstRun.ts`).
 *
 * Local variant (served by `aether start`):
 *   1. Sign in with ChatGPT (Codex): starts `codex login --device-auth` on
 *      this computer through the local server, shows the verification link
 *      and one-time code (copy button), polls until it completes, then shows
 *      the account and a model picker.
 *   2. Use Claude Code: when the `claude` CLI is installed and signed in.
 *   3. Continue offline.
 * Hosted variant (any other origin):
 *   1. Use your own Codex / ChatGPT login: the one-command install starts the
 *      local bridge; pair this page with it, then sign in (device code) or
 *      pick a signed-in Codex / Claude Code on the user's own computer.
 *   2. Use your API key: provider, key (kept in this browser), link to the
 *      provider's key page.
 *   3. Explore offline.
 *
 * Nothing blocks the app: closing the screen equals "continue offline".
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { normalizeBridgeUrl, type AiAccountApi, type BridgeBackendStatus, type LoginState } from '@aether/agent';
import { aiConnection, DEFAULT_BRIDGE_URL } from '../ai/connection';
import { BYOK_CATALOG, BYOK_PROVIDERS, isByokProvider, type ByokProvider } from '../ai/byokCatalog';
import { loadAiPrefs, saveAiPrefs, type AiPrefs } from '../ai/prefs';
import { useAi } from '../ai/useAi';
import { Icon } from '../components/Icon';
import { Logomark } from '../components/Logo';
import { Dialog } from '../components/ui/Dialog';
import { browserStorage } from '../lib/storage';
import { AI_PREFS_EVENT, finishFirstRun, firstRunStore, OFFLINE_CHOICE_PREFS, useFirstRun, type FirstRunChoice } from './firstRun';

/** Public repository of the app (for the local install instructions). */
export const REPO_URL = 'https://github.com/StarAtNyte/aether';
const POLL_MS = 2000;

/** Save AI preferences globally and hand them to an open editor. */
function applyPrefs(patch: Partial<AiPrefs>): void {
  const storage = browserStorage();
  saveAiPrefs(storage, { ...loadAiPrefs(storage), ...patch });
  try {
    window.dispatchEvent(new CustomEvent(AI_PREFS_EVENT, { detail: patch }));
  } catch {
    /* no window (tests) */
  }
}

function finish(choice: FirstRunChoice, patch?: Partial<AiPrefs>): void {
  if (patch) applyPrefs(patch);
  finishFirstRun(browserStorage(), choice);
}

/** Copy-to-clipboard button. */
function CopyButton({ text, label }: { text: string; label: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn icon-btn--sm"
      aria-label={label}
      data-tip={copied ? 'Copied' : 'Copy'}
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
  );
}

/** A command line with a copy button. */
function Command({ text }: { text: string }): ReactElement {
  return (
    <span className="cmd">
      <code className="cmd__text">{text}</code>
      <CopyButton text={text} label={`Copy ${text}`} />
    </span>
  );
}

/** One option row of the screen. */
function Choice({ testId, title, hint, primary, onClick, disabled, children, icon }: { testId: string; title: string; hint: string; primary?: boolean; onClick: () => void; disabled?: boolean; children?: ReactNode; icon: Parameters<typeof Icon>[0]['name'] }): ReactElement {
  return (
    <div className={`first-run__choice${primary ? ' is-primary' : ''}`}>
      <button type="button" className={`first-run__option${primary ? ' first-run__option--primary' : ''}`} data-testid={testId} onClick={onClick} disabled={disabled}>
        <span className="first-run__icon" aria-hidden="true">
          <Icon name={icon} />
        </span>
        <span className="first-run__text">
          <span className="first-run__title">{title}</span>
          <span className="first-run__hint">{hint}</span>
        </span>
        <Icon name="chevronRight" />
      </button>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local variant
// ---------------------------------------------------------------------------

function backendOf(list: readonly BridgeBackendStatus[], id: 'codex' | 'claude-code'): BridgeBackendStatus | undefined {
  return list.find((b) => b.id === id);
}

/** Where a Codex sign-in runs: this computer's Aether server, or the paired local bridge. */
interface SignInTarget {
  /** Sign-in API (null: not reachable yet). */
  api: AiAccountApi | null;
  /** Re-read the backend status after a sign-in ends. */
  refresh: () => void;
  /** Use Codex with the chosen model (empty: the CLI's default). */
  done: (model: string) => void;
}

/** Codex device sign-in (through the local server, or the paired bridge on a hosted page). */
const CodexSignIn = memo(function CodexSignIn({ codex, target }: { codex: BridgeBackendStatus | undefined; target: SignInTarget }): ReactElement {
  const { api, refresh, done } = target;
  const [login, setLogin] = useState<LoginState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string>('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // Poll while the CLI's sign-in runs; refresh the backend status when it ends.
  useEffect(() => {
    if (!login?.running || !api) return;
    const t = setInterval(() => {
      void api.loginStatus().then(
        (s) => {
          if (!alive.current) return;
          setLogin(s);
          if (s && !s.running) refresh();
        },
        () => undefined,
      );
    }, POLL_MS);
    return () => clearInterval(t);
  }, [api, refresh, login?.running]);
  useEffect(() => {
    if (codex?.loggedIn && !model) setModel(codex.defaultModel ?? codex.models[0]?.id ?? '');
  }, [codex, model]);

  if (!codex?.installed) {
    return (
      <div className="first-run__detail" data-testid="first-run-codex-missing">
        <p className="first-run__note">The Codex CLI is not installed on this computer. Install it, then press Check again:</p>
        <Command text="npm i -g @openai/codex" />
        <button type="button" className="btn btn--sm" onClick={refresh}>
          <Icon name="refresh" /> Check again
        </button>
      </div>
    );
  }
  if (codex.loggedIn) {
    return (
      <div className="first-run__detail" data-testid="first-run-signed-in">
        <p className="first-run__account">
          <span className="status-chip is-ok">Signed in</span> {codex.account ?? 'ChatGPT account'}
        </p>
        {codex.models.length > 0 && (
          <label className="first-run__field">
            <span>Model</span>
            <select className="select select--sm" aria-label="Codex model" value={model} onChange={(e) => setModel(e.target.value)}>
              {codex.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="btn btn--primary" data-testid="first-run-done" onClick={() => done(model)}>
          Start creating
        </button>
      </div>
    );
  }
  const start = (): void => {
    if (!api) return;
    setError(null);
    void api.login('codex').then(setLogin, (e: unknown) => setError((e instanceof Error ? e.message : 'Sign-in could not start.').slice(0, 200)));
  };
  return (
    <div className="first-run__detail" data-testid="first-run-login">
      {!login?.running ? (
        <>
          {login?.finished && !login.finished.ok && <p className="setup-error">{login.finished.message}</p>}
          <button type="button" className="btn btn--primary" onClick={start} disabled={!api} data-testid="first-run-login-start">
            {login ? 'Try again' : 'Get a sign-in code'}
          </button>
        </>
      ) : (
        <>
          <ol className="first-run__steps">
            <li>
              Open{' '}
              {login.url ? (
                <a href={login.url} target="_blank" rel="noopener noreferrer" className="first-run__link">
                  {login.url.replace(/^https:\/\//, '').slice(0, 60)}
                </a>
              ) : (
                'the sign-in page'
              )}{' '}
              and sign in with your ChatGPT account.
            </li>
            <li>
              Enter this one-time code:{' '}
              {login.code ? (
                <span className="first-run__code">
                  <code data-testid="first-run-device-code">{login.code}</code>
                  <CopyButton text={login.code} label="Copy the code" />
                </span>
              ) : (
                <span className="first-run__note">waiting for the code…</span>
              )}
            </li>
          </ol>
          <p className="first-run__status" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" /> Waiting for you to finish signing in…
          </p>
          <button type="button" className="btn btn--sm" onClick={() => void api?.cancelLogin().then(setLogin, () => undefined)}>
            Cancel
          </button>
        </>
      )}
      {error && (
        <p className="setup-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});

const refreshLocal = (): void => void aiConnection().refreshLocal();
const LOCAL_TARGET: SignInTarget = {
  get api() {
    return aiConnection().localApi;
  },
  refresh: refreshLocal,
  done: (model) => finish('codex', { mode: 'auto', backend: 'codex', ...(model ? { codexModel: model } : {}) }),
};

const LocalScreen = memo(function LocalScreen(): ReactElement {
  const local = useAi((s) => s.local);
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    void aiConnection().refresh();
  }, []);
  const codex = backendOf(local.backends, 'codex');
  const claude = backendOf(local.backends, 'claude-code');
  const checking = local.state === 'checking';
  return (
    <div className="first-run__choices">
      <Choice testId="first-run-codex" icon="sparkles" primary title="Sign in with ChatGPT (Codex)" hint="Your own ChatGPT account, through the Codex CLI on this computer. Aether never sees your password or tokens." onClick={() => setExpanded((v) => !v)}>
        {expanded && (checking ? <p className="first-run__note first-run__detail">Checking this computer…</p> : <CodexSignIn codex={codex} target={LOCAL_TARGET} />)}
      </Choice>
      {claude?.installed && claude.loggedIn && (
        <Choice testId="first-run-claude" icon="code" title="Use Claude Code" hint={`Signed in${claude.account ? ` as ${claude.account}` : ''} on this computer.`} onClick={() => finish('claude-code', { mode: 'auto', backend: 'claude-code' })} />
      )}
      <Choice testId="first-run-offline" icon="cube" title="Continue offline" hint="The built-in planner and generator library, in your browser. Sign in any time from the top bar." onClick={() => finish('offline', OFFLINE_CHOICE_PREFS)} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Hosted variant
// ---------------------------------------------------------------------------

const KeyForm = memo(function KeyForm(): ReactElement {
  const [provider, setProvider] = useState<ByokProvider>('anthropic');
  const [key, setKey] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = BYOK_CATALOG[provider];
  const submit = (): void => {
    const err = aiConnection().setByok(provider, key.trim(), { remember });
    if (err) {
      setError(err);
      return;
    }
    setKey('');
    finish('byok', { mode: 'byok', byokProvider: provider });
  };
  return (
    <form
      className="first-run__detail first-run__form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="first-run__field">
        <span>Provider</span>
        <select
          className="select select--sm"
          data-testid="first-run-provider"
          aria-label="API provider"
          value={provider}
          onChange={(e) => {
            if (isByokProvider(e.target.value)) setProvider(e.target.value);
          }}
        >
          {BYOK_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {BYOK_CATALOG[p].label}
            </option>
          ))}
        </select>
      </label>
      <label className="first-run__field">
        <span>API key</span>
        <input className="input input--sm input--mono" data-testid="first-run-key" type="password" autoComplete="off" spellCheck={false} placeholder={info.keyHint} value={key} maxLength={300} onChange={(e) => setKey(e.target.value)} aria-label="API key" />
      </label>
      <a className="first-run__link" href={info.keyPage} target="_blank" rel="noopener noreferrer">
        Get a {info.label} key <Icon name="external" />
      </a>
      <label className="first-run__check">
        <input type="checkbox" data-testid="first-run-remember" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember on this device
      </label>
      <p className="first-run__note">The key stays in this browser ({remember ? 'saved on this device until you remove it' : 'forgotten when you close the tab'}) and goes only to {info.label}. Usage is billed to your account.</p>
      {error && (
        <p className="setup-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn--primary" data-testid="first-run-key-submit" disabled={key.trim().length < 20}>
        Use this key
      </button>
    </form>
  );
});

/** After pairing: sign in to / pick Codex or Claude Code on the user's own computer. */
const BridgeBackends = memo(function BridgeBackends(): ReactElement {
  const bridge = useAi((s) => s.bridge);
  const target = useMemo<SignInTarget>(
    () => ({
      api: bridge.paired ? aiConnection().bridgeAccounts() : null,
      refresh: () => void aiConnection().refreshBridge(),
      done: (model) => finish('bridge', { mode: 'bridge', backend: 'codex', ...(model ? { codexModel: model } : {}) }),
    }),
    // A new pairing (url or token) needs a new client.
    [bridge.paired, bridge.url],
  );
  const codex = backendOf(bridge.backends, 'codex');
  const claude = backendOf(bridge.backends, 'claude-code');
  return (
    <div className="first-run__paired" data-testid="first-run-bridge-paired">
      <p className="first-run__account">
        <span className="status-chip is-ok">Paired</span> {bridge.detail || 'Your computer'}
      </p>
      {bridge.state === 'checking' && bridge.backends.length === 0 ? <p className="first-run__note">Checking your computer…</p> : <CodexSignIn codex={codex} target={target} />}
      {claude?.installed && claude.loggedIn && (
        <button type="button" className="btn btn--sm" data-testid="first-run-bridge-claude" onClick={() => finish('bridge', { mode: 'bridge', backend: 'claude-code' })}>
          <Icon name="code" /> Use Claude Code instead{claude.account ? ` (${claude.account})` : ''}
        </button>
      )}
    </div>
  );
});

/** The local bridge path on a hosted page: one command, then pair (or a deep link from the terminal). */
const RunLocally = memo(function RunLocally(): ReactElement {
  const bridge = useAi((s) => s.bridge);
  const [code, setCode] = useState('');
  const [address, setAddress] = useState(bridge.url || DEFAULT_BRIDGE_URL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const origin = typeof location !== 'undefined' ? location.origin : 'https://your-studio';
  if (bridge.paired && bridge.state !== 'unpaired') return <BridgeBackends />;
  const pair = async (): Promise<void> => {
    const url = normalizeBridgeUrl(address);
    if (!url) {
      setError('The bridge runs on this computer: use http://127.0.0.1:<port> (or localhost).');
      return;
    }
    setBusy(true);
    setError(null);
    const err = await aiConnection().pair(url, code);
    setBusy(false);
    if (err) setError(err);
  };
  return (
    <div className="first-run__detail" data-testid="first-run-local-steps">
      <p className="first-run__note">On your computer (Node.js 22+), one command installs Aether and starts its local bridge. It uses your own Codex / ChatGPT or Claude Code login; nothing runs on our servers:</p>
      <Command text={`git clone ${REPO_URL} && cd aether && npm ci && npx aether start --origin ${origin}`} />
      <p className="first-run__note">Open the pairing link it prints, or enter the pairing code here:</p>
      <form
        className="pair-form"
        onSubmit={(e) => {
          e.preventDefault();
          void pair();
        }}
      >
        <input className="input input--sm input--mono" aria-label="Pairing code" data-testid="first-run-pair-code" placeholder="ABCD-EFGH" value={code} maxLength={9} onChange={(e) => setCode(e.target.value.toUpperCase())} spellCheck={false} autoComplete="off" />
        <button type="submit" className="btn btn--sm btn--primary" data-testid="first-run-pair" disabled={busy || code.replace('-', '').length !== 8}>
          {busy ? 'Pairing…' : 'Pair'}
        </button>
      </form>
      <details className="first-run__more">
        <summary>Bridge address</summary>
        <input className="input input--sm input--mono" aria-label="Bridge address" data-testid="first-run-bridge-url" value={address} maxLength={64} onChange={(e) => setAddress(e.target.value)} spellCheck={false} autoComplete="off" />
      </details>
      {error && (
        <p className="setup-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});

const HostedScreen = memo(function HostedScreen(): ReactElement {
  const paired = useAi((s) => s.bridge.paired);
  const [open, setOpen] = useState<'key' | 'local' | null>(paired ? 'local' : null);
  return (
    <div className="first-run__choices">
      <Choice testId="first-run-local" icon="sparkles" primary title="Use your own Codex / ChatGPT login" hint="Runs on your computer with one command and your own subscription (Claude Code works too). No API key." onClick={() => setOpen((v) => (v === 'local' ? null : 'local'))}>
        {open === 'local' && <RunLocally />}
      </Choice>
      <Choice testId="first-run-byok" icon="lock" title="Use your API key" hint="Anthropic, OpenAI, OpenRouter or Google Gemini. Called straight from this browser; never sent to us." onClick={() => setOpen((v) => (v === 'key' ? null : 'key'))}>
        {open === 'key' && <KeyForm />}
      </Choice>
      <Choice testId="first-run-offline" icon="cube" title="Explore offline" hint="Templates and the built-in planner, right here. Connect an AI any time from the top bar." onClick={() => finish('offline', OFFLINE_CHOICE_PREFS)} />
    </div>
  );
});

/** The first-run screen (rendered by the app root once the probe decided to show it). */
export const FirstRun = memo(function FirstRun(): ReactElement {
  const open = useFirstRun((s) => s.open);
  const variant = useFirstRun((s) => s.variant);
  const close = useCallback(() => {
    // Closing without choosing never blocks the app: remember "offline" (the chip offers sign-in later).
    if (firstRunStore.getState().open) finish('offline');
  }, []);
  const description = useMemo(
    () => (variant === 'local' ? 'Aether runs on this computer. Connect your own AI account to build anything you describe, or start offline.' : 'Describe a world and Aether builds it, then proves it works. Choose how it thinks:'),
    [variant],
  );
  return (
    <Dialog open={open} onClose={close} title="Connect your AI" description={description} size="md" className="first-run">
      <div data-testid="first-run" data-variant={variant} className="first-run__body">
        <span className="first-run__mark" aria-hidden="true">
          <Logomark />
        </span>
        {variant === 'local' ? <LocalScreen /> : <HostedScreen />}
      </div>
    </Dialog>
  );
});
