/**
 * The user's imported files (models, images, HDR skies): place, remove, or
 * import more. Everything is validated on import (see @aether/assets
 * `importUserAsset`) and kept in this browser's IndexedDB.
 */
import { memo, useEffect, useRef, type ReactElement } from 'react';
import { userAsset, type UserAssetMeta } from '@aether/assets';
import { useStudio, useUI } from '../../app/context';
import { Icon } from '../../components/Icon';
import { formatBytes } from '../../lib/format';
import { ASSET_DRAG_TYPE, IMPORT_ACCEPT, useLibrary } from './useLibrary';
import type { Creation } from '../../assets/userStore';

function kindLabel(m: UserAssetMeta): string {
  if (m.kind === 'model') return `${(m.triangles ?? 0).toLocaleString('en-US')} triangles${m.clips && m.clips.length > 0 ? ` · ${m.clips.length} clips` : ''}`;
  if (m.kind === 'image') return `Image · ${m.width ?? '?'}×${m.height ?? '?'}`;
  return `HDR sky · ${m.width ?? '?'}×${m.height ?? '?'}`;
}

const ImportRow = memo(function ImportRow({ meta, disabled }: { meta: UserAssetMeta; disabled: boolean }): ReactElement {
  const studio = useStudio();
  const url = meta.kind === 'image' ? userAsset(meta.id)?.url : undefined;
  return (
    <li className="import-row">
      <button
        type="button"
        className="import-row__main"
        disabled={disabled}
        draggable={!disabled}
        onDragStart={(e) => {
          e.dataTransfer.setData(ASSET_DRAG_TYPE, meta.id);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => void studio.assets.place(meta.id)}
        aria-label={`Add ${meta.name}`}
      >
        <span className="import-row__art">{url ? <img src={url} alt="" width={40} height={40} /> : <Icon name={meta.kind === 'hdri' ? 'sun' : meta.kind === 'image' ? 'image' : 'cube'} size={18} />}</span>
        <span className="import-row__text">
          <span className="import-row__name">{meta.name}</span>
          <span className="import-row__meta">
            {kindLabel(meta)} · {formatBytes(meta.bytes)}
          </span>
        </span>
      </button>
      <button type="button" className="icon-btn icon-btn--sm" aria-label={`Remove ${meta.name}`} data-tip="Remove from this browser" onClick={() => void studio.assets.removeImport(meta.id)}>
        <Icon name="trash" size={14} />
      </button>
    </li>
  );
});

const CreationRow = memo(function CreationRow({ c, disabled }: { c: Creation; disabled: boolean }): ReactElement {
  const studio = useStudio();
  const name = c.def.description.split(/[.;\n]/)[0]?.slice(0, 60) || c.def.id;
  return (
    <li className="import-row">
      <button type="button" className="import-row__main" disabled={disabled} onClick={() => void studio.assets.placeCreation(c.def)} aria-label={`Add ${name}`}>
        <span className="import-row__art">{c.thumb ? <img src={c.thumb} alt="" width={40} height={40} /> : <Icon name="sparkles" size={18} />}</span>
        <span className="import-row__text">
          <span className="import-row__name">{name}</span>
          <span className="import-row__meta">
            Parametric · {Object.keys(c.def.params).length} params{c.score !== null ? ` · ${Math.round(c.score * 100)}/100` : ''}
          </span>
        </span>
      </button>
      <button type="button" className="icon-btn icon-btn--sm" aria-label={`Refine ${name}`} data-tip="Refine (e.g. taller, walnut)" disabled={disabled} onClick={() => studio.forge.open(c.def)}>
        <Icon name="wand" size={14} />
      </button>
      <button type="button" className="icon-btn icon-btn--sm" aria-label={`Remove ${name}`} data-tip="Remove from your library" onClick={() => void studio.assets.removeCreation(c.def.id)}>
        <Icon name="trash" size={14} />
      </button>
    </li>
  );
});

/** Imports list with the file picker. */
export const ImportsView = memo(function ImportsView({ query }: { query: string }): ReactElement {
  const studio = useStudio();
  const imports = useLibrary((s) => s.imports);
  const persistent = useLibrary((s) => s.persistent);
  const busy = useLibrary((s) => s.busy);
  const playing = useUI((s) => s.mode === 'play');
  const input = useRef<HTMLInputElement>(null);
  const creations = useLibrary((s) => s.creations);
  useEffect(() => {
    void studio.assets.refreshImports();
    void studio.assets.refreshCreations();
  }, [studio]);
  const q = query.trim().toLowerCase();
  const list = q ? imports.filter((m) => m.name.toLowerCase().includes(q)) : imports;
  return (
    <div className="imports">
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept={IMPORT_ACCEPT}
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          if (files.length > 0) void studio.assets.importFiles(files);
        }}
      />
      <button type="button" className="drop-hint" disabled={playing || busy !== null} onClick={() => input.current?.click()}>
        <Icon name="upload" size={18} />
        <span>
          <strong>{busy ?? 'Import files'}</strong>
          <span className="drop-hint__sub">GLB / glTF models, PNG / JPEG / WebP images (posters), .hdr skies or a world package. You can also drop files on the viewport.</span>
        </span>
      </button>
      {!persistent && <p className="panel-note">This browser blocks storage: imports last until you close the tab.</p>}
      {creations.length > 0 && (
        <section className="assets__section" aria-labelledby="assets-creations">
          <header className="assets__head">
            <h3 id="assets-creations" className="assets__title">
              Your creations
            </h3>
            <span className="assets__hint">Editable generators</span>
          </header>
          <ul className="import-list">
            {creations
              .filter((c) => !q || c.def.description.toLowerCase().includes(q) || c.def.id.includes(q))
              .map((c) => (
                <CreationRow key={c.def.id} c={c} disabled={playing} />
              ))}
          </ul>
        </section>
      )}
      {list.length === 0 ? (
        <p className="panel-empty">{imports.length === 0 ? 'Nothing imported yet.' : `No imports match “${query}”.`}</p>
      ) : (
        <ul className="import-list">
          {list.map((m) => (
            <ImportRow key={m.id} meta={m} disabled={playing} />
          ))}
        </ul>
      )}
    </div>
  );
});
