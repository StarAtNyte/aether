/** Rejected CPU dispatch experiment: preserves callbacks but regresses material-reference workloads. */
import { REVISION } from 'three';

interface Stamp { frameId: number; renderId: number }
interface UpdateNode {
  readonly id: number;
  getUpdateType(frame: Frame): string;
  updateReference(frame: Frame): object;
  update(frame: Frame): unknown;
}
interface Frame {
  frameId: number;
  renderId: number;
  updateMap: WeakMap<object, Stamp>;
  updateNode(node: UpdateNode): void;
  _getMaps(map: WeakMap<object, Stamp>, reference: object): Stamp;
}
interface State { updateNodes: Iterable<UpdateNode> }
interface RenderObject { getNodeBuilderState(): State }
interface Manager {
  nodeFrame: Frame;
  getNodeFrameForRender(object: RenderObject): Frame;
  updateForRender(object: RenderObject): void;
}
interface Renderer { _nodes?: Manager }

const installed = new WeakSet<object>();

export function inlineNodeUpdates(renderer: Renderer): void {
  const manager = renderer._nodes, initial = manager?.nodeFrame;
  if (REVISION !== '186' || !manager || !initial || installed.has(manager)
      || typeof manager.getNodeFrameForRender !== 'function' || typeof manager.updateForRender !== 'function'
      || typeof initial.updateNode !== 'function' || typeof initial._getMaps !== 'function'
      || manager.updateForRender !== Object.getPrototypeOf(manager)?.updateForRender
      || initial.updateNode !== Object.getPrototypeOf(initial)?.updateNode
      || initial._getMaps !== Object.getPrototypeOf(initial)?._getMaps) return;
  const update = initial.updateNode;
  manager.updateForRender = function (object) {
    const frame = this.getNodeFrameForRender(object), state = object.getNodeBuilderState(), nodes = state.updateNodes;
    if (!Array.isArray(nodes)) { for (const node of nodes) frame.updateNode(node); return; }
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      // Preserve even overrides installed by a preceding node's callback in this very loop.
      if (frame.updateNode !== update) { frame.updateNode(node); continue; }
      const type = node.getUpdateType(frame);
      const reference = node.updateReference(frame);
      if (type === 'object') { node.update(frame); continue; }
      if (type !== 'frame' && type !== 'render') continue;
      const stamp = frame._getMaps(frame.updateMap, reference);
      if (type === 'frame') {
        if (stamp.frameId !== frame.frameId && node.update(frame) !== false) stamp.frameId = frame.frameId;
      } else if (stamp.renderId !== frame.renderId && node.update(frame) !== false) stamp.renderId = frame.renderId;
    }
  };
  installed.add(manager);
}
