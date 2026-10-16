/**
 * Write `.br` / `.gz` siblings for the built studio (used by the container
 * build; the Node server sends them with `Content-Encoding`).
 *
 *   npx tsx scripts/precompress.ts [dir=apps/studio/dist]
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { precompressDir } from '../apps/server/src/precompress';
async function main() {
    const dir = resolve(process.argv[2] ?? 'apps/studio/dist');
    if (!existsSync(resolve(dir, 'index.html')))
        throw new Error(`${dir} has no index.html — build the studio first`);
    const started = performance.now();
    const r = await precompressDir(dir);
    const mb = (n) => (n / 1024 / 1024).toFixed(1);
    process.stdout.write(`precompressed ${r.files} files, ${mb(r.bytes)} MB → brotli ${mb(r.brotliBytes)} MB, gzip ${mb(r.gzipBytes)} MB in ${((performance.now() - started) / 1000).toFixed(1)} s\n`);
}
main().catch((err) => {
    process.stderr.write(`precompress failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
});
