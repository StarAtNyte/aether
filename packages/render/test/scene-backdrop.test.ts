/**
 * The scene behind the water (WebGPU): drawn without the water, into a single-sample target with a depth texture,
 * and the renderer is put back as it was.
 */
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Scene } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { SceneBackdrop } from '../src/materials/scene-backdrop';

function stub(size: [number, number], rendered: boolean[][], hide: Array<{ visible: boolean }>): WebGPURenderer {
  const state = { target: 'canvas' as unknown, auto: false };
  return {
    getOutputRenderTarget: () => null,
    getDrawingBufferSize: (v: { set(x: number, y: number): void }) => v.set(size[0], size[1]),
    getRenderTarget: () => state.target,
    getMRT: () => null,
    setMRT: () => undefined,
    setRenderTarget: (t: unknown) => void (state.target = t),
    get autoClear() {
      return state.auto;
    },
    set autoClear(v: boolean) {
      state.auto = v;
    },
    render: () => void rendered.push(hide.map((h) => h.visible)),
  } as unknown as WebGPURenderer;
}

describe('scene backdrop', () => {
  it('draws the scene with the water hidden and restores everything', () => {
    const b = new SceneBackdrop();
    const water = { visible: true };
    const rendered: boolean[][] = [];
    const r = stub([800, 450], rendered, [water]);
    expect(b.used).toBe(false);
    b.depthTexture();
    expect(b.used).toBe(true);
    b.render(r, new Scene(), new PerspectiveCamera(), [water]);
    expect(rendered).toEqual([[false]]);
    expect(water.visible).toBe(true);
    expect(r.getRenderTarget()).toBe('canvas');
    expect(r.autoClear).toBe(false);
    expect(b.ready).toBe(true);
    expect(b.draws).toBe(1);
    expect(b.target.width).toBe(800);
    expect(b.target.height).toBe(450);
    expect(b.target.samples).toBe(0);
    expect(b.target.depthTexture).not.toBeNull();
    b.dispose();
  });

  it('follows the frame size', () => {
    const b = new SceneBackdrop();
    const rendered: boolean[][] = [];
    b.render(stub([640, 360], rendered, []), new Scene(), new PerspectiveCamera(), []);
    b.render(stub([1280, 720], rendered, []), new Scene(), new PerspectiveCamera(), []);
    expect([b.target.width, b.target.height]).toEqual([1280, 720]);
    // three sizes the depth texture of a target from the target when it draws into it.
    expect(b.depthTexture().renderTarget).toBe(b.target);
    b.dispose();
  });

  it('restores the water even when the draw throws', () => {
    const b = new SceneBackdrop();
    const water = { visible: true };
    const r = stub([64, 64], [], [water]);
    (r as unknown as { render: () => void }).render = () => {
      throw new Error('device lost');
    };
    expect(() => b.render(r, new Scene(), new PerspectiveCamera(), [water])).toThrow('device lost');
    expect(water.visible).toBe(true);
    expect(b.ready).toBe(false);
  });
});
