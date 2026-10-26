import { describe, expect, it } from 'vitest';
import { Camera, Mesh, MeshBasicMaterial, Scene } from 'three';
import { Node, type NodeFrame } from 'three/webgpu';
// @ts-expect-error Three r186 renamed this runtime module before its declaration package.
import NodeManager from 'three/src/renderers/common/nodes/NodeManager.js';
import { inlineNodeUpdates } from './node-dispatch-experiment';
import { cacheNodeUpdateMaps } from './node-map-cache-experiment';

function fixture(patched: boolean, patch: typeof inlineNodeUpdates = inlineNodeUpdates) {
  const renderer = {}, manager = new NodeManager(renderer, {}), trace: string[] = [], state = { updateNodes: [] as Node[] };
  const object = new Mesh(undefined, new MeshBasicMaterial()); object.name = 'one';
  const ro = { renderer, scene: new Scene(), camera: new Camera(), object, material: object.material, getNodeBuilderState: () => state };
  if (patched) patch({ _nodes: manager });
  const probe = (type: string) => {
    const index = state.updateNodes.length, node = new Node();
    Object.assign(node, {
      updateType: type,
      getUpdateType(frame: NodeFrame) { trace.push(`type:${index}:${frame.frameId}:${frame.renderId}`); return this.updateType; },
      updateReference(frame: NodeFrame) { trace.push(`ref:${index}:${frame.object?.name}`); return this; },
      update(frame: NodeFrame) { trace.push(`update:${index}:${frame.frameId}:${frame.renderId}:${frame.object?.name}`); },
    });
    state.updateNodes.push(node); return node;
  };
  return { manager, trace, state, ro, probe, get frame() { return manager.nodeFrame; }, run() { manager.updateForRender(ro); } };
}
type Fixture = ReturnType<typeof fixture>;
function same(drive: (f: Fixture) => void) {
  for (const patch of [inlineNodeUpdates, cacheNodeUpdateMaps]) { const a = fixture(false), b = fixture(true, patch); drive(a); drive(b); expect(b.trace).toEqual(a.trace); }
}

describe('rejected node-dispatch parity', () => {
  it('preserves object/frame/render/none callbacks across objects, frames and render calls', () => same(f => {
    for (const type of ['object', 'frame', 'render', 'none']) f.probe(type);
    for (const frameId of [0, 1, 1, 2]) for (const renderId of [0, 1, 2]) {
      f.frame.frameId = frameId; f.frame.renderId = renderId; f.run(); f.ro.object.name = 'two'; f.run();
    }
  }));
  it('preserves false-return retries and callback changes to frame/render IDs', () => same(f => {
    const a = f.probe('frame'), b = f.probe('render'); let attempts = 0;
    a.update = frame => { f.trace.push(`a:${++attempts}`); if (attempts < 3) return false; frame.frameId++; };
    b.update = frame => { f.trace.push('b'); frame.renderId++; };
    f.frame.frameId = 1; f.frame.renderId = 1; for (let i = 0; i < 5; i++) f.run();
  }));
  it('preserves changing/shared references and dynamic update types', () => same(f => {
    const a = f.probe('frame'), b = f.probe('render'), shared = {}; let self = true;
    Object.assign(a, { updateReference() { f.trace.push('dynamic-ref'); return self ? a : shared; } });
    Object.assign(b, { updateReference() { return shared; } });
    f.frame.frameId = 1; f.frame.renderId = 1; f.run(); self = false; f.run();
    self = true; a.updateType = 'object'; f.run(); a.updateType = 'frame'; f.run();
  }));
  it('handles list reordering, replacement, shrinking, appending and repeated nodes', () => same(f => {
    const a = f.probe('frame'), b = f.probe('render'); f.frame.frameId = 1; f.frame.renderId = 1; f.run();
    f.state.updateNodes.reverse(); f.run(); f.state.updateNodes = [a, a, b]; f.frame.frameId++; f.run();
    f.state.updateNodes.length = 1; f.run(); f.probe('object'); f.run();
  }));
  it('handles update-map replacement inside a callback and node-manager disposal', () => same(f => {
    const a = f.probe('frame'), b = f.probe('object');
    b.update = () => { f.trace.push('replace-map'); f.frame.updateMap = new WeakMap(); };
    f.state.updateNodes.push(a); f.frame.frameId = 1; f.run(); f.run();
    f.manager.dispose(); f.frame.frameId = 1; f.run();
  }));
  it('preserves updateNode and map-method overrides installed by preceding callbacks', () => same(f => {
    const a = f.probe('object'); f.probe('render'); const update = f.frame.updateNode, maps = f.frame._getMaps; let first = true;
    a.update = () => {
      if (!first) return; first = false;
      f.frame.updateNode = (node: Node) => { f.trace.push('override-update'); return update.call(f.frame, node); };
      f.frame._getMaps = (...args: unknown[]) => { f.trace.push('override-map'); return maps.apply(f.frame, args); };
    };
    f.frame.frameId = 1; f.frame.renderId = 1; f.run(); f.run();
  }));
  it('preserves custom WeakMap getters and thrown-update retries', () => same(f => {
    const a = f.probe('frame'); let first = true; const get = WeakMap.prototype.get;
    f.frame.updateMap.get = function (key: object) { f.trace.push('map-get'); return get.call(this, key); };
    a.update = () => { f.trace.push('attempt'); if (first) { first = false; throw new Error('retry'); } };
    f.frame.frameId = 1; expect(() => f.run()).toThrow('retry'); f.run(); f.run();
  }));
  it('is idempotent and leaves custom manager/frame implementations alone', () => {
    const f = fixture(true), installed = f.manager.updateForRender;
    inlineNodeUpdates({ _nodes: f.manager }); expect(f.manager.updateForRender).toBe(installed);
    const a = fixture(false), original = a.manager.updateForRender;
    a.frame._getMaps = () => ({ frameId: 0, renderId: 0 }); inlineNodeUpdates({ _nodes: a.manager }); expect(a.manager.updateForRender).toBe(original);
    const b = fixture(false), custom = () => {}; b.manager.updateForRender = custom;
    inlineNodeUpdates({ _nodes: b.manager }); expect(b.manager.updateForRender).toBe(custom);
  });
});
