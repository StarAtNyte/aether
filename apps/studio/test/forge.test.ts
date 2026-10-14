/**
 * Forge controller (studio side of the asset forge): availability messages,
 * a full scripted run (iterations streamed into its store), accept → saved
 * creation + placed generator (one undoable edit), cancel, and refining a
 * creation keeps its id.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { History, createWorld, type GeneratorDef } from '@aether/core';
import type { CompletionRequest, CompletionResponse, Provider } from '@aether/agent';
import { setCatalog, loadCatalog } from '@aether/assets';
import { ForgeController, forgeId, type ForgeHost } from '../src/engine/forge';
import { AssetController } from '../src/engine/assets';
import { createStudioStore } from '../src/state/store';
import type { AiConnection, ResolvedConnection } from '../src/ai/connection';

const SRC = 'const m = api.material({ color: params.color }); api.box(1, params.height, 1, m); return api.build();';

function reply(height: number): CompletionResponse {
  return { content: [{ type: 'tool_use', id: `t${height}`, name: 'submit_generator', input: { id: 'ignored', description: `Ornate chair. seat 0.45 h; back ${height}`, params: { height: { type: 'number', default: height, min: 0.1, max: 5 }, color: { type: 'color', default: '#884422' } }, source: SRC } }], stopReason: 'tool_use' };
}
function critique(score: number): CompletionResponse {
  return { content: [{ type: 'text', text: JSON.stringify({ scores: { silhouette: score, proportions: score, parts: score, colours: score }, matched: ['legs'], missing: ['carved back'], fixes: ['taller back'], summary: `s${score}` }) }], stopReason: 'end' };
}

function provider(coder: CompletionResponse[], critic: CompletionResponse[], gate?: Promise<void>): Provider {
  return {
    name: 'scripted',
    async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResponse> {
      if (gate) await gate;
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const r = (req.role === 'critic' ? critic : coder).shift();
      if (!r) throw new Error('no reply');
      return r;
    },
  } as Provider;
}

function setup(resolved: Partial<ResolvedConnection>, p: Provider | null): { forge: ForgeController; history: History; assets: AssetController } {
  const history = new History(createWorld());
  const store = createStudioStore();
  const ai = { resolve: () => ({ kind: 'bridge', label: 'Claude Code', ready: true, vision: true, ...resolved }), createProvider: () => p } as unknown as AiConnection;
  const commitUser = (patches: unknown[], message: string): string | null => {
    const r = history.commit(patches, message, 'user');
    return r.errors.length > 0 ? r.errors[0]!.message : null;
  };
  const assets = new AssetController({ store, history, simulation: null, onSimulation: () => () => undefined, commitUser, replaceWorld: () => undefined }, { storage: null });
  const host: ForgeHost = { store, history, simulation: null, ai, assets, commitUser, validateGenerator: async (def: GeneratorDef) => (def.source.includes('api.build') ? { ok: true } : { ok: false, error: 'bad' }), generatorSandbox: null };
  const forge = new ForgeController(host);
  // No WebGL in unit tests: a fixed contact sheet stands in for the renders.
  forge.renderSheet = async () => 'data:image/jpeg;base64,AAAA';
  return { forge, history, assets };
}

afterEach(() => setCatalog(null));

describe('forge controller', () => {
  it('explains when it cannot run (offline, not ready, no vision)', () => {
    expect(setup({ kind: 'offline', label: 'Offline planner' }, null).forge.availability()).toMatchObject({ ok: false, reason: expect.stringContaining('connected model') });
    expect(setup({ ready: false, reason: 'not signed in' }, null).forge.availability()).toMatchObject({ ok: false, reason: expect.stringContaining('not signed in') });
    expect(setup({ vision: false }, null).forge.availability()).toMatchObject({ ok: true, vision: false, reason: expect.stringContaining('cannot see images') });
  });

  it('runs, streams iterations, accepts into the library and the world', async () => {
    await loadCatalog();
    const { forge, history, assets } = setup({}, provider([reply(1), reply(1.3)], [critique(6), critique(9)]));
    forge.open();
    await forge.run('an ornate chair', 'data:image/png;base64,iVBORw0KGgo=');
    const s = forge.state.getState();
    expect(s.status).toBe('done');
    expect(s.passed).toBe(true);
    expect(s.iterations.map((i) => i.score)).toEqual([0.6, 0.9]);
    expect(s.iterations[0]!.missing).toEqual(['carved back']);
    expect(s.result?.id).toMatch(/^custom-an-ornate-chair/);
    const id = await forge.accept();
    expect(id).toBeTruthy();
    const world = history.current;
    expect(Object.keys(world.generators)).toContain(s.result!.id);
    expect(world.entities[id!]?.shape).toMatchObject({ kind: 'procedural', generator: s.result!.id });
    expect(assets.state.getState().creations.map((c) => c.def.id)).toEqual([s.result!.id]);
    expect(forge.state.getState().open).toBe(false);
    // One undo removes the placed creation and its definition together.
    history.undo();
    expect(Object.keys(history.current.generators)).not.toContain(s.result!.id);
  });

  it('rejects unsupported reference images up front', async () => {
    const { forge } = setup({}, provider([], []));
    forge.open();
    await forge.run('x', 'data:text/html;base64,PHNjcmlwdD4=');
    expect(forge.state.getState()).toMatchObject({ status: 'failed', message: expect.stringContaining('PNG, JPEG or WebP') });
  });

  it('can be cancelled', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { forge } = setup({}, provider([reply(1)], [critique(9)], gate));
    forge.open();
    const run = forge.run('a lamp', null);
    forge.cancel();
    release();
    await run;
    expect(forge.state.getState()).toMatchObject({ status: 'failed', message: 'Cancelled.' });
  });

  it('refining a creation keeps its id', async () => {
    const base: GeneratorDef = { id: 'custom-chair', description: 'chair', params: {}, source: SRC };
    const { forge } = setup({}, provider([reply(2)], [critique(9)]));
    forge.open(base);
    await forge.run('taller', null);
    expect(forge.state.getState().result?.id).toBe('custom-chair');
  });

  it('derives unique slugs', () => {
    expect(forgeId('A Big Red Barn!', () => false)).toBe('custom-a-big-red');
    expect(forgeId('', () => false)).toBe('custom-object');
    expect(forgeId('lamp', (id) => id === 'custom-lamp')).toBe('custom-lamp-2');
  });
});
