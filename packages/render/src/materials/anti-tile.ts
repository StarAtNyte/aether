/**
 * Anti-tiling for textured finishes: a photographed texture repeating every 1.5–3 m on a floor, wall
 * or lawn shows as a visible grid of identical stains. Every texture lookup is therefore taken twice,
 * from the texture's own tiling and from a rotated, rescaled and offset copy of it, and the two are
 * blended by smooth low-frequency noise of the world position — the repeat never lines up, so no tile
 * edge or stain recurs. Albedo, roughness, ambient occlusion and the normal map are blended with the
 * same weight, so they stay consistent with each other.
 *
 * Pure node (TSL) code: identical on the WebGPU and WebGL2 backends. The nodes are attached to the
 * classic material as `colorNode` / `roughnessNode` / `aoNode` / `normalNode`, which the node renderer
 * copies when it converts the material (like the foliage wind, see `wind.ts`). The texture's `repeat`
 * stays a live uniform, so retiling a finish to its photo's real size later recompiles nothing.
 */
import { staticShadowAlpha } from '../gpu/shadow-alpha';
import { Fn, If, attribute, cameraPosition, clamp, dot, float, fract, materialColor, materialRoughness, mix, modelWorldMatrix, normalMap, normalView, normalWorld, positionWorld, sin, smoothstep, texture, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl';
import { PIECE_ORIGIN, PIECE_TONE_KEY } from '../sync/merge-geometries';
import type { Material, Texture } from 'three';
import type { Node } from 'three/webgpu';
import { noise01 } from './noise-texture';

/** The second lookup's rotation (radians), scale and offset in tile units. */
export const ANTI_TILE = Object.freeze({ rotation: 0.6435, scale: 0.77, offset: [0.31, 0.17] as readonly [number, number] });
/** Noise values between which the second lookup takes over: a seam about a metre wide. */
export const SEAM: readonly [number, number] = Object.freeze([0.47, 0.53]) as readonly [number, number];
/** World-space size (metres) of the blend noise: patches several metres wide, so single tiles never read as repeats. */
export const BLEND_NOISE_SCALE = 0.07;

/** The three maps of a finish (albedo ratio, occlusion/roughness, normal). */
export interface AntiTileMaps {
  map: Texture;
  orm: Texture;
  normal: Texture;
}

/**
 * Finishes with an isotropic, noise-like structure (ground, concrete, plaster, rock, bark): a second
 * lookup breaks their repeat without trace. Patterned finishes (planks, brick, tiles, paving, veined
 * marble) are left out: their pattern *is* the repeat, and two shifted copies of it only ghost.
 */
export const ANTI_TILE_FINISHES: ReadonlySet<string> = new Set(['concrete', 'plaster', 'terrazzo', 'grass', 'gravel', 'soil', 'sand', 'snow', 'rock', 'bark', 'asphalt', 'carpet', 'dry-earth']);

/**
 * Patterned ground and masonry finishes that still get the distance and weather treatment (macro variation, near and far
 * detail, puddles) but keep a single lookup: a second, rotated copy of cobbles or ashlar would only ghost.
 */
export const GROUND_PATTERN_FINISHES: ReadonlySet<string> = new Set(['stone', 'cobble', 'limestone']);

/** Whether `finish` (whose tile is `tileMetres` wide) benefits from anti-tiling (small tiles repeat too finely to show). */
export function needsAntiTile(finish: string, tileMetres: number): boolean {
  return (ANTI_TILE_FINISHES.has(finish) || GROUND_PATTERN_FINISHES.has(finish)) && Number.isFinite(tileMetres) && tileMetres >= 0.9;
}

/**
 * Normal-map strength per finish: the photographs of plaster and concrete carry a faint relief that reads as flat paint on
 * a wall, so their maps are pushed harder; everything else uses 1 (0 without a bump in the finish definition).
 */
export const NORMAL_STRENGTH: Readonly<Record<string, number>> = Object.freeze({ plaster: 2.4, concrete: 1.7, terrazzo: 1.3, limestone: 1.6, cobble: 1.4, 'dry-earth': 1.3, rock: 1.5, stone: 1.4 });

/** Share of a surface that stands in puddles when the weather is dry, and the extra share rain adds, per finish (0 = never wet). */
export const WETNESS: Readonly<Record<string, { base: number; rain: number }>> = Object.freeze({
  asphalt: { base: 0, rain: 0.62 },
  concrete: { base: 0, rain: 0.42 },
  stone: { base: 0, rain: 0.4 },
  cobble: { base: 0, rain: 0.5 },
  limestone: { base: 0, rain: 0.25 },
  gravel: { base: 0, rain: 0.25 },
  soil: { base: 0, rain: 0.3 },
  'dry-earth': { base: 0, rain: 0.3 },
  terrazzo: { base: 0, rain: 0.3 },
});

/**
 * Wet weather (0 dry .. 1 rain) shared by every ground material: darkens and glosses surfaces and fills puddles in
 * those that have a {@link WETNESS} entry. A uniform, so a change of weather recompiles nothing.
 */
export const groundWeather = uniform(0);
/**
 * Lean shading (0 off, 1 on) for every anti-tiled finish: one lookup per map, no repeat-hiding second lookup and no micro or
 * macro detail. Set while the view moves on integrated GPUs; a uniform, so flipping it recompiles nothing.
 */
export const leanShading = uniform(0);
/** Distances (m) over which the close-up micro detail fades out and the far macro detail fades in. */
export const DETAIL_NEAR: readonly [number, number] = Object.freeze([1.5, 7]) as readonly [number, number];
export const DETAIL_FAR: readonly [number, number] = Object.freeze([10, 60]) as readonly [number, number];
/** Texture-repeat factors of the micro (finer) and macro (coarser) detail lookups. */
export const DETAIL_MICRO_SCALE = 5.3;
export const DETAIL_MACRO_SCALE = 0.113;
/**
 * Mid-range breakup of the isotropic ground finishes: a photographed lawn or soil averages out to one flat tone once its
 * texels shrink below a pixel (mip levels keep the mean, not the variance), so a plane seen from 8 to 80 m reads as a
 * carpet. Two lookups of the shared noise (lattice frequencies in 1/m: clumps about 0.6 m wide, grain about 18 cm) put
 * the lost variance back, fading in between these distances (m) and with the amplitudes below (relative to 1).
 */
/** Natural ground finishes that take the mid-range breakup (walls and floors indoors keep their own texture). */
export const MID_DETAIL_FINISHES: ReadonlySet<string> = new Set(['grass', 'gravel', 'soil', 'sand', 'snow', 'rock', 'dry-earth']);
export const DETAIL_MID_SCALES: readonly [number, number] = Object.freeze([1.7, 5.5]) as readonly [number, number];
export const DETAIL_MID: readonly [number, number] = Object.freeze([2.5, 9]) as readonly [number, number];
export const DETAIL_MID_AMOUNT: readonly [number, number] = Object.freeze([0.5, 0.22]) as readonly [number, number];

/** Share of the occlusion map multiplied into the albedo (crevices dark in direct light too). */
export const CAVITY = 0.6;
/** Spread of the per-piece tone (each separate object a little lighter or darker, warmer or cooler): ±7 %. */
export const PIECE_TONE = 0.14;
/**
 * Hue drift of the natural ground finishes: multipliers toward a sun-dried and toward a lush, darker look, and how far the
 * patches go toward them. Applied over the brightness patches (see applyAntiTile).
 */
export const GROUND_HUE: Readonly<Record<string, { dry: readonly [number, number, number]; lush: readonly [number, number, number]; amount: number }>> = Object.freeze({
  grass: { dry: [1.3, 1.08, 0.55], lush: [0.72, 0.88, 0.78], amount: 0.9 },
  soil: { dry: [1.12, 1.04, 0.9], lush: [0.82, 0.8, 0.78], amount: 0.4 },
  'dry-earth': { dry: [1.1, 1.04, 0.92], lush: [0.86, 0.82, 0.78], amount: 0.4 },
  gravel: { dry: [1.06, 1.03, 0.96], lush: [0.9, 0.9, 0.88], amount: 0.35 },
  rock: { dry: [1.06, 1.02, 0.94], lush: [0.88, 0.9, 0.92], amount: 0.4 },
});

/** Options of {@link applyAntiTile}. */
export interface AntiTileOptions {
  /** The finish's id (selects its puddle share, see {@link WETNESS}). */
  finish?: string;
  /** Take every lookup twice at different scales/rotations (isotropic finishes); false for patterned ones. */
  stochastic?: boolean;
  /** Add the close-up micro and distance macro lookups (costs about six extra texture reads; off on weak GPUs). */
  detail?: boolean;
}

/** `userData` key holding the {@link AntiTileMaps} of a material whose maps are sampled by nodes. */
export const FINISH_MAPS_KEY = 'aetherFinishMaps';

/** Marks a finish material whose maps are sampled by nodes (see {@link applyAntiTile}): its colour factors still carry the finish scale. */
export const FINISH_NODES_KEY = 'aetherFinish';

/**
 * Program cache key of an anti-tiled material: the textures its nodes sample (by id) and every option that shapes the node
 * graph. Materials that differ only in colour, roughness or metalness factors share a key, so they share one program.
 */
export function antiTileProgramKey(maps: AntiTileMaps, normalStrength: number, opts: AntiTileOptions = {}): string {
  return `antitile:${opts.finish ?? ''}:${opts.stochastic !== false ? 's' : 'p'}${opts.detail === true ? 'd' : ''}:${normalStrength > 0 ? 'n' : '-'}:${maps.map.id},${maps.orm.id},${maps.normal.id}`;
}

/**
 * Attach the anti-tiled nodes of `maps` to `material` (a classic material the node renderer converts).
 * `normalStrength` is the normal map's scale (0 skips the normal blend). The material must not bind
 * the maps itself (`map`, `roughnessMap`, `aoMap`, `normalMap`): the nodes replace them.
 */
/**
 * World origin of the piece being shaded: its object's, or, in merged geometry, the copy the merge wrote per vertex
 * ({@link PIECE_ORIGIN}: the same float32 translation, so the same tone), passed flat so every pixel of a piece hashes alike.
 */
function pieceOrigin(): Nd3 {
  return Fn((builder: { geometry?: { hasAttribute(name: string): boolean } | null }) =>
    builder.geometry?.hasAttribute(PIECE_ORIGIN) === true
      ? varying(attribute(PIECE_ORIGIN, 'vec3')).setInterpolation('flat')
      : modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz)() as unknown as Nd3;
}
type Nd3 = ReturnType<typeof vec3>;

export function applyAntiTile(material: Material, maps: AntiTileMaps, normalStrength: number, opts: AntiTileOptions = {}): void {
  // Merged pieces keep their own tone (see `pieceOrigin`).
  material.userData[PIECE_TONE_KEY] = true;
  const stochastic = opts.stochastic !== false;
  const detail = opts.detail === true;
  const repeat = uniform(maps.map.repeat);
  const base = uv().mul(repeat);
  const c = Math.cos(ANTI_TILE.rotation);
  const s = Math.sin(ANTI_TILE.rotation);
  const centred = base.sub(vec2(0.5, 0.5));
  const rotated = vec2(centred.x.mul(c).sub(centred.y.mul(s)), centred.x.mul(s).add(centred.y.mul(c)));
  const second = rotated.mul(ANTI_TILE.scale).add(vec2(0.5 + ANTI_TILE.offset[0], 0.5 + ANTI_TILE.offset[1]));
  // The lookups. Lean shading (a uniform: moving views on integrated GPUs) takes one lookup per map; the full path adds the
  // second, rotated lookup that hides the repeat and the close-up micro / distant macro detail, which together are
  // ten texture reads per pixel and the heaviest part of a lawn or plaza. The branch is on a uniform, so it is uniform
  // control flow for every backend; both sides are compiled into the one program (no recompile when it flips).
  const dist = positionWorld.sub(cameraPosition).length();
  const nearFade = float(1).sub(smoothstep(float(DETAIL_NEAR[0]), float(DETAIL_NEAR[1]), dist));
  const farFade = smoothstep(float(DETAIL_FAR[0]), float(DETAIL_FAR[1]), dist);
  const micro = base.mul(DETAIL_MICRO_SCALE);
  const far = base.mul(DETAIL_MACRO_SCALE);
  const flat = vec3(0.5, 0.5, 0);
  /** `lean` or `full`, chosen per pixel by the uniform: only the chosen side's texture reads are executed. */
  const branch = (leanOf: () => Node<'vec3'>, fullOf: () => Node<'vec3'>) =>
    Fn(() => {
      const out = vec3(0).toVar();
      If(leanShading.greaterThan(0.5), () => {
        out.assign(leanOf());
      }).Else(() => {
        out.assign(fullOf());
      });
      return out;
    })();
  // Noise in [0, 1], thresholded so a surface shows ONE lookup almost everywhere and the two meet in a
  // narrow soft seam: an even mix of two unrelated crops would wash the texture out to its average.
  const seamWeight = () => smoothstep(float(SEAM[0]), float(SEAM[1]), noise01(positionWorld, BLEND_NOISE_SCALE, 0));
  const blend = (tex: Texture) => (stochastic ? mix(texture(tex, base), texture(tex, second), seamWeight()) : texture(tex, base));
  const plain = (tex: Texture) => () => texture(tex, base).rgb;
  const split = stochastic || detail;
  // Close up the texels would magnify: a finer lookup of the same photograph adds grain and micro relief; far away a
  // much coarser one adds the large patches a flat ground plane lacks. Both are ratios around 1, so the mean tone holds.
  const mid = detail && opts.finish !== undefined && MID_DETAIL_FINISHES.has(opts.finish);
  const midFade = smoothstep(float(DETAIL_MID[0]), float(DETAIL_MID[1]), dist);
  const clumps = () => {
    const a = noise01(positionWorld, DETAIL_MID_SCALES[0], 0);
    const b = noise01(positionWorld, DETAIL_MID_SCALES[1], 1);
    const k = float(1).sub(float(DETAIL_MID_AMOUNT[0] / 2)).add(a.mul(DETAIL_MID_AMOUNT[0])).mul(float(1).sub(float(DETAIL_MID_AMOUNT[1] / 2)).add(b.mul(DETAIL_MID_AMOUNT[1])));
    return mix(float(1), k, midFade);
  };
  const albedoFull = () => {
    const albedo = mid ? blend(maps.map).rgb.mul(clumps()) : blend(maps.map).rgb;
    return detail ? albedo.mul(mix(vec3(1), texture(maps.map, micro).rgb, nearFade.mul(0.55))).mul(mix(vec3(1), texture(maps.map, far).rgb, farFade.mul(0.9))) : albedo;
  };
  const normalFull = () => {
    const nrm = blend(maps.normal).rgb;
    return detail && normalStrength > 0 ? nrm.add(texture(maps.normal, micro).rgb.sub(flat).mul(nearFade.mul(0.8))).add(texture(maps.normal, far).rgb.sub(flat).mul(farFade.mul(0.35))) : nrm;
  };
  const albedoTex = split ? branch(plain(maps.map), albedoFull) : texture(maps.map, base).rgb;
  const ormTex = split ? branch(plain(maps.orm), () => blend(maps.orm).rgb) : texture(maps.orm, base).rgb;
  const normalTex = split ? branch(() => flat, normalFull) : texture(maps.normal, base).rgb;

  // --- Weather and macro variation ----------------------------------------------------------------------------
  // Macro variation: patches of lighter / darker and rougher / glossier surface several metres and tens of metres wide,
  // so a lawn, a plaza or a street is never one flat tone even where the photograph's own variation is small.
  const m1 = noise01(positionWorld, 0.045, 1);
  const m2 = noise01(positionWorld, 0.21, 2);
  // Contrast-stretched (smoothstep) so the patches read: noise alone clusters around its mean and looks like a flat tone.
  const patch = smoothstep(float(0.22), float(0.78), m1);
  const speck = smoothstep(float(0.3), float(0.7), m2);
  const macro = float(0.74).add(patch.mul(0.46)).add(speck.sub(0.5).mul(0.2));
  const warmth = patch.sub(0.5);
  // Every piece is cut from its own block: a per-object tone (hashed from the object's origin, no texture read) so a row
  // of steps, plinths or paving slabs laid as separate pieces never reads as one uniform pour.
  const origin = pieceOrigin();
  const seed = fract(sin(dot(origin, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
  const piece = float(1).add(seed.sub(0.5).mul(PIECE_TONE));
  const pieceWarm = seed.sub(0.5).mul(PIECE_TONE * 0.5);
  let tinted = albedoTex.mul(macro).mul(piece).mul(vec3(float(1).add(warmth.mul(0.1)).add(pieceWarm), float(1), float(1).sub(warmth.mul(0.14)).sub(pieceWarm)));
  // Natural ground: sun-dried and lush patches that change the hue, not just the brightness (a lawn seen from 30 m is
  // otherwise one flat green). The two noises above already in hand, so no extra texture reads.
  const hue = opts.finish !== undefined ? GROUND_HUE[opts.finish] : undefined;
  if (hue) {
    const dry = smoothstep(float(0.38), float(0.78), m1.mul(0.6).add(m2.mul(0.4)));
    const lush = float(1).sub(smoothstep(float(0.15), float(0.5), m2));
    tinted = tinted.mul(mix(vec3(1), vec3(hue.dry[0], hue.dry[1], hue.dry[2]), dry.mul(hue.amount))).mul(mix(vec3(1), vec3(hue.lush[0], hue.lush[1], hue.lush[2]), lush.mul(hue.amount)));
  }
  const albedoDetailed = tinted;
  const normalEnc = normalTex;
  const orm = ormTex;
  // Wet ground: the weather uniform darkens and glosses everything a little; surfaces with a puddle share (asphalt,
  // concrete, paving) also pool water in the low spots, flat and mirror-like where screen-space reflections show the sky.
  const flatUp = smoothstep(float(0.75), float(0.95), normalWorld.y);
  const damp = groundWeather.mul(0.3);
  const wet = opts.finish ? WETNESS[opts.finish] : undefined;
  const pool = m1.mul(0.55).add(m2.mul(0.45));
  const coverage = wet ? clamp(groundWeather.mul(wet.rain).add(wet.base), 0, 0.95) : float(0);
  const puddle = wet ? smoothstep(float(1).sub(coverage), float(1).sub(coverage).add(0.07), pool).mul(flatUp) : float(0);
  const roughBase = materialRoughness.mul(orm.g).mul(float(0.88).add(m2.mul(0.24))).mul(float(1).sub(damp.mul(0.55)));
  // Cavity: the occlusion map darkens the albedo too, not only the ambient light, so joints, pits and the gaps between stones
  // stay dark under direct sun and the surface reads as relief rather than a printed photograph.
  const cavity = mix(float(1), orm.r, float(CAVITY));
  const rgb = albedoDetailed.mul(cavity).mul(float(1).sub(damp.mul(0.5))).mul(float(1).sub(puddle.mul(0.5)));
  const roughness = mix(roughBase, float(0.035), puddle);
  const normalScale = float(normalStrength).mul(float(1).sub(puddle.mul(0.92)));
  // Exporters (glTF, path tracing) read classic maps: keep the textures reachable for them.
  material.userData[FINISH_MAPS_KEY] = maps;
  // The renderer keys a compiled program by the classic material (its node properties count only as "an object"), and the
  // textures read inside the node functions are bound once per program: two finishes with the same graph shape would
  // share the first one's textures. The key names what the graph samples and how it is shaped.
  const programKey = antiTileProgramKey(maps, normalStrength, opts);
  material.customProgramCacheKey = () => programKey;
  const m = material as Material & { colorNode?: unknown; roughnessNode?: unknown; aoNode?: unknown; normalNode?: unknown };
  // The classic maps are not bound on this material (the nodes sample the textures), so the stock colour
  // and roughness accessors give the plain factors the lookups multiply.
  m.colorNode = staticShadowAlpha(vec4(materialColor.rgb.mul(rgb), 1));
  m.roughnessNode = roughness;
  m.aoNode = orm.r;
  // Lean shading leaves the relief out: the surface keeps its geometric normal, and neither the map nor the tangent frame is read.
  if (normalStrength > 0) {
    m.normalNode = split
      ? Fn(() => {
          const out = normalView.toVar();
          If(leanShading.lessThan(0.5), () => {
            out.assign(normalMap(normalEnc, vec2(normalScale, normalScale)));
          });
          return out;
        })()
      : normalMap(normalEnc, vec2(normalScale, normalScale));
  }
}
