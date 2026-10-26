import { describe, expect, it } from 'vitest';
import { preparePresentation } from '../src/gpu/presentation';
function fixture() {
  const events: string[] = [], context = { textures: null, fullscreenPass: true };
  const mesh = { isQuadMesh: true, material: { version: 0 }, geometry: {} };
  const object = { object: mesh, material: mesh.material, context };
  let pending = false, target: unknown = null, cold = false, mutate = false;
  const backend = {
    beginRender: (_c: unknown) => { events.push('clear canvas'); }, finishRender: (_c: unknown) => { events.push('finish canvas'); },
    draw: (_o: unknown, _i: unknown) => { events.push('present'); },
  };
  const nodes = { updateBefore: (_o: unknown) => { events.push('scene dependencies'); }, updateAfter: (_o: unknown) => { events.push('temporal after'); } };
  const r = {
    backend, _nodes: nodes, needsFrameBufferTarget: false,
    getRenderTarget: () => target, getOutputRenderTarget: () => null,
    _renderScene(_o: unknown, _c: unknown, _f?: boolean) {
      backend.beginRender(context); nodes.updateBefore(object);
      if (!cold) { backend.draw(object, {}); nodes.updateAfter(object); }
      if (mutate) mesh.material.version++;
      backend.finishRender(context);
    },
  };
  const original = r._renderScene;
  const presentation = preparePresentation(r, () => pending);
  return { events, mesh, r, original, presentation,
    pending: (v: boolean) => { pending = v; }, cold: (v: boolean) => { cold = v; },
    target: (v: unknown) => { target = v; }, mutate: () => { mutate = true; },
    render: () => { presentation.beginFrame(); r._renderScene(mesh, null); },
  };
}
describe('complete-frame presentation', () => {
  it('prepares dependencies before touching the canvas and updates temporal state only once', () => {
    const f = fixture(); f.render();
    expect(f.events).toEqual(['scene dependencies', 'temporal after', 'clear canvas', 'present', 'finish canvas']);
    expect(f.presentation.skipped).toBe(false); f.presentation.dispose();
  });
  it('leaves the last image untouched while resources prepare, then resumes without a new renderer', () => {
    const f = fixture(); f.pending(true); f.render();
    expect(f.events).toEqual(['scene dependencies', 'temporal after']);
    expect(f.presentation.skipped).toBe(true);
    f.events.length = 0; f.pending(false); f.render();
    expect(f.events).toContain('present'); expect(f.presentation.skipped).toBe(false); f.presentation.dispose();
  });
  it('does not present an unprepared output shader or a material changed during discovery', () => {
    const f = fixture(); f.cold(true); f.render();
    expect(f.events).toEqual(['scene dependencies']); expect(f.presentation.skipped).toBe(true);
    f.cold(false); f.mutate(); f.events.length = 0; f.render();
    expect(f.events).not.toContain('present'); f.presentation.dispose();
  });
  it('retains atomic capture drawing and restores hooks on disposal', () => {
    const f = fixture(); f.pending(true);
    f.presentation.synchronous(() => f.render());
    expect(f.events).toEqual(['clear canvas', 'scene dependencies', 'present', 'temporal after', 'finish canvas']);
    f.presentation.dispose(); expect(f.r._renderScene).toBe(f.original);
  });
});
