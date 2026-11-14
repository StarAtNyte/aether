/**
 * The home page's "Featured worlds": a gallery of the best published worlds (the manifest's `curation: 'featured'`
 * entries, in manifest order). The first is the lead card, the next two sit beside it, the rest form a row; on a phone
 * they are one snap-scrolling rail. A card opens the published (cooked) world in its own start mode in the player;
 * Remix opens a copy in the editor. Loaded lazily (its own chunk), so the first download does not carry it.
 */
import { memo, type ReactElement } from 'react';
import { FEATURED_TEMPLATES, templateThumbnail, templateThumbnailSrcSet, type WorldTemplate } from '../lib/examples';
import { templatePublish } from '../showcase/publish';
import { Icon } from '../components/Icon';
import { templatePlayUrl } from './cards';
import '../styles/featured.css';

/** Worlds with baked light and a time-of-day slider in the player. */
const TIME_OF_DAY: ReadonlySet<string> = new Set(['casa-patio', 'skyline-penthouse', 'dusk-lake-house']);
/** Larger stills for the lead card (1920 px wide; the others use the thumbnail and its @2x twin). */
const LEAD_STILL: ReadonlySet<string> = new Set(['cloudwatch-harbour']);

/** "Walkthrough · time of day", "Story film", "Game", "City · drone tour", "Scene · orbit": what the player does with the world. */
export function featuredMode(t: Pick<WorldTemplate, 'slug' | 'kind'>): string {
  const p = templatePublish(t.slug, t.kind);
  if (p.startMode === 'story') return 'Explore · story film';
  if (p.startMode === 'play') return p.profile === 'city' ? 'City · game' : 'Game';
  if (p.startMode === 'walkthrough') return TIME_OF_DAY.has(t.slug) ? 'Walkthrough · time of day' : 'Walkthrough';
  return p.profile === 'city' ? 'City · drone tour' : 'Scene · orbit';
}

/** The verb on a card's button. */
export function featuredVerb(t: Pick<WorldTemplate, 'slug' | 'kind'>): string {
  const p = templatePublish(t.slug, t.kind);
  return p.startMode === 'story' ? 'Explore' : p.startMode === 'play' ? 'Play' : p.startMode === 'walkthrough' ? 'Walk through' : 'Explore';
}

type Size = 'lead' | 'side' | 'tile';

const FeaturedCard = memo(function FeaturedCard({ t, size, onRemix }: { t: WorldTemplate; size: Size; onRemix: (slug: string) => void }): ReactElement {
  const lead = size === 'lead';
  const big = lead && LEAD_STILL.has(t.slug);
  return (
    <article className={`fcard fcard--${size}`}>
      <img
        className="fcard__img"
        src={big ? `/templates/featured/${t.slug}.webp` : templateThumbnail(t.slug)}
        srcSet={big ? `/templates/${t.slug}@2x.webp 1280w, /templates/featured/${t.slug}.webp 1920w` : templateThumbnailSrcSet(t.slug)}
        sizes={lead ? '(max-width: 1023px) 100vw, 760px' : '(max-width: 639px) 80vw, (max-width: 1023px) 50vw, 380px'}
        alt=""
        width={big ? 1920 : 640}
        height={big ? 1080 : 360}
        loading={size === 'tile' ? 'lazy' : 'eager'}
        decoding="async"
        draggable={false}
        {...(lead ? { fetchPriority: 'high' as const } : {})}
      />
      {t.assetFree && (
        <span className="fcard__free" title="Built from scratch: every object is shapes and generated code, no library models">
          Asset-free
        </span>
      )}
      {/* The whole card (picture included) is the link; the text above it lets clicks through. */}
      <a className="fcard__link" href={templatePlayUrl(t.slug)} aria-label={`${featuredVerb(t)} ${t.title}: ${featuredMode(t)}`} />
      <div className="fcard__body">
        <span className="fcard__mode">{featuredMode(t)}</span>
        <h3 className="fcard__title">{t.title}</h3>
        {lead && <p className="fcard__desc">{t.description}</p>}
        {lead && (
          <span className="fcard__cta" aria-hidden="true">
            <Icon name="play" />
            {featuredVerb(t)}
          </span>
        )}
      </div>
      <button type="button" className="fcard__remix" onClick={() => onRemix(t.slug)} title="Open a copy in the editor" aria-label={`Remix ${t.title}`}>
        <Icon name="pencil" />
        <span>Remix</span>
      </button>
    </article>
  );
});

/** The featured gallery (nothing when no template is featured). */
export default function Featured({ onRemix }: { onRemix: (slug: string) => void }): ReactElement | null {
  const [lead, ...rest] = FEATURED_TEMPLATES;
  if (!lead) return null;
  return (
    <div className="featured__grid" role="list">
      <div role="listitem" className="featured__item featured__item--lead">
        <FeaturedCard t={lead} size="lead" onRemix={onRemix} />
      </div>
      {rest.map((t, i) => (
        <div key={t.slug} role="listitem" className={`featured__item featured__item--${i < 2 ? 'side' : 'tile'}`}>
          <FeaturedCard t={t} size={i < 2 ? 'side' : 'tile'} onRemix={onRemix} />
        </div>
      ))}
    </div>
  );
}
