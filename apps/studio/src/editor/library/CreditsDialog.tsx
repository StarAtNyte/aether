/**
 * Credits: who made the assets the current world uses (with licence and
 * source link), plus every pack the library ships. CC-BY assets require
 * this attribution; CC0 ones receive it as a courtesy. Also shown from play
 * mode and included as CREDITS.txt in exported packages.
 */
import { memo, useMemo, type ReactElement } from 'react';
import { useStudio, useWorld } from '../../app/context';
import { Dialog } from '../../components/ui/Dialog';
import { textureCredits } from '@aether/assets';
import { useLibrary } from './useLibrary';

/** The credits dialog (open state lives in the library store). */
export const CreditsDialog = memo(function CreditsDialog(): ReactElement | null {
  const studio = useStudio();
  const open = useLibrary((s) => s.creditsOpen);
  const catalog = useLibrary((s) => s.catalog);
  const world = useWorld();
  const credits = useMemo(() => (open ? studio.assets.credits() : []), [open, studio, world, catalog]);
  const textures = useMemo(() => (open ? textureCredits(world) : []), [open, world]);
  if (!open) return null;
  return (
    <Dialog open={open} onClose={() => studio.assets.setCreditsOpen(false)} title="Credits" description="The people and libraries behind the assets in this world." size="md" className="credits-dialog">
      <section className="credits" aria-label="Assets in this world">
        <h3 className="credits__title">In this world</h3>
        {credits.length === 0 ? (
          <p className="panel-empty">This world uses no third-party assets (everything is procedural).</p>
        ) : (
          <ul className="credits__list">
            {credits.map((c) => (
              <li key={`${c.source}|${c.author}`} className="credits__item">
                <div className="credits__head">
                  <strong>{c.source}</strong>
                  <span className="credits__by">by {c.author}</span>
                </div>
                <div className="credits__meta">
                  {c.licenceUrl ? (
                    <a href={c.licenceUrl} target="_blank" rel="noopener noreferrer">
                      {c.licence}
                    </a>
                  ) : (
                    c.licence
                  )}
                  {c.url && (
                    <>
                      {' · '}
                      <a href={c.url} target="_blank" rel="noopener noreferrer">
                        source
                      </a>
                    </>
                  )}
                </div>
                <div className="credits__used">{c.assets.join(', ')}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {textures.length > 0 && (
        <section className="credits" aria-label="Textures in this world">
          <h3 className="credits__title">Textures</h3>
          <p className="panel-empty">Made for this project. Each one says where its pixels came from.</p>
          <ul className="credits__list">
            {textures.map((t) => (
              <li key={t.id} className="credits__item" data-provenance={t.provenance}>
                <div className="credits__head">
                  <strong>{t.name}</strong>
                  <span className="credits__by">{t.label}</span>
                </div>
                {t.detail && <div className="credits__used">{t.detail}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {catalog && catalog.packs.length > 0 && (
        <section className="credits" aria-label="Asset library">
          <h3 className="credits__title">Asset library</h3>
          <ul className="credits__packs">
            {catalog.packs.map((p) => (
              <li key={p.id}>
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  {p.title}
                </a>{' '}
                <span className="credits__by">
                  {p.author} · {p.licence}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Dialog>
  );
});
