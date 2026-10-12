import { memo, useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { OUTLINER_ROW_HEIGHT, OUTLINER_VIRTUALIZE_THRESHOLD } from '../../config';
import { useStudio, useUI, useWorld } from '../../app/context';
import { buildOutlinerRows, visibleRange, type OutlinerRow, type RowKind } from '../../lib/outliner';
import { Icon, type IconName } from '../Icon';

const KIND_ICON: Record<RowKind, IconName> = {
  light: 'sparkles',
  scatter: 'branch',
  procedural: 'wand',
  primitive: 'cube',
  model: 'cube',
  group: 'list',
  template: 'copy',
};

interface RowProps {
  row: OutlinerRow;
  selected: boolean;
  collapsed: boolean;
  disabled: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onFocus: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onToggleVisible: (id: string, visible: boolean) => void;
  onDelete: (id: string) => void;
}

const Row = memo(function Row({ row, selected, collapsed, disabled, onSelect, onFocus, onToggleCollapse, onToggleVisible, onDelete }: RowProps): ReactElement {
  return (
    <div
      className={`outliner-row${selected ? ' is-selected' : ''}${row.visible ? '' : ' is-hidden'}`}
      style={{ paddingLeft: 8 + row.depth * 14 }}
      role="treeitem"
      aria-selected={selected}
      aria-level={row.depth + 1}
      aria-expanded={row.childCount > 0 ? !collapsed : undefined}
      tabIndex={selected ? 0 : -1}
      onClick={(e) => onSelect(row.id, e.shiftKey || e.metaKey || e.ctrlKey)}
      onDoubleClick={() => onFocus(row.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onFocus(row.id);
      }}
    >
      {row.childCount > 0 ? (
        <button
          type="button"
          className="outliner-row__caret"
          aria-label={collapsed ? 'Expand' : 'Collapse'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse(row.id);
          }}
        >
          <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={11} />
        </button>
      ) : (
        <span className="outliner-row__caret" aria-hidden="true" />
      )}
      <Icon name={KIND_ICON[row.kind]} size={13} className={`kind kind--${row.kind}`} />
      <span className="outliner-row__name" title={row.id}>
        {row.name}
      </span>
      {row.dynamic && <span className="mini-badge" title="Dynamic physics body">dyn</span>}
      {row.hasBehaviors && <span className="mini-badge mini-badge--logic" title="Has behaviors">fx</span>}
      {row.tags.slice(0, 2).map((t) => (
        <span key={t} className="tag">
          #{t}
        </span>
      ))}
      <span className="outliner-row__actions">
        <button
          type="button"
          className="icon-btn icon-btn--xs"
          title="Focus camera"
          aria-label={`Focus ${row.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onFocus(row.id);
          }}
        >
          <Icon name="target" size={12} />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--xs"
          disabled={disabled}
          title={row.visible ? 'Hide' : 'Show'}
          aria-label={row.visible ? `Hide ${row.name}` : `Show ${row.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisible(row.id, !row.visible);
          }}
        >
          <Icon name={row.visible ? 'eye' : 'eyeOff'} size={12} />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--xs icon-btn--danger"
          disabled={disabled}
          title="Delete"
          aria-label={`Delete ${row.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(row.id);
          }}
        >
          <Icon name="trash" size={12} />
        </button>
      </span>
    </div>
  );
});

/** Entity tree with search, focus, visibility and delete; virtualized above 300 rows. */
export const Outliner = memo(function Outliner(): ReactElement {
  const studio = useStudio();
  const world = useWorld();
  const selection = useUI((s) => s.selection);
  const filter = useUI((s) => s.outlinerFilter);
  const playing = useUI((s) => s.mode === 'play');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [scroll, setScroll] = useState({ top: 0, height: 600 });
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => buildOutlinerRows(world, filter, collapsed), [world, filter, collapsed]);
  const selected = useMemo(() => new Set(selection), [selection]);
  const virtual = rows.length > OUTLINER_VIRTUALIZE_THRESHOLD;
  const range = virtual ? visibleRange(rows.length, OUTLINER_ROW_HEIGHT, scroll.top, scroll.height) : { start: 0, end: rows.length };

  const onSelect = useCallback(
    (id: string, additive: boolean) => {
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
  const onToggleVisible = useCallback((id: string, visible: boolean) => studio.commitUser([{ op: 'update', id, set: { visible } }], `${visible ? 'Show' : 'Hide'} ${id}`), [studio]);
  const onDelete = useCallback((id: string) => studio.deleteEntities([id]), [studio]);

  const total = Object.keys(world.entities).length;

  return (
    <div className="outliner">
      <div className="panel-toolbar">
        <label className="search">
          <Icon name="search" size={13} />
          <input
            type="search"
            value={filter}
            placeholder="Search entities or #tag"
            aria-label="Search entities"
            onChange={(e) => studio.store.getState().setOutlinerFilter(e.target.value)}
          />
        </label>
        <span className="muted count">{filter ? `${rows.length}/${total}` : total}</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty">{total === 0 ? 'The world is empty — describe something in the chat.' : 'No matching entities.'}</div>
      ) : (
        <div
          className="outliner__list"
          ref={listRef}
          role="tree"
          aria-label="Entities"
          aria-multiselectable="true"
          onScroll={virtual ? (e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight }) : undefined}
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
                  onSelect={onSelect}
                  onFocus={onFocus}
                  onToggleCollapse={onToggleCollapse}
                  onToggleVisible={onToggleVisible}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
