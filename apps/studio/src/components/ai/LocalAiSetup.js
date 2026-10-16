import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Local AI setup (Settings → AI connection): sign in to Codex ("Sign in with
 * ChatGPT") or Claude Code with the CLIs' own flows, manage several Codex
 * accounts, and choose the deep-build budget. The same sign-in panel serves
 * the paired bridge. Aether never sees the credentials: the CLI on this
 * computer stores its own login; only the verification link and one-time
 * code it prints are shown here.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { aiConnection, effectiveBridgeChoice } from '../../ai/connection';
import { useAi } from '../../ai/useAi';
import { Icon } from '../Icon';
import { Segmented } from '../ui/Segmented';
import { Switch } from '../fields';
const LABEL = { codex: 'Codex', 'claude-code': 'Claude Code' };
const POLL_MS = 2000;
function errorText(e) {
    return (e instanceof Error ? e.message : 'Something went wrong.').slice(0, 200);
}
/** A running (or finished) sign-in: link + one-time code, cancel. */
function LoginProgress({ login, onCancel }) {
    return (_jsx("div", { className: "login-flow", "data-testid": "login-flow", role: "status", children: login.running ? (_jsxs(_Fragment, { children: [_jsx("p", { className: "setup-note", children: login.backend === 'codex'
                        ? 'Open the link, sign in with your ChatGPT account and enter the code below.'
                        : 'A browser window opens on this computer to sign in to Claude. If it does not, open the link.' }), login.url && (_jsxs("a", { className: "btn btn--sm btn--primary", href: login.url, target: "_blank", rel: "noopener noreferrer", children: [_jsx(Icon, { name: "external" }), " Open sign-in page"] })), login.code && (_jsxs("span", { className: "login-flow__code", children: ["Code ", _jsx("code", { className: "inline-code", children: login.code })] })), !login.url && !login.code && _jsx("span", { className: "setup-note", children: "Starting sign-in\u2026" }), _jsx("button", { type: "button", className: "btn btn--sm", onClick: onCancel, children: "Cancel" })] })) : (login.finished && _jsx("p", { className: login.finished.ok ? 'setup-note' : 'setup-error', children: login.finished.message })) }));
}
/** Sign-in state polling for one account API (local AI or the bridge). */
function useSignIn(api, onDone) {
    const [login, setLogin] = useState(null);
    const [error, setError] = useState(null);
    const done = useRef(onDone);
    done.current = onDone;
    useEffect(() => {
        if (!api || !login?.running)
            return;
        let alive = true;
        const t = setInterval(() => {
            void api.loginStatus().then((s) => {
                if (!alive)
                    return;
                setLogin(s);
                if (s && !s.running)
                    done.current();
            }, () => undefined);
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
            if (!api)
                return;
            setError(null);
            void api.login(b).then(setLogin, (e) => setError(errorText(e)));
        },
        cancel: () => {
            if (!api)
                return;
            void api.cancelLogin().then(setLogin, (e) => setError(errorText(e)));
        },
        signOut: (b, accountId) => {
            if (!api)
                return;
            setError(null);
            void api.logout(b, accountId).then((r) => {
                if (!r.ok)
                    setError(r.message);
                done.current();
            }, (e) => setError(errorText(e)));
        },
    };
}
/** Backend rows with sign-in / sign-out buttons. */
export const SignInRows = memo(function SignInRows({ backends, api, onChanged, testId }) {
    const s = useSignIn(api, onChanged);
    return (_jsxs(_Fragment, { children: [_jsx("ul", { className: "backend-list", "data-testid": testId, children: backends.map((b) => (_jsxs("li", { className: "backend-list__row", children: [_jsx("span", { className: `status-chip${b.loggedIn ? ' is-ok' : ' is-warn'}`, children: b.loggedIn ? 'Ready' : b.installed ? 'Not signed in' : 'Not installed' }), _jsx("span", { className: "backend-list__name", children: b.label }), _jsx("span", { className: "backend-list__detail", children: b.loggedIn ? (b.account ?? b.detail) : b.detail }), b.installed && api && !s.login?.running && (_jsx("button", { type: "button", className: `btn btn--sm${b.loggedIn ? '' : ' btn--primary'}`, "data-testid": `${testId}-${b.id}`, onClick: () => (b.loggedIn ? s.signOut(b.id) : s.start(b.id)), children: b.loggedIn ? 'Sign out' : b.id === 'codex' ? 'Sign in with ChatGPT' : 'Sign in to Claude' }))] }, b.id))) }), s.login && _jsx(LoginProgress, { login: s.login, onCancel: s.cancel }), s.error && (_jsx("p", { className: "setup-error", role: "alert", children: s.error }))] }));
});
/** Several Codex accounts: add (device sign-in), switch, remove. */
const CodexAccounts = memo(function CodexAccounts() {
    const api = aiConnection().localApi;
    const [list, setList] = useState(null);
    const [label, setLabel] = useState('');
    const [error, setError] = useState(null);
    const reload = useCallback(() => {
        void api.accounts().then(setList, (e) => setError(errorText(e)));
        void aiConnection().refreshLocal();
    }, [api]);
    const s = useSignIn(api, reload);
    useEffect(reload, [reload]);
    const act = (p) => {
        setError(null);
        void p.then((l) => {
            setList(l);
            void aiConnection().refreshLocal();
        }, (e) => setError(errorText(e)));
    };
    return (_jsxs("details", { className: "accounts", children: [_jsxs("summary", { children: ["Codex accounts", list ? ` (${list.items.length})` : ''] }), _jsx("ul", { className: "backend-list", "data-testid": "codex-accounts", children: (list?.items ?? []).map((a) => (_jsxs("li", { className: "backend-list__row", children: [_jsx("span", { className: `status-chip${a.signedIn ? ' is-ok' : ' is-warn'}`, children: a.active ? 'In use' : a.signedIn ? 'Signed in' : 'Not signed in' }), _jsx("span", { className: "backend-list__name", children: a.id === 'default' ? 'This computer’s login' : a.label }), _jsx("span", { className: "backend-list__detail", children: a.detail }), !a.active && a.signedIn && (_jsx("button", { type: "button", className: "btn btn--sm", disabled: (list?.jobs ?? 0) > 0, title: (list?.jobs ?? 0) > 0 ? 'Wait for running builds to finish' : undefined, onClick: () => act(api.activateAccount(a.id)), children: "Use" })), a.id !== 'default' && !a.active && (_jsx("button", { type: "button", className: "icon-btn icon-btn--sm", "aria-label": `Remove ${a.label}`, onClick: () => act(api.removeAccount(a.id)), children: _jsx(Icon, { name: "trash" }) }))] }, a.id))) }), !s.login?.running && (_jsxs("form", { className: "pair-form", onSubmit: (e) => {
                    e.preventDefault();
                    setError(null);
                    void api.addAccount(label.trim()).then((l) => {
                        s.track(l);
                        setLabel('');
                        reload();
                    }, (err) => setError(errorText(err)));
                }, children: [_jsx("input", { className: "input input--sm", "aria-label": "Account name", placeholder: "Account name (e.g. Work)", value: label, maxLength: 80, onChange: (e) => setLabel(e.target.value) }), _jsx("button", { type: "submit", className: "btn btn--sm", disabled: label.trim().length === 0, children: "Add Codex account" })] })), s.login && _jsx(LoginProgress, { login: s.login, onCancel: s.cancel }), (error ?? s.error) && (_jsx("p", { className: "setup-error", role: "alert", children: error ?? s.error })), _jsx("p", { className: "setup-note", children: "Switching is manual and waits for running builds. Each account keeps its own Codex login on this computer; Aether never reads it." })] }));
});
/** Model + effort + deep build controls shared by local AI. */
const LocalModelRows = memo(function LocalModelRows({ prefs, update }) {
    const local = useAi((s) => s.local);
    const choice = effectiveBridgeChoice(prefs, local.backends);
    const models = local.backends.find((b) => b.id === choice.backend)?.models ?? [];
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "setting-row", children: [_jsx("span", { className: "setting-row__text", children: _jsx("span", { className: "setting-row__label", children: "Agent" }) }), _jsx(Segmented, { label: "Local agent", value: prefs.backend, onChange: (v) => update({ backend: v }), options: [
                            ['codex', 'Codex'],
                            ['claude-code', 'Claude Code'],
                        ] })] }), models.length > 0 && (_jsxs("div", { className: "setting-row", children: [_jsx("span", { className: "setting-row__text", children: _jsx("span", { className: "setting-row__label", children: "Model" }) }), _jsx("select", { className: "select select--sm", "aria-label": "Local model", value: choice.model ?? '', onChange: (e) => update(choice.backend === 'codex' ? { codexModel: e.target.value, backend: 'codex' } : { claudeModel: e.target.value, backend: 'claude-code' }), children: models.map((m) => (_jsx("option", { value: m.id, children: m.label }, m.id))) })] })), _jsxs("div", { className: "setting-row", children: [_jsx("span", { className: "setting-row__text", children: _jsx("span", { className: "setting-row__label", children: "Reasoning effort" }) }), _jsx(Segmented, { label: "Local reasoning effort", value: choice.effort, onChange: (v) => update({ effort: v }), options: [
                            ['low', 'Low'],
                            ['medium', 'Medium'],
                            ['high', 'High'],
                        ] })] }), _jsxs("div", { className: "setting-row", children: [_jsxs("span", { className: "setting-row__text", children: [_jsx("span", { className: "setting-row__label", children: "Deep build" }), _jsx("span", { className: "setting-row__hint", children: "New assets are written by a coding agent that renders, checks and fixes its work in a private scratch folder. Small edits stay quick." })] }), _jsx("span", { "data-testid": "deep-build-toggle", children: _jsx(Switch, { label: "Deep build", checked: prefs.deep, onChange: (v) => update({ deep: v }) }) })] }), prefs.deep && (_jsxs("div", { className: "setting-row", children: [_jsxs("span", { className: "setting-row__text", children: [_jsx("span", { className: "setting-row__label", children: "Deep build budget" }), _jsxs("span", { className: "setting-row__hint", children: ["Rounds of write \u2192 check \u2192 fix per asset (about ", Math.min(20, 3 + prefs.deepTurns * 2), " minutes at most)."] })] }), _jsx(Segmented, { label: "Deep build rounds", value: String(prefs.deepTurns), onChange: (v) => update({ deepTurns: Number(v) }), options: [
                            ['1', '1'],
                            ['2', '2'],
                            ['3', '3'],
                            ['4', '4'],
                            ['6', '6'],
                        ] })] }))] }));
});
/** Local AI card body. */
export const LocalAiSetup = memo(function LocalAiSetup({ prefs, update }) {
    const local = useAi((s) => s.local);
    const refresh = useCallback(() => void aiConnection().refreshLocal(), []);
    if (local.state === 'off') {
        return (_jsxs("div", { className: "local-setup", children: [_jsx("p", { className: "setup-note", children: "Runs Codex or Claude Code on this computer with the login you already have. Start Aether locally with one command (in the Aether folder):" }), _jsx("code", { className: "inline-code", children: "npx aether start --open" }), _jsxs("p", { className: "setup-note", children: ["Hosted copies of the studio never use anyone else's subscription: there, use your own key, or pair with your computer through the local bridge (add ", _jsxs("code", { className: "inline-code", children: ["--origin ", typeof location !== 'undefined' ? location.origin : 'https://your-studio'] }), " to the command above)."] })] }));
    }
    return (_jsxs("div", { className: "local-setup", "data-testid": "local-setup", children: [_jsxs("div", { className: "bridge-status", children: [_jsx("span", { className: "bridge-status__url", children: local.account ? `Codex account: ${local.account.label}` : 'This computer' }), local.jobs > 0 && _jsxs("span", { className: "status-chip", children: [local.jobs, " build", local.jobs === 1 ? '' : 's', " running"] }), _jsx("span", { className: "spacer" }), _jsxs("button", { type: "button", className: "btn btn--sm", onClick: refresh, children: [_jsx(Icon, { name: "refresh" }), " Refresh"] })] }), _jsx(SignInRows, { backends: local.backends, api: aiConnection().localApi, onChanged: refresh, testId: "local-signin" }), _jsx(LocalModelRows, { prefs: prefs, update: update }), _jsx(CodexAccounts, {}), local.state === 'error' && _jsx("p", { className: "setup-error", children: local.detail })] }));
});
/** Sign-in rows for the paired bridge. */
export const BridgeSignIn = memo(function BridgeSignIn() {
    const bridge = useAi((s) => s.bridge);
    const api = bridge.paired ? aiConnection().bridgeAccounts() : null;
    if (!api)
        return null;
    return _jsx(SignInRows, { backends: bridge.backends, api: api, onChanged: () => void aiConnection().refreshBridge(), testId: "bridge-signin" });
});
