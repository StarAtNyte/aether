import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Credits: who made the assets the current world uses (with licence and
 * source link), plus every pack the library ships. CC-BY assets require
 * this attribution; CC0 ones receive it as a courtesy. Also shown from play
 * mode and included as CREDITS.txt in exported packages.
 */
import { memo, useMemo } from 'react';
import { useStudio, useWorld } from '../../app/context';
import { Dialog } from '../../components/ui/Dialog';
import { useLibrary } from './useLibrary';
/** The credits dialog (open state lives in the library store). */
export const CreditsDialog = memo(function CreditsDialog() {
    const studio = useStudio();
    const open = useLibrary((s) => s.creditsOpen);
    const catalog = useLibrary((s) => s.catalog);
    const world = useWorld();
    const credits = useMemo(() => (open ? studio.assets.credits() : []), [open, studio, world, catalog]);
    if (!open)
        return null;
    return (_jsxs(Dialog, { open: open, onClose: () => studio.assets.setCreditsOpen(false), title: "Credits", description: "The people and libraries behind the assets in this world.", size: "md", className: "credits-dialog", children: [_jsxs("section", { className: "credits", "aria-label": "Assets in this world", children: [_jsx("h3", { className: "credits__title", children: "In this world" }), credits.length === 0 ? (_jsx("p", { className: "panel-empty", children: "This world uses no third-party assets (everything is procedural)." })) : (_jsx("ul", { className: "credits__list", children: credits.map((c) => (_jsxs("li", { className: "credits__item", children: [_jsxs("div", { className: "credits__head", children: [_jsx("strong", { children: c.source }), _jsxs("span", { className: "credits__by", children: ["by ", c.author] })] }), _jsxs("div", { className: "credits__meta", children: [c.licenceUrl ? (_jsx("a", { href: c.licenceUrl, target: "_blank", rel: "noopener noreferrer", children: c.licence })) : (c.licence), c.url && (_jsxs(_Fragment, { children: [' · ', _jsx("a", { href: c.url, target: "_blank", rel: "noopener noreferrer", children: "source" })] }))] }), _jsx("div", { className: "credits__used", children: c.assets.join(', ') })] }, `${c.source}|${c.author}`))) }))] }), catalog && catalog.packs.length > 0 && (_jsxs("section", { className: "credits", "aria-label": "Asset library", children: [_jsx("h3", { className: "credits__title", children: "Asset library" }), _jsx("ul", { className: "credits__packs", children: catalog.packs.map((p) => (_jsxs("li", { children: [_jsx("a", { href: p.url, target: "_blank", rel: "noopener noreferrer", children: p.title }), ' ', _jsxs("span", { className: "credits__by", children: [p.author, " \u00B7 ", p.licence] })] }, p.id))) })] }))] }));
});
