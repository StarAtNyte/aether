/**
 * Block terrain materials (TSL, so the same shader runs on the WebGPU and
 * WebGL2 backends). Chunk vertices carry everything the shading needs:
 *
 * - `uv` in block units (greedy quads span several blocks; the shader tiles
 *   the atlas cell with `fract`),
 * - `data` (uint8 × 4, normalised): atlas tile, ambient occlusion, sky light
 *   and block light at the vertex (smooth lighting is interpolated).
 *
 * Shading: albedo × AO × directional face shade (top 1, sides 0.8/0.64,
 * bottom 0.5: the classic block look, independent of the sun so caves stay
 * readable) × max(sky light × daylight × sky tint, block light × torch
 * tint). Mip levels come from the derivatives of the *unwrapped* block UVs
 * and are clamped to the last level that keeps atlas tiles apart, so there
 * are no seams at tile repeats and no colour bleeding in the distance. The
 * face orientation is taken from screen-space derivatives of the world
 * position (no normal attribute needed); its sign from the camera side,
 * which is exact for front faces.
 *
 * Fog is the terrain's own: a linear fade over the horizontal distance to
 * the streaming centre (`fogOrigin`: the player in play, the orbit target in
 * the editor; `fogNear` → `fogFar`), so terrain around the centre stays
 * crisp and the streamed square never shows an edge, combined with the
 * environment's exponential haze over the camera distance (`fogDensity`,
 * e.g. a misty or night world). The scene's `FogExp2` keeps fogging
 * everything else.
 *
 * Three materials share the uniforms: opaque cubes, alpha-cutout (leaves,
 * glass, plants; double-sided) and liquids (translucent, animated).
 */
import { Color, DoubleSide, FrontSide, Vector2, Vector3, type DataTexture } from 'three';
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import {
  abs, attribute, cameraPosition, clamp, cross, dFdx, dFdy, dot, exp, float, floor, fract, length, max, min, mix, mod, mx_noise_float, normalize, positionWorld, pow, reflect, select, sin, smoothstep, texture, time, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';

/** Tiles per atlas row. */
const TILES = 16;
/** Highest mip level that keeps 16-pixel tiles apart. */
const MAX_LOD = 4;
/** Atlas edge in pixels. */
const ATLAS_PX = 256;

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
}

/** The three terrain materials and their uniforms. */
export interface TerrainMaterials {
  opaque: MeshBasicNodeMaterial;
  cutout: MeshBasicNodeMaterial;
  liquid: MeshBasicNodeMaterial;
  uniforms: TerrainUniforms;
  dispose(): void;
}

/** Light level (0…1 of 15) → brightness, Minecraft-like 0.8^n falloff with a floor. */
function curve(level: Node<'float'>): Node<'float'> {
  return pow(float(0.8), float(1).sub(level).mul(15)).mul(0.96).add(0.04);
}

/** Build the terrain materials around a block atlas texture. */
export function createTerrainMaterials(atlas: DataTexture): TerrainMaterials {
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

  const build = (kind: 'opaque' | 'cutout' | 'liquid'): MeshBasicNodeMaterial => {
    const data = attribute('data', 'vec4');
    const tile = floor(data.x.mul(255).add(0.5));
    const cell = vec2(mod(tile, TILES), floor(tile.div(TILES)));
    let blockUv: Node<'vec2'> = uv();
    if (kind === 'liquid') blockUv = blockUv.add(vec2(time.mul(0.35), time.mul(0.18)));
    // Inside the cell, away from its edges by half a texel (nearest sampling never reaches the neighbour).
    const inset = 0.5 / TILES;
    const local = clamp(vec2(fract(blockUv.x), float(1).sub(fract(blockUv.y))), inset, 1 - inset);
    const atlasUv = cell.add(local).div(TILES);
    // Gradients of the unwrapped UVs, clamped to MAX_LOD (one tile per texel).
    const maxGrad = float((2 ** MAX_LOD) / ATLAS_PX);
    const gx = dFdx(blockUv).div(TILES);
    const gy = dFdy(blockUv).div(TILES);
    const gxs = gx.mul(min(float(1), maxGrad.div(max(length(gx), float(1e-6)))));
    const gys = gy.mul(min(float(1), maxGrad.div(max(length(gy), float(1e-6)))));
    const tex = texture(atlas, atlasUv).grad(gxs, gys);

    const ao = data.y.mul(0.5).add(0.5);
    const n = normalize(cross(dFdx(positionWorld), dFdy(positionWorld)));
    const toCam = cameraPosition.sub(positionWorld);
    const camDist = length(toCam);
    const view = toCam.div(max(camDist, float(1e-4)));
    // The outward normal of the face (derivatives give its direction, the camera side its sign).
    const nOut = select(dot(n, view).greaterThan(0), n, n.negate());
    const an = abs(nOut);
    const isY = an.y.greaterThan(max(an.x, an.z));
    const faceAmbient = select(isY, select(nOut.y.greaterThan(0), float(1), float(0.7)), select(an.x.greaterThan(an.z), float(0.9), float(0.82)));
    const sky = curve(data.z).mul(daylight);
    const torch = curve(data.w);
    // Sun: a warm directional light on the faces turned to it, only where the vertex sees the open sky (so caves,
    // overhangs and the lee of walls stay in the ambient light); the ambient light is the sky's own tint.
    const sunVisible = smoothstep(float(0.72), float(1), data.z);
    const diffuse = max(dot(nOut, sunDirection), float(0)).mul(sunVisible);
    const ambient = skyTint.mul(sky).mul(faceAmbient).mul(0.55);
    const direct = sunColor.mul(diffuse).mul(0.62);
    const torchLight = vec3(1.0, 0.86, 0.66).mul(torch);
    const light = max(ambient.add(direct), torchLight);

    // Texture relief: the atlas luminance's screen-space gradient lit from the upper left, fading with distance.
    const lum = dot(tex.rgb, vec3(0.3, 0.59, 0.11));
    const relief = clamp(dFdx(lum).mul(-0.7).add(dFdy(lum).mul(0.7)).mul(1.8), -0.16, 0.16).mul(float(1).sub(smoothstep(float(14), float(55), camDist)));
    // Block-to-block variation: a stable hash of the block the face belongs to.
    const blockPos = floor(positionWorld.sub(nOut.mul(0.5)));
    const h = fract(sin(dot(blockPos, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
    const variation = h.mul(0.12).add(0.94);
    const base = tex.rgb.mul(kind === 'liquid' ? float(1) : variation).mul(float(1).add(relief));
    const lit = base.mul(ao).mul(light);
    const flat = length(positionWorld.xz.sub(fogOrigin));
    const haze = float(1).sub(exp(fogDensity.mul(length(toCam)).pow(2).negate()));
    const fogged = clamp(max(smoothstep(fogNear, fogFar, flat), haze), 0, 1);
    let shaded: Node<'vec3'> = lit;
    let alpha: Node<'float'> = float(1);
    if (kind === 'liquid') {
      // Water: animated ripples tilt the surface; a fresnel term mirrors the sky at grazing angles, the sun glints.
      const p = positionWorld.xz;
      const wx = mx_noise_float(vec3(p.x.mul(0.9), p.y.mul(0.9), time.mul(0.45)));
      const wz = mx_noise_float(vec3(p.x.mul(0.9).add(31.7), p.y.mul(0.9).add(11.3), time.mul(0.4)));
      const nW = normalize(vec3(wx.mul(0.16), float(1), wz.mul(0.16)));
      const fres = pow(float(1).sub(max(dot(nW, view), float(0))), float(4)).mul(0.85).add(0.06);
      const mirror = fogColor.mul(float(0.55).add(daylight.mul(0.45)));
      const glint = pow(max(dot(reflect(sunDirection.negate(), nW), view), float(0)), float(120)).mul(daylight.mul(2.4));
      shaded = mix(lit, mirror, fres).add(sunColor.mul(glint));
      alpha = mix(liquidOpacity, float(0.96), fres);
    }
    const rgb = mix(shaded, fogColor, fogged);

    const m = new MeshBasicNodeMaterial();
    m.colorNode = vec4(rgb, float(1));
    // Fogged above (see the module comment); the scene fog would fog it twice.
    m.fog = false;
    if (kind === 'cutout') {
      m.opacityNode = tex.a;
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
    m.name = `aether:voxel-${kind}`;
    return m;
  };

  const opaque = build('opaque');
  const cutout = build('cutout');
  const liquid = build('liquid');
  return {
    opaque,
    cutout,
    liquid,
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
    },
    dispose() {
      opaque.dispose();
      cutout.dispose();
      liquid.dispose();
    },
  };
}
