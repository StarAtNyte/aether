/**
 * Compute worker (module worker): runs mesh edit operations and built-in
 * generator previews off the main thread, so dragging a parameter slider or
 * subdividing a mesh never blocks rendering. It only runs our own trusted
 * code (no model-written source; that goes to the locked-down sandbox) and
 * answers with zero-copy transfers. Every request and reply is validated.
 */
import { runMeshOp, meshTransferables, parseMeshMessage } from '../mesh-edit/run';
import { generateBuiltinSync } from '../generate';
import { finishPixels } from '../finish-pixels';
import { parseComputeRequest, outputTransferables, type ComputeReply } from './protocol';

interface WorkerScope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

function message(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

scope.onmessage = (e: MessageEvent): void => {
  const req = parseComputeRequest(e.data);
  if (!req) return;
  let reply: ComputeReply;
  let transfer: Transferable[] = [];
  try {
    if (req.type === 'mesh') {
      const mesh = parseMeshMessage(req.mesh);
      if (!mesh) throw new Error('invalid mesh data');
      const r = runMeshOp(req.op, mesh);
      reply = { type: 'mesh', id: req.id, ok: true, mesh: r.mesh, ...(r.note ? { note: r.note } : {}) };
      transfer = meshTransferables(r.mesh);
    } else if (req.type === 'finish') {
      const pixels = finishPixels(req.finish, req.size);
      reply = { type: 'finish', id: req.id, ok: true, pixels };
      transfer = [pixels.albedo.buffer, pixels.orm.buffer, pixels.normal.buffer] as ArrayBuffer[];
    } else {
      const output = generateBuiltinSync(req.generator, req.params, req.seed);
      reply = { type: 'generate', id: req.id, ok: true, output };
      transfer = outputTransferables(output);
    }
  } catch (err) {
    reply = { type: req.type, id: req.id, ok: false, error: message(err) };
  }
  scope.postMessage(reply, transfer);
};
scope.postMessage({ type: 'ready' }, []);
