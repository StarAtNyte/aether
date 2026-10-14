/**
 * What was published from this browser (the publish library): games,
 * videos, renders, models, floor plans, links, hosting and network shares,
 * newest first, filterable by kind, with the files kept for re-download.
 * `RecentlyPublished` is the short row on the home dashboard.
 */
import { memo, useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useApp } from '../app/appContext';
import { Icon, type IconName } from '../components/Icon';
import { formatRelative } from '../lib/relativeTime';
import { publishLibrary, type PublishedItem, type PublishKind } from '../publish/library';
import '../styles/published.css';

const KINDS: ReadonlyArray<[PublishKind | 'all', string, IconName]> = [
  ['all', 'All', 'globe'],
  ['game', 'Games', 'gamepad'],
  ['video', 'Videos', 'film'],
  ['render', 'Renders', 'image'],
  ['model', '3D models', 'box3d'],
  ['plan', 'Floor plans', 'plan'],
  ['link', 'Links', 'link'],
  ['hosting', 'Hosted', 'rocket'],
];
const ICON: Readonly<Record<PublishKind, IconName>> = { game: 'gamepad', video: 'film', render: 'image', model: 'box3d', plan: 'plan', link: 'link', hosting: 'rocket', lan: 'wifi' };
const LABEL: Readonly<Record<PublishKind, string>> = { game: 'Game', video: 'Video', render: 'Render', model: '3D model', plan: 'Floor plan', link: 'Share link', hosting: 'Hosted', lan: 'Network' };

/** Items of the library, kept fresh. */
function usePublished(): PublishedItem[] | null {
  const [items, setItems] = useState<PublishedItem[] | null>(null);
  useEffect(() => {
    let alive = true;
    let off: (() => void) | null = null;
    void publishLibrary().then((lib) => {
      const load = (): void => void lib.items().then((list) => alive && setItems(list));
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

async function download(item: PublishedItem): Promise<void> {
  const blob = await (await publishLibrary()).file(item.id);
  if (!blob) return;
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

const Card = memo(function Card({ item, now, onOpenProject }: { item: PublishedItem; now: number; onOpenProject: (id: string) => void }): ReactElement {
  const [busy, setBusy] = useState(false);
  return (
    <li className="pubcard">
      <div className="pubcard__media">
        {item.thumb ? <img src={item.thumb} alt="" loading="lazy" /> : <Icon name={ICON[item.kind]} size={20} />}
        <span className="pubcard__kind">
          <Icon name={ICON[item.kind]} size={14} /> {LABEL[item.kind]}
        </span>
      </div>
      <div className="pubcard__body">
        <span className="pubcard__title" title={item.title}>
          {item.title}
        </span>
        <span className="pubcard__detail" title={item.detail}>
          {item.detail}
        </span>
        <span className="pubcard__time">{formatRelative(item.createdAt, now)}</span>
      </div>
      <div className="pubcard__actions">
        {item.hasBlob && (
          <button
            type="button"
            className="btn btn--sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void download(item).finally(() => setBusy(false));
            }}
          >
            <Icon name="download" /> Download
          </button>
        )}
        {item.url && (
          <a className="btn btn--sm" href={item.url} target="_blank" rel="noopener noreferrer">
            <Icon name="external" /> Open
          </a>
        )}
        {item.projectId && (
          <button type="button" className="icon-btn icon-btn--sm" aria-label="Open the project" data-tip="Open the project" onClick={() => onOpenProject(item.projectId as string)}>
            <Icon name="pencil" />
          </button>
        )}
        <button type="button" className="icon-btn icon-btn--sm" aria-label="Remove from the list" data-tip="Remove from the list" onClick={() => void publishLibrary().then((lib) => lib.remove(item.id))}>
          <Icon name="trash" />
        </button>
      </div>
    </li>
  );
});

/** The Published page. */
export const PublishedPage = memo(function PublishedPage({ now }: { now: number }): ReactElement {
  const items = usePublished();
  const { navigate } = useApp();
  const [kind, setKind] = useState<PublishKind | 'all'>('all');
  const shown = useMemo(() => (items ?? []).filter((i) => kind === 'all' || i.kind === kind || (kind === 'hosting' && i.kind === 'lan')), [items, kind]);
  const openProject = useCallback((id: string) => navigate({ name: 'editor', id }), [navigate]);
  if (items === null) return <div className="pubgrid pubgrid--loading" aria-busy="true" />;
  if (items.length === 0)
    return (
      <div className="empty-state empty-state--page">
        <span className="empty-state__icon">
          <Icon name="rocket" size={20} />
        </span>
        <h3 className="empty-state__title">Nothing published yet</h3>
        <p className="empty-state__text">Open a project and press Publish: download it as a game for itch.io or any website, put it on your own Netlify, Vercel or GitHub Pages, render a video or a 4K still, export a 3D model or a floor plan, or copy a link that plays the world — no upload needed.</p>
      </div>
    );
  return (
    <section className="home-section" data-testid="published-page">
      <div className="pubfilters" role="group" aria-label="Filter by kind">
        {KINDS.map(([k, label, icon]) => (
          <button key={k} type="button" className={`chip chip--action${kind === k ? ' is-on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
            <Icon name={icon} size={14} /> {label}
          </button>
        ))}
      </div>
      <ul className="pubgrid">
        {shown.map((item) => (
          <Card key={item.id} item={item} now={now} onOpenProject={openProject} />
        ))}
      </ul>
    </section>
  );
});

/** The latest few published items (home dashboard); nothing when there are none. */
export const RecentlyPublished = memo(function RecentlyPublished({ now }: { now: number }): ReactElement | null {
  const items = usePublished();
  const { navigate } = useApp();
  const openProject = useCallback((id: string) => navigate({ name: 'editor', id }), [navigate]);
  if (!items || items.length === 0) return null;
  return (
    <section className="home-section" aria-labelledby="h-published">
      <div className="section-head">
        <h2 id="h-published" className="section-head__title">
          Recently published
        </h2>
        <a className="link" href="#/published">
          View all
        </a>
      </div>
      <ul className="pubgrid pubgrid--row">
        {items.slice(0, 4).map((item) => (
          <Card key={item.id} item={item} now={now} onOpenProject={openProject} />
        ))}
      </ul>
    </section>
  );
});
