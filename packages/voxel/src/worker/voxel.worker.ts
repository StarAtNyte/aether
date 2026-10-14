/**
 * Voxel worker entry: terrain generation and chunk meshing off the main
 * thread. All logic lives in {@link VoxelWorkerHandler}; this file only
 * connects it to the worker's message port.
 */
import { VoxelWorkerHandler } from './handler';

interface WorkerScope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;
const handler = new VoxelWorkerHandler();

scope.onmessage = (e: MessageEvent): void => {
  const reply = handler.handle(e.data);
  if (reply) scope.postMessage(reply.message, reply.transfer);
};
