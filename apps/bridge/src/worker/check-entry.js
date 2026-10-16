/**
 * The checker a coding agent runs in its workspace: `node check.mjs
 * out/generator.json`. Bundled into one self-contained file (see
 * `bundle.ts`), so it needs nothing but Node.
 *
 * It validates the generator the same way Aether does before a model-written
 * generator may enter a world (schema, static source screen, sandboxed runs
 * with three seeds, output validation, silhouette sanity) and renders a
 * shaded 2×2 preview (front, side, top, three-quarter) to
 * `out/preview.png` for the agent to look at. Prints a report; exit code 0
 * only when everything passes.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { deflateSync } from 'node:zlib';
import { GeneratorDef } from '@aether/core';
import { checkSilhouette, resolveParams, staticCheckSource, validateOutput } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';
const PREVIEW = 'out/preview.png';
const SIZE = 256;
const SEEDS = [1, 7, 42];
/** Display colours of material presets (approximate, for the preview only). */
const PRESET = {
    plastic: [0.85, 0.85, 0.85], wood: [0.54, 0.35, 0.2], stone: [0.55, 0.54, 0.52], brick: [0.61, 0.29, 0.21], concrete: [0.65, 0.64, 0.61],
    metal: [0.72, 0.74, 0.78], gold: [0.92, 0.72, 0.25], glass: [0.8, 0.9, 0.95], water: [0.2, 0.45, 0.7], ice: [0.8, 0.92, 0.98],
    grass: [0.38, 0.6, 0.25], dirt: [0.45, 0.33, 0.22], sand: [0.85, 0.77, 0.56], snow: [0.95, 0.96, 0.98], lava: [1, 0.35, 0.1],
    neon: [1, 0.2, 0.7], rubber: [0.15, 0.15, 0.16], fabric: [0.6, 0.3, 0.3], leaf: [0.25, 0.5, 0.2], bark: [0.36, 0.25, 0.17],
    crystal: [0.6, 0.85, 1], emissive: [1, 1, 0.9],
};
function hexColor(hex) {
    if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex))
        return null;
    return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}
// -- PNG ----------------------------------------------------------------------
const CRC = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++)
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++)
        c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    Buffer.from(data).copy(out, 8);
    out.writeUInt32BE(crc32(new Uint8Array(out.subarray(4, 8 + data.length))), 8 + data.length);
    return out;
}
/** Encode RGB pixels as a PNG. */
export function encodePng(width, height, rgb) {
    const raw = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (width * 3 + 1)] = 0;
        Buffer.from(rgb.subarray(y * width * 3, (y + 1) * width * 3)).copy(raw, y * (width * 3 + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
}
/** Render one orthographic, lambert-shaded view into a tile of `img` (RGB, `stride` pixels wide). */
function renderView(out, view, img, stride, ox, oy, size) {
    const zbuf = new Float32Array(size * size).fill(-Infinity);
    const b = out.bounds;
    const corners = [];
    for (const x of [b.min[0], b.max[0]])
        for (const y of [b.min[1], b.max[1]])
            for (const z of [b.min[2], b.max[2]])
                corners.push(view(x, y, z));
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const c of corners) {
        minU = Math.min(minU, c[0]);
        maxU = Math.max(maxU, c[0]);
        minV = Math.min(minV, c[1]);
        maxV = Math.max(maxV, c[1]);
    }
    const extent = Math.max(maxU - minU, maxV - minV, 1e-6) * 1.1;
    const cu = (minU + maxU) / 2;
    const cv = (minV + maxV) / 2;
    const px = (u) => ((u - cu) / extent + 0.5) * size;
    const py = (v) => (0.5 - (v - cv) / extent) * size;
    const light = [0.45, 0.8, 0.4];
    for (const part of out.parts) {
        const base = hexColor(part.material.color) ?? PRESET[part.material.preset ?? ''] ?? [0.8, 0.8, 0.8];
        const p = part.positions;
        const idx = part.indices;
        for (let t = 0; t + 2 < idx.length; t += 3) {
            const a = idx[t] * 3;
            const bb = idx[t + 1] * 3;
            const c = idx[t + 2] * 3;
            const A = view(p[a], p[a + 1], p[a + 2]);
            const B = view(p[bb], p[bb + 1], p[bb + 2]);
            const C = view(p[c], p[c + 1], p[c + 2]);
            // World-space normal for shading.
            const ux = p[bb] - p[a], uy = p[bb + 1] - p[a + 1], uz = p[bb + 2] - p[a + 2];
            const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
            let nx = uy * vz - uz * vy;
            let ny = uz * vx - ux * vz;
            let nz = ux * vy - uy * vx;
            const nl = Math.hypot(nx, ny, nz) || 1;
            nx /= nl;
            ny /= nl;
            nz /= nl;
            const shade = 0.35 + 0.65 * Math.abs(nx * light[0] + ny * light[1] + nz * light[2]);
            const x0 = px(A[0]), y0 = py(A[1]), x1 = px(B[0]), y1 = py(B[1]), x2 = px(C[0]), y2 = py(C[1]);
            const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
            const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1, x2)));
            const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
            const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1, y2)));
            const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
            if (Math.abs(area) < 1e-9)
                continue;
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    const sx = x + 0.5;
                    const sy = y + 0.5;
                    const w0 = ((x1 - sx) * (y2 - sy) - (x2 - sx) * (y1 - sy)) / area;
                    const w1 = ((x2 - sx) * (y0 - sy) - (x0 - sx) * (y2 - sy)) / area;
                    const w2 = 1 - w0 - w1;
                    if (w0 < 0 || w1 < 0 || w2 < 0)
                        continue;
                    const depth = w0 * A[2] + w1 * B[2] + w2 * C[2];
                    const zi = y * size + x;
                    if (depth <= zbuf[zi])
                        continue;
                    zbuf[zi] = depth;
                    const o = ((oy + y) * stride + ox + x) * 3;
                    img[o] = Math.min(255, Math.round(base[0] * shade * 255));
                    img[o + 1] = Math.min(255, Math.round(base[1] * shade * 255));
                    img[o + 2] = Math.min(255, Math.round(base[2] * shade * 255));
                }
            }
        }
    }
}
/** A 2×2 preview: front, side, top, three-quarter. */
export function previewPng(out) {
    const W = SIZE * 2;
    const img = new Uint8Array(W * W * 3).fill(236);
    const iso = (x, y, z) => {
        const a = Math.PI / 4;
        const rx = x * Math.cos(a) - z * Math.sin(a);
        const rz = x * Math.sin(a) + z * Math.cos(a);
        const e = Math.PI / 6;
        return [rx, y * Math.cos(e) + rz * Math.sin(e), rz * Math.cos(e) - y * Math.sin(e)];
    };
    renderView(out, (x, y, z) => [x, y, z], img, W, 0, 0, SIZE);
    renderView(out, (x, y, z) => [-z, y, x], img, W, SIZE, 0, SIZE);
    renderView(out, (x, y, z) => [x, -z, y], img, W, 0, SIZE, SIZE);
    renderView(out, iso, img, W, SIZE, SIZE, SIZE);
    return encodePng(W, W, img);
}
// -- Report -----------------------------------------------------------------
/** Check a generator file; returns the report lines and whether it passed. */
export async function checkGeneratorFile(path) {
    const lines = [];
    const issues = [];
    let text;
    try {
        text = readFileSync(path, 'utf8');
    }
    catch {
        return { passed: false, lines: ['RESULT: FAIL', `- issue: cannot read ${path}`] };
    }
    if (text.length > 120 * 1024)
        return { passed: false, lines: ['RESULT: FAIL', '- issue: the file is larger than 120 KB'] };
    let json;
    try {
        json = JSON.parse(text);
    }
    catch (e) {
        return { passed: false, lines: ['RESULT: FAIL', `- issue: not valid JSON (${e instanceof Error ? e.message.slice(0, 120) : 'parse error'})`] };
    }
    const def = GeneratorDef.safeParse(json);
    if (!def.success) {
        const i = def.error.issues[0];
        return { passed: false, lines: ['RESULT: FAIL', `- issue: invalid generator definition at ${i?.path.join('.') || '(root)'}: ${i?.message ?? 'invalid'}`] };
    }
    const screen = staticCheckSource(def.data.source);
    if (!screen.ok)
        return { passed: false, lines: ['RESULT: FAIL', ...screen.problems.slice(0, 6).map((p) => `- issue: source rejected: ${p}`)] };
    const sandbox = createNodeSandbox({ timeoutMs: 4000 });
    let first = null;
    let valid = false;
    try {
        for (const seed of SEEDS) {
            const raw = await sandbox.run(def.data, resolveParams(def.data.params, {}), seed);
            const v = validateOutput(raw);
            if (!v.ok) {
                issues.push(`seed ${seed}: ${v.error}`);
                break;
            }
            first ??= v.output;
        }
        valid = first !== null && issues.length === 0;
    }
    catch (e) {
        issues.push(`the generator threw: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
    }
    finally {
        sandbox.dispose();
    }
    if (first) {
        const b = first.bounds;
        const w = b.max[0] - b.min[0];
        const h = b.max[1] - b.min[1];
        const d = b.max[2] - b.min[2];
        const verts = first.parts.reduce((n, p) => n + p.positions.length / 3, 0);
        lines.push(`size: ${w.toFixed(2)} × ${h.toFixed(2)} × ${d.toFixed(2)} m (width × height × depth)`);
        lines.push(`geometry: ${first.stats.triangles} triangles, ${verts} vertices, ${first.parts.length} parts, ${first.colliders.length} colliders`);
        lines.push(`materials: ${first.parts.map((p) => p.material.preset ?? p.material.color ?? 'default').slice(0, 12).join(', ')}`);
        if (Math.abs(b.min[1]) > 0.05)
            issues.push(`the base is at y=${b.min[1].toFixed(2)}; objects must stand on y = 0 (api.build() places them; do not offset)`);
        if (first.stats.triangles < 40)
            issues.push('very little geometry (under 40 triangles): add detail');
        if (first.stats.triangles > 150_000)
            issues.push('too heavy (over 150k triangles): simplify');
        if (Math.max(w, h, d) > 400)
            issues.push('larger than 400 m: check the units (metres)');
        if (Math.max(w, h, d) < 0.05)
            issues.push('smaller than 5 cm: check the units (metres)');
        const sil = checkSilhouette(first);
        if (!sil.ok)
            issues.push(`silhouette: ${sil.error}`);
        else
            lines.push(`silhouette: front coverage ${(sil.front.coverage * 100).toFixed(0)}%, top coverage ${(sil.top.coverage * 100).toFixed(0)}%, outline complexity ${sil.front.complexity.toFixed(2)}`);
        try {
            writeFileSync(PREVIEW, previewPng(first));
            lines.push(`preview: ${PREVIEW} (front, side / top, three-quarter) — open it and check proportions, detail and colours`);
        }
        catch {
            lines.push('preview: could not be written');
        }
    }
    const passed = issues.length === 0 && first !== null;
    // VALID: the definition is usable at all (schema, source screen, sandboxed runs, output validation),
    // independent of the quality heuristics above. The host re-validates with this line.
    return { passed, lines: [passed ? 'RESULT: PASS' : 'RESULT: FAIL', `VALID: ${valid ? 'yes' : 'no'}`, ...issues.map((i) => `- issue: ${i}`), ...lines] };
}
/**
 * Re-run this script confined by the Node permission model (read the
 * workspace, write only `out/`, no processes or workers) unless it already
 * is: the generator code it executes is untrusted. Returns the exit code, or
 * null when this process is the confined one.
 */
function confineSelf() {
    if (process.permission !== undefined && process.execArgv.some((a) => /^--(experimental-)?permission$/.test(a)))
        return null;
    const script = process.argv[1] ?? '';
    const root = dirname(resolvePath(script));
    const [major = 0, minor = 0] = process.versions.node.split('.').map((n) => Number(n));
    const flag = major > 22 || (major === 22 && minor >= 13) ? '--permission' : '--experimental-permission';
    const r = spawnSync(process.execPath, [flag, `--allow-fs-read=${root}`, `--allow-fs-read=${process.cwd()}`, `--allow-fs-write=${join(process.cwd(), 'out')}`, script, ...process.argv.slice(2)], { stdio: 'inherit', env: { PATH: process.env['PATH'] ?? '' }, timeout: 90_000 });
    return typeof r.status === 'number' ? r.status : 1;
}
/** CLI entry. */
async function main() {
    const confined = confineSelf();
    if (confined !== null) {
        process.exitCode = confined;
        return;
    }
    const file = process.argv[2];
    if (!file) {
        process.stdout.write('usage: node check.mjs out/generator.json\n');
        process.exitCode = 2;
        return;
    }
    const r = await checkGeneratorFile(file);
    process.stdout.write(`${r.lines.join('\n')}\n`);
    process.exitCode = r.passed ? 0 : 1;
}
// Run when executed directly (the bundle), not when imported by tests.
if (process.argv[1] && /check(\.mjs|-entry\.ts)$/.test(process.argv[1]))
    void main();
