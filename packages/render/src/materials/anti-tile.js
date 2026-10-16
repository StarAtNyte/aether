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
import { float, materialColor, materialRoughness, mix, mx_noise_float, normalMap, positionWorld, smoothstep, texture, uniform, uv, vec2, vec4 } from 'three/tsl';
/** The second lookup's rotation (radians), scale and offset in tile units. */
export const ANTI_TILE = Object.freeze({ rotation: 0.6435, scale: 0.77, offset: [0.31, 0.17] });
/** Noise values between which the second lookup takes over: a seam about a metre wide. */
export const SEAM = Object.freeze([0.47, 0.53]);
/** World-space size (metres) of the blend noise: patches several metres wide, so single tiles never read as repeats. */
export const BLEND_NOISE_SCALE = 0.07;
/**
 * Finishes with an isotropic, noise-like structure (ground, concrete, plaster, rock, bark): a second
 * lookup breaks their repeat without trace. Patterned finishes (planks, brick, tiles, paving, veined
 * marble) are left out: their pattern *is* the repeat, and two shifted copies of it only ghost.
 */
export const ANTI_TILE_FINISHES = new Set(['concrete', 'plaster', 'terrazzo', 'grass', 'gravel', 'soil', 'sand', 'snow', 'rock', 'bark', 'asphalt', 'carpet']);
/** Whether `finish` (whose tile is `tileMetres` wide) benefits from anti-tiling (small tiles repeat too finely to show). */
export function needsAntiTile(finish, tileMetres) {
    return ANTI_TILE_FINISHES.has(finish) && Number.isFinite(tileMetres) && tileMetres >= 0.9;
}
/** `userData` key holding the {@link AntiTileMaps} of a material whose maps are sampled by nodes. */
export const FINISH_MAPS_KEY = 'aetherFinishMaps';
/** Marks a finish material whose maps are sampled by nodes (see {@link applyAntiTile}): its colour factors still carry the finish scale. */
export const FINISH_NODES_KEY = 'aetherFinish';
/**
 * Attach the anti-tiled nodes of `maps` to `material` (a classic material the node renderer converts).
 * `normalStrength` is the normal map's scale (0 skips the normal blend). The material must not bind
 * the maps itself (`map`, `roughnessMap`, `aoMap`, `normalMap`): the nodes replace them.
 */
export function applyAntiTile(material, maps, normalStrength) {
    const repeat = uniform(maps.map.repeat);
    const base = uv().mul(repeat);
    const c = Math.cos(ANTI_TILE.rotation);
    const s = Math.sin(ANTI_TILE.rotation);
    const centred = base.sub(vec2(0.5, 0.5));
    const rotated = vec2(centred.x.mul(c).sub(centred.y.mul(s)), centred.x.mul(s).add(centred.y.mul(c)));
    const second = rotated.mul(ANTI_TILE.scale).add(vec2(0.5 + ANTI_TILE.offset[0], 0.5 + ANTI_TILE.offset[1]));
    // Noise in [0, 1], thresholded so a surface shows ONE lookup almost everywhere and the two meet in a
    // narrow soft seam: an even mix of two unrelated crops would wash the texture out to its average.
    const n = mx_noise_float(positionWorld.mul(BLEND_NOISE_SCALE)).mul(0.5).add(0.5);
    const w = smoothstep(float(SEAM[0]), float(SEAM[1]), n);
    const blend = (tex) => mix(texture(tex, base), texture(tex, second), w);
    const albedo = blend(maps.map);
    const orm = blend(maps.orm);
    // Exporters (glTF, path tracing) read classic maps: keep the textures reachable for them.
    material.userData[FINISH_MAPS_KEY] = maps;
    const m = material;
    // The classic maps are not bound on this material (the nodes sample the textures), so the stock colour
    // and roughness accessors give the plain factors the lookups multiply.
    m.colorNode = vec4(materialColor.rgb.mul(albedo.rgb), 1);
    m.roughnessNode = materialRoughness.mul(orm.g);
    m.aoNode = orm.r;
    if (normalStrength > 0)
        m.normalNode = normalMap(blend(maps.normal), vec2(normalStrength, normalStrength));
}
