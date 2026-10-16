import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The asset forge dialog: drop / paste / pick a reference image and / or
 * describe an object; the connected model writes a parametric generator,
 * every iteration is rendered from four sides and critiqued against the
 * reference, and the strip below shows each iteration live with its score
 * and what still differs. Accept saves it to the library and places it.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useStudio } from '../../app/context';
import { Dialog } from '../../components/ui/Dialog';
import { Icon } from '../../components/Icon';
import { MAX_REFERENCE_BYTES } from '../../engine/forge';
const IMAGE_TYPES = /^image\/(png|jpeg|webp)$/;
function readDataUrl(file) {
    if (!IMAGE_TYPES.test(file.type) || file.size > MAX_REFERENCE_BYTES)
        return Promise.resolve(null);
    return new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(typeof r.result === 'string' ? r.result : null);
        r.onerror = () => resolve(null);
        r.readAsDataURL(file);
    });
}
/** The forge dialog (state lives in the forge controller). */
export const ForgeDialog = memo(function ForgeDialog() {
    const studio = useStudio();
    const forge = studio.forge;
    const open = useStore(forge.state, (s) => s.open);
    const status = useStore(forge.state, (s) => s.status);
    const stage = useStore(forge.state, (s) => s.stage);
    const iterations = useStore(forge.state, (s) => s.iterations);
    const message = useStore(forge.state, (s) => s.message);
    const result = useStore(forge.state, (s) => s.result);
    const score = useStore(forge.state, (s) => s.resultScore);
    const passed = useStore(forge.state, (s) => s.passed);
    const base = useStore(forge.state, (s) => s.base);
    const [text, setText] = useState('');
    const [reference, setReference] = useState(null);
    const [dragOver, setDragOver] = useState(false);
    const fileRef = useRef(null);
    // A fresh dialog starts empty (a running forge keeps its inputs).
    useEffect(() => {
        if (open && forge.state.getState().status !== 'running') {
            setText('');
            setReference(null);
        }
    }, [open, base, forge]);
    if (!open)
        return null;
    const avail = forge.availability();
    const running = status === 'running';
    const take = async (file) => {
        if (!file)
            return;
        const url = await readDataUrl(file);
        if (url)
            setReference(url);
        else
            studio.store.getState().toast('Use a PNG, JPEG or WebP image under 6 MB.', 'error', 4);
    };
    const onDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        void take(e.dataTransfer.files[0]);
    };
    const onPaste = (e) => {
        const file = [...e.clipboardData.files].find((f) => IMAGE_TYPES.test(f.type));
        if (file) {
            e.preventDefault();
            void take(file);
        }
    };
    const canRun = avail.ok && !running && (text.trim().length > 0 || reference !== null);
    const title = base ? `Refine “${base.id}”` : 'Create from an image or a description';
    return (_jsx(Dialog, { open: open, onClose: () => forge.close(), title: title, description: "A connected model writes an editable, parametric 3D generator, renders it from four sides and corrects it against your reference until it matches.", size: "lg", className: "forge-dialog", footer: _jsxs(_Fragment, { children: [running ? (_jsx("button", { type: "button", className: "btn", onClick: () => forge.cancel(), children: "Stop" })) : (_jsx("button", { type: "button", className: "btn btn--ghost", onClick: () => forge.close(), children: "Close" })), result && !running && (_jsxs("button", { type: "button", className: "btn", onClick: () => void forge.accept(), "data-tip": "Save to your library and place it in the world", children: [_jsx(Icon, { name: "check" }), "Add to world"] })), _jsxs("button", { type: "button", className: "btn btn--primary", disabled: !canRun, onClick: () => void forge.run(text.trim(), base ? null : reference), children: [_jsx(Icon, { name: "sparkles" }), base ? 'Apply change' : result ? 'Forge again' : 'Forge'] })] }), children: _jsxs("div", { className: "forge", onPaste: onPaste, children: [!avail.ok && _jsx("p", { className: "forge__notice is-warn", children: avail.reason }), avail.ok && avail.reason && _jsx("p", { className: "forge__notice", children: avail.reason }), _jsxs("div", { className: "forge__inputs", children: [!base && (_jsx("button", { type: "button", className: `forge__drop${dragOver ? ' is-over' : ''}${reference ? ' has-image' : ''}`, onClick: () => fileRef.current?.click(), onDragOver: (e) => {
                                e.preventDefault();
                                setDragOver(true);
                            }, onDragLeave: () => setDragOver(false), onDrop: onDrop, "aria-label": reference ? 'Replace the reference image' : 'Add a reference image', disabled: running, children: reference ? _jsx("img", { src: reference, alt: "Reference" }) : (_jsxs("span", { className: "forge__drop-hint", children: [_jsx(Icon, { name: "image", size: 22 }), _jsx("strong", { children: "Reference image" }), _jsx("span", { children: "Drop, paste or pick a photo (optional)" })] })) })), _jsx("input", { ref: fileRef, type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true, onChange: (e) => {
                                const input = e.currentTarget;
                                const file = input.files?.[0];
                                input.value = '';
                                void take(file);
                            } }), _jsxs("label", { className: "forge__text", children: [_jsx("span", { className: "forge__label", children: base ? 'What should change?' : 'Describe it' }), _jsx("textarea", { value: text, maxLength: 1500, rows: base ? 3 : 5, disabled: running, placeholder: base ? 'taller, walnut wood, thinner legs' : 'an ornate stone fountain with three tiers and lion heads', onChange: (e) => setText(e.target.value) })] })] }), (running || iterations.length > 0 || message) && (_jsxs("div", { className: "forge__progress", "aria-live": "polite", children: [running && (_jsxs("p", { className: "forge__stage", children: [_jsx("span", { className: "spinner", "aria-hidden": "true" }), " ", stage || 'Working…'] })), !running && message && _jsxs("p", { className: `forge__result${passed ? ' is-pass' : ''}`, children: [message, score !== null ? ` Score ${Math.round(score * 100)}/100.` : ''] }), _jsx("ol", { className: "forge__strip", children: iterations.map((it) => (_jsxs("li", { className: "forge__iter", children: [_jsx("div", { className: "forge__sheet", children: it.sheet ? _jsx("img", { src: it.sheet, alt: `Iteration ${it.index + 1}: front, side, top and three-quarter views` }) : _jsx(Icon, { name: "alert" }) }), _jsxs("div", { className: "forge__meta", children: [_jsxs("strong", { children: ["Pass ", it.index + 1, it.score !== null ? ` · ${Math.round(it.score * 100)}/100` : ''] }), it.error && _jsx("span", { className: "forge__err", children: it.error }), it.summary && _jsx("span", { children: it.summary }), it.missing.length > 0 && _jsxs("span", { className: "forge__missing", children: ["Still different: ", it.missing.slice(0, 3).join('; ')] })] })] }, it.index))) })] }))] }) }));
});
