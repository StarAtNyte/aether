/**
 * Command palette (Ctrl/⌘+K): fuzzy search over actions, entities,
 * projects and templates supplied by the current page. ARIA combobox +
 * listbox; arrows move, Enter runs, Esc closes.
 */
import { memo, useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { fuzzyScore } from '../../lib/fuzzy';
import { Icon, type IconName } from '../Icon';

/** One runnable command. */
export interface Command {
  id: string;
  title: string;
  /** Section header ("Actions", "Objects", "Projects", …). */
  group: string;
  icon?: IconName;
  /** Keyboard shortcut shown on the right. */
  shortcut?: string;
  /** Extra search terms. */
  keywords?: string;
  /** Secondary text on the right (e.g. "Updated 2h ago"). */
  hint?: string;
  run: () => void;
}

const MAX_RESULTS = 60;

function rank(commands: readonly Command[], query: string): Command[] {
  const q = query.trim();
  if (q === '') return commands.slice(0, MAX_RESULTS);
  const scored: Array<{ c: Command; s: number; i: number }> = [];
  commands.forEach((c, i) => {
    const a = fuzzyScore(q, c.title);
    const b = c.keywords ? fuzzyScore(q, c.keywords) : null;
    const s = Math.max(a ?? -Infinity, b === null ? -Infinity : b - 50);
    if (Number.isFinite(s)) scored.push({ c, s, i });
  });
  scored.sort((x, y) => y.s - x.s || x.i - y.i);
  return scored.slice(0, MAX_RESULTS).map((x) => x.c);
}

/** Command palette overlay. */
export const CommandPalette = memo(function CommandPalette({ open, onClose, commands, placeholder = 'Type a command or search…' }: { open: boolean; onClose: () => void; commands: readonly Command[]; placeholder?: string }): ReactElement | null {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<Element | null>(null);
  const listId = useId();
  const results = useMemo(() => rank(commands, query), [commands, query]);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    setQuery('');
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      const el = restoreRef.current;
      if (el instanceof HTMLElement && el.isConnected) el.focus();
    };
  }, [open]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const runAt = (i: number): void => {
    const c = results[i];
    if (!c) return;
    onClose();
    c.run();
  };

  let lastGroup = '';
  return createPortal(
    <div
      className="palette-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette__search">
          <Icon name="search" />
          <input
            ref={inputRef}
            className="palette__input"
            value={query}
            maxLength={64}
            placeholder={placeholder}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                runAt(active);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }
            }}
          />
          <kbd className="palette__esc">Esc</kbd>
        </div>
        <div ref={listRef} id={listId} className="palette__list" role="listbox" aria-label="Results">
          {results.length === 0 && <div className="palette__empty">No results for “{query.trim()}”</div>}
          {results.map((c, i) => {
            const header = query.trim() === '' && c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id} role="presentation">
                {header && <div className="palette__group">{header}</div>}
                <div
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className={`palette__item${i === active ? ' is-active' : ''}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => runAt(i)}
                >
                  <span className="palette__icon">{c.icon && <Icon name={c.icon} />}</span>
                  <span className="palette__title">{c.title}</span>
                  {query.trim() !== '' && <span className="palette__meta">{c.group}</span>}
                  {c.hint && <span className="palette__meta">{c.hint}</span>}
                  {c.shortcut && <kbd className="palette__kbd">{c.shortcut}</kbd>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="palette__footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> run
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
});
