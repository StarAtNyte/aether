import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURED_TEMPLATES, TEMPLATES } from '../src/lib/examples';
import Featured, { featuredMode, featuredVerb } from '../src/home/Featured';
import { TEMPLATE_PUBLISH } from '../src/showcase/publish';
import { SHOWCASE } from '../src/showcase/manifest';

const PUBLIC = resolve(__dirname, '../public/templates');

describe('the home Featured gallery', () => {
  it('features about 11 worlds, one lead first, with variety across kinds', () => {
    expect(FEATURED_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    expect(FEATURED_TEMPLATES.length).toBeLessThanOrEqual(12);
    expect(FEATURED_TEMPLATES[0]!.slug).toBe('cloudwatch-harbour');
    const modes = new Set(FEATURED_TEMPLATES.map((t) => featuredMode(t).split(' · ')[0]));
    expect(modes.size).toBeGreaterThanOrEqual(4);
  });

  it('only features published worlds: a publish row, a thumbnail within budget, a saved world', () => {
    for (const t of FEATURED_TEMPLATES) {
      expect(TEMPLATE_PUBLISH[t.slug], `${t.slug} publish row`).toBeDefined();
      const thumb = resolve(PUBLIC, `${t.slug}.webp`);
      expect(existsSync(thumb), `${t.slug} thumbnail`).toBe(true);
      expect(statSync(thumb).size, `${t.slug} thumbnail size`).toBeLessThanOrEqual(40 * 1024);
      expect(statSync(resolve(PUBLIC, `${t.slug}@2x.webp`)).size, `${t.slug} @2x size`).toBeLessThanOrEqual(110 * 1024);
      expect(existsSync(resolve(PUBLIC, 'worlds', `${t.slug}.json`)), `${t.slug} world`).toBe(true);
    }
    expect(statSync(resolve(PUBLIC, 'featured/cloudwatch-harbour.webp')).size).toBeLessThanOrEqual(160 * 1024);
  });

  it('labels each world by what the player does with it', () => {
    expect(featuredMode({ slug: 'cloudwatch-harbour', kind: 'story' })).toBe('Explore · story film');
    expect(featuredMode({ slug: 'dusk-lake-house', kind: 'architecture' })).toBe('Walkthrough · time of day');
    expect(featuredMode({ slug: 'lisbon-hills', kind: 'scene' })).toBe('City · drone tour');
    expect(featuredMode({ slug: 'kestrel-outpost', kind: 'game' })).toBe('Game');
    expect(featuredMode({ slug: 'sanctuary-falls', kind: 'scene' })).toBe('Scene · orbit');
    expect(featuredVerb({ slug: 'cloudwatch-harbour', kind: 'story' })).toBe('Explore');
  });

  it('renders one card per featured world: a link to the player and a Remix button outside it', () => {
    const html = renderToStaticMarkup(createElement(Featured, { onRemix: () => undefined }));
    expect(html.match(/class="fcard fcard--/g)?.length).toBe(FEATURED_TEMPLATES.length);
    expect(html).toContain('fcard--lead');
    for (const t of FEATURED_TEMPLATES) {
      expect(html).toContain(`href="/play#t=${t.slug}"`);
      expect(html).toContain(`aria-label="Remix ${t.title}"`);
    }
    expect(html).toContain('/templates/featured/cloudwatch-harbour.webp');
    // No interactive content inside a link.
    expect(html).not.toMatch(/<a[^>]*>[^<]*<button/);
  });

  it('keeps every shown template reachable (featured first, none duplicated) and every entry published', () => {
    expect(new Set(TEMPLATES.map((t) => t.slug)).size).toBe(TEMPLATES.length);
    expect(TEMPLATES.slice(0, FEATURED_TEMPLATES.length)).toEqual([...FEATURED_TEMPLATES]);
    for (const e of SHOWCASE.filter((x) => !x.film)) expect(TEMPLATE_PUBLISH[e.slug], e.slug).toBeDefined();
    for (const e of SHOWCASE.filter((x) => x.film)) expect(TEMPLATE_PUBLISH[e.slug], `${e.slug}: a film has no publish row`).toBeUndefined();
  });
});
