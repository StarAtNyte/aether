/**
 * Entity tree: search, selection synced with the viewport (selected rows
 * scroll into view, ancestors expand), focus, visibility, lock, delete, and
 * drag-and-drop re-parenting (drop on a row to nest, on the top band to
 * un-nest; world poses are kept). Virtualized above 300 rows.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactElement } from 'react';
import { OUTLINER_ROW_HEIGHT, OUTLINER_VIRTUALIZE_THRESHOLD } from '../../config';
import { useStudio, useUI, useWorld } from '../../app/context';
import { buildOutlinerRows, visibleRange, type OutlinerRow, type RowKind } from '../../lib/outliner';
import { Icon, type IconName } from '../Icon';

const KIND_ICON: Record<RowKind, IconName> = {
  light: 'lightbulb',
  scatter: 'grid',
  procedural: 'box3d',
  primitive: 'cube',
  model: 'cube',
  mesh: 'mesh',
  group: 'folder',
  template: 'copy',
};

/** Drag-and-drop MIME type of outliner rows (payload: JSON list of ids). */
export const OUTLINER_DRAG_TYPE = 'application/x-aether-entities';

interface RowProps {
  row: OutlinerRow;
  selected: boolean;
  collapsed: boolean;
  disabled: boolean;
  dropTarget: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onFocus: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onToggleVisible: (id: string, visible: boolean) => void;
  onToggleLock: (id: string, locked: boolean) => void;
  onDelete: (id: string) => void;
  onDragStart: (id: string, e: DragEvent) => void;
  onDragOver: (id: string, e: DragEvent) => void;
  onDrop: (id: string, e: DragEvent) => void;
}

const Row = memo(function Row(p: RowProps): ReactElement {
  const { row, selected, collapsed, disabled } = p;
  return (
    <div
      className={`outliner-row${selected ? ' is-selected' : ''}${row.visible ? '' : ' is-hidden'}${row.locked ? ' is-locked' : ''}${p.dropTarget ? ' is-drop' : ''}`}
      style={{ paddingLeft: 8 + row.depth * 16 }}
      role="treeitem"
      aria-selected={selected}
      aria-level={row.depth + 1}
      aria-expanded={row.childCount > 0 ? !collapsed : undefined}
      tabIndex={selected ? 0 : -1}
      data-id={row.id}
      draggable={!disabled}
      onDragStart={(e) => p.onDragStart(row.id, e)}
      onDragOver={(e) => p.onDragOver(row.id, e)}
      onDrop={(e) => p.onDrop(row.id, e)}
      onClick={(e) => p.onSelect(row.id, e.shiftKey || e.metaKey || e.ctrlKey)}
      onDoubleClick={() => p.onFocus(row.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') p.onFocus(row.id);
      }}
    >
      {row.childCount > 0 ? (
        <button
          type="button"
          className="outliner-row__caret"
          aria-label={collapsed ? 'Expand' : 'Collapse'}
          onClick={(e) => {
            e.stopPropagation();
            p.onToggleCollapse(row.id);
          }}
        >
          <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} />
        </button>
      ) : (
        <span className="outliner-row__caret" aria-hidden="true" />
      )}
      <Icon name={KIND_ICON[row.kind]} className="outliner-row__icon" />
      <span className="outliner-row__name" title={row.id}>
        {row.name}
      </span>
      {row.tags.slice(0, 1).map((t) => (
        <span key={t} className="outliner-row__tag" title={`#${t}`}>
          #{t}
        </span>
      ))}
      {row.hasBehaviors && <Icon name="zap" className="outliner-row__flag" label="Has behaviours" />}
      {row.locked && <Icon name="lock" className="outliner-row__flag outliner-row__lock" label="Locked" />}
      <span className="outliner-row__actions">
        <button
          type="button"
          className="icon-btn icon-btn--xs"
          title="Focus camera"
          aria-label={`Focus ${row.name}`}
          onClick={(e) => {
            e.stopPropagation();
            p.onFocus(row.id);
          }}
        >
          <Icon name="target" />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--xs"
          disabled={disabled}
          title={row.locked ? 'Unlock' : 'Lock'}
          aria-label={row.locked ? `Unlock ${row.name}` : `Lock ${row.name}`}
          onClick={(e) => {
            e.stopPropagation();
            p.onToggleLock(row.id, !row.locked);
          }}
        >
          <Icon name={row.locked ? 'lock' : 'unlock'} />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--xs"
          disabled={disabled}
          title={row.visible ? 'Hide' : 'Show'}
          aria-label={row.visible ? `Hide ${row.name}` : `Show ${row.name}`}
          onClick={(e) => {
            e.stopPropagation();
            p.onToggleVisible(row.id, !row.visible);
          }}
        >
          <Icon name={row.visible ? 'eye' : 'eyeOff'} />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--xs"
          disabled={disabled || row.locked}
          title="Delete"
          aria-label={`Delete ${row.name}`}
          onClick={(e) => {
            e.stopPropagation();
            p.onDelete(row.id);
          }}
        >
          <Icon name="trash" />
        </button>
      </span>
    </div>
  );
});

/** Parse an outliner drag payload (ids), defensively. */
export function parseDragIds(text: string): string[] {
  if (typeof text !== 'string' || text.length === 0 || text.length > 200_000) return [];
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(x)).slice(0, 2000) : [];
  } catch {
    return [];
  }
}

/** Entity tree with search, focus, visibility, lock, delete and drag-to-reparent; virtualized above 300 rows. */
export const Outliner = memo(function Outliner(): ReactElement {
  const studio = useStudio();
  const world = useWorld();
  const selection = useUI((s) => s.selection);
  const filter = useUI((s) => s.outlinerFilter);
  const playing = useUI((s) => s.mode === 'play');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [scroll, setScroll] = useState({ top: 0, height: 600 });
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [rootDrop, setRootDrop] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<string | null>(null);

  const rows = useMemo(() => buildOutlinerRows(world, filter, collapsed), [world, filter, collapsed]);
  const selected = useMemo(() => new Set(selection), [selection]);
  const virtual = rows.length > OUTLINER_VIRTUALIZE_THRESHOLD;
  const range = virtual ? visibleRange(rows.length, OUTLINER_ROW_HEIGHT, scroll.top, scroll.height) : { start: 0, end: rows.length };

  // Viewport → outliner: expand the ancestors of a newly selected entity and scroll it into view.
  useEffect(() => {
    const id = selection[selection.length - 1];
    if (!id || filter) return;
    const ancestors: string[] = [];
    for (let p = world.entities[id]?.parent ?? null, guard = 0; p !== null && guard < 64; guard++, p = world.entities[p]?.parent ?? null) ancestors.push(p);
    if (ancestors.some((a) => collapsed.has(a))) {
      setCollapsed((prev) => {
        const next = new Set(prev);
        for (const a of ancestors) next.delete(a);
        return next;
      });
      return;
    }
    const list = listRef.current;
    if (!list) return;
    const index = rows.findIndex((r) => r.id === id);
    if (index < 0) return;
    const top = index * OUTLINER_ROW_HEIGHT;
    if (top < list.scrollTop || top + OUTLINER_ROW_HEIGHT > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 2);
    }
    // Only react to selection changes, not to every world edit.
  }, [selection]);

  const onSelect = useCallback(
    (id: string, additive: boolean) => {
      anchor.current = id;
      studio.pick(id, additive);
    },
    [studio],
  );
  const onFocus = useCallback((id: string) => studio.focus(id), [studio]);
  const onToggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const onToggleVisible = useCallback((id: string, visible: boolean) => studio.editor.setHidden([id], !visible), [studio]);
  const onToggleLock = useCallback((id: string, locked: boolean) => studio.editor.setLocked([id], locked), [studio]);
  const onDelete = useCallback((id: string) => studio.deleteEntities([id]), [studio]);
  const onDragStart = useCallback(
    (id: string, e: DragEvent) => {
      const sel = studio.store.getState().selection;
      const ids = sel.includes(id) ? sel : [id];
      e.dataTransfer.setData(OUTLINER_DRAG_TYPE, JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'move';
    },
    [studio],
  );
  const onDragOver = useCallback((id: string, e: DragEvent) => {
    if (![...e.dataTransfer.types].includes(OUTLINER_DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDropOn(id);
    setRootDrop(false);
  }, []);
  const onDrop = useCallback(
    (id: string, e: DragEvent) => {
      setDropOn(null);
      const ids = parseDragIds(e.dataTransfer.getData(OUTLINER_DRAG_TYPE)).filter((x) => x !== id);
      if (ids.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      studio.editor.reparent(ids, id);
    },
    [studio],
  );

  const total = Object.keys(world.entities).length;

  return (
    <div className="outliner">
      <div className="panel-toolbar">
        <label className="search-field search-field--sm">
          <Icon name="search" />
          <input type="search" value={filter} placeholder="Search objects or #tag" aria-label="Search objects" onChange={(e) => studio.store.getState().setOutlinerFilter(e.target.value)} />
        </label>
        <span className="panel-toolbar__count">{filter ? `${rows.length} / ${total}` : total}</span>
      </div>
      {rows.length === 0 ? (
        <p className="panel-empty">{total === 0 ? 'The world is empty. Describe something to the agent or add an asset.' : 'No matching objects.'}</p>
      ) : (
        <div
          className={`outliner__list scroll-y${rootDrop ? ' is-root-drop' : ''}`}
          ref={listRef}
          role="tree"
          aria-label="Entities"
          aria-multiselectable="true"
          onScroll={virtual ? (e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight }) : undefined}
          onDragOver={(e) => {
            if (![...e.dataTransfer.types].includes(OUTLINER_DRAG_TYPE)) return;
            e.preventDefault();
            setDropOn(null);
            setRootDrop(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setRootDrop(false);
          }}
          onDrop={(e) => {
            setRootDrop(false);
            setDropOn(null);
            const ids = parseDragIds(e.dataTransfer.getData(OUTLINER_DRAG_TYPE));
            if (ids.length === 0) return;
            e.preventDefault();
            studio.editor.reparent(ids, null);
          }}
          onDragEnd={() => {
            setDropOn(null);
            setRootDrop(false);
          }}
        >
          <div style={virtual ? { height: rows.length * OUTLINER_ROW_HEIGHT, position: 'relative' } : undefined}>
            <div style={virtual ? { transform: `translateY(${range.start * OUTLINER_ROW_HEIGHT}px)` } : undefined}>
              {rows.slice(range.start, range.end).map((row) => (
                <Row
                  key={row.id}
                  row={row}
                  selected={selected.has(row.id)}
                  collapsed={collapsed.has(row.id)}
                  disabled={playing}
                  dropTarget={dropOn === row.id}
                  onSelect={onSelect}
                  onFocus={onFocus}
                  onToggleCollapse={onToggleCollapse}
                  onToggleVisible={onToggleVisible}
                  onToggleLock={onToggleLock}
                  onDelete={onDelete}
                  onDragStart={onDragStart}
                  onDragOver={onDragOver}
                  onDrop={onDrop}
                />
              ))}
            </div>
          </div>
          <p className="outliner__hint">Drag onto an object to nest it; drop here to move it to the top level.</p>
        </div>
      )}
    </div>
  );
});
