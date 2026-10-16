/**
 * One tooltip for the whole app, driven by event delegation: any element
 * with `data-tip` (and optionally `data-kbd`, `data-tip-pos`,
 * `data-tip-align`) gets a tooltip after a short hover delay, immediately
 * on keyboard focus. The tooltip is a single fixed-position element in
 * `<body>`, so scroll containers never clip it and it never adds overflow;
 * it is clamped to the viewport. Text is set with `textContent` only.
 * Hidden on touch-only devices, on pointer down, scroll and key presses.
 */
/** Hover delay before a tooltip appears (ms). */
export const TOOLTIP_DELAY_MS = 450;
/** After one tooltip was shown, neighbours appear without delay for this long (ms). */
const WARM_MS = 600;
const GAP = 6;
const EDGE = 6;
/** Placement of a `w`×`h` tooltip next to `r`, clamped to a `vw`×`vh` viewport (pure; exported for tests). */
export function placeTooltip(r, w, h, vw, vh, pos, align) {
    let p = pos;
    if (p === 'bottom' && r.bottom + GAP + h > vh - EDGE)
        p = 'top';
    else if (p === 'top' && r.top - GAP - h < EDGE)
        p = 'bottom';
    else if (p === 'right' && r.right + GAP + w > vw - EDGE)
        p = 'left';
    else if (p === 'left' && r.left - GAP - w < EDGE)
        p = 'right';
    let left;
    let top;
    if (p === 'top' || p === 'bottom') {
        top = p === 'bottom' ? r.bottom + GAP : r.top - GAP - h;
        left = align === 'start' ? r.left : align === 'end' ? r.right - w : r.left + r.width / 2 - w / 2;
    }
    else {
        left = p === 'right' ? r.right + GAP : r.left - GAP - w;
        top = r.top + r.height / 2 - h / 2;
    }
    left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
    top = Math.max(EDGE, Math.min(top, vh - h - EDGE));
    return { left: Math.round(left), top: Math.round(top), pos: p };
}
/** Install the tooltip layer on a document. Returns an uninstall function. */
export function installTooltips(doc = document) {
    const win = doc.defaultView;
    if (!win)
        return () => undefined;
    const tip = doc.createElement('div');
    tip.className = 'tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.id = 'app-tooltip';
    const text = doc.createElement('span');
    text.className = 'tooltip__text';
    const kbd = doc.createElement('kbd');
    kbd.className = 'tooltip__kbd';
    tip.append(text, kbd);
    doc.body.appendChild(tip);
    let target = null;
    let timer = null;
    let warmUntil = 0;
    const hoverCapable = () => {
        try {
            return win.matchMedia('(hover: hover)').matches;
        }
        catch {
            return true;
        }
    };
    const hide = () => {
        if (timer !== null)
            clearTimeout(timer);
        timer = null;
        if (target) {
            if (target.getAttribute('aria-describedby') === tip.id)
                target.removeAttribute('aria-describedby');
            warmUntil = performance.now() + WARM_MS;
        }
        target = null;
        tip.classList.remove('is-visible');
    };
    const show = (el) => {
        const label = el.dataset['tip'];
        if (!label || !el.isConnected)
            return;
        // Modal dialogs live in the top layer: host the tooltip inside them so it stays visible.
        const host = el.closest('dialog') ?? doc.body;
        if (tip.parentElement !== host)
            host.appendChild(tip);
        text.textContent = label;
        const k = el.dataset['kbd'];
        kbd.textContent = k ?? '';
        kbd.hidden = !k;
        tip.style.left = '0px';
        tip.style.top = '0px';
        tip.classList.add('is-measuring');
        const w = tip.offsetWidth;
        const h = tip.offsetHeight;
        tip.classList.remove('is-measuring');
        const r = el.getBoundingClientRect();
        const pos = el.dataset['tipPos'] ?? 'bottom';
        const align = el.dataset['tipAlign'] ?? 'center';
        const p = placeTooltip(r, w, h, doc.documentElement.clientWidth, doc.documentElement.clientHeight, pos, align);
        tip.style.left = `${p.left}px`;
        tip.style.top = `${p.top}px`;
        tip.dataset['pos'] = p.pos;
        tip.classList.add('is-visible');
        if (!el.hasAttribute('aria-describedby') && !el.getAttribute('aria-label') && el.textContent?.trim() !== label)
            el.setAttribute('aria-describedby', tip.id);
    };
    const schedule = (el, immediate) => {
        if (target === el)
            return;
        hide();
        target = el;
        const delay = immediate || performance.now() < warmUntil ? 0 : TOOLTIP_DELAY_MS;
        timer = setTimeout(() => {
            timer = null;
            if (target === el)
                show(el);
        }, delay);
    };
    const find = (node) => {
        if (!(node instanceof win.Element))
            return null;
        return node.closest('[data-tip]');
    };
    const onOver = (e) => {
        if (e.pointerType === 'touch' || !hoverCapable())
            return;
        const el = find(e.target);
        if (el)
            schedule(el, false);
        else if (target)
            hide();
    };
    const onOut = (e) => {
        if (!target)
            return;
        const to = e.relatedTarget;
        if (to instanceof win.Node && target.contains(to))
            return;
        hide();
    };
    const onFocus = (e) => {
        const el = find(e.target);
        if (!el)
            return;
        let visible = false;
        try {
            visible = el.matches(':focus-visible');
        }
        catch {
            visible = false;
        }
        if (visible)
            schedule(el, true);
    };
    const onBlur = (e) => {
        if (target && e.target === target)
            hide();
    };
    doc.addEventListener('pointerover', onOver, true);
    doc.addEventListener('pointerout', onOut, true);
    doc.addEventListener('pointerdown', hide, true);
    doc.addEventListener('focusin', onFocus, true);
    doc.addEventListener('focusout', onBlur, true);
    doc.addEventListener('keydown', hide, true);
    win.addEventListener('scroll', hide, true);
    win.addEventListener('resize', hide);
    win.addEventListener('blur', hide);
    return () => {
        hide();
        doc.removeEventListener('pointerover', onOver, true);
        doc.removeEventListener('pointerout', onOut, true);
        doc.removeEventListener('pointerdown', hide, true);
        doc.removeEventListener('focusin', onFocus, true);
        doc.removeEventListener('focusout', onBlur, true);
        doc.removeEventListener('keydown', hide, true);
        win.removeEventListener('scroll', hide, true);
        win.removeEventListener('resize', hide);
        win.removeEventListener('blur', hide);
        tip.remove();
    };
}
