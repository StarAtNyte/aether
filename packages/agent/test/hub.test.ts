/** find_model with the Aether asset hub as a second source, and import_asset {hub_id}. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCatalog, setCatalog } from '@aether/assets';
import { executeTool, type ExecutorContext } from '../src/executor';
import type { HubSearchResult } from '../src/types';
import { MemoryHost } from './helpers';

afterEach(() => {
  setCatalog(null);
});

const ctx = (extra: Partial<ExecutorContext>): ExecutorContext =>
  ({ host: new MemoryHost(), provider: {} as never, coderSystem: '', builtinGenerators: new Set<string>(), usage: { inputTokens: 0, outputTokens: 0 }, ...extra }) as unknown as ExecutorContext;

const HIT = { id: 'hub-only-stapler', name: 'Stapler', category: 'tools', style: 'realistic', size: [0.15, 0.05, 0.04] as [number, number, number], triangles: 900, bytes: 120_000, licence: 'CC-BY-4.0', author: 'Someone' };

describe('find_model with the asset hub', () => {
  it('lists hub models after the library, marked, without repeating library ids', async () => {
    await loadCatalog();
    const hubSearch = vi.fn(async (): Promise<HubSearchResult> => ({ ok: true, total: 2, hits: [{ ...HIT, id: 'sofa', name: 'Sofa' }, HIT] }));
    const out = await executeTool(ctx({ hubSearch }), 'find_model', { what: 'sofa' });
    expect(hubSearch).toHaveBeenCalledTimes(1);
    expect(out.isError).toBe(false);
    expect(out.content).toMatch(/Hub models \(Aether asset hub/);
    expect(out.content).toContain('hub-only-stapler — Stapler [tools, realistic] hub');
    expect(out.content).toContain('hub_id');
    // "sofa" is a library id: the hub's copy of it is not listed again.
    expect(out.content.split('Hub models')[1]).not.toMatch(/^\s*\n?sofa —/m);
    expect(out.content.indexOf('Hub models')).toBeGreaterThan(out.content.indexOf('sofa'));
  });

  it('also answers when the library has nothing', async () => {
    await loadCatalog();
    const out = await executeTool(ctx({ hubSearch: async () => ({ ok: true, total: 1, hits: [HIT] }) }), 'find_model', { what: 'stapler' });
    expect(out.content).toContain('hub-only-stapler');
  });

  it('is silent when the hub is unavailable or throws: the library answer stands', async () => {
    await loadCatalog();
    const plain = await executeTool(ctx({}), 'find_model', { what: 'sofa' });
    for (const hubSearch of [async (): Promise<HubSearchResult> => ({ ok: false, reason: 'The asset hub is not public yet.' }), async (): Promise<HubSearchResult> => { throw new Error('boom'); }]) {
      const out = await executeTool(ctx({ hubSearch }), 'find_model', { what: 'sofa' });
      expect(out.isError).toBe(false);
      expect(out.content).toBe(plain.content);
    }
  });

  it('passes the look as a style filter', async () => {
    await loadCatalog();
    const hubSearch = vi.fn(async (_q: string, _o: { limit: number; style?: string }): Promise<HubSearchResult> => ({ ok: true, total: 0, hits: [] }));
    await executeTool(ctx({ hubSearch }), 'find_model', { what: 'chair', look: 'realistic' });
    expect(hubSearch.mock.calls[0]![1].style).toBe('realistic');
  });
});

describe('import_asset with a hub id', () => {
  it('hands the id to the host and reports the credit', async () => {
    const importAsset = vi.fn(async () => ({ ok: true as const, id: 'user-0123456789ab', name: 'Stapler', size: [0.15, 0.05, 0.04] as [number, number, number], triangles: 900, credit: '"Stapler" by Someone (X), CC BY 4.0', licence: 'CC-BY-4.0' }));
    const out = await executeTool(ctx({ importAsset }), 'import_asset', { query: 'stapler', hub_id: 'hub-only-stapler' });
    expect(importAsset).toHaveBeenCalledWith({ query: 'stapler', hubId: 'hub-only-stapler' }, expect.anything());
    expect(out.content).toContain('user-0123456789ab');
    expect((await executeTool(ctx({ importAsset }), 'import_asset', { query: 'x', hub_id: '../etc' })).isError).toBe(true);
  });
});
