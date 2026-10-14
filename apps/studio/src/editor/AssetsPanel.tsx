/**
 * Assets panel, in four tabs sharing one search field:
 * - Library: the curated real-world asset catalog (see `library/LibraryView`).
 * - Basics: the procedural object palette (primitives, generators, lights).
 * - Materials: drag-on material swatches.
 * - Imports: the user's own models, images and HDR skies.
 * Click places at the centre of the view; tiles can be dragged onto the viewport.
 */
import { memo, useMemo, useState, type ReactElement } from 'react';
import { Segmented } from '../components/ui/Segmented';
import { LibraryView } from './library/LibraryView';
import { ImportsView } from './library/ImportsView';
import { useLibrary } from './library/useLibrary';
import { useStudio, useUI } from '../app/context';
import { fuzzyScore } from '../lib/fuzzy';
import { PALETTE_ITEMS, PALETTE_SECTIONS, type PaletteItem } from '../lib/palette';
import { Icon } from '../components/Icon';
import { MATERIAL_DRAG_TYPE, MATERIAL_LIBRARY, materialDragData, parseMaterialDrag, type LibraryMaterial } from '../lib/materials';

/** Drag-and-drop MIME type of palette tiles. */
export const PALETTE_DRAG_TYPE = 'application/x-aether-palette';
export { MATERIAL_DRAG_TYPE, parseMaterialDrag };

/** A draggable material swatch: drop it on an object, or click to apply it to the selection. */
const MaterialSwatch = memo(function MaterialSwatch({ m, disabled, onApply }: { m: LibraryMaterial; disabled: boolean; onApply: (m: LibraryMaterial) => void }): ReactElement {
  return (
    <button
      type="button"
      className="mat-tile"
      disabled={disabled}
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData(MATERIAL_DRAG_TYPE, materialDragData(m));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => onApply(m)}
      aria-label={`Material ${m.name}`}
      data-tip={`${m.name} — drag onto an object or click to apply to the selection`}
    >
      <span className={`mat-tile__ball${m.glow ? ' is-glow' : ''}`} style={{ ['--swatch' as string]: m.swatch }} aria-hidden="true" />
      <span className="mat-tile__label">{m.name}</span>
    </button>
  );
});

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

type AssetsTab = 'library' | 'basics' | 'materials' | 'imports';

/** The assets panel. */
export const AssetsPanel = memo(function AssetsPanel(): ReactElement {
  const studio = useStudio();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<AssetsTab>('library');
  const busy = useLibrary((s) => s.busy);
  return (
    <div className="assets">
      <div className="panel-toolbar assets__toolbar">
        <label className="search-field search-field--sm">
          <Icon name="search" />
          <input type="search" value={query} maxLength={64} placeholder={tab === 'library' ? 'Search 350+ assets (sofa, oak, taxi…)' : 'Search'} aria-label="Search assets" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <Segmented<AssetsTab>
          value={tab}
          onChange={setTab}
          label="Asset source"
          size="sm"
          stretch
          options={[
            ['library', 'Library'],
            ['basics', 'Basics'],
            ['materials', 'Materials'],
            ['imports', 'Imports'],
          ]}
          titles={{ library: 'Ready-made real-world assets', basics: 'Shapes, procedural objects and lights', materials: 'Drag a material onto an object', imports: 'Your own models, images and skies' }}
        />
      </div>
      <div className="assets__scroll scroll-y">
        {tab === 'library' && <LibraryView query={query} />}
        {tab === 'basics' && <BasicsView query={query} />}
        {tab === 'materials' && <MaterialsView query={query} />}
        {tab === 'imports' && <ImportsView query={query} />}
      </div>
      <footer className="assets__footer">
        <span className="assets__footnote">{busy ?? 'CC0 assets by Kenney and Poly Haven'}</span>
        <button type="button" className="btn btn--ghost btn--xs" onClick={() => studio.assets.setCreditsOpen(true)}>
          <Icon name="credits" size={13} />
          Credits
        </button>
      </footer>
    </div>
  );
});

/** Procedural palette sections (primitives, nature, buildings, props, gameplay, lights, effects). */
const BasicsView = memo(function BasicsView({ query }: { query: string }): ReactElement {
  const studio = useStudio();
  const playing = useUI((s) => s.mode === 'play');
  const q = query.trim();
  const items = useMemo(() => (q ? PALETTE_ITEMS.filter((p) => fuzzyScore(q, p.label) !== null || fuzzyScore(q, p.keywords) !== null) : PALETTE_ITEMS), [q]);
  const place = (id: string): void => void studio.addFromPalette(id);
  if (items.length === 0) return <p className="panel-empty">No objects match “{q}”.</p>;
  return (
    <>
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
    </>
  );
});

/** Material swatches. */
const MaterialsView = memo(function MaterialsView({ query }: { query: string }): ReactElement {
  const studio = useStudio();
  const playing = useUI((s) => s.mode === 'play');
  const q = query.trim();
  const mats = useMemo(() => (q ? MATERIAL_LIBRARY.filter((m) => fuzzyScore(q, m.name) !== null) : MATERIAL_LIBRARY), [q]);
  const applyMaterial = (m: LibraryMaterial): void => {
    const sel = studio.store.getState().selection;
    if (sel.length === 0) {
      studio.store.getState().toast('Select objects first, or drag the material onto one.', 'info', 3);
      return;
    }
    studio.editor.applyMaterial(sel, { ...m.spec, color: m.spec.color ?? null, roughness: m.spec.roughness ?? null, metalness: m.spec.metalness ?? null } as never, `Apply ${m.name}`);
  };
  if (mats.length === 0) return <p className="panel-empty">No materials match “{q}”.</p>;
  return (
    <section className="assets__section" aria-labelledby="assets-materials">
      <header className="assets__head">
        <h3 id="assets-materials" className="assets__title">
          Materials
        </h3>
        <span className="assets__hint">Drag onto an object</span>
      </header>
      <div className="mat-grid">
        {mats.map((m) => (
          <MaterialSwatch key={m.id} m={m} disabled={playing} onApply={applyMaterial} />
        ))}
      </div>
    </section>
  );
});
