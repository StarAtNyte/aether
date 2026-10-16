import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Template and project cards for the home page (grid and list variants). */
import { memo, useState } from 'react';
import { TEMPLATE_KIND_LABEL, templateThumbnail } from '../lib/examples';
import { formatRelative, formatTimestamp } from '../lib/relativeTime';
import { Icon } from '../components/Icon';
import { Menu } from '../components/ui/Menu';
/** Thumbnail frame: the image, or a quiet placeholder when there is none (or it fails to load). */
export const Thumb = memo(function Thumb({ src, alt, eager }) {
    const [failed, setFailed] = useState(false);
    return (_jsx("span", { className: "thumb", children: src && !failed ? (_jsx("img", { src: src, alt: alt, width: 480, height: 270, loading: eager ? 'eager' : 'lazy', decoding: "async", draggable: false, onError: () => setFailed(true) })) : (_jsxs("span", { className: "thumb__empty", children: [_jsx(Icon, { name: "image" }), _jsx("span", { children: "No preview" })] })) }));
});
/** A template card (click creates a project from it). */
export const TemplateCard = memo(function TemplateCard({ template, onPick, eager }) {
    return (_jsxs("button", { type: "button", className: "card card--template", onClick: () => onPick(template.slug), "aria-label": `New project from template: ${template.title}`, children: [_jsx(Thumb, { src: templateThumbnail(template.slug), alt: "", eager: eager }), _jsxs("span", { className: "card__body", children: [_jsxs("span", { className: "card__title-row", children: [_jsx("span", { className: "card__title", children: template.title }), _jsx("span", { className: "card__label", children: TEMPLATE_KIND_LABEL[template.kind] })] }), _jsx("span", { className: "card__desc", title: `${template.description}\nPrompt: “${template.prompt}”`, children: template.description })] })] }));
});
function projectMenu(p, a) {
    return [
        { id: 'open', label: 'Open', icon: 'external', onSelect: () => a.onOpen(p) },
        { id: 'rename', label: 'Rename…', icon: 'pencil', onSelect: () => a.onRename(p) },
        { id: 'duplicate', label: 'Duplicate', icon: 'copy', onSelect: () => a.onDuplicate(p) },
        { id: 'export', label: 'Export .aether.json', icon: 'download', onSelect: () => a.onExport(p) },
        { kind: 'separator', id: 'sep' },
        { id: 'delete', label: 'Delete…', icon: 'trash', danger: true, onSelect: () => a.onDelete(p) },
    ];
}
const CardMenu = memo(function CardMenu({ project, actions }) {
    return (_jsx(Menu, { label: `${project.name} actions`, align: "end", items: projectMenu(project, actions), trigger: (t) => (_jsx("button", { ...t, type: "button", className: "icon-btn icon-btn--sm card__menu", "aria-label": `Actions for ${project.name}`, "data-tip": "More actions", children: _jsx(Icon, { name: "more" }) })) }));
});
/** A project card (grid view). */
export const ProjectCard = memo(function ProjectCard({ project, thumb, actions, now }) {
    return (_jsxs("div", { className: "card card--project", "data-project": project.id, children: [_jsx("button", { type: "button", className: "card__hit", onClick: () => actions.onOpen(project), "aria-label": `Open ${project.name}`, children: _jsx(Thumb, { src: thumb, alt: "" }) }), _jsxs("div", { className: "card__body", children: [_jsxs("div", { className: "card__title-row", children: [_jsx("span", { className: "card__title", title: project.name, children: project.name }), _jsx(CardMenu, { project: project, actions: actions })] }), _jsxs("div", { className: "card__meta", children: [_jsxs("span", { title: formatTimestamp(project.updatedAt), children: ["Edited ", formatRelative(project.updatedAt, now).replace(/^Just now$/, 'just now')] }), _jsx("span", { className: "badge", children: "Local" })] })] })] }));
});
/** A project row (list view). */
export const ProjectRow = memo(function ProjectRow({ project, thumb, actions, now }) {
    return (_jsxs("div", { className: "project-row", role: "row", "data-project": project.id, children: [_jsxs("button", { type: "button", className: "project-row__hit", onClick: () => actions.onOpen(project), "aria-label": `Open ${project.name}`, children: [_jsx(Thumb, { src: thumb, alt: "" }), _jsx("span", { className: "project-row__name", title: project.name, children: project.name })] }), _jsxs("span", { className: "project-row__cell project-row__cell--num", role: "cell", children: [project.entityCount, " ", project.entityCount === 1 ? 'object' : 'objects'] }), _jsx("span", { className: "project-row__cell", role: "cell", title: formatTimestamp(project.updatedAt), children: formatRelative(project.updatedAt, now) }), _jsx("span", { className: "project-row__cell project-row__cell--wide", role: "cell", title: formatTimestamp(project.createdAt), children: formatRelative(project.createdAt, now) }), _jsx("span", { className: "project-row__menu", role: "cell", children: _jsx(CardMenu, { project: project, actions: actions }) })] }));
});
