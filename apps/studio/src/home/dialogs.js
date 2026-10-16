import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Home dialogs: new project, rename. */
import { memo, useEffect, useRef, useState } from 'react';
import { MAX_PROMPT_CHARS } from '../config';
import { TEMPLATES, templateThumbnail } from '../lib/examples';
import { MAX_PROJECT_NAME } from '../projects/model';
import { Icon } from '../components/Icon';
import { Dialog } from '../components/ui/Dialog';
import { Thumb } from './cards';
const BLANKS = [
    { kind: 'empty', title: 'Empty scene', hint: 'Ground and sky only', icon: 'square' },
    { kind: 'starter', title: 'Starter scene', hint: 'A small forest camp', icon: 'mountain' },
];
/** "New project" dialog: from a prompt, blank, a template, or an imported file. */
export const NewProjectDialog = memo(function NewProjectDialog({ open, onClose, onPrompt, onBlank, onTemplate, onImport, }) {
    const [prompt, setPrompt] = useState('');
    const ref = useRef(null);
    useEffect(() => {
        if (open) {
            setPrompt('');
            requestAnimationFrame(() => ref.current?.focus());
        }
    }, [open]);
    const submit = () => {
        const t = prompt.trim();
        if (!t)
            return;
        onClose();
        onPrompt(t);
    };
    const pick = (fn) => {
        onClose();
        fn();
    };
    return (_jsxs(Dialog, { open: open, onClose: onClose, title: "New project", description: "Describe a world, or start from a blank scene or a template.", size: "lg", className: "new-project", footer: _jsxs(_Fragment, { children: [_jsxs("button", { type: "button", className: "btn btn--ghost", onClick: () => pick(onImport), children: [_jsx(Icon, { name: "fileImport" }), " Import file\u2026"] }), _jsx("span", { className: "spacer" }), _jsx("button", { type: "button", className: "btn", onClick: onClose, children: "Cancel" })] }), children: [_jsxs("form", { className: "prompt-box", onSubmit: (e) => {
                    e.preventDefault();
                    submit();
                }, children: [_jsx("textarea", { ref: ref, className: "prompt-box__input", value: prompt, rows: 3, maxLength: MAX_PROMPT_CHARS, placeholder: "A lighthouse on a stormy cliff with crashing waves\u2026", "aria-label": "Describe your world", onChange: (e) => setPrompt(e.target.value), onKeyDown: (e) => {
                            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                submit();
                            }
                        } }), _jsxs("div", { className: "prompt-box__bar", children: [_jsx("span", { className: "prompt-box__hint", children: "The agent builds it, checks the physics and opens the editor." }), _jsx("button", { type: "submit", className: "btn btn--primary", disabled: prompt.trim() === '', children: "Create" })] })] }), _jsx("h3", { className: "dialog__section", children: "Start blank" }), _jsx("div", { className: "blank-grid", children: BLANKS.map((b) => (_jsxs("button", { type: "button", className: "blank-card", onClick: () => pick(() => onBlank(b.kind)), children: [_jsx("span", { className: "blank-card__icon", children: _jsx(Icon, { name: b.icon, size: 20 }) }), _jsxs("span", { className: "blank-card__text", children: [_jsx("span", { className: "blank-card__title", children: b.title }), _jsx("span", { className: "blank-card__hint", children: b.hint })] })] }, b.kind))) }), _jsx("h3", { className: "dialog__section", children: "From a template" }), _jsx("div", { className: "mini-templates", children: TEMPLATES.map((t) => (_jsxs("button", { type: "button", className: "mini-template", onClick: () => pick(() => onTemplate(t.slug)), "aria-label": `Template: ${t.title}`, children: [_jsx(Thumb, { src: templateThumbnail(t.slug), alt: "" }), _jsx("span", { className: "mini-template__title", children: t.title })] }, t.slug))) })] }));
});
/** Rename dialog. */
export const RenameDialog = memo(function RenameDialog({ open, name, onClose, onSave }) {
    const [draft, setDraft] = useState(name);
    const ref = useRef(null);
    useEffect(() => {
        if (open) {
            setDraft(name);
            requestAnimationFrame(() => ref.current?.select());
        }
    }, [open, name]);
    const save = () => {
        const t = draft.trim();
        if (!t)
            return;
        onSave(t);
        onClose();
    };
    return (_jsx(Dialog, { open: open, onClose: onClose, title: "Rename project", size: "sm", footer: _jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "btn", onClick: onClose, children: "Cancel" }), _jsx("button", { type: "button", className: "btn btn--primary", onClick: save, disabled: draft.trim() === '', children: "Save" })] }), children: _jsx("input", { ref: ref, className: "input", value: draft, maxLength: MAX_PROJECT_NAME, "aria-label": "Project name", onChange: (e) => setDraft(e.target.value), onKeyDown: (e) => {
                if (e.key === 'Enter')
                    save();
            } }) }));
});
