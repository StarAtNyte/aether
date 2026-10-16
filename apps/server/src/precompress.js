/**
 * Build-time compression of the static studio for the Node server.
 *
 * Writes a Brotli (`.br`) and a gzip (`.gz`) sibling next to every
 * compressible file of the build so `registerStatic` can send them with
 * `Content-Encoding` instead of compressing on every request. Runs once in
 * the container build (`scripts/precompress.ts`); static hosts such as
 * Vercel compress on their own and never need it.
 *
 * - Only types that compress (scripts, styles, HTML, JSON, SVG, WebAssembly,
 *   glTF binaries, Radiance HDR) and files of at least `minBytes`.
 * - A sibling is kept only when it saves at least `minSaving` of the size;
 *   otherwise any stale sibling is removed, so a rebuild never serves old bytes.
 * - Brotli runs at its best quality for text (scripts, styles, markup, JSON)
 *   up to `maxBestBytes`, and at a fast level for binaries and larger files,
 *   where the best level costs minutes for a few percent (bounded build time).
 * - Two files are compressed at a time (zlib runs on the libuv thread pool).
 * - Symbolic links are never followed; the walk is bounded by `maxFiles`.
 */
import { lstat, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
const brotli = promisify(brotliCompress);
const gz = promisify(gzip);
/** Extensions worth compressing (images, fonts and video are already compressed). */
export const COMPRESSIBLE_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.xml', '.webmanifest', '.wasm', '.glb', '.gltf', '.hdr']);
/** Text types that get Brotli's best quality (they dominate first-load bytes). */
const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.xml', '.webmanifest']);
/** Brotli level for binaries and large files: close to the best ratio at a fraction of the time. */
const FAST_BROTLI_QUALITY = 5;
/** Files compressed concurrently. */
const CONCURRENCY = 2;
async function* walk(dir, budget) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
        if (budget.left <= 0)
            throw new Error('precompress: too many files');
        const path = join(dir, e.name);
        if (e.isSymbolicLink())
            continue;
        if (e.isDirectory())
            yield* walk(path, budget);
        else if (e.isFile()) {
            budget.left--;
            yield path;
        }
    }
}
async function keepOrRemove(path, bytes, original, minSaving) {
    if (bytes.length <= original * (1 - minSaving)) {
        await writeFile(path, bytes);
        return bytes.length;
    }
    await rm(path, { force: true });
    return original;
}
async function compressOne(path, cfg, report) {
    const ext = extname(path).toLowerCase();
    if (!COMPRESSIBLE_EXTENSIONS.has(ext))
        return;
    const info = await lstat(path);
    if (info.size < cfg.minBytes) {
        await rm(`${path}.br`, { force: true });
        await rm(`${path}.gz`, { force: true });
        return;
    }
    const data = await readFile(path);
    const quality = TEXT_EXTENSIONS.has(ext) && data.length <= cfg.maxBestBytes ? constants.BROTLI_MAX_QUALITY : FAST_BROTLI_QUALITY;
    const [br, gzipped] = await Promise.all([
        brotli(data, { params: { [constants.BROTLI_PARAM_QUALITY]: quality, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }),
        gz(data, { level: 9 }),
    ]);
    report.files++;
    report.bytes += data.length;
    report.brotliBytes += await keepOrRemove(`${path}.br`, br, data.length, cfg.minSaving);
    report.gzipBytes += await keepOrRemove(`${path}.gz`, gzipped, data.length, cfg.minSaving);
}
/** Write `.br` / `.gz` siblings for the compressible files under `dir`. */
export async function precompressDir(dir, opts = {}) {
    const cfg = { minBytes: opts.minBytes ?? 1024, minSaving: opts.minSaving ?? 0.1, maxBestBytes: opts.maxBestBytes ?? 4 * 1024 * 1024 };
    const report = { files: 0, bytes: 0, brotliBytes: 0, gzipBytes: 0 };
    const paths = [];
    for await (const path of walk(dir, { left: opts.maxFiles ?? 20_000 }))
        paths.push(path);
    let next = 0;
    const lane = async () => {
        while (next < paths.length)
            await compressOne(paths[next++], cfg, report);
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, lane));
    return report;
}
