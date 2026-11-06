import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGame, startModeForKind, templateCookUrl, templateRoute } from '../src/player/source';

describe('the player opens a template as a published world', () => {
  it('parses the template fragment and its options', () => {
    expect(templateRoute('#t=kestrel-outpost')).toEqual({ slug: 'kestrel-outpost', cook: 'use', tier: null });
    expect(templateRoute('#t=kestrel-outpost&cook=0&tier=high')).toEqual({ slug: 'kestrel-outpost', cook: 'off', tier: 'high' });
    expect(templateRoute('#t=lisbon-hills&cook=record&tier=epic')).toEqual({ slug: 'lisbon-hills', cook: 'record', tier: null });
    expect(templateRoute('#t=../etc')).toBeNull();
    expect(templateRoute('#w=abc')).toBeNull();
    expect(templateCookUrl('lisbon-hills')).toBe('./cooked/lisbon-hills/manifest.json');
    expect([startModeForKind('game'), startModeForKind('architecture'), startModeForKind('scene')]).toEqual(['play', 'walkthrough', 'orbit']);
  });

  it('loads the template world with its cooked package and start mode (live with cook=0)', async () => {
    const json = readFileSync(new URL('../public/templates/worlds/kestrel-outpost.json', import.meta.url), 'utf8');
    const seen: string[] = [];
    const fetchFn = (async (u: string) => {
      seen.push(String(u));
      return new Response(json, { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const r = await loadGame('#t=kestrel-outpost', fetchFn, '/play.html');
    expect(r.kind).toBe('game');
    if (r.kind !== 'game') return;
    expect(r.from).toBe('template');
    expect(seen).toEqual(['/templates/worlds/kestrel-outpost.json']);
    expect(r.game.cook).toBe('./cooked/kestrel-outpost/manifest.json');
    expect(r.game.startMode).toBe('play');
    expect(r.game.world.name.length).toBeGreaterThan(0);
    const live = await loadGame('#t=kestrel-outpost&cook=0', fetchFn, '/play.html');
    expect(live.kind === 'game' && live.game.cook).toBe(undefined);
  });
});
