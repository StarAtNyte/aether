import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * What was published from this browser (the publish library): games,
 * videos, renders, models, floor plans, links, hosting and network shares,
 * newest first, filterable by kind, with the files kept for re-download.
 * `RecentlyPublished` is the short row on the home dashboard.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../app/appContext';
import { Icon } from '../components/Icon';
import { formatRelative } from '../lib/relativeTime';
import { publishLibrary } from '../publish/library';
import '../styles/published.css';
const KINDS = [
    ['all', 'All', 'globe'],
    ['game', 'Games', 'gamepad'],
    ['video', 'Videos', 'film'],
    ['render', 'Renders', 'image'],
    ['model', '3D models', 'box3d'],
    ['plan', 'Floor plans', 'plan'],
    ['link', 'Links', 'link'],
    ['hosting', 'Hosted', 'rocket'],
];
const ICON = { game: 'gamepad', video: 'film', render: 'image', model: 'box3d', plan: 'plan', link: 'link', hosting: 'rocket', lan: 'wifi' };
const LABEL = { game: 'Game', video: 'Video', render: 'Render', model: '3D model', plan: 'Floor plan', link: 'Share link', hosting: 'Hosted', lan: 'Network' };
/** Items of the library, kept fresh. */
function usePublished() {
    const [items, setItems] = useState(null);
    useEffect(() => {
        let alive = true;
        let off = null;
        void publishLibrary().then((lib) => {
            const load = () => void lib.items().then((list) => alive && setItems(list));
            load();
            off = lib.subscribe(load);
        });
        return () => {
            alive = false;
            off?.();
        };
    }, []);
    return items;
}
async function download(item) {
    const blob = await (await publishLibrary()).file(item.id);
    if (!blob)
        return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.fileName ?? 'download';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const Card = memo(function Card({ item, now, onOpenProject }) {
    const [busy, setBusy] = useState(false);
    return (_jsxs("li", { className: "pubcard", children: [_jsxs("div", { className: "pubcard__media", children: [item.thumb ? _jsx("img", { src: item.thumb, alt: "", loading: "lazy" }) : _jsx(Icon, { name: ICON[item.kind], size: 20 }), _jsxs("span", { className: "pubcard__kind", children: [_jsx(Icon, { name: ICON[item.kind], size: 14 }), " ", LABEL[item.kind]] })] }), _jsxs("div", { className: "pubcard__body", children: [_jsx("span", { className: "pubcard__title", title: item.title, children: item.title }), _jsx("span", { className: "pubcard__detail", title: item.detail, children: item.detail }), _jsx("span", { className: "pubcard__time", children: formatRelative(item.createdAt, now) })] }), _jsxs("div", { className: "pubcard__actions", children: [item.hasBlob && (_jsxs("button", { type: "button", className: "btn btn--sm", disabled: busy, onClick: () => {
                            setBusy(true);
                            void download(item).finally(() => setBusy(false));
                        }, children: [_jsx(Icon, { name: "download" }), " Download"] })), item.url && (_jsxs("a", { className: "btn btn--sm", href: item.url, target: "_blank", rel: "noopener noreferrer", children: [_jsx(Icon, { name: "external" }), " Open"] })), item.projectId && (_jsx("button", { type: "button", className: "icon-btn icon-btn--sm", "aria-label": "Open the project", "data-tip": "Open the project", onClick: () => onOpenProject(item.projectId), children: _jsx(Icon, { name: "pencil" }) })), _jsx("button", { type: "button", className: "icon-btn icon-btn--sm", "aria-label": "Remove from the list", "data-tip": "Remove from the list", onClick: () => void publishLibrary().then((lib) => lib.remove(item.id)), children: _jsx(Icon, { name: "trash" }) })] })] }));
});
/** The Published page. */
export const PublishedPage = memo(function PublishedPage({ now }) {
    const items = usePublished();
    const { navigate } = useApp();
    const [kind, setKind] = useState('all');
    const shown = useMemo(() => (items ?? []).filter((i) => kind === 'all' || i.kind === kind || (kind === 'hosting' && i.kind === 'lan')), [items, kind]);
    const openProject = useCallback((id) => navigate({ name: 'editor', id }), [navigate]);
    if (items === null)
        return _jsx("div", { className: "pubgrid pubgrid--loading", "aria-busy": "true" });
    if (items.length === 0)
        return (_jsxs("div", { className: "empty-state empty-state--page", children: [_jsx("span", { className: "empty-state__icon", children: _jsx(Icon, { name: "rocket", size: 20 }) }), _jsx("h3", { className: "empty-state__title", children: "Nothing published yet" }), _jsx("p", { className: "empty-state__text", children: "Open a project and press Publish: download it as a game for itch.io or any website, put it on your own Netlify, Vercel or GitHub Pages, render a video or a 4K still, export a 3D model or a floor plan, or copy a link that plays the world \u2014 no upload needed." })] }));
    return (_jsxs("section", { className: "home-section", "data-testid": "published-page", children: [_jsx("div", { className: "pubfilters", role: "group", "aria-label": "Filter by kind", children: KINDS.map(([k, label, icon]) => (_jsxs("button", { type: "button", className: `chip chip--action${kind === k ? ' is-on' : ''}`, "aria-pressed": kind === k, onClick: () => setKind(k), children: [_jsx(Icon, { name: icon, size: 14 }), " ", label] }, k))) }), _jsx("ul", { className: "pubgrid", children: shown.map((item) => (_jsx(Card, { item: item, now: now, onOpenProject: openProject }, item.id))) })] }));
});
/** The latest few published items (home dashboard); nothing when there are none. */
export const RecentlyPublished = memo(function RecentlyPublished({ now }) {
    const items = usePublished();
    const { navigate } = useApp();
    const openProject = useCallback((id) => navigate({ name: 'editor', id }), [navigate]);
    if (!items || items.length === 0)
        return null;
    return (_jsxs("section", { className: "home-section", "aria-labelledby": "h-published", children: [_jsxs("div", { className: "section-head", children: [_jsx("h2", { id: "h-published", className: "section-head__title", children: "Recently published" }), _jsx("a", { className: "link", href: "#/published", children: "View all" })] }), _jsx("ul", { className: "pubgrid pubgrid--row", children: items.slice(0, 4).map((item) => (_jsx(Card, { item: item, now: now, onOpenProject: openProject }, item.id))) })] }));
});
