/**
 * Opt-in smoke of the whole on-demand import against the real SimReady service and Hugging Face (not part of CI):
 *
 *   npm run assets:simready-e2e [-- "office chair"]
 *
 * Needs the network and the tools from `npm run assets:simready-setup`. Imports one model into a temp folder, prints its
 * stages, triangle count, size and credit, and removes the folder. Exit code 0 when the model is ready.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { importUserAsset } from '../../packages/assets/src/user';
import { ImportService } from '../../apps/server/src/assets-import/service';
import { createConverter, toolsMissingReason, usdPython } from '../../apps/server/src/assets-import/convert';
import { silentLogger } from '../../apps/server/src/logger';

const query = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ') || 'office chair';
const root = resolve(import.meta.dirname, '../..');
const tmp = mkdtempSync(join(tmpdir(), 'aether-import-e2e-'));
const service = new ImportService({
  dir: join(tmp, 'imported'),
  srcDir: process.env['AETHER_ASSET_SRC'] ?? join(tmp, 'src'),
  logger: silentLogger,
  toolsMissing: () => toolsMissingReason(root, usdPython()),
  convert: createConverter(root, usdPython()),
});
const job = service.start({ query });
let last = '';
const t0 = Date.now();
for (;;) {
  const v = service.status(job.id)!;
  const line = `${v.stage} ${(v.progress * 100) | 0}% ${v.message}`;
  if (line !== last) console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`);
  last = line;
  if (v.stage === 'ready') {
    const a = v.asset!;
    console.log(`ready: ${a.id} "${a.entry.name}" ${a.entry.tris} triangles, ${(a.entry.bytes / 1024) | 0} KB, size ${a.entry.size.join(' x ')} m\ncredit: ${a.credit.text}`);
    // What the studio does next: validate the file again like any dropped model.
    const chk = await importUserAsset(new Uint8Array(readFileSync(service.filePath(a.id, a.entry.file!)!)), `${a.entry.name}.glb`);
    console.log(chk.ok ? `studio import check: ok (${chk.asset.meta.id}, ${chk.asset.meta.triangles} triangles)` : `studio import check FAILED: ${chk.error}`);
    rmSync(tmp, { recursive: true, force: true });
    process.exit(chk.ok ? 0 : 1);
  }
  if (v.stage === 'failed') {
    console.error(`failed: ${v.error}`);
    rmSync(tmp, { recursive: true, force: true });
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 500));
}
