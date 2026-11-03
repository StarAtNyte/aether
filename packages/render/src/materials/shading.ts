/**
 * Attaches `material.surface` layers and `material.shader` expressions to a classic material as nodes, on top of
 * whatever the finish, splat or anti-tile setup already put there (their nodes are the base the layers weather).
 *
 * Everything is built first and assigned last, so a failure leaves the plain material untouched (the cache logs it and
 * draws the plain look).
 */
import type { MeshStandardMaterial } from 'three';
import { stableStringify } from '@aether/core';
import { T, type Nd } from './tsl-lite';
import { staticShadowAlpha } from '../gpu/shadow-alpha';
import type { ResolvedMaterial } from './presets';
import { bumpNormal, compileChannel, curvatureNode, hashNode, type ShadeInputs, type ShadeTier } from './shader-nodes';
import { surfaceNodes } from './surface-layers';

export type ShaderBudget = 'normal' | 'hero';

/** Distinct shaded programs (surface / shader combinations) a renderer compiles per tier; more draw as their plain material. */
export const SHADED_CAP_LOW = 8;
export const SHADED_CAP_MEDIUM = 24;
export const SHADED_CAP_HIGH = 48;
export const SHADED_CAP_ULTRA = 96;
/** The floor of the halved cap of an ordinary world. */
export const SHADED_CAP_MIN = 8;

/** The cap for a tier: the full tier cap for a `hero` world (refined art), half of it (at least {@link SHADED_CAP_MIN}) otherwise. */
export function shadedCap(tier: ShadeTier, budget: ShaderBudget = 'normal'): number {
  const full = tier === 'low' ? SHADED_CAP_LOW : tier === 'medium' ? SHADED_CAP_MEDIUM : tier === 'high' ? SHADED_CAP_HIGH : SHADED_CAP_ULTRA;
  return budget === 'hero' ? full : Math.max(SHADED_CAP_MIN, Math.floor(full / 2));
}

/** The identity of a material's shading program (null for plain materials). */
export function shadeKey(r: ResolvedMaterial): string | null {
  if (!r.layers && !r.shader) return null;
  return stableStringify({ layers: r.layers ?? null, shader: r.shader ?? null });
}

type NodeSlots = {
  colorNode?: Nd | null;
  roughnessNode?: Nd | null;
  metalnessNode?: Nd | null;
  emissiveNode?: Nd | null;
  normalNode?: Nd | null;
  opacityNode?: Nd | null;
  positionNode?: Nd | null;
};

/** The origin of the object in the world, hashed: a per-object random 0..1 (all instances of one scatter share it). */
function seedNode(): Nd {
  const origin = T.modelWorldMatrix.mul(T.vec4(0, 0, 0, 1)).xyz;
  return hashNode(origin.mul(0.731).add(T.vec3(0.13, 0.29, 0.41)), 3);
}

function fragmentInputs(base: Nd): ShadeInputs {
  const p = T.positionWorld;
  return {
    p,
    o: T.positionGeometry,
    n: T.normalWorldGeometry,
    uv: T.uv(),
    t: T.time,
    v: T.normalize(T.cameraPosition.sub(p)),
    seed: seedNode(),
    base,
    vcol: T.vertexColor().rgb,
    pi: T.float(Math.PI),
  };
}

function vertexInputs(): ShadeInputs {
  // In the position stage the local position already carries instancing; the world one is derived from it.
  const local = T.positionLocal;
  const p = T.modelWorldMatrix.mul(T.vec4(local, 1)).xyz;
  return {
    p,
    o: T.positionGeometry,
    n: T.normalize(T.modelWorldMatrix.mul(T.vec4(T.normalLocal, 0)).xyz),
    uv: T.uv(),
    t: T.time,
    v: T.normalize(T.cameraPosition.sub(p)),
    seed: seedNode(),
    base: T.materialColor.rgb,
    vcol: T.vertexColor().rgb,
    pi: T.float(Math.PI),
  };
}

/**
 * Build and attach the shading of `r` (layers, then expressions) at `tier`. Throws on a bad expression before
 * touching the material.
 */
export function applyShading(m: MeshStandardMaterial, r: ResolvedMaterial, tier: ShadeTier): void {
  const slots = m as unknown as NodeSlots;
  const sh = r.shader ?? {};
  const low = tier === 'low';
  const recolours = r.layers !== undefined || sh.color !== undefined;
  // Vertex colours are folded into the base here, so a layer (snow, moss) or an expression colour is not tinted by them afterwards.
  const foldVertex = recolours && m.vertexColors;
  const colorIn = T.vec4(slots.colorNode ?? T.materialColor);
  const rgbIn = foldVertex ? colorIn.rgb.mul(T.vertexColor().rgb) : colorIn.rgb;
  let color = rgbIn;
  let rough = slots.roughnessNode ?? T.materialRoughness;
  let metal = slots.metalnessNode ?? T.materialMetalness;
  let emissive: Nd | null = null;
  let height: Nd | null = null;
  let touchedRough = false;
  let touchedMetal = false;

  if (r.layers) {
    const p = T.positionWorld;
    const n = T.normalWorldGeometry;
    const res = surfaceNodes(
      r.layers,
      { p, n, oy: T.positionGeometry.y, v: T.normalize(T.cameraPosition.sub(p)), k: curvatureNode(n, p), t: T.time },
      { color, roughness: rough, metalness: metal },
      tier,
    );
    color = res.color;
    rough = res.roughness;
    metal = res.metalness;
    emissive = res.emissive;
    height = low ? null : res.height;
    touchedRough = touchedMetal = true;
  }

  const frag = fragmentInputs(color);
  if (sh.color) color = compileChannel('color', sh.color, frag, tier);
  if (sh.emissive) {
    const e = compileChannel('emissive', sh.emissive, frag, tier);
    emissive = emissive ? emissive.add(e) : e;
  }
  let opacity: Nd | null = null;
  let position: Nd | null = null;
  if (!low) {
    if (sh.roughness) {
      rough = compileChannel('roughness', sh.roughness, frag, tier);
      touchedRough = true;
    }
    if (sh.metalness) {
      metal = compileChannel('metalness', sh.metalness, frag, tier);
      touchedMetal = true;
    }
    if (sh.bump) {
      const b = compileChannel('bump', sh.bump, frag, tier);
      height = height ? height.add(b) : b;
    }
    if (sh.opacity) opacity = T.clamp(compileChannel('opacity', sh.opacity, frag, tier), 0, 1);
    if (sh.displace) {
      const d = compileChannel('displace', sh.displace, vertexInputs(), tier);
      position = (slots.positionNode ?? T.positionLocal).add(T.normalize(T.normalLocal).mul(d));
    }
  }

  // Assign last: everything above may throw.
  // The renderer keys a compiled program by the classic material, where node slots count only as "an object": two
  // shaded materials with the same slots would share whichever program compiled first (an olive crate with scratches
  // drew with a drum's rust). The layers and expressions are baked into the program as constants, so they, the tier
  // and the vertex-colour fold name it, on top of any key the finish setup gave (anti-tile).
  const prior = m.customProgramCacheKey.bind(m);
  const own = `aether-shade:${tier}:${foldVertex ? 1 : 0}:${shadeKey(r) ?? ''}`;
  m.customProgramCacheKey = () => `${prior()}|${own}`;
  if (recolours) slots.colorNode = staticShadowAlpha(T.vec4(color, colorIn.a));
  if (foldVertex) m.vertexColors = false;
  if (touchedRough) slots.roughnessNode = T.clamp(rough, 0.02, 1);
  if (touchedMetal) slots.metalnessNode = T.clamp(metal, 0, 1);
  if (emissive) slots.emissiveNode = (slots.emissiveNode ?? T.materialEmissive).add(emissive);
  if (height) slots.normalNode = bumpNormal(slots.normalNode ?? T.materialNormal, height);
  if (opacity) {
    slots.opacityNode = opacity;
    m.transparent = true;
    m.depthWrite = false;
  }
  if (position) slots.positionNode = position;
  m.userData['aetherShaded'] = tier;
  m.needsUpdate = true;
}
