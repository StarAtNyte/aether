import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeBridgeUrl } from '@aether/agent';
import { aiConnection, DEFAULT_BRIDGE_URL } from '../ai/connection';
import { BYOK_CATALOG, BYOK_PROVIDERS, isByokProvider } from '../ai/byokCatalog';
import { loadAiPrefs, saveAiPrefs } from '../ai/prefs';
import { useAi } from '../ai/useAi';
import { Icon } from '../components/Icon';
import { Logomark } from '../components/Logo';
import { Dialog } from '../components/ui/Dialog';
import { browserStorage } from '../lib/storage';
import { AI_PREFS_EVENT, finishFirstRun, firstRunStore, useFirstRun } from './firstRun';
/** Public repository of the app (for the local install instructions). */
export const REPO_URL = 'https://github.com/StarAtNyte/aether';
const POLL_MS = 2000;
/** Save AI preferences globally and hand them to an open editor. */
function applyPrefs(patch) {
    const storage = browserStorage();
    saveAiPrefs(storage, { ...loadAiPrefs(storage), ...patch });
    try {
        window.dispatchEvent(new CustomEvent(AI_PREFS_EVENT, { detail: patch }));
    }
    catch {
        /* no window (tests) */
    }
}
function finish(choice, patch) {
    if (patch)
        applyPrefs(patch);
    finishFirstRun(browserStorage(), choice);
}
/** Copy-to-clipboard button. */
function CopyButton({ text, label }) {
    const [copied, setCopied] = useState(false);
    return (_jsx("button", { type: "button", className: "icon-btn icon-btn--sm", "aria-label": label, "data-tip": copied ? 'Copied' : 'Copy', onClick: () => {
            void navigator.clipboard?.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            }, () => undefined);
        }, children: _jsx(Icon, { name: copied ? 'check' : 'copy' }) }));
}
/** A command line with a copy button. */
function Command({ text }) {
    return (_jsxs("span", { className: "cmd", children: [_jsx("code", { className: "cmd__text", children: text }), _jsx(CopyButton, { text: text, label: `Copy ${text}` })] }));
}
/** One option row of the screen. */
function Choice({ testId, title, hint, primary, onClick, disabled, children, icon }) {
    return (_jsxs("div", { className: `first-run__choice${primary ? ' is-primary' : ''}`, children: [_jsxs("button", { type: "button", className: `first-run__option${primary ? ' first-run__option--primary' : ''}`, "data-testid": testId, onClick: onClick, disabled: disabled, children: [_jsx("span", { className: "first-run__icon", "aria-hidden": "true", children: _jsx(Icon, { name: icon }) }), _jsxs("span", { className: "first-run__text", children: [_jsx("span", { className: "first-run__title", children: title }), _jsx("span", { className: "first-run__hint", children: hint })] }), _jsx(Icon, { name: "chevronRight" })] }), children] }));
}
// ---------------------------------------------------------------------------
// Local variant
// ---------------------------------------------------------------------------
function backendOf(list, id) {
    return list.find((b) => b.id === id);
}
/** Codex device sign-in (through the local server, or the paired bridge on a hosted page). */
const CodexSignIn = memo(function CodexSignIn({ codex, target }) {
    const { api, refresh, done } = target;
    const [login, setLogin] = useState(null);
    const [error, setError] = useState(null);
    const [model, setModel] = useState('');
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);
    // Poll while the CLI's sign-in runs; refresh the backend status when it ends.
    useEffect(() => {
        if (!login?.running || !api)
            return;
        const t = setInterval(() => {
            void api.loginStatus().then((s) => {
                if (!alive.current)
                    return;
                setLogin(s);
                if (s && !s.running)
                    refresh();
            }, () => undefined);
        }, POLL_MS);
        return () => clearInterval(t);
    }, [api, refresh, login?.running]);
    useEffect(() => {
        if (codex?.loggedIn && !model)
            setModel(codex.defaultModel ?? codex.models[0]?.id ?? '');
    }, [codex, model]);
    if (!codex?.installed) {
        return (_jsxs("div", { className: "first-run__detail", "data-testid": "first-run-codex-missing", children: [_jsx("p", { className: "first-run__note", children: "The Codex CLI is not installed on this computer. Install it, then press Check again:" }), _jsx(Command, { text: "npm i -g @openai/codex" }), _jsxs("button", { type: "button", className: "btn btn--sm", onClick: refresh, children: [_jsx(Icon, { name: "refresh" }), " Check again"] })] }));
    }
    if (codex.loggedIn) {
        return (_jsxs("div", { className: "first-run__detail", "data-testid": "first-run-signed-in", children: [_jsxs("p", { className: "first-run__account", children: [_jsx("span", { className: "status-chip is-ok", children: "Signed in" }), " ", codex.account ?? 'ChatGPT account'] }), codex.models.length > 0 && (_jsxs("label", { className: "first-run__field", children: [_jsx("span", { children: "Model" }), _jsx("select", { className: "select select--sm", "aria-label": "Codex model", value: model, onChange: (e) => setModel(e.target.value), children: codex.models.map((m) => (_jsx("option", { value: m.id, children: m.label }, m.id))) })] })), _jsx("button", { type: "button", className: "btn btn--primary", "data-testid": "first-run-done", onClick: () => done(model), children: "Start creating" })] }));
    }
    const start = () => {
        if (!api)
            return;
        setError(null);
        void api.login('codex').then(setLogin, (e) => setError((e instanceof Error ? e.message : 'Sign-in could not start.').slice(0, 200)));
    };
    return (_jsxs("div", { className: "first-run__detail", "data-testid": "first-run-login", children: [!login?.running ? (_jsxs(_Fragment, { children: [login?.finished && !login.finished.ok && _jsx("p", { className: "setup-error", children: login.finished.message }), _jsx("button", { type: "button", className: "btn btn--primary", onClick: start, disabled: !api, "data-testid": "first-run-login-start", children: login ? 'Try again' : 'Get a sign-in code' })] })) : (_jsxs(_Fragment, { children: [_jsxs("ol", { className: "first-run__steps", children: [_jsxs("li", { children: ["Open", ' ', login.url ? (_jsx("a", { href: login.url, target: "_blank", rel: "noopener noreferrer", className: "first-run__link", children: login.url.replace(/^https:\/\//, '').slice(0, 60) })) : ('the sign-in page'), ' ', "and sign in with your ChatGPT account."] }), _jsxs("li", { children: ["Enter this one-time code:", ' ', login.code ? (_jsxs("span", { className: "first-run__code", children: [_jsx("code", { "data-testid": "first-run-device-code", children: login.code }), _jsx(CopyButton, { text: login.code, label: "Copy the code" })] })) : (_jsx("span", { className: "first-run__note", children: "waiting for the code\u2026" }))] })] }), _jsxs("p", { className: "first-run__status", role: "status", "aria-live": "polite", children: [_jsx("span", { className: "spinner", "aria-hidden": "true" }), " Waiting for you to finish signing in\u2026"] }), _jsx("button", { type: "button", className: "btn btn--sm", onClick: () => void api?.cancelLogin().then(setLogin, () => undefined), children: "Cancel" })] })), error && (_jsx("p", { className: "setup-error", role: "alert", children: error }))] }));
});
const refreshLocal = () => void aiConnection().refreshLocal();
const LOCAL_TARGET = {
    get api() {
        return aiConnection().localApi;
    },
    refresh: refreshLocal,
    done: (model) => finish('codex', { mode: 'auto', backend: 'codex', ...(model ? { codexModel: model } : {}) }),
};
const LocalScreen = memo(function LocalScreen() {
    const local = useAi((s) => s.local);
    const [expanded, setExpanded] = useState(true);
    useEffect(() => {
        void aiConnection().refresh();
    }, []);
    const codex = backendOf(local.backends, 'codex');
    const claude = backendOf(local.backends, 'claude-code');
    const checking = local.state === 'checking';
    return (_jsxs("div", { className: "first-run__choices", children: [_jsx(Choice, { testId: "first-run-codex", icon: "sparkles", primary: true, title: "Sign in with ChatGPT (Codex)", hint: "Your own ChatGPT account, through the Codex CLI on this computer. Aether never sees your password or tokens.", onClick: () => setExpanded((v) => !v), children: expanded && (checking ? _jsx("p", { className: "first-run__note first-run__detail", children: "Checking this computer\u2026" }) : _jsx(CodexSignIn, { codex: codex, target: LOCAL_TARGET })) }), claude?.installed && claude.loggedIn && (_jsx(Choice, { testId: "first-run-claude", icon: "code", title: "Use Claude Code", hint: `Signed in${claude.account ? ` as ${claude.account}` : ''} on this computer.`, onClick: () => finish('claude-code', { mode: 'auto', backend: 'claude-code' }) })), _jsx(Choice, { testId: "first-run-offline", icon: "cube", title: "Continue offline", hint: "The built-in planner and generator library, in your browser. Sign in any time from the top bar.", onClick: () => finish('offline') })] }));
});
// ---------------------------------------------------------------------------
// Hosted variant
// ---------------------------------------------------------------------------
const KeyForm = memo(function KeyForm() {
    const [provider, setProvider] = useState('anthropic');
    const [key, setKey] = useState('');
    const [remember, setRemember] = useState(false);
    const [error, setError] = useState(null);
    const info = BYOK_CATALOG[provider];
    const submit = () => {
        const err = aiConnection().setByok(provider, key.trim(), { remember });
        if (err) {
            setError(err);
            return;
        }
        setKey('');
        finish('byok', { mode: 'byok', byokProvider: provider });
    };
    return (_jsxs("form", { className: "first-run__detail first-run__form", onSubmit: (e) => {
            e.preventDefault();
            submit();
        }, children: [_jsxs("label", { className: "first-run__field", children: [_jsx("span", { children: "Provider" }), _jsx("select", { className: "select select--sm", "data-testid": "first-run-provider", "aria-label": "API provider", value: provider, onChange: (e) => {
                            if (isByokProvider(e.target.value))
                                setProvider(e.target.value);
                        }, children: BYOK_PROVIDERS.map((p) => (_jsx("option", { value: p, children: BYOK_CATALOG[p].label }, p))) })] }), _jsxs("label", { className: "first-run__field", children: [_jsx("span", { children: "API key" }), _jsx("input", { className: "input input--sm input--mono", "data-testid": "first-run-key", type: "password", autoComplete: "off", spellCheck: false, placeholder: info.keyHint, value: key, maxLength: 300, onChange: (e) => setKey(e.target.value), "aria-label": "API key" })] }), _jsxs("a", { className: "first-run__link", href: info.keyPage, target: "_blank", rel: "noopener noreferrer", children: ["Get a ", info.label, " key ", _jsx(Icon, { name: "external" })] }), _jsxs("label", { className: "first-run__check", children: [_jsx("input", { type: "checkbox", "data-testid": "first-run-remember", checked: remember, onChange: (e) => setRemember(e.target.checked) }), " Remember on this device"] }), _jsxs("p", { className: "first-run__note", children: ["The key stays in this browser (", remember ? 'saved on this device until you remove it' : 'forgotten when you close the tab', ") and goes only to ", info.label, ". Usage is billed to your account."] }), error && (_jsx("p", { className: "setup-error", role: "alert", children: error })), _jsx("button", { type: "submit", className: "btn btn--primary", "data-testid": "first-run-key-submit", disabled: key.trim().length < 20, children: "Use this key" })] }));
});
/** After pairing: sign in to / pick Codex or Claude Code on the user's own computer. */
const BridgeBackends = memo(function BridgeBackends() {
    const bridge = useAi((s) => s.bridge);
    const target = useMemo(() => ({
        api: bridge.paired ? aiConnection().bridgeAccounts() : null,
        refresh: () => void aiConnection().refreshBridge(),
        done: (model) => finish('bridge', { mode: 'bridge', backend: 'codex', ...(model ? { codexModel: model } : {}) }),
    }), 
    // A new pairing (url or token) needs a new client.
    [bridge.paired, bridge.url]);
    const codex = backendOf(bridge.backends, 'codex');
    const claude = backendOf(bridge.backends, 'claude-code');
    return (_jsxs("div", { className: "first-run__paired", "data-testid": "first-run-bridge-paired", children: [_jsxs("p", { className: "first-run__account", children: [_jsx("span", { className: "status-chip is-ok", children: "Paired" }), " ", bridge.detail || 'Your computer'] }), bridge.state === 'checking' && bridge.backends.length === 0 ? _jsx("p", { className: "first-run__note", children: "Checking your computer\u2026" }) : _jsx(CodexSignIn, { codex: codex, target: target }), claude?.installed && claude.loggedIn && (_jsxs("button", { type: "button", className: "btn btn--sm", "data-testid": "first-run-bridge-claude", onClick: () => finish('bridge', { mode: 'bridge', backend: 'claude-code' }), children: [_jsx(Icon, { name: "code" }), " Use Claude Code instead", claude.account ? ` (${claude.account})` : ''] }))] }));
});
/** The local bridge path on a hosted page: one command, then pair (or a deep link from the terminal). */
const RunLocally = memo(function RunLocally() {
    const bridge = useAi((s) => s.bridge);
    const [code, setCode] = useState('');
    const [address, setAddress] = useState(bridge.url || DEFAULT_BRIDGE_URL);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const origin = typeof location !== 'undefined' ? location.origin : 'https://your-studio';
    if (bridge.paired && bridge.state !== 'unpaired')
        return _jsx(BridgeBackends, {});
    const pair = async () => {
        const url = normalizeBridgeUrl(address);
        if (!url) {
            setError('The bridge runs on this computer: use http://127.0.0.1:<port> (or localhost).');
            return;
        }
        setBusy(true);
        setError(null);
        const err = await aiConnection().pair(url, code);
        setBusy(false);
        if (err)
            setError(err);
    };
    return (_jsxs("div", { className: "first-run__detail", "data-testid": "first-run-local-steps", children: [_jsx("p", { className: "first-run__note", children: "On your computer (Node.js 22+), one command installs Aether and starts its local bridge. It uses your own Codex / ChatGPT or Claude Code login; nothing runs on our servers:" }), _jsx(Command, { text: `git clone ${REPO_URL} && cd aether && npm ci && npx aether start --origin ${origin}` }), _jsx("p", { className: "first-run__note", children: "Open the pairing link it prints, or enter the pairing code here:" }), _jsxs("form", { className: "pair-form", onSubmit: (e) => {
                    e.preventDefault();
                    void pair();
                }, children: [_jsx("input", { className: "input input--sm input--mono", "aria-label": "Pairing code", "data-testid": "first-run-pair-code", placeholder: "ABCD-EFGH", value: code, maxLength: 9, onChange: (e) => setCode(e.target.value.toUpperCase()), spellCheck: false, autoComplete: "off" }), _jsx("button", { type: "submit", className: "btn btn--sm btn--primary", "data-testid": "first-run-pair", disabled: busy || code.replace('-', '').length !== 8, children: busy ? 'Pairing…' : 'Pair' })] }), _jsxs("details", { className: "first-run__more", children: [_jsx("summary", { children: "Bridge address" }), _jsx("input", { className: "input input--sm input--mono", "aria-label": "Bridge address", "data-testid": "first-run-bridge-url", value: address, maxLength: 64, onChange: (e) => setAddress(e.target.value), spellCheck: false, autoComplete: "off" })] }), error && (_jsx("p", { className: "setup-error", role: "alert", children: error }))] }));
});
const HostedScreen = memo(function HostedScreen() {
    const paired = useAi((s) => s.bridge.paired);
    const [open, setOpen] = useState(paired ? 'local' : null);
    return (_jsxs("div", { className: "first-run__choices", children: [_jsx(Choice, { testId: "first-run-local", icon: "sparkles", primary: true, title: "Use your own Codex / ChatGPT login", hint: "Runs on your computer with one command and your own subscription (Claude Code works too). No API key.", onClick: () => setOpen((v) => (v === 'local' ? null : 'local')), children: open === 'local' && _jsx(RunLocally, {}) }), _jsx(Choice, { testId: "first-run-byok", icon: "lock", title: "Use your API key", hint: "Anthropic, OpenAI, OpenRouter or Google Gemini. Called straight from this browser; never sent to us.", onClick: () => setOpen((v) => (v === 'key' ? null : 'key')), children: open === 'key' && _jsx(KeyForm, {}) }), _jsx(Choice, { testId: "first-run-offline", icon: "cube", title: "Explore offline", hint: "Templates and the built-in planner, right here. Connect an AI any time from the top bar.", onClick: () => finish('offline') })] }));
});
/** The first-run screen (rendered by the app root once the probe decided to show it). */
export const FirstRun = memo(function FirstRun() {
    const open = useFirstRun((s) => s.open);
    const variant = useFirstRun((s) => s.variant);
    const close = useCallback(() => {
        // Closing without choosing never blocks the app: remember "offline" (the chip offers sign-in later).
        if (firstRunStore.getState().open)
            finish('offline');
    }, []);
    const description = useMemo(() => (variant === 'local' ? 'Aether runs on this computer. Connect your own AI account to build anything you describe, or start offline.' : 'Describe a world and Aether builds it, then proves it works. Choose how it thinks:'), [variant]);
    return (_jsx(Dialog, { open: open, onClose: close, title: "Connect your AI", description: description, size: "md", className: "first-run", children: _jsxs("div", { "data-testid": "first-run", "data-variant": variant, className: "first-run__body", children: [_jsx("span", { className: "first-run__mark", "aria-hidden": "true", children: _jsx(Logomark, {}) }), variant === 'local' ? _jsx(LocalScreen, {}) : _jsx(HostedScreen, {})] }) }));
});
