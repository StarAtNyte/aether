/** Template and project cards for the home page (grid and list variants). */
import { memo, useState, type ReactElement } from 'react';
import { TEMPLATE_KIND_LABEL, templateThumbnail, type WorldTemplate } from '../lib/examples';
import { formatRelative, formatTimestamp } from '../lib/relativeTime';
import type { ProjectMeta } from '../projects/model';
import { Icon } from '../components/Icon';
import { Menu, type MenuEntry } from '../components/ui/Menu';

/** Thumbnail frame: the image, or a quiet placeholder when there is none (or it fails to load). */
export const Thumb = memo(function Thumb({ src, alt, eager }: { src: string | null; alt: string; eager?: boolean }): ReactElement {
  const [failed, setFailed] = useState(false);
  return (
    <span className="thumb">
      {src && !failed ? (
        <img src={src} alt={alt} width={480} height={270} loading={eager ? 'eager' : 'lazy'} decoding="async" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span className="thumb__empty">
          <Icon name="image" />
          <span>No preview</span>
        </span>
      )}
    </span>
  );
});

/** A template card (click creates a project from it). */
export const TemplateCard = memo(function TemplateCard({ template, onPick, eager }: { template: WorldTemplate; onPick: (slug: string) => void; eager?: boolean }): ReactElement {
  return (
    <button type="button" className="card card--template" onClick={() => onPick(template.slug)} aria-label={`New project from template: ${template.title}`}>
      <Thumb src={templateThumbnail(template.slug)} alt="" eager={eager} />
      <span className="card__body">
        <span className="card__title-row">
          <span className="card__title">{template.title}</span>
          <span className="card__label">{TEMPLATE_KIND_LABEL[template.kind]}</span>
        </span>
        <span className="card__desc" title={`${template.description}\nPrompt: “${template.prompt}”`}>
          {template.description}
        </span>
      </span>
    </button>
  );
});

/** Callbacks of a project card's menu. */
export interface ProjectCardActions {
  onOpen: (p: ProjectMeta) => void;
  onRename: (p: ProjectMeta) => void;
  onDuplicate: (p: ProjectMeta) => void;
  onExport: (p: ProjectMeta) => void;
  onDelete: (p: ProjectMeta) => void;
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
      items={projectMenu(project, actions)}
      trigger={(t) => (
        <button {...t} type="button" className="icon-btn icon-btn--sm card__menu" aria-label={`Actions for ${project.name}`} data-tip="More actions">
          <Icon name="more" />
        </button>
      )}
    />
  );
});

/** A project card (grid view). */
export const ProjectCard = memo(function ProjectCard({ project, thumb, actions, now }: { project: ProjectMeta; thumb: string | null; actions: ProjectCardActions; now: number }): ReactElement {
  return (
    <div className="card card--project" data-project={project.id}>
      <button type="button" className="card__hit" onClick={() => actions.onOpen(project)} aria-label={`Open ${project.name}`}>
        <Thumb src={thumb} alt="" />
      </button>
      <div className="card__body">
        <div className="card__title-row">
          <span className="card__title" title={project.name}>
            {project.name}
          </span>
          <CardMenu project={project} actions={actions} />
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
export const ProjectRow = memo(function ProjectRow({ project, thumb, actions, now }: { project: ProjectMeta; thumb: string | null; actions: ProjectCardActions; now: number }): ReactElement {
  return (
    <div className="project-row" role="row" data-project={project.id}>
      <button type="button" className="project-row__hit" onClick={() => actions.onOpen(project)} aria-label={`Open ${project.name}`}>
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
        <CardMenu project={project} actions={actions} />
      </span>
    </div>
  );
});
