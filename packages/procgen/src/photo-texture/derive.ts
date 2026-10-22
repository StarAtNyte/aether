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

/** Reads one surface or piece after another from one photograph (decoded and projected once). */
export function textureReader(photo: Rgba8, d: RoomDescription, opts: { ppm?: number } = {}): {
  /** Derive one target; `box` overrides where the surface appears in the photograph. */
  read(target: TextureTarget, box?: Box): DerivedTexture | SkippedTexture;
} {
  const img = fromRgba8(photo);
  const cam: CameraModel = cameraModel(d.camera, photo.width / photo.height);
  const planes = roomPlanes(d.footprint);
  const occluders = occluderBoxes(d);
  return {
    read(target, box): DerivedTexture | SkippedTexture {
      const skip = (reason: string): SkippedTexture => ({ target, reason });
      try {
        const notes: string[] = [];
        let tile: ReturnType<typeof tileFrom>;
        let coverage: number;
        let sourceMetres: number;
        const cls = surfaceClassOf(target.word);
        if (target.kind === 'piece') {
          const item = target.item;
          const spec = PIECES[item?.kind ?? ''] ?? GENERIC_PIECE;
          const pbox = box ?? item?.box;
          if (!item || !pbox) return skip('it has no box in the photo');
          const bw = pbox[2] - pbox[0];
          const bh = pbox[3] - pbox[1];
          const region = box ? ([0, 0, 1, 1] as const) : spec.region;
          const x0 = Math.floor((pbox[0] + bw * region[0]) * photo.width);
          const y0 = Math.floor((pbox[1] + bh * region[1]) * photo.height);
          const w = Math.floor(bw * (region[2] - region[0]) * photo.width);
          const h = Math.floor(bh * (region[3] - region[1]) * photo.height);
          if (w < 40 || h < 40) return skip('its box is too small in the photo to read a cover from');
          const all = new Uint8Array(img.width * img.height).fill(1);
          // Daylight beyond a window is not the cover: the openings' boxes (grown) are out.
          for (const b of d.openings.flatMap((o) => (o.box ? [o.box] : []))) for (let yy = Math.max(0, Math.floor((b[1] - 0.02) * img.height)); yy < Math.min(img.height, Math.ceil((b[3] + 0.02) * img.height)); yy++) for (let xx = Math.max(0, Math.floor((b[0] - 0.02) * img.width)); xx < Math.min(img.width, Math.ceil((b[2] + 0.02) * img.width)); xx++) all[yy * img.width + xx] = 0;
          const c = crop(img, all, x0, y0, w, h);
          const valid = rejectOutliers(c.image, c.valid, 3);
          const sq = bestSquare(valid, w, h, 40, 0.8);
          if (!sq) return skip('no clean square of its cover is visible (folds, shadows and other objects cover it)');
          sourceMetres = (sq.size * spec.width(item) * (region[2] - region[0])) / w;
          coverage = sq.fill;
          // Folds and creases are the fabric's character: keep a share of the shading in soft covers.
          tile = tileFrom(c.image, valid, sq, sourceMetres, { keepShading: 0.35, quiltBelow: 0.9 });
          notes.push('cover of a piece: photographed straight on (not flattened by the camera), tile size estimated from its width');
        } else {
          const plane = planes[target.id];
          if (!plane) return skip('it is not a surface of the room');
          const region = box ?? textureTargetsBox(d, target.id);
          const rr = rectify(img, cam, plane, { ppm: opts.ppm ?? 160, occluders, pad: 0.03, ...(region ? { region: [Math.max(0, region[0] - 0.02), Math.max(0, region[1] - 0.02), Math.min(1, region[2] + 0.02), Math.min(1, region[3] + 0.02)] as Box } : {}) });
          if (rr.coverage < 0.02) return skip(`only ${(rr.coverage * 100).toFixed(1)} % of it is visible and unobstructed in the photo`);
          const valid = rejectOutliers(rr.image, rr.valid);
          const minSize = Math.max(32, Math.round(rr.ppm * 0.2));
          const sq = bestSquare(valid, rr.image.width, rr.image.height, minSize, 0.88);
          if (!sq) return skip('no clear square of at least 0.2 m of it is visible (furniture, windows and oblique angles cover the rest)');
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
        if (target.kind === 'wall' && cls === surfaceClassOf('paint') && tile.contrast < 0.03) return skip('plain paint: the pixels hold only a colour, so the procedural paint (with its roller mottle) is kept');
        // Soft covers are read at a small scale (weave, wrinkles, print): a clean palm-sized patch is a fair sample of them.
        const soft = target.kind === 'piece';
        const quality: DerivedTexture['quality'] = coverage >= 0.97 && sourceMetres >= (soft ? 0.25 : 0.6) ? 'good' : coverage >= (soft ? 0.8 : 0.88) && sourceMetres >= (soft ? 0.12 : 0.2) ? 'fair' : 'weak';
        if (sourceMetres < (soft ? 0.25 : 0.6)) notes.push(`the clean part is only ${Math.round(sourceMetres * 100)} cm wide, so the tile repeats a small sample`);
        return { target, tile: tile.tile, tileMetres: tile.tileMetres, mean: hexOfMean(tile.mean), cls, coverage, sourceMetres, contrast: tile.contrast, quality, notes };
      } catch (e) {
        return skip(`could not be read (${e instanceof Error ? e.message : 'error'})`);
      }
    },
  };
}

const GENERIC_PIECE = { region: [0.15, 0.2, 0.85, 0.85] as Box, word: 'fabric', width: (): number => 1 };

function textureTargetsBox(d: RoomDescription, id: string): Box | undefined {
  return textureTargets(d).find((t) => t.id === id)?.box;
}

/** Derive the textures of a room from the photograph. Never throws on a bad region: it is skipped with a reason. */
export function deriveTextures(photo: Rgba8, d: RoomDescription, opts: { ppm?: number } = {}): TextureDerivation {
  const out: TextureDerivation = { textures: [], skipped: [] };
  const reader = textureReader(photo, d, opts);
  for (const t of textureTargets(d)) {
    const { box: _box, ...target } = t;
    const r = reader.read(target);
    if ('tile' in r) out.textures.push(r);
    else out.skipped.push(r);
  }
  return out;
}

/**
 * A texture from a flat swatch picture (an AI-generated image, a scan): not a photograph of a room, so nothing is rectified. The
 * large-scale light is taken out, the tile is made seamless when asked and the maps are derived like any other.
 */
export function deriveFromSwatch(img: Rgba8, opts: { word: string; tileMetres: number; tileable: boolean; keepShading?: number }): { tile: FImage; mean: string; contrast: number; cls: SurfaceClass; seam: number } {
  const lin = fromRgba8(img);
  // Crop to the central square (generated pictures are square already; a scan may not be).
  const side = Math.min(lin.width, lin.height);
  const sq = crop(lin, new Uint8Array(lin.width * lin.height).fill(1), Math.floor((lin.width - side) / 2), Math.floor((lin.height - side) / 2), side, side);
  const lit = delight(sq.image, { sigma: Math.max(4, side / 3), keepShading: opts.keepShading ?? 0 });
  // How far the opposite edges differ, against how much neighbouring columns differ: ~1 is already seamless.
  const n = side;
  let edge = 0;
  let inner = 0;
  for (let y = 0; y < n; y++) {
    edge += Math.abs((lit.ratio.data[(y * n) * 3 + 1] as number) - (lit.ratio.data[(y * n + n - 1) * 3 + 1] as number));
    inner += Math.abs((lit.ratio.data[(y * n + (n >> 1)) * 3 + 1] as number) - (lit.ratio.data[(y * n + (n >> 1) + 1) * 3 + 1] as number));
  }
  const seam = edge / Math.max(1e-6, inner);
  const tile = opts.tileable && seam > 1.6 ? seamless(lit.ratio) : lit.ratio;
  return { tile: resize(tile, MASTER_SIZE, MASTER_SIZE, true), mean: hexOfMean(lit.mean), contrast: lit.contrast, cls: surfaceClassOf(opts.word), seam };
}

/** The maps of a derived texture at each tier (edge lengths). */
export function texturePbr(t: DerivedTexture, tiers: readonly number[]): PbrMaps[] {
  return tiers.map((size) => buildMaps(t.tile, { tileMetres: t.tileMetres, cls: t.cls, size }));
}
