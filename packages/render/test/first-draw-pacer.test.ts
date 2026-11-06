import { describe, expect, it } from 'vitest';
import { installFirstDrawPacer } from '../src/gpu/first-draw-pacer';

function setup(active = true) {
  const drawn: object[] = [];
  const backend = { gl: {} as WebGL2RenderingContext, draw: (ro: { pipeline: object }) => void drawn.push(ro.pipeline) };
  let frame = 0;
  let again = 0;
  const state = { active };
  const pacer = installFirstDrawPacer(backend as never, { frame: () => frame, active: () => state.active, again: () => again++ });
  const mesh = { isMesh: true };
  const draw = (pipeline: object, object: object = mesh): void => (backend.draw as (ro: unknown, info: unknown) => void)({ pipeline, object }, null);
  return { drawn, pacer, draw, next: () => frame++, state, againCount: () => again };
}

describe('first-draw pacer', () => {
  it('draws one new pipeline per frame and every known one, until all are drawn', async () => {
    const t = setup();
    const known = {};
    const a = {}, b = {}, c = {};
    t.draw(known);
    t.next();
    t.draw(known);
    t.draw(a);
    t.draw(b);
    t.draw(c);
    expect(t.drawn).toEqual([known, known, a]);
    expect(t.pacer.pending).toBe(2);
    await new Promise((r) => setTimeout(r, 0));
    expect(t.againCount()).toBe(1);
    t.next();
    t.draw(a);
    t.draw(b);
    t.draw(c);
    expect(t.drawn.slice(3)).toEqual([a, b]);
    t.next();
    t.draw(a);
    t.draw(b);
    t.draw(c);
    expect(t.pacer.pending).toBe(0);
    expect(t.pacer.deferred).toBe(3);
  });

  it('draws everything while inactive (load screen, captures), and never holds back full-screen passes', () => {
    const t = setup(false);
    const a = {}, b = {}, q = {}, r = {};
    t.draw(a);
    t.draw(b);
    expect(t.drawn).toEqual([a, b]);
    t.state.active = true;
    t.next();
    t.draw(q, { isMesh: true, isQuadMesh: true });
    t.draw(r, { isMesh: true, isQuadMesh: true });
    t.draw(a);
    expect(t.drawn).toEqual([a, b, q, r, a]);
    t.pacer.dispose();
  });
});
