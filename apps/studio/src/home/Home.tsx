/**
 * Projects home: sidebar navigation, search, templates, recently opened
 * projects (grid or list), all projects with sorting, everything published
 * from this browser and the documentation page. Files dropped anywhere on the
 * page are imported as projects.
 */
import { lazyBoundary } from '../components/ErrorBoundary';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useApp, useAppState } from '../app/appContext';
import { MAX_IMPORT_BYTES } from '../config';
import { FEATURED_TEMPLATES, TEMPLATES, TEMPLATE_GROUPS, templatesInGroup, type TemplateGroup } from '../lib/examples';
import { shortcut } from '../lib/keys';
import { formatRelative } from '../lib/relativeTime';
import type { HomeSection } from '../lib/router';
import { browserStorage, readJson, writeJson } from '../lib/storage';
import { isProjectSort, PROJECT_SORTS, searchProjects, sortProjects, type ProjectSort } from '../projects/query';
import type { ProjectMeta } from '../projects/model';
import { Icon, type IconName } from '../components/Icon';
import { Logomark } from '../components/Logo';
import { SettingsDialog } from '../components/SettingsDialog';
import { loadAiPrefs, parsePrefs, saveAiPrefs, type AiPrefs } from '../ai/prefs';
import { SignInChip } from '../onboarding/FirstRunHost';
import { useAiPrefsEvent } from '../onboarding/useAiPrefsEvent';
import { ToastStack } from '../components/Toasts';
import { CommandPalette, type Command } from '../components/ui/CommandPalette';
import { ConfirmDialog } from '../components/ui/Dialog';
import { Menu } from '../components/ui/Menu';
import { Segmented } from '../components/ui/Segmented';
import { ProjectCard, ProjectRow, TemplateCard, type ProjectCardActions } from './cards';
import { NewProjectDialog, RenameDialog } from './dialogs';
import { Docs } from './Docs';
import { Hero } from './Hero';
import { describeProjects, isDeletable } from '../projects/bulkDelete';
import { isHelpKey, setShortcutsOpen, ShortcutsDialog } from '../components/ShortcutsDialog';
import { useProjectActions } from './useProjectActions';
import { useProjectList, useThumbnails } from './useProjects';
import { prefetchEditor } from '../editor/prefetch';

/** The publish history (IndexedDB library) loads with the page that shows it. */
const PublishedPage = lazyBoundary(async () => ({ default: (await import('./Published')).PublishedPage }), { what: 'published page', fallback: null, variant: 'inline' });
const RecentlyPublished = lazyBoundary(async () => ({ default: (await import('./Published')).RecentlyPublished }), { what: 'published list', fallback: null, variant: 'inline' });

const FeaturedGallery = lazyBoundary(async () => ({ default: (await import('./Featured')).default }), { what: 'featured worlds', fallback: <FeaturedSkeleton />, variant: 'inline' });

const NAV: ReadonlyArray<{ id: HomeSection; label: string; icon: IconName }> = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'templates', label: 'Templates', icon: 'template' },
  { id: 'projects', label: 'Projects', icon: 'folder' },
  { id: 'published', label: 'Published', icon: 'globe' },
  { id: 'docs', label: 'Documentation', icon: 'book' },
];

/** The "Start from a template" row: the shown templates that are not in the Featured section (or the first shown ones when none is featured). */
const HOME_ROW = FEATURED_TEMPLATES.length > 0 ? TEMPLATES.filter((t) => t.curation !== 'featured').slice(0, 16) : TEMPLATES.slice(0, 8);

/** Placeholder with the gallery's exact geometry (the grid CSS is in the entry stylesheet), so the lazy chunk never shifts the page. */
function FeaturedSkeleton(): ReactElement {
  return (
    <div className="featured__grid" aria-hidden="true">
      {FEATURED_TEMPLATES.map((t, i) => (
        <div key={t.slug} className={`featured__item${i === 0 ? ' featured__item--lead' : i < 3 ? ' featured__item--side' : ''}`}>
          <span className="fskel" />
        </div>
      ))}
    </div>
  );
}

const TITLES: Readonly<Record<HomeSection, string>> = { home: 'Home', templates: 'Templates', projects: 'Projects', published: 'Published', docs: 'Documentation' };
const RECENT_LIMIT = 12;
const PREFS_KEY = 'aether.studio.home.v1';

interface HomePrefs {
  view: 'grid' | 'list';
  sort: ProjectSort;
  collapsed: boolean;
}

function loadPrefs(): HomePrefs {
  const raw = readJson(browserStorage(), PREFS_KEY);
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return { view: r['view'] === 'list' ? 'list' : 'grid', sort: isProjectSort(r['sort']) ? r['sort'] : 'updated', collapsed: r['collapsed'] === true };
}

/** Relative-time labels refresh once a minute. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

const Sidebar = memo(function Sidebar({ section, collapsed, onCollapse, onSettings }: { section: HomeSection; collapsed: boolean; onCollapse: () => void; onSettings: () => void }): ReactElement {
  const { store } = useApp();
  const dark = useAppState((s) => s.settings.darkTheme);
  return (
    <aside className="sidebar" aria-label="Navigation">
      <div className="sidebar__head">
        <a className="sidebar__brand" href="#/" aria-label="Aether home">
          <Logomark size={22} />
          <span className="sidebar__name">Aether</span>
        </a>
        <button type="button" className="icon-btn icon-btn--sm sidebar__collapse" onClick={onCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} data-tip={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} data-tip-pos="right">
          <Icon name="panelLeft" />
        </button>
      </div>
      <nav className="sidebar__nav">
        {NAV.map((n) => (
          <a key={n.id} href={n.id === 'home' ? '#/' : `#/${n.id}`} className={`nav-item${section === n.id ? ' is-active' : ''}`} aria-current={section === n.id ? 'page' : undefined} data-tip={collapsed ? n.label : undefined} data-tip-pos="right">
            <Icon name={n.icon} />
            <span className="nav-item__label">{n.label}</span>
          </a>
        ))}
      </nav>
      <div className="sidebar__foot">
        <button type="button" className="nav-item" onClick={onSettings} data-tip={collapsed ? 'Settings' : undefined} data-tip-pos="right">
          <Icon name="settings" />
          <span className="nav-item__label">Settings</span>
        </button>
        <button
          type="button"
          className="nav-item"
          onClick={() => store.getState().updateSettings({ darkTheme: !dark })}
          aria-label={dark ? 'Switch to the light theme' : 'Switch to the dark theme'}
          data-tip={collapsed ? (dark ? 'Light theme' : 'Dark theme') : undefined}
          data-tip-pos="right"
        >
          <Icon name={dark ? 'sun' : 'moon'} />
          <span className="nav-item__label">{dark ? 'Light theme' : 'Dark theme'}</span>
        </button>
      </div>
    </aside>
  );
});

const EmptyProjects = memo(function EmptyProjects({ onNew, searching }: { onNew: () => void; searching: boolean }): ReactElement {
  return (
    <div className="empty-state">
      <span className="empty-state__icon">
        <Icon name={searching ? 'search' : 'folder'} size={20} />
      </span>
      <h3 className="empty-state__title">{searching ? 'No matching projects' : 'No projects yet'}</h3>
      <p className="empty-state__text">{searching ? 'Try a different name.' : 'Start from a template or create a blank project. Projects are saved in this browser.'}</p>
      {!searching && (
        <button type="button" className="btn btn--primary" onClick={onNew}>
          <Icon name="plus" /> New project
        </button>
      )}
    </div>
  );
});

const ProjectSkeletons = memo(function ProjectSkeletons({ count = 4 }: { count?: number }): ReactElement {
  return (
    <div className="project-grid" aria-busy="true" aria-label="Loading projects">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card card--skeleton">
          <span className="thumb skeleton" />
          <span className="card__body">
            <span className="skeleton skeleton--line" style={{ width: '60%' }} />
            <span className="skeleton skeleton--line" style={{ width: '35%' }} />
          </span>
        </div>
      ))}
    </div>
  );
});

/** Grid or list of projects. */
const ProjectCollection = memo(function ProjectCollection({
  projects,
  view,
  thumbs,
  actions,
  now,
  selecting,
  selection,
}: {
  projects: readonly ProjectMeta[];
  view: 'grid' | 'list';
  thumbs: ReadonlyMap<string, string>;
  actions: ProjectCardActions;
  now: number;
  selecting: boolean;
  selection: ReadonlySet<string>;
}): ReactElement {
  if (view === 'list') {
    return (
      <div className="project-list" role="table" aria-label="Projects">
        <div className="project-row project-row--head" role="row">
          <span className="project-row__hit" role="columnheader">
            Name
          </span>
          <span className="project-row__cell project-row__cell--num" role="columnheader">
            Objects
          </span>
          <span className="project-row__cell" role="columnheader">
            Edited
          </span>
          <span className="project-row__cell project-row__cell--wide" role="columnheader">
            Created
          </span>
          <span className="project-row__menu" role="columnheader" aria-label="Actions" />
        </div>
        {projects.map((p) => (
          <ProjectRow key={p.id} project={p} thumb={thumbs.get(p.id) ?? null} actions={actions} now={now} selecting={selecting} selected={selection.has(p.id)} />
        ))}
      </div>
    );
  }
  return (
    <div className="project-grid">
      {projects.map((p) => (
        <ProjectCard key={p.id} project={p} thumb={thumbs.get(p.id) ?? null} actions={actions} now={now} selecting={selecting} selected={selection.has(p.id)} />
      ))}
    </div>
  );
});

/** The projects home. */
export const Home = memo(function Home({ section }: { section: HomeSection }): ReactElement {
  const { repo, store, navigate } = useApp();
  const settings = useAppState((s) => s.settings);
  const toasts = useAppState((s) => s.toasts);
  const paletteOpen = useAppState((s) => s.paletteOpen);
  const newOpen = useAppState((s) => s.newProjectOpen);
  const list = useProjectList(repo);
  const actions = useProjectActions();
  const now = useNow();
  const [prefs, setPrefs] = useState<HomePrefs>(loadPrefs);
  const [templateGroup, setTemplateGroup] = useState<'all' | TemplateGroup>('all');
  const [query, setQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiPrefs, setAiPrefs] = useState<AiPrefs>(() => loadAiPrefs(browserStorage()));
  // A first-run choice (already saved) updates the settings shown here.
  useAiPrefsEvent(() => setAiPrefs(loadAiPrefs(browserStorage())));
  const [renaming, setRenaming] = useState<ProjectMeta | null>(null);
  const [deleting, setDeleting] = useState<ProjectMeta | null>(null);
  const [dragging, setDragging] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [announce, setAnnounce] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const updatePrefs = useCallback((patch: Partial<HomePrefs>) => {
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

  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const toggle = useCallback((p: ProjectMeta) => {
    setSelection((cur) => {
      const next = new Set(cur);
      if (!next.delete(p.id)) next.add(p.id);
      return next;
    });
  }, []);
  const cardActions = useMemo<ProjectCardActions>(
    () => ({
      onOpen: (p) => actions.open(p.id),
      onRename: (p) => setRenaming(p),
      onDuplicate: (p) => void actions.duplicate(p.id),
      onExport: (p) => void actions.exportProject(p.id),
      // Delete on a card that is part of a multi-selection deletes the whole selection.
      onDelete: (p) => (selectionRef.current.size > 1 && selectionRef.current.has(p.id) ? setBulkOpen(true) : setDeleting(p)),
      onToggle: toggle,
      canDelete: (p) => isDeletable(p),
    }),
    [actions, toggle],
  );
  const exitSelect = useCallback(() => {
    setSelecting(false);
    setSelection(new Set());
    setBulkOpen(false);
  }, []);
  // Selected projects that no longer exist (deleted, other tab) drop out of the selection.
  useEffect(() => {
    setSelection((cur) => {
      if (cur.size === 0) return cur;
      const live = new Set(projects.map((p) => p.id));
      const next = new Set([...cur].filter((id) => live.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [projects]);
  const selectable = useMemo(() => shown.filter((p) => isDeletable(p)), [shown]);
  const chosen = useMemo(() => projects.filter((p) => selection.has(p.id)), [projects, selection]);
  const allChosen = selectable.length > 0 && selectable.every((p) => selection.has(p.id));
  /** After a delete the focused card is gone: land on the section heading and tell screen readers what happened. */
  const afterDelete = useCallback((ids: readonly string[], what: string) => {
    if (ids.length === 0) return;
    setAnnounce(`${what} deleted. Undo is available for a few seconds.`);
    requestAnimationFrame(() => headingRef.current?.focus());
  }, []);
  const deleteSelected = useCallback(async () => {
    const batch = chosen;
    const gone = await actions.removeMany(batch);
    afterDelete(gone, gone.length === 1 ? describeProjects(batch.filter((p) => p.id === gone[0])) : `${gone.length} projects`);
    if (gone.length === batch.length) exitSelect();
    else setSelection((cur) => new Set([...cur].filter((id) => !gone.includes(id))));
  }, [actions, afterDelete, chosen, exitSelect]);
  const openNew = useCallback(() => store.getState().setNewProjectOpen(true), [store]);
  const pickTemplate = useCallback((slug: string) => void actions.createFromTemplate(slug), [actions]);
  const importFiles = useCallback(
    (files: FileList | null) => {
      const f = files?.[0];
      if (f) void actions.importFile(f);
    },
    [actions],
  );

  useEffect(() => {
    document.title = section === 'home' ? 'Aether' : `${TITLES[section]} · Aether`;
  }, [section]);

  // Keyboard: ⌘/Ctrl+K palette, "/" search, N new project.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        store.getState().setPaletteOpen(!store.getState().paletteOpen);
        return;
      }
      if (e.key === 'Escape' && selecting && !document.querySelector('dialog[open]') && !document.querySelector('[role="menu"]')) {
        exitSelect();
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (document.querySelector('dialog[open]')) return;
      if (isHelpKey(e)) {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if ((e.key === 'n' || e.key === 'N') && !mod && !e.altKey) {
        e.preventDefault();
        openNew();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, openNew, selecting, exitSelect]);

  const newFromPrompt = useCallback((q: string): Command => ({ id: 'new-from-prompt', title: `Build a new world: “${q}”`, group: 'Create', icon: 'sparkles', shortcut: '↵', run: () => void actions.createFromPrompt(q) }), [actions]);
  const commands = useMemo<Command[]>(() => {
    const out: Command[] = [
      { id: 'new', title: 'New project…', group: 'Actions', icon: 'plus', shortcut: 'N', run: openNew },
      { id: 'blank', title: 'New empty scene', group: 'Actions', icon: 'square', run: () => void actions.createBlank('empty') },
      { id: 'import', title: 'Import project…', group: 'Actions', icon: 'fileImport', run: () => fileRef.current?.click() },
      { id: 'theme', title: settings.darkTheme ? 'Switch to light theme' : 'Switch to dark theme', group: 'Actions', icon: settings.darkTheme ? 'sun' : 'moon', run: () => store.getState().updateSettings({ darkTheme: !settings.darkTheme }) },
      { id: 'settings', title: 'Settings', group: 'Actions', icon: 'settings', run: () => setSettingsOpen(true) },
      { id: 'shortcuts', title: 'Keyboard shortcuts', group: 'Actions', icon: 'keyboard', shortcut: '?', run: () => setShortcutsOpen(true) },
      ...NAV.map((n) => ({ id: `go-${n.id}`, title: `Go to ${n.label}`, group: 'Navigation', icon: n.icon, run: () => navigate({ name: n.id }) })),
      ...TEMPLATES.map((t) => ({ id: `tpl-${t.slug}`, title: t.title, group: 'Templates', icon: 'template' as IconName, keywords: `${t.description} template`, hint: 'New from template', run: () => pickTemplate(t.slug) })),
      ...projects.map((p) => ({ id: `proj-${p.id}`, title: p.name, group: 'Projects', icon: 'cube' as IconName, hint: formatRelative(p.updatedAt, now), run: () => actions.open(p.id) })),
    ];
    return out;
  }, [actions, navigate, now, openNew, pickTemplate, projects, settings.darkTheme, store]);

  const viewToggle = (
    <Segmented<'grid' | 'list'>
      label="View"
      size="sm"
      value={prefs.view}
      onChange={(v) => updatePrefs({ view: v })}
      options={[
        ['grid', <Icon key="g" name="grid" label="Grid view" />],
        ['list', <Icon key="l" name="rows" label="List view" />],
      ]}
      titles={{ grid: 'Grid view', list: 'List view' }}
    />
  );

  let content: ReactElement;
  if (section === 'docs') content = <Docs />;
  else if (section === 'published') {
    content = (
      <PublishedPage now={now} />
    );
  } else if (section === 'templates' && !searching) {
    content = (
      <>
        <div className="template-filter" role="group" aria-label="Template type">
          <Segmented<'all' | TemplateGroup>
            label="Template type"
            size="sm"
            value={templateGroup}
            onChange={setTemplateGroup}
            options={[['all', `All (${TEMPLATES.length})`], ...TEMPLATE_GROUPS.filter((g) => templatesInGroup(g.id).length > 0).map((g) => [g.id, `${g.label} (${templatesInGroup(g.id).length})`] as [TemplateGroup, string])]}
          />
        </div>
        {TEMPLATE_GROUPS.filter((g) => (templateGroup === 'all' || templateGroup === g.id) && templatesInGroup(g.id).length > 0).map((g, gi) => (
          <section key={g.id} className="home-section" aria-labelledby={`h-${g.id}`}>
            <div className="section-head">
              <h2 id={`h-${g.id}`} className="section-head__title">
                {g.title}
              </h2>
            </div>
            <p className="home-section__lead">{g.lead}</p>
            <div className="template-grid">
              {templatesInGroup(g.id).map((t, i) => (
                <TemplateCard key={t.slug} template={t} onPick={pickTemplate} eager={gi === 0 && i < 4} />
              ))}
            </div>
          </section>
        ))}
      </>
    );
  } else {
    const showTemplates = section === 'home' && !searching;
    content = (
      <>
        {showTemplates && <Hero onPrompt={(p) => void actions.createFromPrompt(p)} onTemplate={pickTemplate} />}
        {showTemplates && FEATURED_TEMPLATES.length > 0 && (
          <section className="home-section featured" aria-labelledby="h-featured">
            <div className="section-head">
              <h2 id="h-featured" className="section-head__title">
                Featured worlds
              </h2>
              <a className="link" href="#/templates">
                View all
              </a>
            </div>
            <p className="featured__lead">Published worlds, ready to open. Click one to play or explore it; Remix opens a copy in the editor to change by chat.</p>
            <FeaturedGallery onRemix={pickTemplate} />
          </section>
        )}
        {showTemplates && (
          <section className="home-section" aria-labelledby="h-templates">
            <div className="section-head">
              <h2 id="h-templates" className="section-head__title">
                Start from a template
              </h2>
              <a className="link" href="#/templates">
                View all
              </a>
            </div>
            <div className="template-row" role="list">
              {HOME_ROW.map((t) => (
                <div key={t.slug} role="listitem" className="template-row__item">
                  {/* Eager: ~10 KB each, and the cards at the faded edge of the row must never show a placeholder. */}
                  <TemplateCard template={t} onPick={pickTemplate} eager />
                </div>
              ))}
            </div>
          </section>
        )}
        {showTemplates && (
          <RecentlyPublished now={now} />
        )}
        <section className="home-section" aria-labelledby="h-projects">
          <div className="section-head">
            <h2 id="h-projects" className="section-head__title" ref={headingRef} tabIndex={-1}>
              {searching ? `Results for “${query.trim()}”` : section === 'projects' ? `All projects${list ? ` · ${projects.length}` : ''}` : 'Recently opened'}
            </h2>
            <div className="section-head__tools">
              {selecting && (
                <>
                  <label className="select-all">
                    <input
                      type="checkbox"
                      className="select-box"
                      checked={allChosen}
                      onChange={() => setSelection(allChosen ? new Set() : new Set(selectable.map((p) => p.id)))}
                    />
                    <span>Select all</span>
                  </label>
                  <span className="select-count" aria-live="polite">
                    {selection.size} selected
                  </span>
                  <button type="button" className="btn btn--danger btn--sm" disabled={selection.size === 0} onClick={() => setBulkOpen(true)}>
                    <Icon name="trash" /> Delete selected ({selection.size})
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={exitSelect}>
                    Done
                  </button>
                </>
              )}
              {!selecting && list !== null && shown.length > 0 && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelecting(true)} data-tip="Select several projects to delete">
                  <Icon name="check" /> Select
                </button>
              )}
              {(section === 'projects' || searching) && (
                <Menu
                  label="Sort projects"
                  align="end"
                  items={PROJECT_SORTS.map(([id, label]) => ({ id, label, checked: prefs.sort === id, onSelect: () => updatePrefs({ sort: id }) }))}
                  trigger={(t) => (
                    <button {...t} type="button" className="btn btn--ghost btn--sm">
                      {PROJECT_SORTS.find(([id]) => id === prefs.sort)?.[1]} <Icon name="chevronDown" />
                    </button>
                  )}
                />
              )}
              {viewToggle}
            </div>
          </div>
          {list === null ? <ProjectSkeletons /> : shown.length === 0 ? <EmptyProjects onNew={openNew} searching={searching} /> : <ProjectCollection projects={shown} view={prefs.view} thumbs={thumbs} actions={cardActions} now={now} selecting={selecting} selection={selection} />}
        </section>
      </>
    );
  }

  return (
    <div
      className={`home${prefs.collapsed ? ' is-collapsed' : ''}`}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(false);
        importFiles(e.dataTransfer.files);
      }}
    >
      <Sidebar section={section} collapsed={prefs.collapsed} onCollapse={() => updatePrefs({ collapsed: !prefs.collapsed })} onSettings={() => setSettingsOpen(true)} />
      <div className="home__main" onPointerOver={(e) => (e.target as Element).closest('.card, .home-top__new, .project-row') && prefetchEditor()} onFocus={(e) => (e.target as Element).closest('.card, .home-top__new, .project-row') && prefetchEditor()}>
        <header className="home-top">
          <a className="home-top__brand" href="#/" aria-label="Aether home">
            <Logomark size={22} />
          </a>
          <h1 className="home-top__title">{TITLES[section]}</h1>
          {section !== 'docs' && section !== 'published' && (
            <label className="search-field home-top__search">
              <Icon name="search" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                maxLength={80}
                placeholder="Search projects…"
                aria-label="Search projects"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setQuery('');
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
              <kbd className="search-field__kbd">/</kbd>
            </label>
          )}
          <span className="spacer" />
          <SignInChip />
          <button type="button" className="icon-btn home-top__cmd"onClick={() => store.getState().setPaletteOpen(true)} aria-label="Command palette" data-tip="Command palette" data-kbd={shortcut('Mod+K')}>
            <Icon name="command" />
          </button>
          <button type="button" className="btn home-top__import" onClick={() => fileRef.current?.click()} data-tip="Import a .aether.json file">
            <Icon name="upload" />
            <span className="btn__label">Import</span>
          </button>
          <button type="button" className="btn btn--primary home-top__new" onClick={openNew} data-tip="New project" data-kbd="N">
            <Icon name="plus" />
            <span className="btn__label">New project</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              importFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </header>
        <div className="home__scroll">
          <div className="home__content">{content}</div>
        </div>
      </div>
      <nav className="tabbar" aria-label="Sections">
        {NAV.filter((n) => n.id !== 'published').map((n) => (
          <a key={n.id} href={n.id === 'home' ? '#/' : `#/${n.id}`} className={`tabbar__item${section === n.id ? ' is-active' : ''}`} aria-current={section === n.id ? 'page' : undefined}>
            <Icon name={n.icon} size={20} />
            <span>{n.id === 'docs' ? 'Docs' : n.label}</span>
          </a>
        ))}
        <button type="button" className="tabbar__item" onClick={() => setSettingsOpen(true)}>
          <Icon name="settings" size={20} />
          <span>Settings</span>
        </button>
      </nav>
      {dragging && (
        <div className="dropzone" aria-hidden="true">
          <div className="dropzone__card">
            <Icon name="fileImport" size={20} />
            <span>Drop a .aether.json file to import it</span>
            <span className="dropzone__hint">Up to {Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB</span>
          </div>
        </div>
      )}
      <NewProjectDialog
        open={newOpen}
        onClose={() => store.getState().setNewProjectOpen(false)}
        onPrompt={(p) => void actions.createFromPrompt(p)}
        onBlank={(k) => void actions.createBlank(k)}
        onTemplate={pickTemplate}
        onImport={() => fileRef.current?.click()}
      />
      <RenameDialog
        open={renaming !== null}
        name={renaming?.name ?? ''}
        onClose={() => setRenaming(null)}
        onSave={(name) => {
          if (renaming) void actions.rename(renaming.id, name);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete project?"
        description={deleting ? `“${deleting.name}” will be removed from this browser. You can undo right after.` : ''}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (deleting) void actions.remove(deleting).then((ok) => ok && afterDelete([deleting.id], describeProjects([deleting])));
        }}
        onClose={() => setDeleting(null)}
      />
      <ConfirmDialog
        open={bulkOpen}
        title={`Delete ${selection.size} ${selection.size === 1 ? 'project' : 'projects'}?`}
        description={`${describeProjects(chosen)} will be removed from this browser. One Undo restores ${selection.size === 1 ? 'it' : 'all of them'}.`}
        confirmLabel={`Delete ${selection.size}`}
        danger
        onConfirm={() => void deleteSelected()}
        onClose={() => setBulkOpen(false)}
      />
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        update={(p) => store.getState().updateSettings(p)}
        ai={{
          prefs: aiPrefs,
          update: (p) =>
            setAiPrefs((cur) => {
              const next = parsePrefs({ ...cur, ...p });
              saveAiPrefs(browserStorage(), next);
              return next;
            }),
        }}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => store.getState().setPaletteOpen(false)}
        commands={commands}
        placeholder="Search projects, templates, actions — or describe a world…"
        fallback={newFromPrompt}
      />
      <ToastStack toasts={toasts} onDismiss={store.getState().dismissToast} />
      <ShortcutsDialog />
    </div>
  );
});
