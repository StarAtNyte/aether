import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo } from 'react';
import { useHistoryState, useStudio, useUI } from '../../app/context';
import { Icon } from '../Icon';
/** "Checks" button: latest physics verification; click to (re)run and open the Checks view. */
export const VerifyPill = memo(function VerifyPill() {
    const studio = useStudio();
    const verify = useUI((s) => s.verify);
    const mode = useUI((s) => s.mode);
    const { head } = useHistoryState();
    if (mode === 'play')
        return null;
    const stale = verify.head !== null && verify.head !== head;
    let state = 'idle';
    let text = 'Run checks';
    if (verify.status === 'running') {
        state = 'running';
        const live = verify.live;
        const done = live ? live.results.filter((r) => r !== null).length : 0;
        text = live && live.tests.length > 0 ? `Checking ${done}/${live.tests.length}…` : 'Checking…';
    }
    else if (verify.status === 'passed') {
        state = stale ? 'idle' : 'ok';
        text = stale ? 'Checks outdated' : 'Checks passed';
    }
    else if (verify.status === 'failed' || verify.status === 'error') {
        state = stale ? 'idle' : 'bad';
        const failing = verify.results.filter((r) => !r.passed).length;
        text = stale ? 'Checks outdated' : failing > 0 ? `${failing} check${failing === 1 ? '' : 's'} failing` : 'Checks failed';
    }
    return (_jsxs("button", { type: "button", className: `vp-btn vp-btn--label pill--button is-${state}`, onClick: () => {
            studio.store.getState().showLeftView('verify');
            void studio.runVerify();
        }, "data-tip": "Simulate the world headless and run its physics tests", "data-tip-align": "end", disabled: verify.status === 'running', children: [_jsx("span", { className: "vp-btn__status", "aria-hidden": "true" }), _jsx("span", { children: text })] }));
});
