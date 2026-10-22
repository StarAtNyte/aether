/**
 * Photo-derived textures of a room: for each large surface of the description (floor, walls) and each large soft piece (bed linen,
 * curtains, sofa, armchair) the part of the photograph that shows it becomes a seamless, de-lit tile with its maps.
 *
 * Surfaces are measured, not guessed: every texel of the floor or wall is projected through the solved camera into the photograph
 * (`rectify`), so a floor seen at a slant is drawn flat and in metres. Pieces are not planes; their box in the photograph is cropped
 * and the real size of the tile is estimated from the piece's known width.
 *
 * The result of a surface that cannot be read (a bare patch too small, occluded everywhere, flat paint with nothing to sample) is
 * "no texture" with the reason; the caller keeps the procedural finish. Pure and deterministic.
 */
import type { PhotoItem, RoomDescription } from '@aether/arch/photo';
import { cameraModel, roomPlanes, type CameraModel } from './project';
import { rectify, type Box } from './rectify';
import { bestSquare, crop, fillHoles, rejectOutliers } from './fill';
import { delight } from './delight';
import { quilt, seamless } from './tile';
import { buildMaps, surfaceClassOf, type PbrMaps, type SurfaceClass } from './maps';
import { fromRgba8, linearToHex, resize, type FImage, type Rgba8 } from './raster';

/** Edge of the master tile all tiers are built from. */
export const MASTER_SIZE = 512;

/** What a texture is for. */
export interface TextureTarget {
  /** `floor`, `wall-north` …, or the id of the piece. */
  id: string;
  kind: 'floor' | 'wall' | 'piece';
  label: string;
  /** The words the description gives the surface (finish, material), deciding the surface class. */
  word: string;
  /** Pieces: the piece. */
  item?: PhotoItem;
}

/** One derived texture (master tile and what is known about it). */
export interface DerivedTexture {
  target: TextureTarget;
  /** Seamless ratios around 1 (`MASTER_SIZE` square). */
  tile: FImage;
  /** Real-world edge of the tile (m). */
  tileMetres: number;
  /** The colour the surface showed in the photograph (sRGB hex). */
  mean: string;
  cls: SurfaceClass;
  /** Share of the chosen square that showed the surface itself before holes were filled. */
  coverage: number;
  /** Real-world edge of the clean square (m). */
  sourceMetres: number;
  /** Relative spread of the pattern (0 = flat). */
  contrast: number;
  quality: 'good' | 'fair' | 'weak';
  notes: string[];
}

/** A surface that gave no texture, and why. */
export interface SkippedTexture {
  target: TextureTarget;
  reason: string;
}

/** Result of {@link deriveTextures}. */
export interface TextureDerivation {
  textures: DerivedTexture[];
  skipped: SkippedTexture[];
}

/** Soft pieces worth sampling: the part of the piece's box that shows its cover, and its real width (m). */
const PIECES: Readonly<Record<string, { region: Box; word: string; width: (it: PhotoItem) => number }>> = Object.freeze({
  bed: { region: [0.1, 0.5, 0.9, 0.95], word: 'duvet fabric', width: (it) => ({ single: 0.9, double: 1.4, queen: 1.6, king: 1.8 }[String(it.params['size'])] ?? 1.5) },
  sofa: { region: [0.12, 0.3, 0.88, 0.85], word: 'sofa upholstery fabric', width: () => 2 },
  armchair: { region: [0.2, 0.3, 0.8, 0.85], word: 'armchair upholstery fabric', width: () => 0.85 },
  curtain: { region: [0.08, 0.12, 0.92, 0.9], word: 'curtain fabric', width: () => 1.1 },
});

/** The kinds of pieces {@link deriveTextures} samples. */
export const TEXTURE_PIECE_KINDS: readonly string[] = Object.keys(PIECES);

const wallCompasses = ['north', 'east', 'south', 'west'] as const;

/** The targets a description offers: its visible walls, the floor, and the soft pieces with a box. */
export function textureTargets(d: RoomDescription): Array<TextureTarget & { box?: Box }> {
  const out: Array<TextureTarget & { box?: Box }> = [];
  out.push({ id: 'floor', kind: 'floor', label: 'the floor', word: `${d.floor.finish ?? ''} ${d.floor.material ?? ''}`.trim() || 'floor', ...(d.floor.box ? { box: d.floor.box } : {}) });
  for (const c of wallCompasses) {
    const w = d.walls[c];
    if (w && w.visible !== false) out.push({ id: `wall-${c}`, kind: 'wall', label: `the ${c} wall`, word: `${w.finish ?? ''} ${w.material ?? ''}`.trim() || 'paint', ...(w.box ? { box: w.box } : {}) });
  }
  for (const it of d.items) {
    const p = PIECES[it.kind];
    if (p && it.box && it.visible !== false) out.push({ id: it.id, kind: 'piece', label: it.label || it.kind, word: p.word, item: it, box: it.box });
  }
  return out;
}

/** The pixel boxes of everything that stands in front of the room's surfaces. */
function occluderBoxes(d: RoomDescription): Box[] {
  const out: Box[] = [];
  for (const it of d.items) if (it.box && it.visible !== false) out.push(it.box);
  for (const o of d.openings) if (o.box && o.visible !== false) out.push(o.box);
  return out;
}

const hexOfMean = (m: readonly [number, number, number]): string => linearToHex(m);

/**
 * One tile from a clean-ish square: fill, de-light, quilt larger when the square is small, seamless, resample to the master size.
 * `sourceMetres` is the real edge of the square.
 */
function tileFrom(
  img: FImage,
  valid: Uint8Array,
  sq: { x: number; y: number; size: number; fill: number },
  sourceMetres: number,
  opts: { keepShading: number; quiltBelow: number },
): { tile: FImage; tileMetres: number; mean: [number, number, number]; contrast: number } {
  const { image, valid: v } = crop(img, valid, sq.x, sq.y, sq.size, sq.size);
  const filled = fillHoles(image, v);
  const lit = delight(filled, { sigma: Math.max(4, sq.size / 3), keepShading: opts.keepShading });
  let tile = lit.ratio;
  let metres = sourceMetres;
  if (sourceMetres < opts.quiltBelow && sq.size >= 40) {
    tile = quilt(tile, Math.min(MASTER_SIZE, sq.size * 2));
    metres = sourceMetres * (tile.width / sq.size);
  }
  tile = seamless(tile);
  return { tile: resize(tile, MASTER_SIZE, MASTER_SIZE, true), tileMetres: Math.round(metres * 100) / 100, mean: lit.mean, contrast: lit.contrast };
}

/** Derive the textures of a room from the photograph. Never throws on a bad region: it is skipped with a reason. */
export function deriveTextures(photo: Rgba8, d: RoomDescription, opts: { ppm?: number } = {}): TextureDerivation {
  const out: TextureDerivation = { textures: [], skipped: [] };
  const img = fromRgba8(photo);
  const cam: CameraModel = cameraModel(d.camera, photo.width / photo.height);
  const planes = roomPlanes(d.footprint);
  const occluders = occluderBoxes(d);
  for (const t of textureTargets(d)) {
    const { box, ...target } = t;
    try {
      const notes: string[] = [];
      let tile: ReturnType<typeof tileFrom>;
      let coverage: number;
      let sourceMetres: number;
      let cls = surfaceClassOf(target.word);
      if (target.kind === 'piece') {
        const spec = PIECES[target.item?.kind ?? ''];
        if (!spec || !box || !target.item) continue;
        const bw = box[2] - box[0];
        const bh = box[3] - box[1];
        const x0 = Math.floor((box[0] + bw * spec.region[0]) * photo.width);
        const y0 = Math.floor((box[1] + bh * spec.region[1]) * photo.height);
        const w = Math.floor(bw * (spec.region[2] - spec.region[0]) * photo.width);
        const h = Math.floor(bh * (spec.region[3] - spec.region[1]) * photo.height);
        if (w < 40 || h < 40) {
          out.skipped.push({ target, reason: 'its box is too small in the photo to read a cover from' });
          continue;
        }
        const open = d.openings.flatMap((o) => (o.box ? [o.box] : []));
        const all = new Uint8Array(img.width * img.height).fill(1);
        // Daylight beyond a window is not the cover: the openings' boxes (grown) are out.
        for (const b of open) for (let yy = Math.max(0, Math.floor((b[1] - 0.02) * img.height)); yy < Math.min(img.height, Math.ceil((b[3] + 0.02) * img.height)); yy++) for (let xx = Math.max(0, Math.floor((b[0] - 0.02) * img.width)); xx < Math.min(img.width, Math.ceil((b[2] + 0.02) * img.width)); xx++) all[yy * img.width + xx] = 0;
        const c = crop(img, all, x0, y0, w, h);
        const valid = rejectOutliers(c.image, c.valid, 3);
        const sq = bestSquare(valid, w, h, 40, 0.8);
        if (!sq) {
          out.skipped.push({ target, reason: 'no clean square of its cover is visible (folds, shadows and other objects cover it)' });
          continue;
        }
        const metresPerPx = (spec.width(target.item) * (spec.region[2] - spec.region[0])) / w;
        sourceMetres = sq.size * metresPerPx;
        coverage = sq.fill;
        // Folds and creases are the fabric's character: keep a share of the shading in soft covers.
        tile = tileFrom(c.image, valid, sq, sourceMetres, { keepShading: 0.35, quiltBelow: 0.9 });
        notes.push('cover of a piece: photographed straight on (not flattened by the camera), tile size estimated from its width');
      } else {
        const plane = planes[target.id];
        if (!plane) continue;
        const rr = rectify(img, cam, plane, { ppm: opts.ppm ?? 160, occluders, pad: 0.03, ...(box ? { region: [Math.max(0, box[0] - 0.02), Math.max(0, box[1] - 0.02), Math.min(1, box[2] + 0.02), Math.min(1, box[3] + 0.02)] as Box } : {}) });
        if (rr.coverage < 0.02) {
          out.skipped.push({ target, reason: `only ${(rr.coverage * 100).toFixed(1)} % of it is visible and unobstructed in the photo` });
          continue;
        }
        const valid = rejectOutliers(rr.image, rr.valid);
        const minSize = Math.max(40, Math.round(rr.ppm * 0.28));
        const sq = bestSquare(valid, rr.image.width, rr.image.height, minSize, 0.9);
        if (!sq) {
          out.skipped.push({ target, reason: 'no clear square of at least 0.3 m of it is visible (furniture, windows and oblique angles cover the rest)' });
          continue;
        }
        sourceMetres = sq.size / rr.ppm;
        coverage = sq.fill;
        tile = tileFrom(rr.image, valid, sq, sourceMetres, { keepShading: 0, quiltBelow: 1.1 });
        if (target.kind === 'wall') {
          // A wall tile's rows run from the top down; the shader's v runs up.
          const flipped = new Float32Array(tile.tile.data.length);
          const s = MASTER_SIZE * 3;
          for (let y = 0; y < MASTER_SIZE; y++) flipped.set(tile.tile.data.subarray(y * s, (y + 1) * s), (MASTER_SIZE - 1 - y) * s);
          tile.tile.data.set(flipped);
        }
        notes.push(`${(rr.coverage * 100).toFixed(0)} % of the ${target.kind} is visible; rectified through the solved camera`);
      }
      if (target.kind === 'wall' && cls === surfaceClassOf('paint') && tile.contrast < 0.03) {
        out.skipped.push({ target, reason: 'plain paint: the pixels hold only a colour, so the procedural paint (with its roller mottle) is kept' });
        continue;
      }
      const quality: DerivedTexture['quality'] = coverage >= 0.97 && sourceMetres >= 0.6 ? 'good' : coverage >= 0.9 && sourceMetres >= 0.3 ? 'fair' : 'weak';
      if (sourceMetres < 0.6) notes.push(`the clean part is only ${Math.round(sourceMetres * 100)} cm wide, so the tile repeats a small sample`);
      out.textures.push({ target, tile: tile.tile, tileMetres: tile.tileMetres, mean: hexOfMean(tile.mean), cls, coverage, sourceMetres, contrast: tile.contrast, quality, notes });
    } catch (e) {
      out.skipped.push({ target, reason: `could not be read (${e instanceof Error ? e.message : 'error'})` });
    }
  }
  return out;
}

/** The maps of a derived texture at each tier (edge lengths). */
export function texturePbr(t: DerivedTexture, tiers: readonly number[]): PbrMaps[] {
  return tiers.map((size) => buildMaps(t.tile, { tileMetres: t.tileMetres, cls: t.cls, size }));
}
