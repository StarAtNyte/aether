/** Template and project cards for the home page (grid and list variants). */
import { memo, useState, type KeyboardEvent, type ReactElement } from 'react';
import { TEMPLATE_KIND_LABEL, templateThumbnail, templateThumbnailSrcSet, type WorldTemplate } from '../lib/examples';
import { formatRelative, formatTimestamp } from '../lib/relativeTime';
import type { ProjectMeta } from '../projects/model';
import { PROVENANCE_LABEL } from '../showcase/manifest';
import { Icon } from '../components/Icon';
import { Menu, type MenuEntry } from '../components/ui/Menu';

/** What a card image's width is, for `sizes`: a grid column (about 380 px), a phone's full width. */
const CARD_SIZES = '(max-width: 639px) 100vw, (max-width: 1279px) 33vw, 380px';

/** Thumbnail frame: the image, or a quiet placeholder when there is none (or it fails to load). */
export const Thumb = memo(function Thumb({ src, alt, eager, srcSet, sizes }: { src: string | null; alt: string; eager?: boolean; srcSet?: string; sizes?: string }): ReactElement {
  const [failed, setFailed] = useState(false);
  return (
    <span className="thumb">
      {src && !failed ? (
        <img src={src} srcSet={srcSet} sizes={srcSet ? sizes ?? CARD_SIZES : undefined} alt={alt} width={480} height={270} loading={eager ? 'eager' : 'lazy'} decoding="async" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span className="thumb__empty">
          <Icon name="image" />
          <span>No preview</span>
        </span>
      )}
    </span>
  );
});

/** The player route of a template: its published world, cooked where a package exists (player/source.ts falls back to live). */
export function templatePlayUrl(slug: string): string {
  return `/play#t=${slug}`;
}

/**
 * A template card: the card opens the template in the player as a published world; Remix makes a project of your own
 * from it and opens that in the editor.
 */
export const TemplateCard = memo(function TemplateCard({ template, onPick, eager }: { template: WorldTemplate; onPick: (slug: string) => void; eager?: boolean }): ReactElement {
  return (
    <div className="card card--template">
      <a className="card__hit" href={templatePlayUrl(template.slug)} aria-label={`Play ${template.title}`}>
        <Thumb src={templateThumbnail(template.slug)} srcSet={templateThumbnailSrcSet(template.slug)} alt="" eager={eager} />
        <span className="card__body">
          <span className="card__title-row">
            <span className="card__title">{template.title}</span>
            <span className="card__label">{TEMPLATE_KIND_LABEL[template.kind]}</span>
          </span>
          <span className="card__desc" title={`${template.description}\nPrompt: “${template.prompt}”`}>
            {template.description}
          </span>
          {template.origin === 'agent' && template.provenance && (
            <span className="card__desc" title={`${PROVENANCE_LABEL[template.provenance]}, from the prompt: “${template.prompt}”`}>
              {PROVENANCE_LABEL[template.provenance]}
            </span>
          )}
          {template.origin === 'agent' && (
            <span className="card__desc" title={`Prompt: “${template.prompt}”`}>
              Prompt: “{template.prompt}”
            </span>
          )}
          {template.photo && (
            <span className="card__desc" title={`Photo: ${template.photo.author}, ${template.photo.licence}\n${template.photo.url}`}>
              Rebuilt from a photo by {template.photo.author} ({template.photo.licence})
            </span>
          )}
        </span>
      </a>
      <div className="card__tools">
        <button type="button" className="card__remix" onClick={() => onPick(template.slug)} title="Open a copy in the editor" aria-label={`Remix ${template.title}`}>
          <Icon name="pencil" />
          <span>Remix</span>
        </button>
      </div>
    </div>
  );
});

/** Callbacks of a project card's menu. */
export interface ProjectCardActions {
  onOpen: (p: ProjectMeta) => void;
  onRename: (p: ProjectMeta) => void;
  onDuplicate: (p: ProjectMeta) => void;
  onExport: (p: ProjectMeta) => void;
  onDelete: (p: ProjectMeta) => void;
  /** Flip a project's selection (select mode). */
  onToggle: (p: ProjectMeta) => void;
  /** False for anything that is not a user project (never offered for deletion). */
  canDelete: (p: ProjectMeta) => boolean;
}

/** Select-mode state of one card or row. */
export interface SelectState {
  selecting: boolean;
  selected: boolean;
}

/** Delete / Backspace on a focused card or row asks to delete it (not from inside a menu or a field). */
function deleteKey(e: KeyboardEvent<HTMLElement>, p: ProjectMeta, a: ProjectCardActions): void {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  const t = e.target as HTMLElement;
  // The row's menu is portaled but React still bubbles its events here: only react to the card's own elements.
  if (!e.currentTarget.contains(t) || t.closest('[role="menu"]') || t.tagName === 'INPUT' && t.getAttribute('type') !== 'checkbox') return;
  if (!a.canDelete(p)) return;
  e.preventDefault();
  a.onDelete(p);
}

function projectMenu(p: ProjectMeta, a: ProjectCardActions): MenuEntry[] {
  return [
    { id: 'open', label: 'Open', icon: 'external', onSelect: () => a.onOpen(p) },
    { id: 'rename', label: 'Rename…', icon: 'pencil', onSelect: () => a.onRename(p) },
    { id: 'duplicate', label: 'Duplicate', icon: 'copy', onSelect: () => a.onDuplicate(p) },
    { id: 'export', label: 'Export .aether.json', icon: 'download', onSelect: () => a.onExport(p) },
    { kind: 'separator', id: 'sep' },
    { id: 'delete', label: 'Delete…', icon: 'trash', danger: true, onSelect: () => a.onDelete(p) },
  ];
}

const CardMenu = memo(function CardMenu({ project, actions }: { project: ProjectMeta; actions: ProjectCardActions }): ReactElement {
  return (
    <Menu
      label={`${project.name} actions`}
      align="end"
      items={projectMenu(project, actions).filter((m) => m.id !== 'delete' && m.id !== 'sep' || actions.canDelete(project))}
      trigger={(t) => (
        <button {...t} type="button" className="icon-btn card__menu" aria-label={`Actions for ${project.name}`} data-tip="More actions">
          <Icon name="more" />
        </button>
      )}
    />
  );
});

/** Quick delete button (opens the confirm; the menu keeps its own Delete entry). */
const TrashButton = memo(function TrashButton({ project, actions }: { project: ProjectMeta; actions: ProjectCardActions }): ReactElement | null {
  if (!actions.canDelete(project)) return null;
  return (
    <button type="button" className="icon-btn card__trash" aria-label={`Delete ${project.name}`} data-tip="Delete" onClick={() => actions.onDelete(project)}>
      <Icon name="trash" />
    </button>
  );
});

/** Selection checkbox of a card or row. */
const SelectBox = memo(function SelectBox({ project, selected, actions }: { project: ProjectMeta; selected: boolean; actions: ProjectCardActions }): ReactElement {
  return (
    <input
      type="checkbox"
      className="select-box"
      checked={selected}
      disabled={!actions.canDelete(project)}
      aria-label={`Select ${project.name}`}
      onChange={() => actions.onToggle(project)}
    />
  );
});

/** A project card (grid view). */
export const ProjectCard = memo(function ProjectCard({ project, thumb, actions, now, selecting, selected }: { project: ProjectMeta; thumb: string | null; actions: ProjectCardActions; now: number } & SelectState): ReactElement {
  return (
    <div className={`card card--project${selected ? ' is-selected' : ''}`} data-project={project.id} onKeyDown={(e) => deleteKey(e, project, actions)}>
      <button type="button" className="card__hit" onClick={() => (selecting ? actions.onToggle(project) : actions.onOpen(project))} aria-label={selecting ? `Select ${project.name}` : `Open ${project.name}`} aria-pressed={selecting ? selected : undefined}>
        <Thumb src={thumb} alt="" />
      </button>
      <div className="card__tools">
        {selecting ? (
          <SelectBox project={project} selected={selected} actions={actions} />
        ) : (
          <>
            <TrashButton project={project} actions={actions} />
            <CardMenu project={project} actions={actions} />
          </>
        )}
      </div>
      <div className="card__body">
        <div className="card__title-row">
          <span className="card__title" title={project.name}>
            {project.name}
          </span>
        </div>
        <div className="card__meta">
          <span title={formatTimestamp(project.updatedAt)}>Edited {formatRelative(project.updatedAt, now).replace(/^Just now$/, 'just now')}</span>
          <span className="badge">Local</span>
        </div>
      </div>
    </div>
  );
});

/** A project row (list view). */
export const ProjectRow = memo(function ProjectRow({ project, thumb, actions, now, selecting, selected }: { project: ProjectMeta; thumb: string | null; actions: ProjectCardActions; now: number } & SelectState): ReactElement {
  return (
    <div className={`project-row${selected ? ' is-selected' : ''}`} role="row" data-project={project.id} onKeyDown={(e) => deleteKey(e, project, actions)}>
      <button type="button" className="project-row__hit" onClick={() => (selecting ? actions.onToggle(project) : actions.onOpen(project))} aria-label={selecting ? `Select ${project.name}` : `Open ${project.name}`} aria-pressed={selecting ? selected : undefined}>
        <Thumb src={thumb} alt="" />
        <span className="project-row__name" title={project.name}>
          {project.name}
        </span>
      </button>
      <span className="project-row__cell project-row__cell--num" role="cell">
        {project.entityCount} {project.entityCount === 1 ? 'object' : 'objects'}
      </span>
      <span className="project-row__cell" role="cell" title={formatTimestamp(project.updatedAt)}>
        {formatRelative(project.updatedAt, now)}
      </span>
      <span className="project-row__cell project-row__cell--wide" role="cell" title={formatTimestamp(project.createdAt)}>
        {formatRelative(project.createdAt, now)}
      </span>
      <span className="project-row__menu" role="cell">
        {selecting ? (
          <SelectBox project={project} selected={selected} actions={actions} />
        ) : (
          <>
            <TrashButton project={project} actions={actions} />
            <CardMenu project={project} actions={actions} />
          </>
        )}
      </span>
    </div>
  );
});
