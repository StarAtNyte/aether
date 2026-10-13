/**
 * DAG worker (module worker): builds cluster LOD DAGs for big meshes off the
 * main thread (seconds of CPU for a million triangles). Runs only our own
 * geometry code; requests and replies are validated.
 */
import { buildClusterDag } from './cluster-dag';
import { dagTransferables, parseDagRequest, type DagReply } from './dag-protocol';

interface WorkerScope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e: MessageEvent): void => {
  const req = parseDagRequest(e.data);
  if (!req) {
    const id: unknown = (e.data as { id?: unknown } | null)?.id;
    if (typeof id === 'number' && Number.isSafeInteger(id)) scope.postMessage({ type: 'dag', id, ok: false, error: 'invalid mesh' } satisfies DagReply, []);
    return;
  }
  let reply: DagReply;
  let transfer: Transferable[] = [];
  try {
    const dag = buildClusterDag(req.positions, req.indices);
    reply = { type: 'dag', id: req.id, ok: true, dag };
    transfer = dagTransferables(dag);
  } catch (err) {
    reply = { type: 'dag', id: req.id, ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
  }
  scope.postMessage(reply, transfer);
};
