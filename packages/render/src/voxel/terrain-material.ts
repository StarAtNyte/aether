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
 * Three materials share the uniforms: opaque cubes, alpha-cutout (leaves,
 * glass, plants; double-sided) and liquids (translucent, animated).
 */
import { Color, DoubleSide, FrontSide, type DataTexture } from 'three';
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import {
  abs, attribute, cameraPosition, clamp, cross, dFdx, dFdy, float, floor, fract, length, max, min, mix, mod, normalize, positionWorld, pow, select, texture, time, uniform, uv, vec2, vec3, vec4,
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
    const an = abs(n);
    const toCam = cameraPosition.sub(positionWorld);
    const isY = an.y.greaterThan(max(an.x, an.z));
    const isX = an.x.greaterThan(an.z);
    const shade = select(isY, select(toCam.y.greaterThan(0), float(1), float(0.5)), select(isX, float(0.8), float(0.64)));
    const sky = curve(data.z).mul(daylight);
    const torch = curve(data.w);
    const light = max(skyTint.mul(sky), vec3(1.0, 0.86, 0.66).mul(torch));
    const rgb = tex.rgb.mul(ao).mul(kind === 'cutout' ? mix(shade, float(1), float(0.35)) : shade).mul(light);

    const m = new MeshBasicNodeMaterial();
    m.colorNode = vec4(rgb, float(1));
    m.fog = true;
    if (kind === 'cutout') {
      m.opacityNode = tex.a;
      m.alphaTest = 0.5;
      m.side = DoubleSide;
    } else if (kind === 'liquid') {
      m.transparent = true;
      m.opacityNode = liquidOpacity;
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
    uniforms: { daylight, skyTint: skyTint as unknown as TerrainUniforms['skyTint'], liquidOpacity },
    dispose() {
      opaque.dispose();
      cutout.dispose();
      liquid.dispose();
    },
  };
}
