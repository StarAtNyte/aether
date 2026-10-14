/**
 * Local AI setup (Settings → AI connection): sign in to Codex ("Sign in with
 * ChatGPT") or Claude Code with the CLIs' own flows, manage several Codex
 * accounts, and choose the deep-build budget. The same sign-in panel serves
 * the paired bridge. Aether never sees the credentials: the CLI on this
 * computer stores its own login; only the verification link and one-time
 * code it prints are shown here.
 */
import { memo, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { AccountsList, AiAccountApi, BridgeBackendStatus, LoginState } from '@aether/agent';
import { aiConnection, effectiveBridgeChoice } from '../../ai/connection';
import type { AiPrefs } from '../../ai/prefs';
import { useAi } from '../../ai/useAi';
import { Icon } from '../Icon';
import { Segmented } from '../ui/Segmented';
import { Switch } from '../fields';

const LABEL: Record<'codex' | 'claude-code', string> = { codex: 'Codex', 'claude-code': 'Claude Code' };
const POLL_MS = 2000;

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : 'Something went wrong.').slice(0, 200);
}

/** A running (or finished) sign-in: link + one-time code, cancel. */
function LoginProgress({ login, onCancel }: { login: LoginState; onCancel: () => void }): ReactElement {
  return (
    <div className="login-flow" data-testid="login-flow" role="status">
      {login.running ? (
        <>
          <p className="setup-note">
            {login.backend === 'codex'
              ? 'Open the link, sign in with your ChatGPT account and enter the code below.'
              : 'A browser window opens on this computer to sign in to Claude. If it does not, open the link.'}
          </p>
          {login.url && (
            <a className="btn btn--sm btn--primary" href={login.url} target="_blank" rel="noopener noreferrer">
              <Icon name="external" /> Open sign-in page
            </a>
          )}
          {login.code && (
            <span className="login-flow__code">
              Code <code className="inline-code">{login.code}</code>
            </span>
          )}
          {!login.url && !login.code && <span className="setup-note">Starting sign-in…</span>}
          <button type="button" className="btn btn--sm" onClick={onCancel}>
            Cancel
          </button>
        </>
      ) : (
        login.finished && <p className={login.finished.ok ? 'setup-note' : 'setup-error'}>{login.finished.message}</p>
      )}
    </div>
  );
}

/** Sign-in state polling for one account API (local AI or the bridge). */
function useSignIn(api: AiAccountApi | null, onDone: () => void): { login: LoginState | null; error: string | null; start: (b: 'codex' | 'claude-code') => void; cancel: () => void; signOut: (b: 'codex' | 'claude-code', accountId?: string) => void; track: (l: LoginState) => void } {
  const [login, setLogin] = useState<LoginState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!api || !login?.running) return;
    let alive = true;
    const t = setInterval(() => {
      void api.loginStatus().then(
        (s) => {
          if (!alive) return;
          setLogin(s);
          if (s && !s.running) done.current();
        },
        () => undefined,
      );
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [api, login?.running]);
  return {
    login,
    error,
    track: setLogin,
    start: (b) => {
      if (!api) return;
      setError(null);
      void api.login(b).then(setLogin, (e: unknown) => setError(errorText(e)));
    },
    cancel: () => {
      if (!api) return;
      void api.cancelLogin().then(setLogin, (e: unknown) => setError(errorText(e)));
    },
    signOut: (b, accountId) => {
      if (!api) return;
      setError(null);
      void api.logout(b, accountId).then(
        (r) => {
          if (!r.ok) setError(r.message);
          done.current();
        },
        (e: unknown) => setError(errorText(e)),
      );
    },
  };
}

/** Backend rows with sign-in / sign-out buttons. */
export const SignInRows = memo(function SignInRows({ backends, api, onChanged, testId }: { backends: readonly BridgeBackendStatus[]; api: AiAccountApi | null; onChanged: () => void; testId: string }): ReactElement {
  const s = useSignIn(api, onChanged);
  return (
    <>
      <ul className="backend-list" data-testid={testId}>
        {backends.map((b) => (
          <li key={b.id} className="backend-list__row">
            <span className={`status-chip${b.loggedIn ? ' is-ok' : ' is-warn'}`}>{b.loggedIn ? 'Ready' : b.installed ? 'Not signed in' : 'Not installed'}</span>
            <span className="backend-list__name">{b.label}</span>
            <span className="backend-list__detail">{b.loggedIn ? (b.account ?? b.detail) : b.detail}</span>
            {b.installed && api && !s.login?.running && (
              <button type="button" className={`btn btn--sm${b.loggedIn ? '' : ' btn--primary'}`} data-testid={`${testId}-${b.id}`} onClick={() => (b.loggedIn ? s.signOut(b.id) : s.start(b.id))}>
                {b.loggedIn ? 'Sign out' : b.id === 'codex' ? 'Sign in with ChatGPT' : 'Sign in to Claude'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {s.login && <LoginProgress login={s.login} onCancel={s.cancel} />}
      {s.error && (
        <p className="setup-error" role="alert">
          {s.error}
        </p>
      )}
    </>
  );
});

/** Several Codex accounts: add (device sign-in), switch, remove. */
const CodexAccounts = memo(function CodexAccounts(): ReactElement {
  const api = aiConnection().localApi;
  const [list, setList] = useState<AccountsList | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    void api.accounts().then(setList, (e: unknown) => setError(errorText(e)));
    void aiConnection().refreshLocal();
  }, [api]);
  const s = useSignIn(api, reload);
  useEffect(reload, [reload]);
  const act = (p: Promise<AccountsList>): void => {
    setError(null);
    void p.then(
      (l) => {
        setList(l);
        void aiConnection().refreshLocal();
      },
      (e: unknown) => setError(errorText(e)),
    );
  };
  return (
    <details className="accounts">
      <summary>Codex accounts{list ? ` (${list.items.length})` : ''}</summary>
      <ul className="backend-list" data-testid="codex-accounts">
        {(list?.items ?? []).map((a) => (
          <li key={a.id} className="backend-list__row">
            <span className={`status-chip${a.signedIn ? ' is-ok' : ' is-warn'}`}>{a.active ? 'In use' : a.signedIn ? 'Signed in' : 'Not signed in'}</span>
            <span className="backend-list__name">{a.id === 'default' ? 'This computer’s login' : a.label}</span>
            <span className="backend-list__detail">{a.detail}</span>
            {!a.active && a.signedIn && (
              <button type="button" className="btn btn--sm" disabled={(list?.jobs ?? 0) > 0} title={(list?.jobs ?? 0) > 0 ? 'Wait for running builds to finish' : undefined} onClick={() => act(api.activateAccount(a.id))}>
                Use
              </button>
            )}
            {a.id !== 'default' && !a.active && (
              <button type="button" className="icon-btn icon-btn--sm" aria-label={`Remove ${a.label}`} onClick={() => act(api.removeAccount(a.id))}>
                <Icon name="trash" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!s.login?.running && (
        <form
          className="pair-form"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            void api.addAccount(label.trim()).then(
              (l) => {
                s.track(l);
                setLabel('');
                reload();
              },
              (err: unknown) => setError(errorText(err)),
            );
          }}
        >
          <input className="input input--sm" aria-label="Account name" placeholder="Account name (e.g. Work)" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
          <button type="submit" className="btn btn--sm" disabled={label.trim().length === 0}>
            Add Codex account
          </button>
        </form>
      )}
      {s.login && <LoginProgress login={s.login} onCancel={s.cancel} />}
      {(error ?? s.error) && (
        <p className="setup-error" role="alert">
          {error ?? s.error}
        </p>
      )}
      <p className="setup-note">Switching is manual and waits for running builds. Each account keeps its own Codex login on this computer; Aether never reads it.</p>
    </details>
  );
});

/** Model + effort + deep build controls shared by local AI. */
const LocalModelRows = memo(function LocalModelRows({ prefs, update }: { prefs: AiPrefs; update: (p: Partial<AiPrefs>) => void }): ReactElement {
  const local = useAi((s) => s.local);
  const choice = effectiveBridgeChoice(prefs, local.backends);
  const models = local.backends.find((b) => b.id === choice.backend)?.models ?? [];
  return (
    <>
      <div className="setting-row">
        <span className="setting-row__text">
          <span className="setting-row__label">Agent</span>
        </span>
        <Segmented<'codex' | 'claude-code'>
          label="Local agent"
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
          <select className="select select--sm" aria-label="Local model" value={choice.model ?? ''} onChange={(e) => update(choice.backend === 'codex' ? { codexModel: e.target.value, backend: 'codex' } : { claudeModel: e.target.value, backend: 'claude-code' })}>
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
        </span>
        <Segmented<'low' | 'medium' | 'high'>
          label="Local reasoning effort"
          value={choice.effort}
          onChange={(v) => update({ effort: v })}
          options={[
            ['low', 'Low'],
            ['medium', 'Medium'],
            ['high', 'High'],
          ]}
        />
      </div>
      <div className="setting-row">
        <span className="setting-row__text">
          <span className="setting-row__label">Deep build</span>
          <span className="setting-row__hint">New assets are written by a coding agent that renders, checks and fixes its work in a private scratch folder. Small edits stay quick.</span>
        </span>
        <span data-testid="deep-build-toggle">
          <Switch label="Deep build" checked={prefs.deep} onChange={(v) => update({ deep: v })} />
        </span>
      </div>
      {prefs.deep && (
        <div className="setting-row">
          <span className="setting-row__text">
            <span className="setting-row__label">Deep build budget</span>
            <span className="setting-row__hint">Rounds of write → check → fix per asset (about {Math.min(20, 3 + prefs.deepTurns * 2)} minutes at most).</span>
          </span>
          <Segmented<string>
            label="Deep build rounds"
            value={String(prefs.deepTurns)}
            onChange={(v) => update({ deepTurns: Number(v) })}
            options={[
              ['1', '1'],
              ['2', '2'],
              ['3', '3'],
              ['4', '4'],
              ['6', '6'],
            ]}
          />
        </div>
      )}
    </>
  );
});

/** Local AI card body. */
export const LocalAiSetup = memo(function LocalAiSetup({ prefs, update }: { prefs: AiPrefs; update: (p: Partial<AiPrefs>) => void }): ReactElement {
  const local = useAi((s) => s.local);
  const refresh = useCallback(() => void aiConnection().refreshLocal(), []);
  if (local.state === 'off') {
    return (
      <div className="local-setup">
        <p className="setup-note">Runs Codex or Claude Code on this computer with the login you already have. Start Aether locally with one command (in the Aether folder):</p>
        <code className="inline-code">npx aether start --open</code>
        <p className="setup-note">Hosted copies of the studio never use anyone else&apos;s subscription: there, use your own key, or pair with your computer through the local bridge (add <code className="inline-code">--origin {typeof location !== 'undefined' ? location.origin : 'https://your-studio'}</code> to the command above).</p>
      </div>
    );
  }
  return (
    <div className="local-setup" data-testid="local-setup">
      <div className="bridge-status">
        <span className="bridge-status__url">{local.account ? `Codex account: ${local.account.label}` : 'This computer'}</span>
        {local.jobs > 0 && <span className="status-chip">{local.jobs} build{local.jobs === 1 ? '' : 's'} running</span>}
        <span className="spacer" />
        <button type="button" className="btn btn--sm" onClick={refresh}>
          <Icon name="refresh" /> Refresh
        </button>
      </div>
      <SignInRows backends={local.backends} api={aiConnection().localApi} onChanged={refresh} testId="local-signin" />
      <LocalModelRows prefs={prefs} update={update} />
      <CodexAccounts />
      {local.state === 'error' && <p className="setup-error">{local.detail}</p>}
    </div>
  );
});

/** Sign-in rows for the paired bridge. */
export const BridgeSignIn = memo(function BridgeSignIn(): ReactElement | null {
  const bridge = useAi((s) => s.bridge);
  const api = bridge.paired ? aiConnection().bridgeAccounts() : null;
  if (!api) return null;
  return <SignInRows backends={bridge.backends} api={api} onChanged={() => void aiConnection().refreshBridge()} testId="bridge-signin" />;
});
