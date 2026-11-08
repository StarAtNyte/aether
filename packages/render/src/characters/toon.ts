/**
 * Cel shading for toon bodies (cast entries with `style: 'toon'`): one body
 * material and one inverted-hull outline material, shared by every toon
 * person of a renderer, so the whole style costs two programs.
 *
 * The body is unlit like the baked world around it: the colour is the painted
 * atlas, banded by the sun direction into a lit tone (warmed by the sun's
 * colour) and a cool violet shadow tone, never grey or black; hair texels
 * coded as highlight show their light shape on the lit side only; eye texels
 * coded as unshaded keep their colour; a warm rim catches edges that face the
 * sun. Per-vertex `_toon` data (outline width, shade bias, rim strength) is
 * written by the body's build script.
 *
 * The outline pushes each vertex out along its (skinned) normal by a width
 * that grows only with the square root of the distance, so on screen lines
 * thin out with distance; its colour is a darker, more saturated shade of the
 * part under it.
 */
import { BackSide, Color, FrontSide, Mesh, Vector3, type Material, type MeshStandardMaterial, type Object3D, type Texture } from 'three';
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import { lodDitherMask } from './lod';
import { clothClearNode } from './cloth-clear';
import { attribute, cameraPosition, clamp, dot, float, length, max, mix, modelViewMatrix, normalize, normalLocal, normalWorld, positionLocal, positionWorld, pow, smoothstep, sqrt, texture, uniform, uv, vec3, vec4 } from 'three/tsl';

/** Atlas alpha at or below this is a hole (painted hair cards); the codes in use are 0.2 (unshaded), 0.6 (highlight), 1. */
export const CUT_CODE = 0.08;

/** Look constants of the toon style (linear colours). */
export const TOON_STYLE = {
  /** Shadow tone: a warm violet multiplier of the base colour (warm enough that chestnut hair stays chestnut in it). */
  shadow: new Color(0.7, 0.6, 0.78),
  /** Warm rim colour (added, linear). */
  rim: new Color(1.0, 0.62, 0.38),
  /** How much of the sun's hue warms the lit tone (0 = none). */
  sunWarmth: 0.28,
  /** Outline half-width (m) at 2.5 m from the camera. */
  outline: 0.0026,
  /** Outline colour factor (multiplies the base colour raised to 1.35). */
  line: new Color(0.42, 0.3, 0.42),
};

/** Shared uniforms of the toon materials. */
interface ToonUniforms {
  sunDir: { value: Vector3 };
  litTint: { value: Color };
  shadowTint: { value: Color };
  rim: { value: Color };
  exposure: { value: number };
  width: { value: number };
}

/** Is this a toon body's scene (scene extras written by the build carry `toon`)? */
export function isToonScene(scene: Object3D): boolean {
  return typeof scene.userData['toon'] === 'object' && scene.userData['toon'] !== null;
}

/** Owns the shared toon materials of one renderer. */
export class ToonShading {
  private readonly u: ToonUniforms = {
    sunDir: uniform(new Vector3(0.35, 0.75, 0.55).normalize()) as unknown as { value: Vector3 },
    litTint: uniform(new Color(1, 1, 1)) as unknown as { value: Color },
    shadowTint: uniform(TOON_STYLE.shadow.clone()) as unknown as { value: Color },
    rim: uniform(TOON_STYLE.rim.clone()) as unknown as { value: Color },
    exposure: uniform(1) as unknown as { value: number },
    width: uniform(TOON_STYLE.outline) as unknown as { value: number },
  };
  /** Body and outline materials by atlas texture (one pair per toon body file). */
  private readonly pairs = new Map<Texture, { body: MeshBasicNodeMaterial; outline: MeshBasicNodeMaterial }>();

  /**
   * Set the light: `dir` points toward the sun (world), `color` its linear colour (any intensity: only the hue is used).
   * A sun below the horizon falls back to a soft light from above and in front.
   */
  setLight(dir: Vector3 | null, color: Color | null): void {
    const d = this.u.sunDir.value;
    if (dir && dir.lengthSq() > 1e-8) {
      d.copy(dir).normalize();
      // A sun on the horizon still models the body from slightly above.
      if (d.y < 0.12) d.y = 0.12;
      d.normalize();
    } else d.set(0.35, 0.75, 0.55).normalize();
    const t = this.u.litTint.value;
    if (color) {
      const m = Math.max(color.r, color.g, color.b, 1e-6);
      const w = TOON_STYLE.sunWarmth;
      t.setRGB(1 - w + (w * color.r) / m, 1 - w + (w * color.g) / m, 1 - w + (w * color.b) / m);
      // Keep the lit tone's brightness at 1 (the hue warms it; it never dims the body).
      const lum = 0.2126 * t.r + 0.7152 * t.g + 0.0722 * t.b;
      t.multiplyScalar(1 / Math.max(0.5, lum));
    } else t.setRGB(1, 1, 1);
  }

  /** Brightness of the whole toon body (1 = the atlas colour where lit). */
  setExposure(v: number): void {
    this.u.exposure.value = v;
  }

  /** Swap a toon body scene's materials for the shared toon pair (by the source material's `toon` extras). */
  apply(scene: Object3D): void {
    scene.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const src = o.material as Material;
      const kind = (src.userData as { toon?: string }).toon;
      const map = (src as MeshStandardMaterial).map;
      if (!map || (kind !== 'body' && kind !== 'outline')) return;
      const pair = this.pairFor(map);
      o.material = kind === 'body' ? pair.body : pair.outline;
      if (kind === 'outline') {
        o.castShadow = false;
        o.receiveShadow = false;
        o.userData['toonOutline'] = true;
      }
    });
  }

  private pairFor(map: Texture): { body: MeshBasicNodeMaterial; outline: MeshBasicNodeMaterial } {
    let pair = this.pairs.get(map);
    if (!pair) {
      // Oblique faces (a three-quarter view of the eyes) keep their lines through the mips.
      map.anisotropy = Math.max(map.anisotropy, 8);
      pair = { body: this.bodyMaterial(map), outline: this.outlineMaterial(map) };
      this.pairs.set(map, pair);
    }
    return pair;
  }

  private bodyMaterial(map: Texture): MeshBasicNodeMaterial {
    const u = this.u;
    const m = new MeshBasicNodeMaterial();
    m.name = 'toon-body';
    m.side = FrontSide;
    const tex = texture(map, uv());
    const base = tex.rgb;
    const code = tex.a;
    // Painted hair cards and strands are alpha-cut: code 0 is a hole (the shapes of the tips are in the texture).
    const keep = code.greaterThan(CUT_CODE);
    const info = attribute('_toon', 'vec4') as unknown as Node<'vec4'>;
    // Cloth (`_toon.w`) clears the legs of the pose being drawn (cloth-clear.ts).
    m.positionNode = clothClearNode(positionLocal as unknown as Node, info.w as unknown as Node) as unknown as Node;
    // (not in the sun's map: a few millimetres of cloth do not show in a shadow, and the depth pass keeps the program
    // every skinned body shares instead of one more, linked when a far body first casts mid-film)
    m.castShadowPositionNode = positionLocal as unknown as Node;
    const n = normalize(normalWorld);
    const l = u.sunDir as unknown as Node<'vec3'>;
    const ndl = dot(n, l).add(info.y);
    // Two tones with a crisp, anti-aliased terminator.
    const lit = smoothstep(float(-0.02), float(0.04), ndl);
    const unshaded = smoothstep(float(0.45), float(0.25), code);
    const highlight = smoothstep(float(0.75), float(0.66), code).mul(smoothstep(float(0.4), float(0.52), code));
    const litTint = u.litTint as unknown as Node<'color'>;
    const shadowTint = u.shadowTint as unknown as Node<'color'>;
    const litCol = base.mul(litTint);
    // Highlight texels are the light shape: in shadow they fall back to the hair's own tone.
    const shadowBase = mix(base, base.mul(0.62), highlight);
    const shadowCol = shadowBase.mul(shadowTint);
    let col = mix(shadowCol, litCol, lit);
    // Eyes keep their colour (a slight dim in shadow).
    col = mix(col, base.mul(mix(float(0.86), float(1), lit)), unshaded);
    // Warm rim on edges facing the sun.
    const v = normalize((cameraPosition as unknown as Node<'vec3'>).sub(positionWorld));
    const fres = float(1).sub(clamp(dot(n, v), 0, 1));
    const rimSide = smoothstep(float(-0.15), float(0.35), dot(n, l));
    const rim = smoothstep(float(0.6), float(0.67), fres).mul(rimSide).mul(info.z).mul(float(1).sub(unshaded));
    col = mix(col, litCol.mul(1.12).add((u.rim as unknown as Node<'color'>).mul(0.22)), rim.mul(0.8));
    m.colorNode = vec4(col.mul(u.exposure as unknown as Node<"float">), 1) as unknown as Node<"vec4">;
    // Cross-fade between a body's levels of detail (a per-object dither; 0 keeps every pixel).
    m.maskNode = (lodDitherMask() as unknown as Node<'bool'>).and(keep) as unknown as Node<'bool'>;
    // (the sun's map cuts the same holes: a hair card's tips are shapes, not a rectangle)
    m.maskShadowNode = keep as unknown as Node<'bool'>;
    return m;
  }

  private outlineMaterial(map: Texture): MeshBasicNodeMaterial {
    const u = this.u;
    const m = new MeshBasicNodeMaterial();
    m.name = 'toon-outline';
    m.side = BackSide;
    const info = attribute('_toon', 'vec4') as unknown as Node<'vec4'>;
    const pl = clothClearNode(positionLocal as unknown as Node, info.w as unknown as Node) as unknown as typeof positionLocal;
    const view = modelViewMatrix.mul(vec4(pl, 1)).xyz;
    const dist = max(length(view), float(0.05));
    // World width ∝ √distance: lines thin out on screen as she walks away, and stay fine in a close-up.
    const width = (u.width as unknown as Node<'float'>).mul(info.x).mul(clamp(sqrt(dist.div(2.5)), 0.45, 2.2));
    m.positionNode = pl.add(normalize(normalLocal).mul(width)) as unknown as Node;
    const tx = texture(map, uv());
    const base = tx.rgb;
    const line = vec3(TOON_STYLE.line.r, TOON_STYLE.line.g, TOON_STYLE.line.b);
    const col = pow(base, vec3(1.35, 1.35, 1.35)).mul(line).mul(u.litTint as unknown as Node<'color'>);
    m.colorNode = vec4(col.mul(u.exposure as unknown as Node<"float">), 1) as unknown as Node<"vec4">;
    // (a hair card's hull is cut like the card: no outline in its holes; the card's edge line is painted in its texture)
    m.maskNode = (lodDitherMask() as unknown as Node<'bool'>).and(tx.a.greaterThan(CUT_CODE)) as unknown as Node<'bool'>;
    return m;
  }

  /** The shared materials (diagnostics: program count, tests). */
  get materials(): Material[] {
    return [...this.pairs.values()].flatMap((p) => [p.body, p.outline]);
  }

  dispose(): void {
    for (const p of this.pairs.values()) {
      p.body.dispose();
      p.outline.dispose();
    }
    this.pairs.clear();
  }
}
