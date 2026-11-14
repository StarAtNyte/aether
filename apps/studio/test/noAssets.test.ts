import { describe, expect, it, vi } from 'vitest';
import type { AgentOptions } from '@aether/agent';

// Record every agent the studio constructs (the real agent still runs).
const seen: AgentOptions[] = [];
vi.mock('@aether/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aether/agent')>();
  class RecordingAgent extends actual.WorldAgent {
    constructor(opts: AgentOptions) {
      seen.push(opts);
      super(opts);
    }
  }
  return { ...actual, WorldAgent: RecordingAgent };
});

const { AiConnection } = await import('../src/ai/connection');
const { Studio } = await import('../src/engine/Studio');
const { withoutLibraryShapes } = await import('../src/engine/AgentBridge');
const { DEFAULT_AI_PREFS, loadAiPrefs, parsePrefs, saveAiPrefs } = await import('../src/ai/prefs');
const { reviveEvent } = await import('../src/lib/chat');

function mem(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

function newStudio(): InstanceType<typeof Studio> {
  const ai = new AiConnection({ fetch: (async () => { throw new TypeError('offline'); }) as typeof fetch, session: mem() });
  return new Studio({ storage: mem(), safeMode: false, ai });
}

function doneEvent(studio: InstanceType<typeof Studio>): Record<string, unknown> | undefined {
  const chat = studio.store.getState().chat;
  const entry = chat[chat.length - 1];
  return entry?.role === 'assistant' ? (entry.events as Array<Record<string, unknown>>).find((e) => e['type'] === 'done') : undefined;
}

describe('"No assets" preference', () => {
  it('is off by default and for stored prefs that predate it', () => {
    expect(DEFAULT_AI_PREFS.noAssets).toBe(false);
    expect(parsePrefs({ mode: 'offline' }).noAssets).toBe(false);
    expect(parsePrefs({ noAssets: 'yes' }).noAssets).toBe(false);
  });

  it('is persisted with the AI prefs (global and per project)', () => {
    const storage = mem();
    saveAiPrefs(storage, { ...DEFAULT_AI_PREFS, noAssets: true }, 'abcdefgh1234');
    expect(loadAiPrefs(storage).noAssets).toBe(true);
    expect(loadAiPrefs(storage, 'abcdefgh1234').noAssets).toBe(true);
    saveAiPrefs(storage, { ...DEFAULT_AI_PREFS, noAssets: false });
    expect(loadAiPrefs(storage).noAssets).toBe(false);
  });
});

describe('the offline planner in "No assets" mode', () => {
  it('turns library-model shapes into their fallback or a primitive', () => {
    const input = {
      patches: [
        { op: 'add', entity: { id: 'sofa', shape: { kind: 'asset', id: 'sofa-modern', fallback: { kind: 'procedural', generator: 'furn-sofa', params: {} } } } },
        { op: 'add', entity: { id: 'lamp', shape: { kind: 'asset', id: 'lamp-1', fitSize: 2 } } },
        { op: 'add', entity: { id: 'm', shape: { kind: 'model', url: 'https://x/y.glb' } } },
        { op: 'add', entity: { id: 'tree', shape: { kind: 'procedural', generator: 'tree', params: {} } } },
      ],
    };
    const out = JSON.stringify(withoutLibraryShapes(input));
    expect(out).not.toMatch(/"kind":"(asset|model)"/);
    expect(out).toContain('"generator":"furn-sofa"');
    expect(out).toContain('"size":[2,2,2]');
    expect(out).toContain('"generator":"tree"');
  });
});

describe('run options', () => {
  it('pass noAssets to the agent and record it on the turn when on', async () => {
    const studio = newStudio();
    studio.store.getState().setAiPrefs({ mode: 'offline', noAssets: true, refine: 0 });
    seen.length = 0;
    await studio.send('A cozy living room with a sofa, a lamp and a bookshelf');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((o) => o.noAssets === true)).toBe(true);
    expect(seen.every((o) => o.importAsset === undefined && o.hubSearch === undefined && o.buildAsset === undefined)).toBe(true);
    const done = doneEvent(studio);
    expect(done).toMatchObject({ noAssets: true });
    expect(reviveEvent(JSON.parse(JSON.stringify(done)))).toMatchObject({ type: 'done', noAssets: true });
    // Nothing in the world is a library model.
    expect(JSON.stringify(studio.history.current.entities)).not.toMatch(/"kind":"(asset|model)"/);
    studio.dispose();
  }, 60_000);

  it('leave it out when off', async () => {
    const studio = newStudio();
    studio.store.getState().setAiPrefs({ mode: 'offline', refine: 0 });
    seen.length = 0;
    await studio.send('A cozy lakeside camp at sunset with a campfire, tents and fireflies');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((o) => o.noAssets)).toBe(false);
    expect(doneEvent(studio)?.['noAssets']).toBeUndefined();
    studio.dispose();
  }, 60_000);
});
