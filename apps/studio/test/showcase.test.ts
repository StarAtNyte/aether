/**
 * Bundled default projects: the manifest is consistent with the files the
 * studio ships, the saved worlds validate, and the lazy loader treats those
 * files as untrusted input (slug check, size caps, timeouts, WebP check).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateWorld } from '@aether/core';
import { describe, expect, it, vi } from 'vitest';
import { AGENT_TEMPLATES, FEATURED_TEMPLATES, MORE_TEMPLATES, PHOTO_TEMPLATES, TEMPLATES, templateBySlug } from '../src/lib/examples';
import { SHOWCASE } from '../src/showcase/manifest';
import { loadTemplateThumbnail, loadTemplateWorld, readCapped, type FetchLike } from '../src/showcase/load';
import { FLAGSHIPS } from '../../../packages/agent/src/providers/mock/showcase/index';

const pub = (rel: string): string => fileURLToPath(new URL(`../public/${rel}`, import.meta.url));

describe('showcase manifest', () => {
  it('has unique slugs, titles and prompts (exact duplicate prompts removed)', () => {
    expect(new Set(SHOWCASE.map((e) => e.slug)).size).toBe(SHOWCASE.length);
    expect(new Set(SHOWCASE.map((e) => e.title)).size).toBe(SHOWCASE.length);
    expect(new Set(SHOWCASE.map((e) => e.prompt)).size).toBe(SHOWCASE.length);
    for (const e of SHOWCASE) expect(e.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+){0,7}$/);
  });

  it('lists every flagship of the planner, and every flagship prompt rebuilds it', () => {
    const flagships = SHOWCASE.filter((e) => e.origin === 'flagship');
    expect(flagships.map((e) => e.slug).sort()).toEqual(FLAGSHIPS.map((f) => f.id).sort());
    for (const e of flagships) expect(FLAGSHIPS.find((f) => f.id === e.slug)?.match.test(e.prompt.toLowerCase()), e.slug).toBe(true);
  });

  it('keeps every gallery world as a default project, each cut from its screenshot', () => {
    const gallery = SHOWCASE.filter((e) => e.origin === 'gallery');
    expect(gallery.length).toBeGreaterThanOrEqual(22);
    for (const e of gallery.filter((x) => x.shot)) expect(existsSync(fileURLToPath(new URL(`../../../docs/screenshots/gallery/${e.shot}`, import.meta.url))), e.shot).toBe(true);
  });

  it('credits every photo room: permissive licence, a listed fixture photo, recorded in THIRD_PARTY', () => {
    const rooms = SHOWCASE.filter((e) => e.origin === 'photo');
    expect(rooms.length).toBe(4);
    const thirdParty = readFileSync(fileURLToPath(new URL('../../../docs/THIRD_PARTY.md', import.meta.url)), 'utf8');
    for (const e of rooms) {
      expect(e.photo, e.slug).toBeDefined();
      expect(['CC0 1.0', 'Public domain'], e.slug).toContain(e.photo?.licence);
      expect(existsSync(fileURLToPath(new URL(`../../../tests/fixtures/photo/${e.photo?.file}`, import.meta.url))), e.slug).toBe(true);
      expect(thirdParty, e.slug).toContain(`tests/fixtures/photo/${e.photo?.file}`);
      expect(thirdParty, e.slug).toContain(e.photo?.url ?? '');
    }
  });

  it('lists the generated worlds as agent templates, each with a prompt and a stored world', () => {
    const agent = SHOWCASE.filter((e) => e.origin === 'agent');
    expect(agent.length).toBeGreaterThanOrEqual(1);
    expect(AGENT_TEMPLATES.map((t) => t.slug)).toEqual(agent.map((t) => t.slug));
    expect(MORE_TEMPLATES.some((t) => t.origin === 'agent')).toBe(false);
    for (const e of agent) {
      expect(e.prompt.length, e.slug).toBeGreaterThan(10);
      expect(['offline-planner', 'claude-code', 'codex'], e.slug).toContain(e.provenance);
    }
  });

  it('ships a thumbnail (WebP ≤ 30 KB) and a valid saved world for every entry', () => {
    for (const e of SHOWCASE) {
      const thumb = pub(`templates/${e.slug}.webp`);
      expect(existsSync(thumb), `${e.slug} thumbnail`).toBe(true);
      expect(statSync(thumb).size, `${e.slug} thumbnail size`).toBeLessThanOrEqual(30 * 1024);
      expect(readFileSync(thumb).subarray(8, 12).toString('latin1')).toBe('WEBP');
      const raw = JSON.parse(readFileSync(pub(`templates/worlds/${e.slug}.json`), 'utf8')) as { format: string; world: unknown };
      expect(raw.format).toBe('aether-world');
      const r = validateWorld(raw.world);
      expect(r.ok, `${e.slug} world`).toBe(true);
      if (r.ok) expect(Object.keys(r.world.entities).length > 0 || r.world.voxel !== undefined).toBe(true);
    }
  });

  it('derives the shown lists from curation (featured first, hidden nowhere)', () => {
    expect(FEATURED_TEMPLATES.every((t) => t.curation === 'featured')).toBe(true);
    expect(MORE_TEMPLATES.every((t) => t.curation === 'candidate')).toBe(true);
    expect(TEMPLATES).toEqual([...FEATURED_TEMPLATES, ...MORE_TEMPLATES, ...AGENT_TEMPLATES, ...PHOTO_TEMPLATES]);
    expect(TEMPLATES.some((t) => t.curation === 'hidden')).toBe(false);
    expect(templateBySlug('lantern-isles')?.title).toBe('Lantern Isles');
  });
});

/** A fetch answering with `body` (and optional headers / status). */
function fakeFetch(body: BodyInit | null, init: ResponseInit = {}): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn: FetchLike = async (url) => {
    calls.push(url);
    return new Response(body, init);
  };
  return Object.assign(fn, { calls });
}

describe('template loader', () => {
  const world = readFileSync(pub('templates/worlds/lantern-isles.json'), 'utf8');

  it('loads and validates a saved world from its static path', async () => {
    const f = fakeFetch(world, { status: 200 });
    const r = await loadTemplateWorld('lantern-isles', f);
    expect(r.ok).toBe(true);
    expect(f.calls).toEqual(['/templates/worlds/lantern-isles.json']);
  });

  it('refuses unsafe slugs without fetching', async () => {
    const f = fakeFetch(world);
    for (const slug of ['../etc/passwd', 'a/b', 'UPPER', '', 'x'.repeat(300)]) expect((await loadTemplateWorld(slug, f)).ok).toBe(false);
    expect(f.calls).toEqual([]);
  });

  it('fails cleanly on HTTP errors, invalid JSON, invalid worlds and oversize bodies', async () => {
    expect((await loadTemplateWorld('x', fakeFetch('nope', { status: 404 }))).ok).toBe(false);
    expect((await loadTemplateWorld('x', fakeFetch('{not json'))).ok).toBe(false);
    expect((await loadTemplateWorld('x', fakeFetch(JSON.stringify({ entities: { BAD: {} } })))).ok).toBe(false);
    expect((await loadTemplateWorld('x', fakeFetch('{}', { headers: { 'content-length': String(50 * 1024 * 1024) } }))).ok).toBe(false);
    // No content-length: the stream is cut at the cap.
    const big = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new Uint8Array(1024 * 1024).fill(32));
      },
    });
    const r = await loadTemplateWorld('x', fakeFetch(big));
    expect(r).toEqual({ ok: false, error: 'The template file is too large.' });
  });

  it('rejects prototype-polluting worlds', async () => {
    const r = await loadTemplateWorld('x', fakeFetch('{"format":"aether-world","world":{"__proto__":{"polluted":true}}}'));
    expect(r.ok).toBe(false);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('times out a request that never answers', async () => {
    vi.useFakeTimers();
    try {
      const hang: FetchLike = (_u, init) => new Promise((_ok, fail) => init.signal.addEventListener('abort', () => fail(new Error('aborted'))));
      const p = loadTemplateWorld('x', hang, 1000);
      await vi.advanceTimersByTimeAsync(1001);
      expect(await p).toEqual({ ok: false, error: 'The template took too long to load.' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts only WebP thumbnails within the budget', async () => {
    const webp = new Uint8Array(readFileSync(pub('templates/lantern-isles.webp')));
    const blob = await loadTemplateThumbnail('lantern-isles', fakeFetch(webp));
    expect(blob?.type).toBe('image/webp');
    expect(await loadTemplateThumbnail('lantern-isles', fakeFetch('<svg onload="x"></svg>'))).toBeNull();
    expect(await loadTemplateThumbnail('lantern-isles', fakeFetch(new Uint8Array(100 * 1024)))).toBeNull();
    expect(await loadTemplateThumbnail('../x', fakeFetch(webp))).toBeNull();
  });

  it('readCapped returns the whole body under the cap', async () => {
    const bytes = await readCapped(new Response('hello'), 10);
    expect(new TextDecoder().decode(bytes ?? new Uint8Array())).toBe('hello');
    expect(await readCapped(new Response('hello world'), 5)).toBeNull();
  });
});
