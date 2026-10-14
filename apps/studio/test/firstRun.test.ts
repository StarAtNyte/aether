/**
 * First-run "Connect your AI" decisions: variant (local vs hosted), when the
 * screen shows, the remembered choice, untrusted probe parsing, and the
 * prefs event payload filter.
 */
import { describe, expect, it } from 'vitest';
import { decideFirstRun, healthOffersLocal, ONBOARDING_KEY, probeFirstRun, readMarker, statusSignedIn, writeMarker } from '../src/onboarding/firstRun';
import { pickPrefsPatch } from '../src/onboarding/useAiPrefsEvent';
import type { StorageLike } from '../src/lib/storage';

function mem(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

function fakeFetch(routes: Record<string, unknown | Error>): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const f = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    urls.push(url);
    const r = routes[url];
    if (r instanceof Error) throw r;
    if (r === undefined) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: f as typeof fetch, urls };
}

describe('first-run decision', () => {
  it('shows the local variant only when the server offers local AI and nothing is signed in', () => {
    expect(decideFirstRun({ marker: null, local: true, signedIn: false, hostedBuild: false })).toEqual({ show: true, variant: 'local' });
    expect(decideFirstRun({ marker: null, local: true, signedIn: true, hostedBuild: false })).toEqual({ show: false, variant: 'local' });
    expect(decideFirstRun({ marker: null, local: false, signedIn: false, hostedBuild: false })).toEqual({ show: true, variant: 'hosted' });
    // The hosted build flag wins even if some server answered.
    expect(decideFirstRun({ marker: null, local: true, signedIn: false, hostedBuild: true })).toEqual({ show: true, variant: 'hosted' });
  });

  it('never nags once a choice is remembered', () => {
    for (const choice of ['offline', 'codex', 'byok'] as const) {
      expect(decideFirstRun({ marker: { choice, at: 1 }, local: true, signedIn: false, hostedBuild: false }).show).toBe(false);
      expect(decideFirstRun({ marker: { choice, at: 1 }, local: false, signedIn: false, hostedBuild: false }).show).toBe(false);
    }
  });
});

describe('remembered choice', () => {
  it('round-trips and rejects invalid values', () => {
    const s = mem();
    expect(readMarker(s)).toBeNull();
    writeMarker(s, 'byok', 1234.7);
    expect(readMarker(s)).toEqual({ choice: 'byok', at: 1234 });
    for (const bad of ['{', '[]', '{"choice":"root","at":1}', '{"choice":"offline","at":-1}', '{"choice":"offline"}', '{"choice":"offline","at":"x"}']) {
      s.setItem(ONBOARDING_KEY, bad);
      expect(readMarker(s), bad).toBeNull();
    }
    expect(readMarker(null)).toBeNull();
  });
});

describe('probes (untrusted input)', () => {
  it('reads local AI from /api/health and sign-in from /api/local/status', () => {
    expect(healthOffersLocal({ ok: true, local: true })).toBe(true);
    for (const b of [null, 'x', { ok: true, local: 'yes' }, { ok: false, local: true }, { local: true }]) expect(healthOffersLocal(b)).toBe(false);
    expect(statusSignedIn({ backends: [{ installed: true, loggedIn: false }, { installed: true, loggedIn: true }] })).toBe(true);
    for (const b of [null, { backends: 'x' }, { backends: [{ installed: false, loggedIn: true }] }, { backends: [null, 3] }]) expect(statusSignedIn(b)).toBe(false);
  });

  it('probes health, then the local status only when local AI is offered and no choice is remembered', async () => {
    const local = fakeFetch({ '/api/health': { ok: true, local: true }, '/api/local/status': { backends: [{ installed: true, loggedIn: true }] } });
    expect(await probeFirstRun(local.fetch, mem(), false)).toMatchObject({ local: true, signedIn: true });
    expect(local.urls).toEqual(['/api/health', '/api/local/status']);

    const remembered = mem();
    writeMarker(remembered, 'offline');
    const again = fakeFetch({ '/api/health': { ok: true, local: true } });
    expect(await probeFirstRun(again.fetch, remembered, false)).toMatchObject({ local: true, signedIn: false, marker: { choice: 'offline' } });
    expect(again.urls).toEqual(['/api/health']);

    // A static host: no /api at all → hosted; a network failure is the same.
    expect(await probeFirstRun(fakeFetch({}).fetch, mem(), false)).toMatchObject({ local: false });
    expect(await probeFirstRun(fakeFetch({ '/api/health': new TypeError('offline') }).fetch, mem(), false)).toMatchObject({ local: false });
    const flagged = fakeFetch({ '/api/health': { ok: true, local: true } });
    expect(await probeFirstRun(flagged.fetch, mem(), true)).toMatchObject({ local: false, hostedBuild: true });
    expect(flagged.urls).toEqual([]);
  });
});

describe('prefs event payload', () => {
  it('keeps only known preference keys', () => {
    expect(pickPrefsPatch({ mode: 'byok', byokProvider: 'openai', __proto__x: 1, evil: 'x' })).toEqual({ mode: 'byok', byokProvider: 'openai' });
    expect(pickPrefsPatch(JSON.parse('{"__proto__":{"polluted":1},"backend":"claude-code"}'))).toEqual({ backend: 'claude-code' });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    for (const bad of [null, 'x', [1], { nope: 1 }]) expect(pickPrefsPatch(bad)).toBeNull();
  });
});
