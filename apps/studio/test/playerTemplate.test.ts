import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { openCookedPackage } from '@aether/render';
import { cookedBase, HOSTED_COOKED_BASE, LOCAL_COOKED_BASE, loadGame, normalizeCookedBase, startModeForKind, templateCookUrl, templateRoute } from '../src/player/source';
import { SHOWCASE } from '../src/showcase/manifest';
import { publishForKind, TEMPLATE_PUBLISH, templatePublish } from '../src/showcase/publish';
import { TemplateCard, templatePlayUrl } from '../src/home/cards';

const worldJson = readFileSync(new URL('../public/templates/worlds/kestrel-outpost.json', import.meta.url), 'utf8');
const serveWorld = (seen: string[]): typeof fetch =>
  (async (u: string) => {
    seen.push(String(u));
    return new Response(worldJson, { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

describe('the player opens a template as a published world', () => {
  it('parses the template fragment and its options', () => {
    expect(templateRoute('#t=kestrel-outpost')).toEqual({ slug: 'kestrel-outpost', cook: 'use', tier: null });
    expect(templateRoute('#t=kestrel-outpost&cook=0&tier=high')).toEqual({ slug: 'kestrel-outpost', cook: 'off', tier: 'high' });
    expect(templateRoute('#t=kestrel-outpost&cook=local')).toEqual({ slug: 'kestrel-outpost', cook: 'local', tier: null });
    expect(templateRoute('#t=lisbon-hills&cook=record&tier=epic')).toEqual({ slug: 'lisbon-hills', cook: 'record', tier: null });
    expect(templateRoute('#t=../etc')).toBeNull();
    expect(templateRoute('#w=abc')).toBeNull();
    expect([startModeForKind('game'), startModeForKind('architecture'), startModeForKind('scene')]).toEqual(['play', 'walkthrough', 'orbit']);
  });

  it('reads cooked packages from the hosted dataset or a local folder, and refuses any other base', () => {
    expect(HOSTED_COOKED_BASE).toBe('https://huggingface.co/datasets/StarAtNyte1/aether-cooked/resolve/main/');
    expect(templateCookUrl('lisbon-hills', HOSTED_COOKED_BASE)).toBe('https://huggingface.co/datasets/StarAtNyte1/aether-cooked/resolve/main/lisbon-hills/manifest.json');
    expect(templateCookUrl('lisbon-hills', LOCAL_COOKED_BASE)).toBe('./cooked/lisbon-hills/manifest.json');
    // Without a build-time base (tests, an unconfigured build) the page's own folder.
    expect(cookedBase()).toBe(LOCAL_COOKED_BASE);
    expect(templateCookUrl('lisbon-hills')).toBe('./cooked/lisbon-hills/manifest.json');
    expect(normalizeCookedBase('https://cdn.example.org/cooked')).toBe('https://cdn.example.org/cooked/');
    expect(normalizeCookedBase('/cooked')).toBe('/cooked/');
    for (const bad of ['http://insecure.example/', 'javascript:alert(1)', '//evil.example/', '', '  ']) expect(normalizeCookedBase(bad), bad).toBeNull();
    expect(templateCookUrl('w', 'ftp://x/')).toBe('./cooked/w/manifest.json');
    // The vite config's hosted base is the same.
    expect(readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')).toContain(`const HOSTED_COOKED_BASE = '${HOSTED_COOKED_BASE}';`);
  });

  it('loads the template world with its cooked package and start mode (local with cook=local, live with cook=0)', async () => {
    const seen: string[] = [];
    const fetchFn = serveWorld(seen);
    const r = await loadGame('#t=kestrel-outpost', fetchFn, '/play.html');
    expect(r.kind).toBe('game');
    if (r.kind !== 'game') return;
    expect(r.from).toBe('template');
    expect(seen).toEqual(['/templates/worlds/kestrel-outpost.json']);
    expect(r.game.cook).toBe(templateCookUrl('kestrel-outpost'));
    expect(r.game.startMode).toBe('play');
    expect(r.game.world.name.length).toBeGreaterThan(0);
    const local = await loadGame('#t=kestrel-outpost&cook=local', fetchFn, '/play.html');
    expect(local.kind === 'game' && local.game.cook).toBe('./cooked/kestrel-outpost/manifest.json');
    const live = await loadGame('#t=kestrel-outpost&cook=0', fetchFn, '/play.html');
    expect(live.kind === 'game' && live.game.cook).toBe(undefined);
  });

  it('starts each template in its registered mode', async () => {
    const seen: string[] = [];
    for (const [slug, mode] of [['lisbon-hills', 'orbit'], ['casa-patio', 'walkthrough'], ['bowling-alley', 'play']] as const) {
      const json = readFileSync(new URL(`../public/templates/worlds/${slug}.json`, import.meta.url), 'utf8');
      const r = await loadGame(`#t=${slug}`, (async (u: string) => (seen.push(u), new Response(json, { headers: { 'content-type': 'application/json' } }))) as typeof fetch, '/play.html');
      expect(r.kind === 'game' && r.game.startMode, slug).toBe(mode);
    }
  });

  it('falls back to the live load when the hosted package is missing, unreachable or not JSON', async () => {
    const world = { name: 'W', entities: {} };
    const url = templateCookUrl('w', HOSTED_COOKED_BASE);
    const answers: Array<() => Promise<Response>> = [
      async () => new Response('Entry not found', { status: 404, headers: { 'content-type': 'text/plain' } }),
      async () => Promise.reject(new TypeError('Failed to fetch')),
      async () => new Response('<!doctype html><p>sign in', { headers: { 'content-type': 'text/html' } }),
      async () => new Response('{"probe":true}', { headers: { 'content-type': 'text/plain; charset=utf-8' } }),
    ];
    for (const answer of answers) {
      const r = await openCookedPackage(url, world, { genVersion: 'g', fetch: answer });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/no cooked package|rejected/);
    }
  });
});

describe('template publish settings', () => {
  it('has a start mode and a profile for every template, matching its kind', () => {
    const slugs = SHOWCASE.map((e) => e.slug);
    expect(Object.keys(TEMPLATE_PUBLISH).sort()).toEqual([...slugs].sort());
    for (const e of SHOWCASE) {
      const p = templatePublish(e.slug, e.kind);
      expect(['play', 'walkthrough', 'orbit', 'story']).toContain(p.startMode);
      expect(['game', 'walkthrough', 'showcase', 'city', 'vr', 'story']).toContain(p.profile);
      // Games start as games; a city with a game goal keeps its city profile for its explore mode.
      if (e.kind === 'game') expect(p, e.slug).toEqual({ startMode: 'play', profile: e.slug === 'neon-rain-city' ? 'city' : 'game' });
      if (e.kind === 'architecture') expect(p, e.slug).toEqual({ startMode: 'walkthrough', profile: 'walkthrough' });
    }
    expect(templatePublish('lisbon-hills')).toEqual({ startMode: 'orbit', profile: 'city' });
    expect(templatePublish('neon-rain-city')).toEqual({ startMode: 'play', profile: 'city' });
    expect(templatePublish('cliff-sanctuary')).toEqual({ startMode: 'orbit', profile: 'showcase' });
    expect(templatePublish('cloudwatch-harbour')).toEqual({ startMode: 'story', profile: 'story' });
    expect(templatePublish('not-a-template', 'architecture')).toEqual(publishForKind('architecture'));
    expect(templatePublish('constructor')).toEqual(publishForKind(undefined));
  });
});

describe('the template gallery', () => {
  it('opens a card in the player and offers Remix to open a copy in the editor', () => {
    const entry = SHOWCASE.find((e) => e.slug === 'lisbon-hills')!;
    expect(templatePlayUrl('lisbon-hills')).toBe('/play#t=lisbon-hills');
    const html = renderToStaticMarkup(createElement(TemplateCard, { template: entry, onPick: () => undefined }));
    expect(html).toContain('href="/play#t=lisbon-hills"');
    expect(html).toContain('aria-label="Play Lisbon Hills"');
    expect(html).toMatch(/<button[^>]*class="card__remix"[^>]*aria-label="Remix Lisbon Hills"/);
    // The Remix button sits outside the link (no interactive content inside an <a>).
    expect(html.indexOf('</a>')).toBeLessThan(html.indexOf('card__remix'));
    // The route the card opens parses back to the template.
    expect(templateRoute(new URL(templatePlayUrl('lisbon-hills'), 'https://x.test').hash)).toEqual({ slug: 'lisbon-hills', cook: 'use', tier: null });
  });
});
