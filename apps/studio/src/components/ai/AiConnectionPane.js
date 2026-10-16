import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Settings → AI connection: every way to drive the agent, with live status
 * badges and guided setup. Nothing here costs the site owner anything: the
 * offline planner runs in the browser, the bridge uses the visitor's own
 * Codex / Claude Code subscription, the on-device model runs on their GPU,
 * and a personal API key is billed to its owner.
 */
import { memo, useEffect, useState } from 'react';
import { aiConnection, DEFAULT_BRIDGE_URL, effectiveBridgeChoice } from '../../ai/connection';
import { hostedBridgeNote, isLocalOrigin } from '../../ai/messages';
import { byokModelFor } from '../../ai/byok';
import { BYOK_CATALOG, BYOK_PROVIDERS, BYOK_SESSION_CALL_CAP, isByokProvider } from '../../ai/byokCatalog';
import { MAX_REFINE, WEBLLM_MODELS } from '../../ai/prefs';
import { Toggle } from '../fields';
import { bridgeBadge, localBadge, useAi } from '../../ai/useAi';
import { Icon } from '../Icon';
import { Segmented } from '../ui/Segmented';
import { BridgeSignIn, LocalAiSetup } from './LocalAiSetup';
/** Copy-to-clipboard command line. */
function Command({ text }) {
    const [copied, setCopied] = useState(false);
    return (_jsxs("span", { className: "cmd", children: [_jsx("code", { className: "cmd__text", children: text }), _jsx("button", { type: "button", className: "icon-btn icon-btn--sm", "aria-label": `Copy ${text}`, onClick: () => {
                    void navigator.clipboard?.writeText(text).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                    }, () => undefined);
                }, children: _jsx(Icon, { name: copied ? 'check' : 'copy' }) })] }));
}
function Badge({ text, tone }) {
    return _jsx("span", { className: `status-chip${tone === 'quiet' ? '' : ` is-${tone}`}`, children: text });
}
/** One selectable connection card. */
function ModeCard({ mode, prefs, update, title, hint, badge, children }) {
    const selected = prefs.mode === mode;
    return (_jsxs("div", { className: `ai-mode${selected ? ' is-selected' : ''}`, "data-mode": mode, children: [_jsxs("label", { className: "ai-mode__head", children: [_jsx("input", { type: "radio", name: "ai-mode", className: "ai-mode__radio", checked: selected, onChange: () => update({ mode }) }), _jsxs("span", { className: "ai-mode__text", children: [_jsxs("span", { className: "ai-mode__title", children: [title, " ", badge] }), _jsx("span", { className: "ai-mode__hint", children: hint })] })] }), selected && children && _jsx("div", { className: "ai-mode__body", children: children })] }));
}
const BridgeSetup = memo(function BridgeSetup({ prefs, update }) {
    const bridge = useAi((s) => s.bridge);
    const [url, setUrl] = useState(bridge.url || DEFAULT_BRIDGE_URL);
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const origin = typeof location !== 'undefined' ? location.origin : '';
    const local = isLocalOrigin(origin);
    const browserNote = hostedBridgeNote(origin, typeof navigator !== 'undefined' ? navigator.userAgent : '');
    const choice = effectiveBridgeChoice(prefs, bridge.backends);
    const command = local ? 'npx aether start' : `npx aether start --origin ${origin}`;
    const backend = bridge.backends.find((b) => b.id === prefs.backend);
    const models = backend?.models ?? [];
    const pair = async () => {
        setBusy(true);
        setError(null);
        const err = await aiConnection().pair(url, code);
        setBusy(false);
        if (err)
            setError(err);
        else
            setCode('');
    };
    return (_jsxs("div", { className: "bridge-setup", children: [!bridge.paired ? (_jsxs("ol", { className: "setup-steps", children: [_jsxs("li", { children: [_jsx("span", { className: "setup-steps__text", children: "On this computer, in the Aether folder, start the bridge (uses the Codex or Claude Code login you already have):" }), _jsx(Command, { text: command })] }), _jsxs("li", { children: [_jsx("span", { className: "setup-steps__text", children: "Enter the pairing code it prints (or open the link it prints)." }), _jsxs("form", { className: "pair-form", onSubmit: (e) => {
                                    e.preventDefault();
                                    void pair();
                                }, children: [_jsx("input", { className: "input input--sm input--mono pair-form__url", "aria-label": "Bridge address", value: url, maxLength: 200, onChange: (e) => setUrl(e.target.value), spellCheck: false }), _jsx("input", { className: "input input--sm input--mono pair-form__code", "aria-label": "Pairing code", placeholder: "ABCD-EFGH", value: code, maxLength: 9, onChange: (e) => setCode(e.target.value.toUpperCase()), spellCheck: false, autoComplete: "off" }), _jsx("button", { type: "submit", className: "btn btn--sm btn--primary", disabled: busy || code.replace('-', '').length !== 8, children: busy ? 'Pairing…' : 'Pair' })] }), error && _jsx("p", { className: "setup-error", role: "alert", children: error })] })] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "bridge-status", children: [_jsx("span", { className: "bridge-status__url", children: bridge.url }), _jsx("span", { className: "spacer" }), _jsxs("button", { type: "button", className: "btn btn--sm", onClick: () => void aiConnection().refreshBridge(), children: [_jsx(Icon, { name: "refresh" }), " Refresh"] }), _jsx("button", { type: "button", className: "btn btn--sm", onClick: () => aiConnection().unpair(), children: "Unpair" })] }), _jsx(BridgeSignIn, {}), _jsxs("div", { className: "setting-row", children: [_jsx("span", { className: "setting-row__text", children: _jsx("span", { className: "setting-row__label", children: "Agent" }) }), _jsx(Segmented, { label: "Bridge agent", value: prefs.backend, onChange: (v) => update({ backend: v }), options: [
                                    ['codex', 'Codex'],
                                    ['claude-code', 'Claude Code'],
                                ] })] }), models.length > 0 && (_jsxs("div", { className: "setting-row", children: [_jsx("span", { className: "setting-row__text", children: _jsx("span", { className: "setting-row__label", children: "Model" }) }), _jsx("select", { className: "select select--sm", "aria-label": "Model", value: choice.backend === prefs.backend && choice.model ? choice.model : prefs.backend === 'codex' ? prefs.codexModel : prefs.claudeModel, onChange: (e) => update(prefs.backend === 'codex' ? { codexModel: e.target.value } : { claudeModel: e.target.value }), children: models.map((m) => (_jsx("option", { value: m.id, children: m.label }, m.id))) })] })), _jsxs("div", { className: "setting-row", children: [_jsxs("span", { className: "setting-row__text", children: [_jsx("span", { className: "setting-row__label", children: "Reasoning effort" }), _jsx("span", { className: "setting-row__hint", children: "Low is fastest; higher effort is slower but plans more carefully." })] }), _jsx(Segmented, { label: "Reasoning effort", value: choice.effort, onChange: (v) => update({ effort: v }), options: [
                                    ['low', 'Low'],
                                    ['medium', 'Medium'],
                                    ['high', 'High'],
                                ] })] })] })), browserNote && (_jsx("p", { className: `setup-note${browserNote.tone === 'warn' ? ' setup-note--warn' : ''}`, "data-testid": "bridge-browser-note", children: browserNote.text })), bridge.detail && bridge.state !== 'ready' && _jsx("p", { className: "setup-note", children: bridge.detail }), _jsxs("details", { className: "troubleshoot", children: [_jsx("summary", { children: "Troubleshooting" }), _jsxs("ul", { children: [_jsxs("li", { children: [_jsx("strong", { children: "Bridge offline:" }), " start it with ", _jsx("code", { children: "npx aether start --origin <this site>" }), " (it runs in the background; ", _jsx("code", { children: "npx aether status" }), " / ", _jsx("code", { children: "npx aether pair" }), "). It listens on 127.0.0.1 only."] }), _jsxs("li", { children: [_jsx("strong", { children: "Hosted page cannot connect:" }), " Safari blocks HTTPS pages from reaching local services; use Chrome, Edge or Firefox, or run the studio locally. Chrome may first ask to allow access to your local network."] }), _jsxs("li", { children: [_jsx("strong", { children: "Not signed in:" }), " use the sign-in buttons above, or run ", _jsx("code", { children: "codex login" }), " (ChatGPT account) or ", _jsx("code", { children: "claude auth login" }), " in a terminal."] }), _jsxs("li", { children: [_jsx("strong", { children: "Origin not allowed:" }), " when using a hosted copy of the studio, start the bridge with ", _jsxs("code", { children: ["--origin ", origin || 'https://your-site'] }), "."] }), _jsxs("li", { children: [_jsx("strong", { children: "Usage limit reached:" }), " your subscription's limit applies; switch models or try later. Aether falls back to the offline planner meanwhile."] }), _jsx("li", { children: "The bridge runs the CLIs with every tool disabled, read-only, in an empty temporary folder: the model can only return text." })] })] })] }));
});
const WebLlmSetup = memo(function WebLlmSetup({ prefs, update }) {
    const w = useAi((s) => s.webllm);
    const model = WEBLLM_MODELS.find((m) => m.id === prefs.webllmModel) ?? WEBLLM_MODELS[0];
    return (_jsxs("div", { className: "webllm-setup", children: [_jsxs("p", { className: "setup-note", children: ["Experimental. Downloads about ", (model.downloadMB / 1000).toFixed(1), " GB once (cached by the browser) and runs on your GPU with WebGPU. Small models follow instructions less reliably than the bridge."] }), _jsxs("div", { className: "setting-row", children: [_jsx("span", { className: "setting-row__text", children: _jsx("span", { className: "setting-row__label", children: "Model" }) }), _jsx("select", { className: "select select--sm", "aria-label": "On-device model", value: prefs.webllmModel, onChange: (e) => update({ webllmModel: e.target.value }), children: WEBLLM_MODELS.map((m) => (_jsxs("option", { value: m.id, children: [m.label, " \u00B7 ", (m.downloadMB / 1000).toFixed(1), " GB \u00B7 ", m.licence] }, m.id))) })] }), w.state === 'loading' ? (_jsxs("div", { className: "progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(w.progress * 100), "aria-label": "Model download", children: [_jsx("span", { className: "progress__fill", style: { width: `${Math.round(w.progress * 100)}%` } }), _jsx("span", { className: "progress__text", children: w.detail })] })) : (_jsx("button", { type: "button", className: "btn btn--sm", disabled: w.state === 'ready' && w.model === prefs.webllmModel, onClick: () => void aiConnection().loadWebLlm(prefs.webllmModel), children: w.state === 'ready' && w.model === prefs.webllmModel ? 'Loaded' : 'Download and start' })), (w.state === 'unsupported' || w.state === 'error') && (_jsx("p", { className: "setup-error", role: "alert", children: w.detail }))] }));
});
/** Compact count (1 234 → "1.2k"). */
function compact(n) {
    return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
/** Model picker for the chosen key provider: the provider's live list once a key is set, else the built-in shortlist. */
function ByokModelPicker({ provider, prefs, update, hasKey }) {
    const [live, setLive] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (!hasKey)
            return;
        const ctrl = new AbortController();
        setError(null);
        aiConnection()
            .listByokModels(provider, ctrl.signal)
            .then((models) => setLive({ provider, models }), (err) => {
            if (!ctrl.signal.aborted)
                setError(err instanceof Error ? err.message.slice(0, 160) : 'The model list could not be loaded.');
        });
        return () => ctrl.abort();
    }, [provider, hasKey]);
    const current = byokModelFor(provider, prefs.byokModels[provider]);
    const base = live?.provider === provider && live.models.length > 0 ? live.models : BYOK_CATALOG[provider].models;
    const options = base.some((m) => m.id === current) ? base : [{ id: current, label: current }, ...base];
    return (_jsxs("div", { className: "setting-row", children: [_jsxs("span", { className: "setting-row__text", children: [_jsx("span", { className: "setting-row__label", children: "Model" }), error && _jsxs("span", { className: "setting-row__hint", children: [error, " Showing the usual models."] })] }), _jsx("select", { className: "select select--sm", "aria-label": "Key model", value: current, onChange: (e) => update({ byokModels: { ...prefs.byokModels, [provider]: e.target.value } }), children: options.map((m) => (_jsx("option", { value: m.id, children: m.label }, m.id))) })] }));
}
/** Bring your own API key: provider, key (kept in this browser only), model, usage. */
export const ByokSetup = memo(function ByokSetup({ prefs, update }) {
    const byok = useAi((s) => s.byok);
    const [key, setKey] = useState('');
    const [remember, setRemember] = useState(byok.remembered);
    const [error, setError] = useState(null);
    const provider = prefs.byokProvider;
    const info = BYOK_CATALOG[provider];
    const hasKey = byok.providers.includes(provider);
    return (_jsxs("div", { className: "byok-setup", "data-testid": "byok-setup", children: [_jsxs("p", { className: "setup-note", children: ["Your key stays in this browser and goes straight to ", info.label, "; Aether's server never sees it. Usage is billed to your account."] }), _jsxs("div", { className: "setting-row", children: [_jsx("span", { className: "setting-row__text", children: _jsx("span", { className: "setting-row__label", children: "Provider" }) }), _jsx("select", { className: "select select--sm", "aria-label": "Key provider", value: provider, onChange: (e) => isByokProvider(e.target.value) && update({ byokProvider: e.target.value }), children: BYOK_PROVIDERS.map((p) => (_jsxs("option", { value: p, children: [BYOK_CATALOG[p].label, byok.providers.includes(p) ? ' · key set' : ''] }, p))) })] }), hasKey ? (_jsxs("div", { className: "bridge-status", children: [_jsx(Badge, { text: byok.remembered ? 'Key saved on this device' : 'Key set for this tab', tone: "ok" }), _jsx("span", { className: "spacer" }), _jsx("button", { type: "button", className: "btn btn--sm", onClick: () => aiConnection().clearByok(provider), children: "Forget key" })] })) : (_jsxs("form", { className: "pair-form", onSubmit: (e) => {
                    e.preventDefault();
                    const err = aiConnection().setByok(provider, key, { remember });
                    setError(err);
                    if (!err)
                        setKey('');
                }, children: [_jsx("input", { className: "input input--sm input--mono", type: "password", autoComplete: "off", spellCheck: false, "aria-label": `${info.label} API key`, placeholder: info.keyHint, value: key, maxLength: 300, onChange: (e) => setKey(e.target.value) }), _jsx("button", { type: "submit", className: "btn btn--sm btn--primary", disabled: key.trim().length < 20, children: "Use key" })] })), !hasKey && (_jsx("p", { className: "setup-note", children: _jsxs("a", { href: info.keyPage, target: "_blank", rel: "noopener noreferrer", children: ["Get a ", info.label, " key"] }) })), error && (_jsx("p", { className: "setup-error", role: "alert", children: error })), _jsx(Toggle, { label: "Remember on this device", hint: "Keeps your keys in this browser's local storage after the tab closes. Leave it off on a shared computer.", checked: hasKey ? byok.remembered : remember, onChange: (v) => {
                    setRemember(v);
                    if (byok.providers.length > 0)
                        aiConnection().setByokRemember(v);
                } }), _jsx(ByokModelPicker, { provider: provider, prefs: prefs, update: update, hasKey: hasKey }), _jsxs("div", { className: "setting-row", "data-testid": "byok-usage", children: [_jsxs("span", { className: "setting-row__text", children: [_jsxs("span", { className: "setting-row__label", children: ["This session: ", byok.usage.calls, " / ", BYOK_SESSION_CALL_CAP, " calls"] }), _jsxs("span", { className: "setting-row__hint", children: ["About ", compact(byok.usage.inputTokens), " tokens in, ", compact(byok.usage.outputTokens), " out (estimated; your provider's dashboard has the exact bill)."] })] }), _jsx("button", { type: "button", className: "btn btn--sm", disabled: byok.usage.calls === 0, onClick: () => aiConnection().resetByokUsage(), children: "Reset" })] })] }));
});
/** The AI connection settings pane. */
export const AiConnectionPane = memo(function AiConnectionPane({ prefs, update, repairs, setRepairs }) {
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
    return (_jsxs("div", { className: "settings__pane ai-pane", children: [_jsxs("section", { className: "settings__group", children: [_jsx("h3", { className: "settings__heading", children: "Connection" }), _jsxs("div", { className: "ai-modes", role: "radiogroup", "aria-label": "AI connection", children: [_jsx(ModeCard, { mode: "auto", prefs: prefs, update: update, title: "Automatic", hint: "Picks the best connection: Codex or Claude Code on this computer, then the local bridge, then your own API key, then an on-device model, then the offline planner.", badge: _jsx(Badge, { text: "Recommended", tone: "quiet" }) }), _jsx(ModeCard, { mode: "local", prefs: prefs, update: update, title: "Codex or Claude Code on this computer", hint: "Your own ChatGPT or Claude subscription, run by Aether on this computer. Deep builds let a coding agent write, render and check new assets.", badge: _jsx(Badge, { text: lb.text, tone: lb.tone }), children: _jsx(LocalAiSetup, { prefs: prefs, update: update }) }), _jsx(ModeCard, { mode: "bridge", prefs: prefs, update: update, title: "Local bridge \u00B7 Codex or Claude Code", hint: "Use your subscription from a hosted copy of the studio, through a small service on your computer.", badge: _jsx(Badge, { text: b.text, tone: b.tone }), children: _jsx(BridgeSetup, { prefs: prefs, update: update }) }), _jsx(ModeCard, { mode: "webllm", prefs: prefs, update: update, title: "On-device model", hint: "A small model running in this browser on your GPU. Experimental.", badge: _jsx(Badge, { text: webllm.state === 'ready' ? 'Loaded' : webllm.state === 'loading' ? 'Downloading' : webllm.state === 'unsupported' ? 'Unsupported' : 'Experimental', tone: webllm.state === 'ready' ? 'ok' : webllm.state === 'unsupported' ? 'warn' : 'quiet' }), children: _jsx(WebLlmSetup, { prefs: prefs, update: update }) }), _jsx(ModeCard, { mode: "offline", prefs: prefs, update: update, title: "Offline planner", hint: "Always available, instant, runs in your browser. Best for the built-in themes and common objects.", badge: _jsx(Badge, { text: "Available", tone: "ok" }) }), _jsx(ModeCard, { mode: "byok", prefs: prefs, update: update, title: "Your own API key", hint: "Anthropic, OpenAI, OpenRouter or Google Gemini, called straight from this browser.", badge: _jsx(Badge, { text: byok.providers.length > 0 ? 'Key set' : 'Optional', tone: byok.providers.length > 0 ? 'ok' : 'quiet' }), children: _jsx(ByokSetup, { prefs: prefs, update: update }) }), server.state === 'live' && _jsx(ModeCard, { mode: "server", prefs: prefs, update: update, title: "Server model", hint: `The model configured on this server (${server.providers.join(', ')}).`, badge: _jsx(Badge, { text: "Connected", tone: "ok" }) })] })] }), _jsxs("section", { className: "settings__group", children: [_jsx("h3", { className: "settings__heading", children: "Quality" }), _jsxs("div", { className: "setting-row", children: [_jsxs("span", { className: "setting-row__text", children: [_jsx("span", { className: "setting-row__label", children: "Refinement rounds" }), _jsx("span", { className: "setting-row__hint", children: "After building, Aether renders four views, scores them against a rubric and spends up to this many rounds improving the weakest points." })] }), _jsx(Segmented, { label: "Refinement rounds", value: String(prefs.refine), onChange: (v) => update({ refine: Number(v) }), options: Array.from({ length: MAX_REFINE + 1 }, (_, i) => [String(i), i === 0 ? 'Off' : `${i}`]) })] }), repairs !== undefined && setRepairs && (_jsxs("div", { className: "setting-row", children: [_jsxs("span", { className: "setting-row__text", children: [_jsx("span", { className: "setting-row__label", children: "Automatic repairs" }), _jsx("span", { className: "setting-row__hint", children: "Rounds the agent may spend fixing a world that fails its physics checks." })] }), _jsx(Segmented, { label: "Automatic repairs", value: String(repairs), onChange: (v) => setRepairs(Number(v)), options: [
                                    ['0', 'Off'],
                                    ['1', '1'],
                                    ['2', '2'],
                                    ['3', '3'],
                                ] })] }))] })] }));
});
