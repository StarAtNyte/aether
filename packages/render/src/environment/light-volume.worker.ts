/**
 * Light-volume worker (module worker): bakes a building's light volume off the main thread (a second or two
 * of CPU for a house). Runs only our own bake code; requests are validated, replies carry the probe data
 * as a transferred buffer.
 */
import { LightVolumeBaker, TraceScene } from './light-volume';
import { parseVolumeRequest, type VolumeReply } from './light-volume-protocol';

interface WorkerScope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e: MessageEvent): void => {
  const req = parseVolumeRequest(e.data);
  if (!req) {
    const id: unknown = (e.data as { id?: unknown } | null)?.id;
    if (typeof id === 'number' && Number.isSafeInteger(id)) scope.postMessage({ type: 'volume', id, ok: false, error: 'invalid bake request' } satisfies VolumeReply, []);
    return;
  }
  try {
    const scene = new TraceScene({ positions: req.positions, albedo: req.albedo, twoSided: req.twoSided });
    const data = new LightVolumeBaker({ grid: req.grid, scene, sun: req.sun, ambient: req.ambient, ground: req.ground, lamps: req.lamps }).run();
    scope.postMessage({ type: 'volume', id: req.id, ok: true, data } satisfies VolumeReply, [data.buffer]);
  } catch (err) {
    scope.postMessage({ type: 'volume', id: req.id, ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) } satisfies VolumeReply, []);
  }
};
