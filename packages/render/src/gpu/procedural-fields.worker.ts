import { createProceduralFields } from './procedural-fields';
const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(value: unknown, transfer: Transferable[]): void };
scope.onmessage = event => {
  if (event.data !== 'prepare') return;
  try {
    const fields = createProceduralFields();
    scope.postMessage(fields, [fields.cloud.buffer, fields.cirrus.buffer, fields.material.buffer]);
  } catch { scope.postMessage(null, []); }
};
