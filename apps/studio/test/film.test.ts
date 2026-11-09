/** Stories films: the card, the player modal, and the lists that must leave a film (no world) out. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import FilmDialog, { LOOP_MAX_SECONDS } from '../src/home/FilmDialog';
import { TemplateCard, clock } from '../src/home/cards';
import { EXAMPLE_PROMPTS, TEMPLATES, WORLD_TEMPLATES, isFilm, templateImage, type FilmTemplate } from '../src/lib/examples';
import { FILM_PROVENANCE } from '../src/showcase/manifest';

const FILM: FilmTemplate = {
  slug: 'morning-kitchen',
  title: 'Morning Kitchen',
  kind: 'story',
  curation: 'candidate',
  origin: 'film',
  description: 'Morning light crosses a stone kitchen.',
  prompt: '',
  film: { poster: '/stories/morning-kitchen/poster.webp', mp4: '/stories/morning-kitchen/morning-kitchen.mp4', webm: '/stories/morning-kitchen/morning-kitchen.webm', seconds: 6, credit: 'Rendered with Cycles', note: 'Procedural, no outside assets.' },
};

describe('film card', () => {
  const html = renderToStaticMarkup(createElement(TemplateCard, { template: FILM, onPick: () => undefined }));
  it('is a button that opens the player, with the poster, a Film badge with the duration and the honest provenance', () => {
    expect(html).toContain('<button');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('src="/stories/morning-kitchen/poster.webp"');
    expect(html).toContain('Film · 0:06');
    expect(html).toContain(FILM_PROVENANCE);
    expect(FILM_PROVENANCE).toBe('Local run · Blender');
    expect(html).toContain('thumb__play');
  });
  it('offers no Remix, no editor and no player link (a film has no world)', () => {
    expect(html).not.toMatch(/Remix/);
    expect(html).not.toContain('/play#t=');
    expect(html).not.toContain('<a ');
  });
  it('formats durations', () => {
    expect([clock(6), clock(65), clock(59.6)]).toEqual(['0:06', '1:05', '1:00']);
  });
});

describe('film player', () => {
  const html = renderToStaticMarkup(createElement(FilmDialog, { template: FILM, onClose: () => undefined }));
  it('is a labelled modal dialog with the title, description and credit', () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Morning Kitchen');
    expect(html).toContain('Morning light crosses a stone kitchen.');
    expect(html).toContain('Rendered with Cycles');
    expect(html).toContain('aria-label="Close"');
  });
  it('loads nothing until opened, plays inline muted with controls and a poster, WebM before MP4', () => {
    expect(html).toContain('preload="none"');
    expect(html).toContain('playsInline');
    expect(html).toContain('poster="/stories/morning-kitchen/poster.webp"');
    expect(html).toContain(' controls');
    expect(html).not.toMatch(/<video[^>]*\bautoplay/i);
    expect(html.indexOf('.webm')).toBeGreaterThan(-1);
    expect(html.indexOf('.webm')).toBeLessThan(html.indexOf('.mp4"'));
    expect(html).toContain('Turn sound on');
  });
  it('loops short clips only', () => {
    expect(html).toMatch(/<video[^>]*\bloop/);
    const long = renderToStaticMarkup(createElement(FilmDialog, { template: { ...FILM, film: { ...FILM.film, seconds: LOOP_MAX_SECONDS + 1 } }, onClose: () => undefined }));
    expect(long).not.toMatch(/<video[^>]*\bloop/);
  });
});

describe('lists', () => {
  it('a film entry is recognised, uses its poster, and stays out of the world lists', () => {
    expect(isFilm(FILM)).toBe(true);
    expect(templateImage(FILM)).toBe(FILM.film.poster);
    expect(WORLD_TEMPLATES.some(isFilm)).toBe(false);
    expect(WORLD_TEMPLATES.length).toBe(TEMPLATES.filter((t) => !isFilm(t)).length);
    expect(EXAMPLE_PROMPTS.every((p) => p.prompt.length > 0)).toBe(true);
  });
});
