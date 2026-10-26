import { runMergeRequest } from './merge-work';
import type { MergeRequest, MergeOutput } from './merge-wire';
const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(message: unknown, transfer: Transferable[]): void };
scope.onmessage = event => {
  const { id, request } = event.data as { id: number; request: MergeRequest };
  let output: MergeOutput | null = null;
  try {
    output = runMergeRequest(request);
  } catch { /* The owner retains its original synchronous merge path. */ }
  const buffers = new Set<Transferable>();
  if (output) { for (const a of Object.values(output.attributes)) buffers.add(a.array.buffer); if (output.index) buffers.add(output.index.buffer); }
  scope.postMessage({ id, output }, [...buffers]);
};
