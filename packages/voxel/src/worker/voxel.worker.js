/**
 * Voxel worker entry: terrain generation and chunk meshing off the main
 * thread. All logic lives in {@link VoxelWorkerHandler}; this file only
 * connects it to the worker's message port.
 */
import { VoxelWorkerHandler } from './handler';
const scope = globalThis;
const handler = new VoxelWorkerHandler();
scope.onmessage = (e) => {
    const reply = handler.handle(e.data);
    if (reply)
        scope.postMessage(reply.message, reply.transfer);
};
