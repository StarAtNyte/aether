/**
 * Block terrain materials (TSL, so the same shader runs on the WebGPU and WebGL2 backends).
 *
 * Chunk vertices carry everything the shading needs: `uv` in block units (greedy quads span several
 * blocks; the texture arrays repeat natively), and `data` (uint8 × 4, normalised): atlas tile, ambient
 * occlusion, sky light and block light at the vertex (smooth lighting is interpolated; the occlusion is
 * baked into the mesh, the screen-space AO of the post chain adds contact detail on top).
 *
 * Surface: every tile is looked up in a small table ({@link TerrainTextures.table}) that binds it to a
 * photographic PBR material (albedo, tangent-space normal, occlusion / roughness / height arrays with
 * mips and anisotropy), a tint that re-colours the photograph towards the block's own colour, and a
 * class (plain, grass or snow fringe, foliage, ore, lava, ice, metal, emissive). Tiles without a
 * photograph (sprites, glass frames, book spines) keep the procedural pixel atlas. Each block gets a
 * random texture offset so neighbouring blocks never repeat.
 *
 * Light: a warm sun with soft heightfield shadows, a sky hemisphere with ambient occlusion, torch
 * light that bounces warm, GGX-style highlights and sky reflections whose sharpness follows the
 * roughness map. The sun shadow is a cascaded ray march over a column-height texture
 * ({@link SunShadowField}): fine steps near the surface (hard contact shadows), coarser and softer
 * steps further out (long mountain and tree shadows), foliage counted as partial occluders.
 * Wet sand and dirt near the waterline darken and gloss; shallow lake beds show animated caustics.
 *
 * Water is translucent with depth taken from the same height texture (absorption colour, clarity),
 * ripples, a fresnel mirror of the analytic sky, sun glints and shoreline foam. Leaves are alpha-cut
 * clumps with light shining through (translucency) and a wind sway shared with sprites.
 *
 * Fog is the terrain's own: a linear fade over the horizontal distance to the streaming centre, the
 * environment's exponential haze, and in-scattering that glows warm toward the sun.
 *
 * Tiers: `low` (software rasterisers) has photographic albedo and normal maps with the baked light
 * only; `medium` adds the cascaded sun shadows; `high` adds parallax, caustics and finer shadows;
 * `ultra` the longest and softest shadows and sun shafts through the foliage (volumetric haze).
 * A tier is a different shader (not a uniform branch), so the cheap tiers pay for nothing they skip.
 */
import { Color, DoubleSide, FrontSide, Vector2, Vector3, type DataArrayTexture, type DataTexture } from 'three';
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import {
  abs, attribute, cameraPosition, clamp, cross, dFdx, dFdy, dot, exp, float, floor, fract, length, max, min, mix, modelWorldMatrix, mod, mx_noise_float, normalize, positionLocal, positionWorld,
  pow, reflect, select, sin, smoothstep, step, texture, time, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';

/** Tiles per atlas row. */
const TILES = 16;
/** Highest mip level that keeps 16-pixel tiles apart. */
const MAX_LOD = 4;
/** Atlas edge in pixels. */
const ATLAS_PX = 256;
/** Columns of the tile table. */
export const TILE_TABLE_WIDTH = 256;
/** Rows of the tile table. */
const TABLE_ROWS = 4;
/** Edge of the column-height texture (blocks). */
export const SHADOW_FIELD_SIZE = 512;

/** Quality tier of the terrain shaders (mirrors the render tiers). */
export type TerrainTier = 'low' | 'medium' | 'high' | 'ultra';

/** Cascaded sun-shadow march per tier: samples per cascade (near, mid, far) and the reach of each (blocks). */
export const SHADOW_MARCH: Readonly<Record<TerrainTier, { steps: readonly [number, number, number]; reach: readonly [number, number, number] }>> = Object.freeze({
  low: { steps: [0, 0, 0], reach: [0, 0, 0] },
  medium: { steps: [4, 3, 3], reach: [5, 18, 56] },
  high: { steps: [6, 5, 5], reach: [6, 22, 80] },
  ultra: { steps: [8, 7, 7], reach: [6, 24, 110] },
});

/** Radiometric scale of the sun and the sky (linear, 1 ≈ a sunlit white surface before tone mapping). */
const SUN_SCALE = 1.6;
const SKY_SCALE = 0.68;
/** Photographed albedos are re-coloured to the block colours, which were chosen for flat shading: darken them to sit in a lit scene. */
const ALBEDO_GAIN = 0.64;

/** What the shaders sample. */
export interface TerrainTextures {
  /** Procedural pixel atlas (sprites, glass, fallback). */
  atlas: DataTexture;
  /** The same pixels with bilinear filtering: sprites and fallback tiles read as soft shapes, not hard pixels. */
  atlasSmooth: DataTexture;
  /** Photographic sheets and the per-tile table; null keeps the pixel atlas only. */
  pbr: { albedo: DataArrayTexture; normal: DataArrayTexture; orm: DataArrayTexture; table: DataTexture } | null;
  /** Column heights of the loaded chunks (R solid top, G foliage top), nearest, repeating. */
  field: DataTexture;
}

/** Shared lighting uniforms of the terrain materials. */
export interface TerrainUniforms {
  /** 0 (night) … 1 (noon): scales sky light. */
  daylight: { value: number };
  /** Sky light tint (linear RGB). */
  skyTint: { value: Color };
  /** Liquid opacity. */
  liquidOpacity: { value: number };
  /** Fog colour (linear RGB, the scene fog's colour). */
  fogColor: { value: Color };
  /** Centre of the linear fade (world x, z). */
  fogOrigin: { value: Vector2 };
  /** Horizontal distance where the terrain fog starts (metres). */
  fogNear: { value: number };
  /** Horizontal distance where the terrain is fully fogged (metres). */
  fogFar: { value: number };
  /** The environment's own exponential haze density (0: none). */
  fogDensity: { value: number };
  /** Unit vector toward the sun (world space). */
  sunDirection: { value: Vector3 };
  /** Sun light colour (linear RGB, already scaled by how high and bright the sun is; black at night). */
  sunColor: { value: Color };
  /** Sky colour overhead (linear RGB). */
  skyZenith: { value: Color };
  /** World y of the water surface (wet shores, caustics, foam depth). */
  waterLevel: { value: number };
}

/** The three terrain materials and their uniforms. */
export interface TerrainMaterials {
  opaque: MeshBasicNodeMaterial;
  cutout: MeshBasicNodeMaterial;
  liquid: MeshBasicNodeMaterial;
  uniforms: TerrainUniforms;
  tier: TerrainTier;
  dispose(): void;
}

/** Light level (0…1 of 15) → brightness, Minecraft-like 0.8^n falloff with a floor. */
function curve(level: Node<'float'>): Node<'float'> {
  return pow(float(0.8), float(1).sub(level).mul(15)).mul(0.96).add(0.04);
}

/** Cheap hash of a vec3 → 0…1. */
function hash31(p: Node<'vec3'>): Node<'float'> {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
}

/** Analytic sky radiance toward direction `d` (y up): zenith → horizon gradient, ground tint, sun disc and glow. */
function skyColor(d: Node<'vec3'>, u: TerrainUniforms & { zenith: Node<'vec3'>; horizon: Node<'vec3'>; sunDir: Node<'vec3'>; sunCol: Node<'vec3'> }): Node<'vec3'> {
  const up = clamp(d.y, -1, 1);
  const t = pow(clamp(float(1).sub(max(up, float(0))), 0, 1), float(2.2));
  const sky = mix(u.zenith, u.horizon, t);
  const ground = u.horizon.mul(0.35);
  const base = mix(ground, sky, smoothstep(float(-0.12), float(0.06), up));
  const sd = max(dot(d, u.sunDir), float(0));
  const glow = pow(sd, float(6)).mul(0.22).add(pow(sd, float(48)).mul(0.9));
  const disc = smoothstep(float(0.9994), float(0.99985), sd).mul(14);
  return base.add(u.sunCol.mul(glow.add(disc)).mul(0.16));
}

/** Build the terrain materials around the block textures at a quality tier. */
export function createTerrainMaterials(tex: TerrainTextures, tier: TerrainTier = 'medium'): TerrainMaterials {
  const daylight = uniform(1);
  const skyTint = uniform(new Color(1, 1, 1));
  const liquidOpacity = uniform(0.78);
  const fogColor = uniform(new Color(0.77, 0.87, 0.96));
  const fogOrigin = uniform(new Vector2(0, 0));
  const fogNear = uniform(1e5);
  const fogFar = uniform(2e5);
  const fogDensity = uniform(0);
  const sunDirection = uniform(new Vector3(0.43, 0.76, 0.33));
  const sunColor = uniform(new Color(1, 0.97, 0.9));
  const skyZenith = uniform(new Color(0.12, 0.3, 0.7));
  const waterLevel = uniform(47.875);
  const pbr = tex.pbr;
  const skyTintV = skyTint as unknown as Node<'vec3'>;
  const sunColorV = sunColor as unknown as Node<'vec3'>;
  const fogColorV = fogColor as unknown as Node<'vec3'>;
  const skyZenithV = skyZenith as unknown as Node<'vec3'>;
  const march = SHADOW_MARCH[tier];
  const shadows = march.steps[0] + march.steps[1] + march.steps[2] > 0;
  const rich = tier === 'high' || tier === 'ultra';
  /** Lean shaders (software rasterisers): albedo only, no normal or occlusion fetch, cheap hash patterns instead of noise. */
  const lean = tier === 'low';
  const cheap = tier !== 'high' && tier !== 'ultra';

  const skyUniforms = { zenith: skyZenith as unknown as Node<'vec3'>, horizon: fogColor as unknown as Node<'vec3'>, sunDir: sunDirection as unknown as Node<'vec3'>, sunCol: sunColor as unknown as Node<'vec3'> } as unknown as TerrainUniforms & {
    zenith: Node<'vec3'>;
    horizon: Node<'vec3'>;
    sunDir: Node<'vec3'>;
    sunCol: Node<'vec3'>;
  };

  /** Column heights (solid, foliage) at a world position (xz). */
  const fieldAt = (p: Node<'vec3'>): Node<'vec4'> => texture(tex.field, p.xz.div(SHADOW_FIELD_SIZE));

  /** Soft cascaded sun shadow of a surface point: 1 lit … 0 shadowed. */
  const sunShadow = (origin: Node<'vec3'>, L: Node<'vec3'>): Node<'float'> => {
    let occ: Node<'float'> = float(0);
    let start = 0.45;
    for (let c = 0; c < 3; c++) {
      const n = march.steps[c] as number;
      const reach = march.reach[c] as number;
      if (n === 0) continue;
      for (let i = 0; i < n; i++) {
        const t = start + ((reach - start) * (i + 0.5)) / n;
        const p = origin.add(L.mul(t));
        const h = fieldAt(p);
        // How far the ray is below the column top: positive means the point is inside terrain.
        const soft = float(0.5 + t * 0.07);
        const solid = clamp(h.x.sub(p.y).div(soft), 0, 1);
        const foliage = clamp(h.y.sub(p.y).div(soft), 0, 1).mul(0.62);
        const fade = float(1 - (t / (march.reach[2] as number)) ** 2 * 0.65);
        occ = max(occ, max(solid, foliage).mul(fade));
      }
      start = reach;
    }
    return float(1).sub(occ);
  };

  const build = (kind: 'opaque' | 'cutout' | 'liquid'): MeshBasicNodeMaterial => {
    const data = attribute('data', 'vec4');
    const tile = floor(data.x.mul(255).add(0.5));
    const cell = vec2(mod(tile, TILES), floor(tile.div(TILES)));
    let blockUv: Node<'vec2'> = uv();
    if (kind === 'liquid') blockUv = blockUv.add(vec2(time.mul(0.35), time.mul(0.18)));

    // Pixel atlas (sprites, glass, fallback): the nearest texel of the tile, mip clamped to keep tiles apart.
    const inset = 0.5 / TILES;
    const local = clamp(vec2(fract(blockUv.x), float(1).sub(fract(blockUv.y))), inset, 1 - inset);
    const atlasUv = cell.add(local).div(TILES);
    const maxGrad = float((2 ** MAX_LOD) / ATLAS_PX);
    const gx = dFdx(blockUv).div(TILES);
    const gy = dFdy(blockUv).div(TILES);
    const gxs = gx.mul(min(float(1), maxGrad.div(max(length(gx), float(1e-6)))));
    const gys = gy.mul(min(float(1), maxGrad.div(max(length(gy), float(1e-6)))));
    const atlas = texture(tex.atlasSmooth, atlasUv).grad(gxs, gys);

    // Geometry: the outward face normal from screen derivatives, the view vector.
    const dpx = dFdx(positionWorld);
    const dpy = dFdy(positionWorld);
    const n0 = normalize(cross(dpx, dpy));
    const toCam = cameraPosition.sub(positionWorld);
    const camDist = length(toCam);
    const view = toCam.div(max(camDist, float(1e-4)));
    const Ng = select(dot(n0, view).greaterThan(0), n0, n0.negate());
    const an = abs(Ng);
    const isY = an.y.greaterThan(max(an.x, an.z));
    const faceAmbient = select(isY, select(Ng.y.greaterThan(0), float(1), float(0.62)), select(an.x.greaterThan(an.z), float(0.86), float(0.76)));

    // Per-block randomness.
    const blockPos = floor(positionWorld.sub(Ng.mul(0.5)));
    const h = hash31(blockPos);
    const h2 = hash31(blockPos.add(vec3(17.3, 5.1, 9.7)));
    const h3 = hash31(blockPos.add(vec3(3.7, 41.9, 23.1)));

    // Tile table.
    const col = tile.add(0.5).div(TILE_TABLE_WIDTH);
    const row = (r: number): Node<'vec2'> => vec2(col, float((r + 0.5) / TABLE_ROWS));
    const t0 = pbr ? texture(pbr.table, row(0)) : null;
    const t1 = pbr ? texture(pbr.table, row(1)) : null;
    const t2 = pbr ? texture(pbr.table, row(2)) : null;
    const t3 = pbr ? texture(pbr.table, row(3)) : null;
    const slot = t0 ? t0.x : float(-1);
    const cls = t0 ? floor(t0.y.add(0.5)) : float(0);
    const roughScale = t0 ? t0.z : float(1);
    const metallicBase = t0 ? t0.w : float(0);
    const tint = t1 ? t1.xyz : vec3(1, 1, 1);
    const wetSusceptibility = t1 ? t1.w : float(0);
    const tint2 = t2 ? t2.xyz : vec3(1, 1, 1);
    const slot2 = t2 ? t2.w : float(-1);
    const accent = t3 ? t3.xyz : vec3(0, 0, 0);
    const emissiveK = t3 ? t3.w : float(0);
    const isCls = (k: number): Node<'float'> => step(float(k - 0.5), cls).mul(step(cls, float(k + 0.5)));
    const hasPbr = step(float(-0.5), slot);

    // Sample coordinate: texture repeat does the tiling; a per-block offset hides the repetition.
    // (u, -v) so that the image's up is the world's up on side faces.
    const off = vec2(h, h2);
    let st: Node<'vec2'> = vec2(blockUv.x, blockUv.y.negate()).add(off);
    const sgx = dFdx(blockUv).mul(vec2(1, -1));
    const sgy = dFdy(blockUv).mul(vec2(1, -1));

    // Cotangent frame from the derivatives (no tangents in the mesh).
    const duv1 = sgx;
    const duv2 = sgy;
    const dp2perp = cross(dpy, Ng);
    const dp1perp = cross(Ng, dpx);
    const Tr = dp2perp.mul(duv1.x).add(dp1perp.mul(duv2.x));
    const Br = dp2perp.mul(duv1.y).add(dp1perp.mul(duv2.y));
    const inv = float(1).div(max(length(Tr), length(Br)).max(1e-8));
    const Tn = Tr.mul(inv);
    const Bn = Br.mul(inv);

    // Parallax: shift the sample along the view direction by the height map (high tiers, near the camera).
    if (pbr && rich) {
      const v1 = vec3(dot(view, normalize(Tn)), dot(view, normalize(Bn)).negate(), max(dot(view, Ng), float(0.2)));
      const hgt = texture(pbr.orm, st).depth(slot.max(0)).grad(sgx, sgy).z;
      const k = float(0.035).mul(float(1).sub(smoothstep(float(6), float(22), camDist)));
      st = st.add(vec2(v1.x, v1.y.negate()).div(v1.z).mul(hgt.sub(0.5)).mul(k).mul(vec2(1, 1)));
    }

    const fetch = (map: DataArrayTexture, layer: Node<'float'>): Node<'vec4'> => texture(map, st).depth(layer.max(0)).grad(sgx, sgy) as unknown as Node<'vec4'>;

    let albedo: Node<'vec3'> = atlas.rgb;
    let alphaMask: Node<'float'> = atlas.a;
    let nTs: Node<'vec3'> = vec3(0, 0, 1);
    let ao: Node<'float'> = float(1);
    let rough: Node<'float'> = float(0.9);
    let heightV: Node<'float'> = float(0.5);
    let metal: Node<'float'> = float(0);
    let secondary: Node<'float'> = float(0);
    let leafMask: Node<'float'> = float(1);
    if (pbr) {
      const a1 = fetch(pbr.albedo, slot).rgb.mul(tint);
      const o1: Node<'vec4'> = lean ? vec4(1, 0.85, 0.5, 1) : fetch(pbr.orm, slot);
      const nm: Node<'vec3'> = lean ? vec3(0, 0, 1) : fetch(pbr.normal, slot).xyz.mul(2).sub(1);
      // Fringe materials (grass or snow edge over dirt): a ragged mask along the top of the side faces.
      const lv = float(1).sub(fract(blockUv.y));
      const lu = fract(blockUv.x);
      const fringeNoise = cheap
        ? hash31(vec3(floor(lu.mul(12)), floor(h.mul(40)), float(2))).sub(0.5).mul(1.1)
        : mx_noise_float(vec3(lu.mul(7).add(h.mul(31)), float(2.3), h2.mul(11)));
      const fringeCut = float(0.8).add(fringeNoise.mul(0.1)).sub(select(isY, float(10), float(0)));
      const fringeOn = isCls(2).add(isCls(3));
      secondary = smoothstep(fringeCut.sub(0.02), fringeCut.add(0.045), lv).mul(fringeOn);
      const a2: Node<'vec3'> = lean ? tint2.mul(vec3(0.117, 0.15, 0.03)) : fetch(pbr.albedo, slot2).rgb.mul(tint2);
      const o2: Node<'vec4'> = lean ? vec4(1, 0.9, 0.5, 1) : fetch(pbr.orm, slot2);
      const nm2: Node<'vec3'> = lean ? vec3(0, 0, 1) : fetch(pbr.normal, slot2).xyz.mul(2).sub(1);
      const albedoPbr = mix(a1, a2, secondary);
      const ormPbr = mix(o1, o2, secondary);
      const nPbr = mix(nm, nm2, secondary);
      // Ore: flecks of the accent colour in the stone.
      const fleckField: Node<'float'> = cheap
        ? hash31(vec3(floor(st.x.mul(4)), floor(st.y.mul(4)), h3.mul(9))).mul(0.5).add(0.18)
        : mx_noise_float(vec3(st.x.mul(5.5), st.y.mul(5.5), h3.mul(9))).mul(0.5).add(0.5).add(mx_noise_float(vec3(st.x.mul(13), st.y.mul(13), float(4))).mul(0.12));
      const fleck = smoothstep(float(0.58), float(0.66), fleckField).mul(isCls(5));
      const albedoOre = mix(albedoPbr, accent.mul(1.1), fleck);
      // The tone curve desaturates: lift the saturation of the photographs a little so greens and earth stay rich.
      const lumPbr = dot(albedoOre, vec3(0.2126, 0.7152, 0.0722));
      const richPbr = mix(vec3(lumPbr, lumPbr, lumPbr), albedoOre, 1.22).max(0);
      albedo = mix(atlas.rgb, richPbr.mul(ALBEDO_GAIN), hasPbr);
      nTs = mix(vec3(0, 0, 1), nPbr, hasPbr);
      ao = mix(float(1), ormPbr.x, hasPbr);
      rough = mix(float(0.9), clamp(ormPbr.y.mul(roughScale), 0.06, 1), hasPbr);
      heightV = mix(float(0.5), ormPbr.z, hasPbr);
      metal = clamp(metallicBase.add(fleck.mul(0.5)), 0, 1);
      rough = mix(rough, float(0.32), fleck);
    }
    // Atlas sprites keep their own alpha (cutout pass); leaves cut clumps out of the cube faces.
    if (kind === 'cutout') {
      const lu = fract(blockUv.x);
      const lv = fract(blockUv.y);
      const clumpBase = mx_noise_float(vec3(lu.mul(4.2).add(h.mul(23)), lv.mul(4.2).add(h2.mul(19)), h3.mul(7))).mul(0.5);
      const clump = (cheap ? clumpBase : clumpBase.add(mx_noise_float(vec3(lu.mul(11).add(h2.mul(5)), lv.mul(11).add(h3.mul(3)), h.mul(2))).mul(0.2))).add(0.5);
      const edgeShade = smoothstep(float(0.34), float(0.62), clump);
      leafMask = smoothstep(float(0.36), float(0.4), clump);
      if (pbr) {
        const isLeaf = isCls(4);
        alphaMask = mix(alphaMask, leafMask, isLeaf);
        // Darker towards the clump edge, lighter in the middle (leaf depth).
        albedo = mix(albedo, albedo.mul(mix(float(0.42), float(1.18), edgeShade)), isLeaf);
        rough = mix(rough, float(0.62), isLeaf);
      }
    }

    // Grass blades: drawn here, six tapered blades per quad that lean with the wind-free rest pose.
    if (kind === 'cutout') {
      const bu = fract(blockUv.x);
      const bv = fract(blockUv.y);
      let cover: Node<'float'> = float(0);
      for (let k = 0; k < (lean ? 4 : 6); k++) {
        const seed = hash31(blockPos.add(vec3(k * 7.31, k * 1.7, k * 3.9)));
        const seed2 = hash31(blockPos.add(vec3(k * 2.13, k * 5.3, 11.0)));
        const base = float((k + 0.5) / (lean ? 4 : 6)).add(seed.sub(0.5).mul(0.16));
        const heightK = seed2.mul(0.45).add(0.5);
        const bend = seed.sub(0.5).mul(0.28);
        const centre = base.add(bend.mul(bv).mul(bv));
        const width = float(0.075).mul(float(1).sub(clamp(bv.div(heightK), 0, 1)).pow(0.7)).add(0.004);
        cover = max(cover, step(abs(bu.sub(centre)), width).mul(step(bv, heightK)));
      }
      const bladeAlpha = cover;
      const bladeColor = mix(accent.mul(0.6), tint2.mul(1.15), pow(bv, float(0.8))).mul(h.mul(0.3).add(0.85));
      const isBlade = isCls(10);
      albedo = mix(albedo, bladeColor, isBlade);
      alphaMask = mix(alphaMask, bladeAlpha, isBlade);
      rough = mix(rough, float(0.55), isBlade);
    }

    // Wet shore: dirt, sand and gravel near the water line darken and gloss (and in water caustics play on them).
    const wy = positionWorld.y.sub(waterLevel);
    const shore = float(1).sub(smoothstep(float(0.0), float(1.6), wy)).mul(wetSusceptibility);
    const wet = kind === 'liquid' ? float(0) : shore;
    albedo = albedo.mul(mix(float(1), float(0.62), wet));
    rough = mix(rough, rough.mul(0.35), wet);

    // Surface normal (world space).
    const nStrength = float(1).sub(smoothstep(float(18), float(60), camDist).mul(0.8));
    const nMap = vec3(nTs.x.mul(nStrength), nTs.y.mul(nStrength), nTs.z);
    const Nm = normalize(Tn.mul(nMap.x).sub(Bn.mul(nMap.y)).add(Ng.mul(nMap.z)));
    // Sprites (flowers, grass) are crossed quads: they take the light of the ground they stand on.
    const sprite = kind === 'cutout' ? float(1).sub(isCls(4)).mul(float(1).sub(hasPbr)) : float(0);
    const N = mix(kind === 'liquid' ? Ng : mix(Ng, Nm, hasPbr), vec3(0, 1, 0), sprite);

    // Light ---------------------------------------------------------------------------------------
    const L = sunDirection;
    const skyLevel = data.z;
    const sky = curve(skyLevel).mul(daylight);
    const torch = curve(data.w);
    const sunOpen = smoothstep(float(0.62), float(0.98), skyLevel);
    const vAo = data.y.mul(0.5).add(0.5);
    const ndl = max(dot(N, L), float(0));
    const facing = mix(smoothstep(float(0.0), float(0.18), dot(Ng, L)), float(1), sprite);
    const origin = positionWorld.add(Ng.mul(0.07));
    const shadow = shadows ? sunShadow(origin, L) : float(1);
    // The height texture knows nothing of overhangs: the vertex sky light is the cave term.
    const sunVis = sunOpen.mul(shadow).mul(facing);
    const direct = sunColorV.mul(ndl).mul(sunVis).mul(SUN_SCALE);
    const hemi = mix(fogColorV.mul(0.5).mul(vec3(0.92, 0.84, 0.72)), skyZenithV.mul(0.75).add(fogColorV.mul(0.5)), N.y.mul(0.5).add(0.5));
    // Skylight is bluish but diffuse: keep a good share of it neutral so warm materials in the shade do not go black.
    const hemiLum = dot(hemi, vec3(0.3, 0.59, 0.11));
    const ambientSky = skyTintV.mul(mix(vec3(hemiLum, hemiLum, hemiLum), hemi, 0.4)).mul(sky).mul(SKY_SCALE);
    // The sun's fill bounces off the ground and the walls: a faint warm light from the side facing away.
    const bounce = sunColorV.mul(max(dot(N, L.mul(vec3(-1, 0, -1)).normalize()), float(0))).mul(0.08).mul(sky);
    const texAo = mix(float(1), ao, 0.6).mul(mix(float(0.7), float(1), smoothstep(float(0.0), float(0.7), heightV)).mul(0.5).add(0.5));
    const occlusion = vAo.mul(vAo.mul(0.35).add(0.65)).mul(texAo);
    const ambient = ambientSky.add(bounce).mul(occlusion).mul(faceAmbient);
    // Torch and lava light: warm, with a little bounce (it reaches the shadow side as well).
    const torchTint = vec3(1.0, 0.62, 0.34);
    const torchLight = torchTint.mul(torch).mul(torch).mul(mix(float(0.72), float(1), ndl.mul(0.4).add(0.6))).mul(2.2);
    const irradiance = ambient.add(direct).add(torchLight.mul(occlusion));

    const diffuseColor = albedo.mul(kind === 'liquid' ? float(1) : h.mul(0.1).add(0.95)).mul(float(1).sub(metal));
    let color: Node<'vec3'> = diffuseColor.mul(irradiance);

    // Specular: sun highlight and sky reflection, sharpness from the roughness map.
    const r2 = rough.mul(rough);
    const Hh = normalize(L.add(view));
    const ndh = max(dot(N, Hh), float(0));
    const shin = max(float(2).div(max(r2.mul(r2), float(1e-3))).sub(2), float(2));
    const f0 = mix(vec3(0.04, 0.04, 0.04), albedo, metal);
    const ndv = max(dot(N, view), float(0.02));
    const fres = f0.add(vec3(1, 1, 1).sub(f0).mul(pow(float(1).sub(ndv), float(5))).mul(float(1).sub(rough).mul(0.9).add(0.1)));
    const sunSpec = sunColorV.mul(pow(ndh, shin)).mul(shin.add(8).div(25)).mul(ndl).mul(sunVis).mul(0.5);
    const R = reflect(view.negate(), N);
    const skyVis = smoothstep(float(0.35), float(1), skyLevel).mul(daylight.mul(0.85).add(0.15));
    const envSpec = skyColor(R, skyUniforms).mul(skyVis).mul(float(1).sub(rough).pow(2.2)).mul(vAo);
    color = color.add(fres.mul(sunSpec.add(envSpec)));

    // Foliage translucency: light shining through the leaves from the sun behind them.
    if (kind === 'cutout' && pbr) {
      const through = max(dot(N.negate(), L), float(0)).mul(max(dot(view.negate(), L), float(0)).mul(0.6).add(0.4));
      const leafGlow = albedo.mul(vec3(1.0, 1.15, 0.5)).mul(sunColor).mul(through).mul(sunOpen).mul(shadow).mul(1.5);
      color = color.add(leafGlow.mul(isCls(4)));
    }
    // Ice: inner glow, a lighter body.
    color = color.add(albedo.mul(isCls(7)).mul(ambientSky).mul(0.5));

    // Emission: lava, glowstone and flames (only the bright pixels of atlas tiles).
    const glowMask = mix(smoothstep(float(0.5), float(0.78), max(atlas.r, atlas.g)), float(1), isCls(6));
    const flow = mx_noise_float(vec3(positionWorld.x.mul(1.3), positionWorld.z.mul(1.3).add(positionWorld.y.mul(1.3)), time.mul(0.35))).mul(0.5).add(0.5);
    const emitColor = mix(albedo, albedo.mul(vec3(1.3, 0.8, 0.5)).add(vec3(0.35, 0.08, 0.0)).mul(flow.mul(0.6).add(0.7)), isCls(6));
    color = color.add(emitColor.mul(emissiveK).mul(glowMask));

    // Lakebed caustics: bright animated net on the sun-lit floor of shallow water.
    if (rich && kind !== 'liquid') {
      const depthBelow = waterLevel.sub(positionWorld.y);
      const cp = positionWorld.xz.mul(1.15);
      const c1 = abs(mx_noise_float(vec3(cp.x.add(time.mul(0.3)), cp.y, time.mul(0.25))));
      const c2 = abs(mx_noise_float(vec3(cp.x.mul(1.7), cp.y.mul(1.7).sub(time.mul(0.35)), time.mul(0.31).add(9))));
      const net = pow(float(1).sub(max(c1, c2)), float(7)).mul(2.4);
      const inWater = smoothstep(float(-0.1), float(0.2), depthBelow).mul(float(1).sub(smoothstep(float(1), float(9), depthBelow)));
      color = color.add(sunColorV.mul(albedo).mul(net).mul(inWater).mul(sunVis).mul(1.7));
    }

    // Fog -------------------------------------------------------------------------------------------
    const flat = length(positionWorld.xz.sub(fogOrigin));
    const haze = float(1).sub(exp(fogDensity.mul(camDist).pow(2).negate()));
    const fogged = clamp(max(smoothstep(fogNear, fogFar, flat), haze), 0, 1);
    // Sun shafts (ultra): march the view ray; each sample asks the height texture whether the sun reaches it
    // (two taps toward the sun), so canopies, ridges and walls cut the haze into shafts when you look sunward.
    if (tier === 'ultra' && kind !== 'liquid') {
      const SAMPLES = 7;
      const rayLen = min(camDist, float(80));
      const rayDir = positionWorld.sub(cameraPosition).div(max(camDist, float(1e-3)));
      const jitter = hash31(positionWorld.mul(17.31).add(vec3(time, 0, 0)));
      let lit: Node<'float'> = float(0);
      for (let i = 0; i < SAMPLES; i++) {
        const t = rayLen.mul(jitter.add(i).div(SAMPLES));
        const p = cameraPosition.add(rayDir.mul(t));
        let vis: Node<'float'> = float(1);
        for (const reach of [9, 34]) {
          const q = p.add(L.mul(reach));
          const hq = fieldAt(q);
          vis = vis.mul(float(1).sub(clamp(hq.x.sub(q.y), 0, 1))).mul(float(1).sub(clamp(hq.y.sub(q.y), 0, 1).mul(0.7)));
        }
        lit = lit.add(vis);
      }
      const phaseSun = pow(max(dot(rayDir, L), float(0)), float(5)).mul(0.9).add(0.1);
      const shaft = sunColorV.mul(lit.div(SAMPLES)).mul(phaseSun).mul(rayLen.mul(0.0075)).mul(daylight).mul(0.55);
      color = color.add(shaft);
    }
    // In-scattering: the haze glows toward the sun (a warm mie lobe), stronger at low sun.
    const sunAlign = pow(max(dot(view.negate(), L), float(0)), float(5));
    const scatterAmount = clamp(camDist.mul(0.006), 0, 0.6).mul(sunAlign).mul(sunOpen.mul(0.4).add(0.6));
    color = color.add(sunColorV.mul(0.18).mul(scatterAmount).mul(daylight));

    let shaded: Node<'vec3'> = color;
    let alpha: Node<'float'> = float(1);
    if (kind === 'liquid') {
      // Water: depth from the column heights, ripples, a fresnel mirror of the sky, sun glints, shore foam.
      const p = positionWorld.xz;
      const t = time;
      const w1x = mx_noise_float(vec3(p.x.mul(0.9), p.y.mul(0.9), t.mul(0.45)));
      const w1z = mx_noise_float(vec3(p.x.mul(0.9).add(31.7), p.y.mul(0.9).add(11.3), t.mul(0.4)));
      const w2x = mx_noise_float(vec3(p.x.mul(2.6).add(7.1), p.y.mul(2.6), t.mul(0.8)));
      const w2z = mx_noise_float(vec3(p.x.mul(2.6), p.y.mul(2.6).add(3.9), t.mul(0.75)));
      const nW = normalize(vec3(w1x.mul(0.14).add(w2x.mul(0.05)), float(1), w1z.mul(0.14).add(w2z.mul(0.05))));
      const floor0 = fieldAt(positionWorld.add(vec3(0, -0.2, 0))).x;
      const depth = max(positionWorld.y.sub(floor0), float(0.05));
      const isLava = isCls(6);
      const fr = pow(float(1).sub(max(dot(nW, view), float(0))), float(4)).mul(0.9).add(0.04);
      const absorb = exp(depth.mul(0.42).negate());
      const shallow = vec3(0.11, 0.42, 0.36);
      const deep = vec3(0.012, 0.075, 0.18);
      const body = mix(deep, shallow, absorb).mul(float(0.35).add(daylight.mul(0.65))).mul(skyTint).mul(sky.mul(0.6).add(0.4));
      const Rw = reflect(view.negate(), nW);
      const mirror = skyColor(Rw, skyUniforms).mul(skyVis.mul(0.8).add(0.2));
      const glint = pow(max(dot(reflect(L.negate(), nW), view), float(0)), float(220)).mul(daylight.mul(6)).mul(sunOpen);
      // Foam: ragged bands that wash up the shore and breathe with time.
      // The shallowest water over a shore block is 0.875 deep.
      const shoreBand = float(1).sub(smoothstep(float(0.9), float(1.7), depth));
      const foamNoise = mx_noise_float(vec3(p.x.mul(3.2), p.y.mul(3.2), t.mul(0.6))).mul(0.5).add(0.5);
      const wash = sin(depth.mul(9).sub(t.mul(1.6)).add(foamNoise.mul(3))).mul(0.5).add(0.5);
      const foam = clamp(shoreBand.mul(foamNoise.mul(0.7).add(wash.mul(0.5))), 0, 1).mul(smoothstep(float(0.25), float(0.5), foamNoise.add(shoreBand.mul(0.6))));
      const foamColor = vec3(0.9, 0.95, 1).mul(sky.mul(0.8).add(0.2)).mul(skyTint);
      let water = mix(body, mirror, fr).add(sunColorV.mul(glint));
      water = mix(water, foamColor, foam.mul(0.9));
      // Lava: opaque, bright and flowing.
      shaded = mix(water, color, isLava);
      const clarity = float(1).sub(exp(depth.mul(0.5).negate()));
      alpha = mix(clamp(mix(float(0.3), float(0.96), clarity.pow(0.85)), 0, 1).max(fr), float(1), max(isLava, foam.mul(0.8)));
    }
    const rgb = mix(shaded, fogColorV, fogged);

    const m = new MeshBasicNodeMaterial();
    m.colorNode = vec4(rgb, float(1));
    // Fogged above (see the module comment); the scene fog would fog it twice.
    m.fog = false;
    if (kind === 'cutout') {
      // Wind: leaves and sprites sway; sprites more toward their tips (no sway at the foot).
      const wp = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz;
      const gust = sin(wp.x.mul(0.35).add(wp.z.mul(0.27)).add(time.mul(1.4))).mul(0.5).add(sin(wp.x.mul(1.1).sub(wp.z.mul(0.8)).add(time.mul(2.3))).mul(0.5));
      const tip = clamp(fract(positionLocal.y), 0, 1);
      m.positionNode = positionLocal.add(vec3(gust.mul(0.045), gust.mul(0.012), gust.mul(0.035)).mul(mix(float(0.55), tip, 0.5)));
      m.opacityNode = alphaMask;
      m.alphaTest = 0.5;
      m.side = DoubleSide;
    } else if (kind === 'liquid') {
      m.transparent = true;
      m.opacityNode = alpha;
      m.depthWrite = false;
      m.side = DoubleSide;
    } else {
      m.side = FrontSide;
    }
    m.name = `aether:voxel-${kind}-${tier}`;
    return m;
  };

  const opaque = build('opaque');
  const cutout = build('cutout');
  const liquid = build('liquid');
  return {
    opaque,
    cutout,
    liquid,
    tier,
    uniforms: {
      daylight,
      skyTint: skyTint as unknown as TerrainUniforms['skyTint'],
      liquidOpacity,
      fogColor: fogColor as unknown as TerrainUniforms['fogColor'],
      fogOrigin: fogOrigin as unknown as TerrainUniforms['fogOrigin'],
      fogNear,
      fogFar,
      fogDensity,
      sunDirection: sunDirection as unknown as TerrainUniforms['sunDirection'],
      sunColor: sunColor as unknown as TerrainUniforms['sunColor'],
      skyZenith: skyZenith as unknown as TerrainUniforms['skyZenith'],
      waterLevel,
    },
    dispose() {
      opaque.dispose();
      cutout.dispose();
      liquid.dispose();
    },
  };
}
