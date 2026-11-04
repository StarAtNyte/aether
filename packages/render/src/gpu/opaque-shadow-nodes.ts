/**
 * Opaque casters share one shadow-pass program.
 *
 * three.js (r186, Renderer._getShadowNodes) gives the shadow override material an alpha expression for every caster
 * whose material has a colour map or a colour node: `vec4(0, map.a * colorNode.a)`, sampling that material's own
 * texture. The expression differs per material, so every textured material compiled a shadow program of its own
 * (79 of the 151 builds a change of tier made on a hillside town), though for an opaque caster the alpha can change
 * nothing: the depth pass only discards against `alphaTest` and only transmits colour when `shadowMap.transmitted`.
 * For those casters the alpha expression is dropped and the override's plain depth is used.
 */
interface ShadowMaterialLike {
  alphaTest?: number;
  alphaMap?: unknown;
  transparent?: boolean;
  alphaHash?: boolean;
  alphaToCoverage?: boolean;
  transmission?: number;
  castShadowNode?: unknown;
  maskNode?: unknown;
  maskShadowNode?: unknown;
}

interface ShadowNodes {
  colorNode: unknown;
  depthNode: unknown;
  positionNode: unknown;
}

/** Whether a caster's alpha can matter in the sun's depth pass. */
export function shadowAlphaMatters(m: ShadowMaterialLike, transmitted: boolean): boolean {
  return transmitted || (m.alphaTest ?? 0) > 0 || !!m.alphaMap || m.transparent === true || m.alphaHash === true || m.alphaToCoverage === true || (m.transmission ?? 0) > 0 || !!m.castShadowNode || !!m.maskNode || !!m.maskShadowNode;
}

export function shareOpaqueShadowPrograms(r: unknown): void {
  const rr = r as { _getShadowNodes?: (m: ShadowMaterialLike) => ShadowNodes; shadowMap?: { transmitted?: boolean }; __aetherOpaqueShadows?: boolean };
  const get = rr._getShadowNodes;
  if (typeof get !== 'function' || rr.__aetherOpaqueShadows) return;
  rr.__aetherOpaqueShadows = true;
  rr._getShadowNodes = function (this: typeof rr, material: ShadowMaterialLike): ShadowNodes {
    const nodes = get.call(this, material);
    if (shadowAlphaMatters(material, this.shadowMap?.transmitted === true)) return nodes;
    return { colorNode: null, depthNode: nodes.depthNode, positionNode: nodes.positionNode };
  };
}
