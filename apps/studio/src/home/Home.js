import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Projects home: sidebar navigation, search, templates, recently opened
 * projects (grid or list), all projects with sorting, everything published
 * from this browser and the documentation page. Files dropped anywhere on the
 * page are imported as projects.
 */
import { lazyBoundary } from '../components/ErrorBoundary';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useAppState } from '../app/appContext';
import { MAX_IMPORT_BYTES } from '../config';
import { FEATURED_TEMPLATES, MORE_TEMPLATES, TEMPLATES } from '../lib/examples';
import { shortcut } from '../lib/keys';
import { formatRelative } from '../lib/relativeTime';
import { browserStorage, readJson, writeJson } from '../lib/storage';
import { isProjectSort, PROJECT_SORTS, searchProjects, sortProjects } from '../projects/query';
import { Icon } from '../components/Icon';
import { Logomark } from '../components/Logo';
import { SettingsDialog } from '../components/SettingsDialog';
import { loadAiPrefs, parsePrefs, saveAiPrefs } from '../ai/prefs';
import { SignInChip } from '../onboarding/FirstRunHost';
import { useAiPrefsEvent } from '../onboarding/useAiPrefsEvent';
import { ToastStack } from '../components/Toasts';
import { CommandPalette } from '../components/ui/CommandPalette';
import { ConfirmDialog } from '../components/ui/Dialog';
import { Menu } from '../components/ui/Menu';
import { Segmented } from '../components/ui/Segmented';
import { ProjectCard, ProjectRow, TemplateCard } from './cards';
import { NewProjectDialog, RenameDialog } from './dialogs';
import { Docs } from './Docs';
import { Hero } from './Hero';
import { isHelpKey, setShortcutsOpen, ShortcutsDialog } from '../components/ShortcutsDialog';
import { useProjectActions } from './useProjectActions';
import { useProjectList, useThumbnails } from './useProjects';
import { prefetchEditor } from '../editor/prefetch';
/** The publish history (IndexedDB library) loads with the page that shows it. */
const PublishedPage = lazyBoundary(async () => ({ default: (await import('./Published')).PublishedPage }), { what: 'published page', fallback: null, variant: 'inline' });
const RecentlyPublished = lazyBoundary(async () => ({ default: (await import('./Published')).RecentlyPublished }), { what: 'published list', fallback: null, variant: 'inline' });
const NAV = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'templates', label: 'Templates', icon: 'template' },
    { id: 'projects', label: 'Projects', icon: 'folder' },
    { id: 'published', label: 'Published', icon: 'globe' },
    { id: 'docs', label: 'Documentation', icon: 'book' },
];
/** The home page's template row: the featured templates (or the first shown ones when none is featured). */
const HOME_ROW = FEATURED_TEMPLATES.length > 0 ? FEATURED_TEMPLATES : TEMPLATES.slice(0, 8);
const TITLES = { home: 'Home', templates: 'Templates', projects: 'Projects', published: 'Published', docs: 'Documentation' };
const RECENT_LIMIT = 12;
const PREFS_KEY = 'aether.studio.home.v1';
function loadPrefs() {
    const raw = readJson(browserStorage(), PREFS_KEY);
    const r = typeof raw === 'object' && raw !== null ? raw : {};
    return { view: r['view'] === 'list' ? 'list' : 'grid', sort: isProjectSort(r['sort']) ? r['sort'] : 'updated', collapsed: r['collapsed'] === true };
}
/** Relative-time labels refresh once a minute. */
function useNow() {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), 60_000);
        return () => window.clearInterval(id);
    }, []);
    return now;
}
const Sidebar = memo(function Sidebar({ section, collapsed, onCollapse, onSettings }) {
    const { store } = useApp();
    const dark = useAppState((s) => s.settings.darkTheme);
    return (_jsxs("aside", { className: "sidebar", "aria-label": "Navigation", children: [_jsxs("div", { className: "sidebar__head", children: [_jsxs("a", { className: "sidebar__brand", href: "#/", "aria-label": "Aether home", children: [_jsx(Logomark, { size: 22 }), _jsx("span", { className: "sidebar__name", children: "Aether" })] }), _jsx("button", { type: "button", className: "icon-btn icon-btn--sm sidebar__collapse", onClick: onCollapse, "aria-label": collapsed ? 'Expand sidebar' : 'Collapse sidebar', "data-tip": collapsed ? 'Expand sidebar' : 'Collapse sidebar', "data-tip-pos": "right", children: _jsx(Icon, { name: "panelLeft" }) })] }), _jsx("nav", { className: "sidebar__nav", children: NAV.map((n) => (_jsxs("a", { href: n.id === 'home' ? '#/' : `#/${n.id}`, className: `nav-item${section === n.id ? ' is-active' : ''}`, "aria-current": section === n.id ? 'page' : undefined, "data-tip": collapsed ? n.label : undefined, "data-tip-pos": "right", children: [_jsx(Icon, { name: n.icon }), _jsx("span", { className: "nav-item__label", children: n.label })] }, n.id))) }), _jsxs("div", { className: "sidebar__foot", children: [_jsxs("button", { type: "button", className: "nav-item", onClick: onSettings, "data-tip": collapsed ? 'Settings' : undefined, "data-tip-pos": "right", children: [_jsx(Icon, { name: "settings" }), _jsx("span", { className: "nav-item__label", children: "Settings" })] }), _jsxs("button", { type: "button", className: "nav-item", onClick: () => store.getState().updateSettings({ darkTheme: !dark }), "aria-label": dark ? 'Switch to the light theme' : 'Switch to the dark theme', "data-tip": collapsed ? (dark ? 'Light theme' : 'Dark theme') : undefined, "data-tip-pos": "right", children: [_jsx(Icon, { name: dark ? 'sun' : 'moon' }), _jsx("span", { className: "nav-item__label", children: dark ? 'Light theme' : 'Dark theme' })] })] })] }));
});
const EmptyProjects = memo(function EmptyProjects({ onNew, searching }) {
    return (_jsxs("div", { className: "empty-state", children: [_jsx("span", { className: "empty-state__icon", children: _jsx(Icon, { name: searching ? 'search' : 'folder', size: 20 }) }), _jsx("h3", { className: "empty-state__title", children: searching ? 'No matching projects' : 'No projects yet' }), _jsx("p", { className: "empty-state__text", children: searching ? 'Try a different name.' : 'Start from a template or create a blank project. Projects are saved in this browser.' }), !searching && (_jsxs("button", { type: "button", className: "btn btn--primary", onClick: onNew, children: [_jsx(Icon, { name: "plus" }), " New project"] }))] }));
});
const ProjectSkeletons = memo(function ProjectSkeletons({ count = 4 }) {
    return (_jsx("div", { className: "project-grid", "aria-busy": "true", "aria-label": "Loading projects", children: Array.from({ length: count }, (_, i) => (_jsxs("div", { className: "card card--skeleton", children: [_jsx("span", { className: "thumb skeleton" }), _jsxs("span", { className: "card__body", children: [_jsx("span", { className: "skeleton skeleton--line", style: { width: '60%' } }), _jsx("span", { className: "skeleton skeleton--line", style: { width: '35%' } })] })] }, i))) }));
});
/** Grid or list of projects. */
const ProjectCollection = memo(function ProjectCollection({ projects, view, thumbs, actions, now, }) {
    if (view === 'list') {
        return (_jsxs("div", { className: "project-list", role: "table", "aria-label": "Projects", children: [_jsxs("div", { className: "project-row project-row--head", role: "row", children: [_jsx("span", { className: "project-row__hit", role: "columnheader", children: "Name" }), _jsx("span", { className: "project-row__cell project-row__cell--num", role: "columnheader", children: "Objects" }), _jsx("span", { className: "project-row__cell", role: "columnheader", children: "Edited" }), _jsx("span", { className: "project-row__cell project-row__cell--wide", role: "columnheader", children: "Created" }), _jsx("span", { className: "project-row__menu", role: "columnheader", "aria-label": "Actions" })] }), projects.map((p) => (_jsx(ProjectRow, { project: p, thumb: thumbs.get(p.id) ?? null, actions: actions, now: now }, p.id)))] }));
    }
    return (_jsx("div", { className: "project-grid", children: projects.map((p) => (_jsx(ProjectCard, { project: p, thumb: thumbs.get(p.id) ?? null, actions: actions, now: now }, p.id))) }));
});
/** The projects home. */
export const Home = memo(function Home({ section }) {
    const { repo, store, navigate } = useApp();
    const settings = useAppState((s) => s.settings);
    const toasts = useAppState((s) => s.toasts);
    const paletteOpen = useAppState((s) => s.paletteOpen);
    const newOpen = useAppState((s) => s.newProjectOpen);
    const list = useProjectList(repo);
    const actions = useProjectActions();
    const now = useNow();
    const [prefs, setPrefs] = useState(loadPrefs);
    const [query, setQuery] = useState('');
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [aiPrefs, setAiPrefs] = useState(() => loadAiPrefs(browserStorage()));
    // A first-run choice (already saved) updates the settings shown here.
    useAiPrefsEvent(() => setAiPrefs(loadAiPrefs(browserStorage())));
    const [renaming, setRenaming] = useState(null);
    const [deleting, setDeleting] = useState(null);
    const [dragging, setDragging] = useState(false);
    const fileRef = useRef(null);
    const searchRef = useRef(null);
    const updatePrefs = useCallback((patch) => {
        setPrefs((p) => {
            const next = { ...p, ...patch };
            writeJson(browserStorage(), PREFS_KEY, next);
            return next;
        });
    }, []);
    const projects = useMemo(() => list ?? [], [list]);
    const recent = useMemo(() => [...projects].sort((a, b) => b.openedAt - a.openedAt).slice(0, RECENT_LIMIT), [projects]);
    const searching = query.trim() !== '';
    const searched = useMemo(() => searchProjects(sortProjects(projects, prefs.sort), query), [projects, prefs.sort, query]);
    const shown = section === 'projects' || searching ? searched : recent;
    const thumbs = useThumbnails(repo, shown);
    const cardActions = useMemo(() => ({
        onOpen: (p) => actions.open(p.id),
        onRename: (p) => setRenaming(p),
        onDuplicate: (p) => void actions.duplicate(p.id),
        onExport: (p) => void actions.exportProject(p.id),
        onDelete: (p) => setDeleting(p),
    }), [actions]);
    const openNew = useCallback(() => store.getState().setNewProjectOpen(true), [store]);
    const pickTemplate = useCallback((slug) => void actions.createFromTemplate(slug), [actions]);
    const importFiles = useCallback((files) => {
        const f = files?.[0];
        if (f)
            void actions.importFile(f);
    }, [actions]);
    useEffect(() => {
        document.title = section === 'home' ? 'Aether' : `${TITLES[section]} · Aether`;
    }, [section]);
    // Keyboard: ⌘/Ctrl+K palette, "/" search, N new project.
    useEffect(() => {
        const onKey = (e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (mod && (e.key === 'k' || e.key === 'K')) {
                e.preventDefault();
                store.getState().setPaletteOpen(!store.getState().paletteOpen);
                return;
            }
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))
                return;
            if (document.querySelector('dialog[open]'))
                return;
            if (isHelpKey(e)) {
                e.preventDefault();
                setShortcutsOpen(true);
            }
            else if (e.key === '/') {
                e.preventDefault();
                searchRef.current?.focus();
            }
            else if ((e.key === 'n' || e.key === 'N') && !mod && !e.altKey) {
                e.preventDefault();
                openNew();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [store, openNew]);
    const newFromPrompt = useCallback((q) => ({ id: 'new-from-prompt', title: `Build a new world: “${q}”`, group: 'Create', icon: 'sparkles', shortcut: '↵', run: () => void actions.createFromPrompt(q) }), [actions]);
    const commands = useMemo(() => {
        const out = [
            { id: 'new', title: 'New project…', group: 'Actions', icon: 'plus', shortcut: 'N', run: openNew },
            { id: 'blank', title: 'New empty scene', group: 'Actions', icon: 'square', run: () => void actions.createBlank('empty') },
            { id: 'import', title: 'Import project…', group: 'Actions', icon: 'fileImport', run: () => fileRef.current?.click() },
            { id: 'theme', title: settings.darkTheme ? 'Switch to light theme' : 'Switch to dark theme', group: 'Actions', icon: settings.darkTheme ? 'sun' : 'moon', run: () => store.getState().updateSettings({ darkTheme: !settings.darkTheme }) },
            { id: 'settings', title: 'Settings', group: 'Actions', icon: 'settings', run: () => setSettingsOpen(true) },
            { id: 'shortcuts', title: 'Keyboard shortcuts', group: 'Actions', icon: 'keyboard', shortcut: '?', run: () => setShortcutsOpen(true) },
            ...NAV.map((n) => ({ id: `go-${n.id}`, title: `Go to ${n.label}`, group: 'Navigation', icon: n.icon, run: () => navigate({ name: n.id }) })),
            ...TEMPLATES.map((t) => ({ id: `tpl-${t.slug}`, title: t.title, group: 'Templates', icon: 'template', keywords: `${t.description} template`, hint: 'New from template', run: () => pickTemplate(t.slug) })),
            ...projects.map((p) => ({ id: `proj-${p.id}`, title: p.name, group: 'Projects', icon: 'cube', hint: formatRelative(p.updatedAt, now), run: () => actions.open(p.id) })),
        ];
        return out;
    }, [actions, navigate, now, openNew, pickTemplate, projects, settings.darkTheme, store]);
    const viewToggle = (_jsx(Segmented, { label: "View", size: "sm", value: prefs.view, onChange: (v) => updatePrefs({ view: v }), options: [
            ['grid', _jsx(Icon, { name: "grid", label: "Grid view" }, "g")],
            ['list', _jsx(Icon, { name: "rows", label: "List view" }, "l")],
        ], titles: { grid: 'Grid view', list: 'List view' } }));
    let content;
    if (section === 'docs')
        content = _jsx(Docs, {});
    else if (section === 'published') {
        content = (_jsx(PublishedPage, { now: now }));
    }
    else if (section === 'templates' && !searching) {
        content = (_jsxs(_Fragment, { children: [FEATURED_TEMPLATES.length > 0 && (_jsxs("section", { className: "home-section", "aria-labelledby": "h-featured", children: [_jsx("div", { className: "section-head", children: _jsx("h2", { id: "h-featured", className: "section-head__title", children: "Featured" }) }), _jsx("p", { className: "home-section__lead", children: "Finished games and scenes built with the framework: open one, play it, then ask the agent to change it." }), _jsx("div", { className: "template-grid", children: FEATURED_TEMPLATES.map((t, i) => (_jsx(TemplateCard, { template: t, onPick: pickTemplate, eager: i < 8 }, t.slug))) })] })), MORE_TEMPLATES.length > 0 && (_jsxs("section", { className: "home-section", "aria-labelledby": "h-more", children: [_jsx("div", { className: "section-head", children: _jsx("h2", { id: "h-more", className: "section-head__title", children: "More worlds" }) }), _jsx("p", { className: "home-section__lead", children: "Saved worlds, each built from the prompt on its card." }), _jsx("div", { className: "template-grid", children: MORE_TEMPLATES.map((t) => (_jsx(TemplateCard, { template: t, onPick: pickTemplate }, t.slug))) })] }))] }));
    }
    else {
        const showTemplates = section === 'home' && !searching;
        content = (_jsxs(_Fragment, { children: [showTemplates && _jsx(Hero, { onPrompt: (p) => void actions.createFromPrompt(p), onTemplate: pickTemplate }), showTemplates && (_jsxs("section", { className: "home-section", "aria-labelledby": "h-templates", children: [_jsxs("div", { className: "section-head", children: [_jsx("h2", { id: "h-templates", className: "section-head__title", children: "Start from a template" }), _jsx("a", { className: "link", href: "#/templates", children: "View all" })] }), _jsx("div", { className: "template-row", role: "list", children: HOME_ROW.map((t) => (_jsx("div", { role: "listitem", className: "template-row__item", children: _jsx(TemplateCard, { template: t, onPick: pickTemplate, eager: true }) }, t.slug))) })] })), showTemplates && (_jsx(RecentlyPublished, { now: now })), _jsxs("section", { className: "home-section", "aria-labelledby": "h-projects", children: [_jsxs("div", { className: "section-head", children: [_jsx("h2", { id: "h-projects", className: "section-head__title", children: searching ? `Results for “${query.trim()}”` : section === 'projects' ? `All projects${list ? ` · ${projects.length}` : ''}` : 'Recently opened' }), _jsxs("div", { className: "section-head__tools", children: [(section === 'projects' || searching) && (_jsx(Menu, { label: "Sort projects", align: "end", items: PROJECT_SORTS.map(([id, label]) => ({ id, label, checked: prefs.sort === id, onSelect: () => updatePrefs({ sort: id }) })), trigger: (t) => (_jsxs("button", { ...t, type: "button", className: "btn btn--ghost btn--sm", children: [PROJECT_SORTS.find(([id]) => id === prefs.sort)?.[1], " ", _jsx(Icon, { name: "chevronDown" })] })) })), viewToggle] })] }), list === null ? _jsx(ProjectSkeletons, {}) : shown.length === 0 ? _jsx(EmptyProjects, { onNew: openNew, searching: searching }) : _jsx(ProjectCollection, { projects: shown, view: prefs.view, thumbs: thumbs, actions: cardActions, now: now })] })] }));
    }
    return (_jsxs("div", { className: `home${prefs.collapsed ? ' is-collapsed' : ''}`, onDragOver: (e) => {
            if (![...e.dataTransfer.types].includes('Files'))
                return;
            e.preventDefault();
            setDragging(true);
        }, onDragLeave: (e) => {
            if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget))
                setDragging(false);
        }, onDrop: (e) => {
            if (![...e.dataTransfer.types].includes('Files'))
                return;
            e.preventDefault();
            setDragging(false);
            importFiles(e.dataTransfer.files);
        }, children: [_jsx(Sidebar, { section: section, collapsed: prefs.collapsed, onCollapse: () => updatePrefs({ collapsed: !prefs.collapsed }), onSettings: () => setSettingsOpen(true) }), _jsxs("div", { className: "home__main", onPointerOver: (e) => e.target.closest('.card, .home-top__new, .project-row') && prefetchEditor(), onFocus: (e) => e.target.closest('.card, .home-top__new, .project-row') && prefetchEditor(), children: [_jsxs("header", { className: "home-top", children: [_jsx("a", { className: "home-top__brand", href: "#/", "aria-label": "Aether home", children: _jsx(Logomark, { size: 22 }) }), _jsx("h1", { className: "home-top__title", children: TITLES[section] }), section !== 'docs' && section !== 'published' && (_jsxs("label", { className: "search-field home-top__search", children: [_jsx(Icon, { name: "search" }), _jsx("input", { ref: searchRef, type: "search", value: query, maxLength: 80, placeholder: "Search projects\u2026", "aria-label": "Search projects", onChange: (e) => setQuery(e.target.value), onKeyDown: (e) => {
                                            if (e.key === 'Escape') {
                                                setQuery('');
                                                e.target.blur();
                                            }
                                        } }), _jsx("kbd", { className: "search-field__kbd", children: "/" })] })), _jsx("span", { className: "spacer" }), _jsx(SignInChip, {}), _jsx("button", { type: "button", className: "icon-btn home-top__cmd", onClick: () => store.getState().setPaletteOpen(true), "aria-label": "Command palette", "data-tip": "Command palette", "data-kbd": shortcut('Mod+K'), children: _jsx(Icon, { name: "command" }) }), _jsxs("button", { type: "button", className: "btn home-top__import", onClick: () => fileRef.current?.click(), "data-tip": "Import a .aether.json file", children: [_jsx(Icon, { name: "upload" }), _jsx("span", { className: "btn__label", children: "Import" })] }), _jsxs("button", { type: "button", className: "btn btn--primary home-top__new", onClick: openNew, "data-tip": "New project", "data-kbd": "N", children: [_jsx(Icon, { name: "plus" }), _jsx("span", { className: "btn__label", children: "New project" })] }), _jsx("input", { ref: fileRef, type: "file", accept: "application/json,.json", hidden: true, onChange: (e) => {
                                    importFiles(e.target.files);
                                    e.target.value = '';
                                } })] }), _jsx("div", { className: "home__scroll", children: _jsx("div", { className: "home__content", children: content }) })] }), _jsxs("nav", { className: "tabbar", "aria-label": "Sections", children: [NAV.filter((n) => n.id !== 'published').map((n) => (_jsxs("a", { href: n.id === 'home' ? '#/' : `#/${n.id}`, className: `tabbar__item${section === n.id ? ' is-active' : ''}`, "aria-current": section === n.id ? 'page' : undefined, children: [_jsx(Icon, { name: n.icon, size: 20 }), _jsx("span", { children: n.id === 'docs' ? 'Docs' : n.label })] }, n.id))), _jsxs("button", { type: "button", className: "tabbar__item", onClick: () => setSettingsOpen(true), children: [_jsx(Icon, { name: "settings", size: 20 }), _jsx("span", { children: "Settings" })] })] }), dragging && (_jsx("div", { className: "dropzone", "aria-hidden": "true", children: _jsxs("div", { className: "dropzone__card", children: [_jsx(Icon, { name: "fileImport", size: 20 }), _jsx("span", { children: "Drop a .aether.json file to import it" }), _jsxs("span", { className: "dropzone__hint", children: ["Up to ", Math.round(MAX_IMPORT_BYTES / 1024 / 1024), " MB"] })] }) })), _jsx(NewProjectDialog, { open: newOpen, onClose: () => store.getState().setNewProjectOpen(false), onPrompt: (p) => void actions.createFromPrompt(p), onBlank: (k) => void actions.createBlank(k), onTemplate: pickTemplate, onImport: () => fileRef.current?.click() }), _jsx(RenameDialog, { open: renaming !== null, name: renaming?.name ?? '', onClose: () => setRenaming(null), onSave: (name) => {
                    if (renaming)
                        void actions.rename(renaming.id, name);
                } }), _jsx(ConfirmDialog, { open: deleting !== null, title: "Delete project?", description: deleting ? `“${deleting.name}” will be removed from this browser. You can undo right after.` : '', confirmLabel: "Delete", danger: true, onConfirm: () => {
                    if (deleting)
                        void actions.remove(deleting);
                }, onClose: () => setDeleting(null) }), _jsx(SettingsDialog, { open: settingsOpen, onClose: () => setSettingsOpen(false), settings: settings, update: (p) => store.getState().updateSettings(p), ai: {
                    prefs: aiPrefs,
                    update: (p) => setAiPrefs((cur) => {
                        const next = parsePrefs({ ...cur, ...p });
                        saveAiPrefs(browserStorage(), next);
                        return next;
                    }),
                } }), _jsx(CommandPalette, { open: paletteOpen, onClose: () => store.getState().setPaletteOpen(false), commands: commands, placeholder: "Search projects, templates, actions \u2014 or describe a world\u2026", fallback: newFromPrompt }), _jsx(ToastStack, { toasts: toasts, onDismiss: store.getState().dismissToast }), _jsx(ShortcutsDialog, {})] }));
});
