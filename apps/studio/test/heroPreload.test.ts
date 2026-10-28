import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stageTemplates } from '../src/home/Hero';
import { FEATURED_TEMPLATES, TEMPLATES, templateThumbnail } from '../src/lib/examples';

describe('home page first image', () => {
  it('index.html preloads the thumbnail the hero stage shows first (its largest contentful paint)', () => {
    const first = stageTemplates(TEMPLATES, FEATURED_TEMPLATES)[0]!;
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain(`<link rel="preload" href="${templateThumbnail(first.slug)}" as="image"`);
  });
});
