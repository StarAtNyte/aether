/**
 * DAG worker (module worker): builds cluster LOD DAGs for big meshes off the
 * main thread (seconds of CPU for a million triangles). Runs only our own
 * geometry code; requests and replies are validated.
 */
import { buildClusterDag } from './cluster-dag';
import { dagTransferables, parseDagRequest } from './dag-protocol';
const scope = self;
scope.onmessage = (e) => {
    const req = parseDagRequest(e.data);
    if (!req) {
        const id = e.data?.id;
        if (typeof id === 'number' && Number.isSafeInteger(id))
            scope.postMessage({ type: 'dag', id, ok: false, error: 'invalid mesh' }, []);
        return;
    }
    let reply;
    let transfer = [];
    try {
        const dag = buildClusterDag(req.positions, req.indices);
        reply = { type: 'dag', id: req.id, ok: true, dag };
        transfer = dagTransferables(dag);
    }
    catch (err) {
        reply = { type: 'dag', id: req.id, ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
    }
    scope.postMessage(reply, transfer);
};
