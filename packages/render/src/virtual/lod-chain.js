/**
 * Automatic discrete LOD chains for instanced meshes (scatter layers).
 *
 * Each mesh part is simplified with the QEM simplifier to a few target
 * ratios. Faceted (flat-shaded) parts — the style of most built-in
 * generators — are re-flattened after simplification so every LOD keeps
 * crisp per-face normals; smooth parts keep their original vertex
 * attributes. Levels that would not reduce the triangle count meaningfully
 * are dropped, so a chain always gets strictly cheaper.
 */
import { simplifyMesh, weldPositions } from './simplify';
import { normalsAreSoft } from '../geometry/soften';
/** Largest scale a kept card grows by when its neighbours are dropped (so far crowns keep their silhouette without ballooning). */
const CARD_GROW_MAX = 2.8;
/**
 * True when `part` is a foliage card set (the generators' `Sheets`): a `foliage` material, four vertices and
 * twelve indices (both faces, two triangles each) per card, every card indexing its own four vertices.
 */
export function isCardPart(part) {
    const material = part.material;
    if (!material || typeof material.foliage !== 'string')
        return false;
    const verts = part.positions.length / 3;
    if (verts < 8 || verts % 4 !== 0 || part.indices.length !== (verts / 4) * 12)
        return false;
    for (let c = 0; c < verts / 4; c++) {
        for (let k = 0; k < 12; k++) {
            const v = part.indices[c * 12 + k];
            if (v < c * 4 || v > c * 4 + 3)
                return false;
        }
    }
    return true;
}
/**
 * Thin a card set to about `keep` (0..1) of its cards: an even stride picks the survivors (deterministic) and
 * each grows about its centre by 1/sqrt(keep), capped at {@link CARD_GROW_MAX}, so the crown keeps its
 * coverage and silhouette with far fewer, larger cards. Always keeps at least two cards.
 */
export function thinCards(src, keep) {
    const cards = src.positions.length / 12;
    const want = Math.max(2, Math.min(cards, Math.round(cards * (Number.isFinite(keep) ? Math.max(0, Math.min(1, keep)) : 0))));
    const grow = Math.min(CARD_GROW_MAX, 1 / Math.sqrt(want / cards));
    const positions = new Float32Array(want * 12);
    const normals = new Float32Array(want * 12);
    const uvs = src.uvs && src.uvs.length >= cards * 8 ? new Float32Array(want * 8) : undefined;
    const colors = src.colors && src.colors.length >= cards * 12 ? new Float32Array(want * 12) : undefined;
    const indices = new Uint32Array(want * 12);
    for (let k = 0; k < want; k++) {
        const c = Math.min(cards - 1, Math.floor(((k + 0.5) * cards) / want));
        let cx = 0;
        let cy = 0;
        let cz = 0;
        for (let v = 0; v < 4; v++) {
            cx += src.positions[(c * 4 + v) * 3] / 4;
            cy += src.positions[(c * 4 + v) * 3 + 1] / 4;
            cz += src.positions[(c * 4 + v) * 3 + 2] / 4;
        }
        for (let v = 0; v < 4; v++) {
            const s = (c * 4 + v) * 3;
            const d = (k * 4 + v) * 3;
            positions[d] = cx + (src.positions[s] - cx) * grow;
            positions[d + 1] = cy + (src.positions[s + 1] - cy) * grow;
            positions[d + 2] = cz + (src.positions[s + 2] - cz) * grow;
            normals[d] = src.normals[s];
            normals[d + 1] = src.normals[s + 1];
            normals[d + 2] = src.normals[s + 2];
            if (colors) {
                colors[d] = src.colors[s];
                colors[d + 1] = src.colors[s + 1];
                colors[d + 2] = src.colors[s + 2];
            }
            if (uvs) {
                uvs[(k * 4 + v) * 2] = src.uvs[(c * 4 + v) * 2];
                uvs[(k * 4 + v) * 2 + 1] = src.uvs[(c * 4 + v) * 2 + 1];
            }
        }
        for (let i = 0; i < 12; i++)
            indices[k * 12 + i] = src.indices[c * 12 + i] - c * 4 + k * 4;
    }
    return { positions, normals, indices, ...(uvs ? { uvs } : {}), ...(colors ? { colors } : {}) };
}
/** Share of cards kept at a QEM `ratio` (cards lose coverage faster than a solid mesh loses detail, so they keep more). */
export function cardKeepRatio(ratio) {
    return Math.min(1, Math.sqrt(Math.max(0, ratio)) * 0.82);
}
/** Default target triangle ratios after level 0. */
export const LOD_RATIOS = [0.3, 0.1, 0.03];
/** A level must keep at most this share of the previous level's triangles. */
const MIN_STEP = 0.7;
/** Triangles a simplified part keeps at least. */
const MIN_PART_TRIANGLES = 4;
/** True when most vertices are duplicated per face (flat shading). */
export function isFaceted(positions) {
    const n = positions.length / 3;
    if (n < 6)
        return false;
    const weld = weldPositions(positions);
    let unique = 0;
    for (let v = 0; v < n; v++)
        if (weld[v] === v)
            unique++;
    return unique < n * 0.6;
}
/** Copy the vertices referenced by `indices` into compact arrays (smooth parts). */
function compact(src, indices) {
    const n = src.positions.length / 3;
    const map = new Int32Array(n).fill(-1);
    let m = 0;
    for (const v of indices)
        if (map[v] < 0)
            map[v] = m++;
    const positions = new Float32Array(m * 3);
    const normals = new Float32Array(m * 3);
    const uvs = src.uvs && src.uvs.length >= n * 2 ? new Float32Array(m * 2) : undefined;
    const colors = src.colors && src.colors.length >= n * 3 ? new Float32Array(m * 3) : undefined;
    for (let v = 0; v < n; v++) {
        const d = map[v];
        if (d < 0)
            continue;
        for (let k = 0; k < 3; k++) {
            positions[d * 3 + k] = src.positions[v * 3 + k];
            normals[d * 3 + k] = src.normals[v * 3 + k];
            if (colors)
                colors[d * 3 + k] = src.colors[v * 3 + k];
        }
        if (uvs) {
            uvs[d * 2] = src.uvs[v * 2];
            uvs[d * 2 + 1] = src.uvs[v * 2 + 1];
        }
    }
    const out = new Uint32Array(indices.length);
    for (let i = 0; i < indices.length; i++)
        out[i] = map[indices[i]];
    return { positions, normals, indices: out, ...(uvs ? { uvs } : {}), ...(colors ? { colors } : {}) };
}
/**
 * Rebuild a faceted part: three own vertices per triangle and either the face normal (flat shading) or,
 * for parts softened by the renderer (`geometry/soften.ts`), the source's blended vertex normals.
 */
function flatten(src, indices, soft) {
    const t = indices.length / 3;
    const positions = new Float32Array(t * 9);
    const normals = new Float32Array(t * 9);
    const n = src.positions.length / 3;
    const colors = src.colors && src.colors.length >= n * 3 ? new Float32Array(t * 9) : undefined;
    const uvs = src.uvs && src.uvs.length >= n * 2 ? new Float32Array(t * 6) : undefined;
    const p = src.positions;
    for (let f = 0; f < t; f++) {
        const a = indices[f * 3], b = indices[f * 3 + 1], c = indices[f * 3 + 2];
        const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
        const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        const sn = src.normals;
        const corners = [a, b, c];
        for (let k = 0; k < 3; k++) {
            const v = corners[k];
            const o = (f * 3 + k) * 3;
            positions[o] = p[v * 3];
            positions[o + 1] = p[v * 3 + 1];
            positions[o + 2] = p[v * 3 + 2];
            normals[o] = soft ? sn[v * 3] : nx;
            normals[o + 1] = soft ? sn[v * 3 + 1] : ny;
            normals[o + 2] = soft ? sn[v * 3 + 2] : nz;
            if (colors) {
                const cs = src.colors;
                colors[o] = cs[v * 3];
                colors[o + 1] = cs[v * 3 + 1];
                colors[o + 2] = cs[v * 3 + 2];
            }
            if (uvs) {
                const us = src.uvs;
                uvs[(f * 3 + k) * 2] = us[v * 2];
                uvs[(f * 3 + k) * 2 + 1] = us[v * 2 + 1];
            }
        }
    }
    const idx = new Uint32Array(t * 3);
    for (let i = 0; i < idx.length; i++)
        idx[i] = i;
    return { positions, normals, indices: idx, ...(uvs ? { uvs } : {}), ...(colors ? { colors } : {}) };
}
/**
 * Build the LOD chain of a multi-part mesh. Level 0 is the source itself
 * (shared, not copied). Coarser levels simplify every part to the same
 * ratio of its own triangles (at least {@link MIN_PART_TRIANGLES}).
 */
export function buildLodChain(parts, ratios = LOD_RATIOS) {
    const triangles = (ps) => ps.reduce((s, p) => s + Math.floor(p.indices.length / 3), 0);
    const levels = [{ parts: parts.slice(), triangles: triangles(parts) }];
    const cardParts = parts.map((p) => isCardPart(p));
    const faceted = parts.map((p, i) => cardParts[i] !== true && isFaceted(p.positions));
    const soft = parts.map((p, i) => faceted[i] === true && normalsAreSoft(p.positions, p.indices, p.normals));
    for (const ratio of ratios) {
        const prev = levels[levels.length - 1];
        const next = [];
        for (let i = 0; i < parts.length; i++) {
            const src = parts[i];
            const srcTris = Math.floor(src.indices.length / 3);
            if (cardParts[i] === true) {
                next.push(thinCards(src, cardKeepRatio(ratio)));
                continue;
            }
            const target = Math.max(MIN_PART_TRIANGLES, Math.ceil(srcTris * ratio));
            if (target >= srcTris) {
                next.push(prev.parts[i]);
                continue;
            }
            const res = simplifyMesh(src.positions, src.indices, { targetIndexCount: target * 3, lockBorder: false });
            next.push(faceted[i] ? flatten(src, res.indices, soft[i] === true) : compact(src, res.indices));
        }
        const tris = triangles(next);
        if (tris > prev.triangles * MIN_STEP)
            continue;
        levels.push({ parts: next, triangles: tris });
    }
    return levels;
}
