/**
 * Assets: the object palette as large tiles with rendered previews, grouped
 * by section. Click places an object at the centre of the view; tiles can
 * also be dragged onto the viewport.
 */
import { memo, useMemo, useState, type ReactElement } from 'react';
import { useStudio, useUI } from '../app/context';
import { fuzzyScore } from '../lib/fuzzy';
import { PALETTE_ITEMS, PALETTE_SECTIONS, type PaletteItem } from '../lib/palette';
import { Icon } from '../components/Icon';

/** Drag-and-drop MIME type of palette tiles. */
export const PALETTE_DRAG_TYPE = 'application/x-aether-palette';

const Tile = memo(function Tile({ item, disabled, onPlace }: { item: PaletteItem; disabled: boolean; onPlace: (id: string) => void }): ReactElement {
  // Lights have no geometry to render: they get an icon instead of a preview image.
  const [failed, setFailed] = useState(item.entity.shape === undefined);
  return (
    <button
      type="button"
      className="tile"
      disabled={disabled}
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData(PALETTE_DRAG_TYPE, item.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => onPlace(item.id)}
      aria-label={`Add ${item.label}`}
      title={`Add ${item.label}`}
    >
      <span className="tile__art">
        {failed ? <Icon name={item.section === 'lights' ? 'lightbulb' : 'cube'} size={20} /> : <img src={`/palette/${item.id}.webp`} alt="" width={96} height={96} loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />}
      </span>
      <span className="tile__label">{item.label}</span>
    </button>
  );
});

/** The assets panel. */
export const AssetsPanel = memo(function AssetsPanel(): ReactElement {
  const studio = useStudio();
  const playing = useUI((s) => s.mode === 'play');
  const [query, setQuery] = useState('');
  const q = query.trim();
  const items = useMemo(() => (q ? PALETTE_ITEMS.filter((p) => fuzzyScore(q, p.label) !== null || fuzzyScore(q, p.keywords) !== null) : PALETTE_ITEMS), [q]);
  const place = (id: string): void => void studio.addFromPalette(id);
  return (
    <div className="assets">
      <div className="panel-toolbar">
        <label className="search-field search-field--sm">
          <Icon name="search" />
          <input type="search" value={query} maxLength={64} placeholder="Search assets" aria-label="Search assets" onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <div className="assets__scroll scroll-y">
        {PALETTE_SECTIONS.map((s) => {
          const list = items.filter((i) => i.section === s.id);
          if (list.length === 0) return null;
          return (
            <section key={s.id} className="assets__section" aria-labelledby={`assets-${s.id}`}>
              <header className="assets__head">
                <h3 id={`assets-${s.id}`} className="assets__title">
                  {s.title}
                </h3>
                <span className="assets__hint">{s.hint}</span>
              </header>
              <div className="tile-grid">
                {list.map((it) => (
                  <Tile key={it.id} item={it} disabled={playing} onPlace={place} />
                ))}
              </div>
            </section>
          );
        })}
        {items.length === 0 && <p className="panel-empty">No assets match “{q}”.</p>}
      </div>
    </div>
  );
});
