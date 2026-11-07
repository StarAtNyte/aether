/**
 * Light node of a {@link LightVolume}: for every lit node material, read the baked volume at the surface
 * (half a probe spacing out along the normal, so a wall reads the room it faces, not the probes behind it),
 * evaluate sky visibility and bounce for the surface normal and
 *
 * - multiply the lighting context's ambient occlusion by the visibility (the sky hemisphere, the image light
 *   and its reflections reach a room only through its windows),
 * - add the bounce irradiance, divided by that same visibility so the occlusion does not darken it twice
 *   (screen-space AO still applies to it, as it should), and its mean radiance to the reflections.
 *
 * Probes that do not see the shaded point (a wall between them, from their baked free distances) are left out of the
 * interpolation, so light does not leak through thin walls, slabs and door frames. Outside the volume's box the effect
 * fades out over {@link LightVolume.fade}. Eight unfiltered and four filtered reads of one 3D texture and some ALU per
 * fragment; the same code runs on WebGPU and WebGL2.
 */
import { Vector3, Vector4 } from 'three';
import * as TSL from 'three/tsl';
import { AnalyticLightNode, type NodeBuilder } from 'three/webgpu';
import { T, type Nd } from '../materials/tsl-lite';
import { LIGHTMAP_ATTRIBUTE, LightVolume } from '../environment/light-volume-light';
import { ATLAS_SUBVOLUMES, FREE_SLACK, FREE_STEPS } from '../environment/light-volume';
import { LOG_STOPS, VIS_BASE, VIS_SPAN } from '../environment/lightmap';
import { LAYER_CHROMA, LAYER_LAMP, LAYER_SKY0, LAYER_SKY1, LUM } from '../environment/relight';

interface LightingContext {
  irradiance: Nd;
  radiance: Nd;
  ambientOcclusion: Nd;
}

/** `Loop(count, body)` of three's TSL with the loop index passed to `body`. */
const LOOP = (count: number, body: (i: Nd) => void): void => {
  (TSL as unknown as { Loop(n: number, f: (o: { i: Nd }) => void): void }).Loop(count, ({ i }) => body(i));
};

/** The node the renderer creates for each {@link LightVolume} (register with `renderer.library.addLight`). */
export class LightVolumeNode extends AnalyticLightNode<LightVolume> {
  static get type(): string {
    return 'LightVolumeNode';
  }

  private readonly vMin = new Vector3();
  private readonly vExtent = new Vector3(1, 1, 1);
  private readonly vRes = new Vector3(2, 2, 2);
  private readonly vAlloc = new Vector3(2, 2, 2);
  /** spacing, fade, visibility floor, strength. */
  private readonly vParams = new Vector4(1, 1, 0.05, 0);
  /** Lightmap: strength. */
  private readonly vMap = new Vector4(0, 0, 0, 0);
  /** Lightmap part weights (rgb: live weight × stored scale; w of the sun keys: their layer), copied from the light. */
  private readonly vSky0 = new Vector4();
  private readonly vSky1 = new Vector4();
  private readonly vLamp = new Vector4();
  private readonly vSun = new Vector4();
  private readonly vKeyA = new Vector4();
  private readonly vKeyB = new Vector4();
  private readonly vSelA = new Vector4();
  private readonly vSelB = new Vector4();
  /** The lightmap texture node: a new allocation (another atlas size or part count) is swapped in without a new program. */
  private lmTex: Nd | null = null;

  constructor(light: LightVolume | null = null) {
    super(light);
  }

  override update(): undefined {
    const l = this.light;
    if (!l) return undefined;
    this.vMin.copy(l.gridMin);
    this.vExtent.copy(l.gridExtent);
    this.vRes.copy(l.gridResolution);
    this.vAlloc.copy(l.allocResolution);
    this.vParams.set(l.spacing, Math.max(0.01, l.fade), Math.max(0.005, l.visFloor), l.visible ? l.strength * l.intensity : 0);
    this.vMap.set(l.visible ? l.lightmapStrength * l.intensity : 0, 0, 0, 0);
    this.vSky0.copy(l.lmSky0);
    this.vSky1.copy(l.lmSky1);
    this.vLamp.copy(l.lmLamp);
    this.vSun.copy(l.lmSun);
    this.vKeyA.copy(l.lmKeyA);
    this.vKeyB.copy(l.lmKeyB);
    this.vSelA.copy(l.lmSelA);
    this.vSelB.copy(l.lmSelB);
    const tex = this.lmTex as unknown as { value: unknown } | null;
    if (tex && l.lightmap && tex.value !== l.lightmap) tex.value = l.lightmap;
    return undefined;
  }

  override setup(builder: NodeBuilder): undefined {
    const light = this.light;
    if (!light) return undefined;
    const ctx = builder.context as unknown as LightingContext;
    // A mesh with baked lightmap coordinates reads its texels instead of the probes: the baked surface detail (corners, the floor
    // under furniture) the probes cannot hold. The lightmap is re-lightable (`relight.ts`): its layers are weighted by uniforms,
    // so a change of the hour, the sky or the lamps changes numbers, never the program. Four to five filtered reads of one array
    // texture (the sky's two parts; by day the sun keys' chroma and the one or two keys around the sun; at night the lamps and
    // the moon's key), against twelve reads of the 3D volume. Meshes without coordinates keep the volume.
    if (light.lightmap && (builder as unknown as { hasGeometryAttribute(name: string): boolean }).hasGeometryAttribute(LIGHTMAP_ATTRIBUTE)) {
      const uMap = T.uniform(this.vMap);
      const uParamsLm = T.uniform(this.vParams);
      const uSky0 = T.uniform(this.vSky0);
      const uSky1 = T.uniform(this.vSky1);
      const uLamp = T.uniform(this.vLamp);
      const uSun = T.uniform(this.vSun);
      const uKeyA = T.uniform(this.vKeyA);
      const uKeyB = T.uniform(this.vKeyB);
      const uSelA = T.uniform(this.vSelA);
      const uSelB = T.uniform(this.vSelB);
      const uv = T.attribute(LIGHTMAP_ATTRIBUTE, 'vec2').toVar();
      // One texture node for every material this light serves (the reads derive from it), so a new allocation reaches them all.
      const tex = (this.lmTex ??= T.texture(light.lightmap));
      // Explicit level: the atlas has no mips, and the reads of the lamp and sun layers sit in (uniform) branches.
      const layer = (k: Nd | number): Nd => tex.sample(uv).depth(T.int(k)).level(0);
      const s0 = layer(LAYER_SKY0);
      // Alpha is the stored visibility, offset so that "no data" (0) survives a lossy image (see `encodeVis`).
      const has = T.step(VIS_BASE / 2 / 255, s0.a);
      const wm = has.mul(uMap.x);
      const vis = T.mix(T.float(1), T.clamp(s0.a.sub(VIS_BASE / 255).mul(255 / VIS_SPAN), 0, 1), wm);
      const visC = T.max(vis, uParamsLm.z);
      // Sky: the constant part (sqrt-coded) and the signed gradient part (128 is zero, see `encodePart`).
      const g = layer(LAYER_SKY1).rgb.mul(255 / 127).sub(128 / 127);
      // Unsigned parts are logarithmic over LOG_STOPS stops of their scale, 0 for none (`encodePart`).
      const dec = (c: Nd): Nd => T.exp2(c.sub(1).mul(LOG_STOPS)).mul(T.step(0.5 / 255, c));
      const bounce = dec(s0.rgb).mul(uSky0.xyz).add(g.mul(T.abs(g)).mul(uSky1.xyz)).toVar();
      T.If(T.dot(uLamp.xyz, T.vec3(1)).greaterThan(0), () => {
        const c = layer(LAYER_LAMP).rgb;
        bounce.addAssign(dec(c).mul(uLamp.xyz));
      });
      // Sun: the two keys around it (their luminance, sqrt-coded, one channel of a layer each) coloured by the keys' shared
      // chroma and the sun's own irradiance.
      T.If(T.dot(uSun.xyz, T.vec3(1)).greaterThan(0), () => {
        const ch = layer(LAYER_CHROMA).rgb;
        const chN = ch.div(T.max(T.dot(ch, T.vec3(LUM[0], LUM[1], LUM[2])), 1e-3));
        const a = T.dot(layer(uKeyA.w).rgb, uSelA.xyz);
        const lum = dec(a).mul(uKeyA.x).toVar();
        T.If(uKeyB.x.greaterThan(0), () => {
          const b = T.dot(layer(uKeyB.w).rgb, uSelB.xyz);
          lum.addAssign(dec(b).mul(uKeyB.x));
        });
        bounce.addAssign(chN.mul(lum).mul(uSun.xyz));
      });
      const b = T.max(bounce, 0).mul(wm);
      ctx.ambientOcclusion.mulAssign(visC);
      ctx.irradiance.addAssign(b.div(visC));
      ctx.radiance.addAssign(b.div(visC).mul(1 / Math.PI));
      return undefined;
    }
    const uMin = T.uniform(this.vMin);
    const uExtent = T.uniform(this.vExtent);
    const uRes = T.uniform(this.vRes);
    const uAlloc = T.uniform(this.vAlloc);
    const uParams = T.uniform(this.vParams);
    // Copies made before the branch: a shared node (the world normal and position) is declared where it is first built, which
    // inside a branch would leave it undeclared for every other user of it on the pixels that skip the branch.
    const n = T.normalWorld.toVar();
    const pw = T.positionWorld.toVar();
    const hi = uMin.add(uExtent);
    const outside = T.max(uMin.sub(pw), 0).add(T.max(pw.sub(hi), 0)).length();
    // Past the fade distance the volume contributes nothing, and most of a scene's pixels (a lawn or plaza around a room) are
    // there: skip the twelve reads and the arithmetic for them. The reads inside carry an explicit level (the volume has no
    // mip chain), which is also what keeps them legal in the non-uniform branch on WebGPU.
    const inside = outside.lessThan(uParams.y).and(uParams.w.greaterThan(0));
    // The branch writes to variables declared before it (the lighting context's own variables are first built where they are
    // first used, which inside a branch would leave them undeclared, and uninitialised, on the other side).
    const occlusion = T.float(1).toVar();
    const ambient = T.vec3(0).toVar();
    T.If(inside, () => {
      const p = pw.add(n.mul(uParams.x.mul(0.5)));
      // Probe coordinates (texel centres of the allocated atlas; the grid uses its low corner).
      const f = T.clamp(p.sub(uMin).div(uExtent), 0, 1).mul(uRes.sub(1));
      const slab = uAlloc.z.add(2);
      const depth = slab.mul(ATLAS_SUBVOLUMES);
      const tex = T.texture3D(light.texture);
      // Leak test: of the eight probes around the point, only those that see it (no wall between them along an axis,
      // from each probe's baked free distances) count; the filtered reads then go to the point whose trilinear weights
      // match those (per axis), so a wall's room side never mixes in the probes behind it (outside, the next room,
      // under the slab). Eight unfiltered reads at texel centres plus the four filtered ones.
      const base = T.min(T.floor(f), uRes.sub(2));
      const t = f.sub(base);
      const geomZ = slab.mul(4).add(1.5);
      const free = (code: Nd): Nd => T.mix(code.div(FREE_STEPS), T.float(2), T.step(FREE_STEPS - 0.5, code));
      const sees = (d: Nd, minus: Nd, plus: Nd): Nd => T.clamp(T.mix(minus, plus, T.step(0, d)).sub(T.abs(d)).mul(20), 0, 1);
      const wsum = T.float(0).toVar();
      const wx = T.float(0).toVar();
      const wy = T.float(0).toVar();
      const wz = T.float(0).toVar();
      // The eight probes are a loop, not eight copies: each copy is about a hundred lines of shader, and every lit program
      // without baked light coordinates carries this node (the unrolled form was a third of such a program's source).
      LOOP(8, (i: Nd) => {
        const cx = T.float(i.bitAnd(1));
        const cy = T.float(i.shiftRight(1).bitAnd(1));
        const cz = T.float(i.shiftRight(2).bitAnd(1));
        const corner = base.add(T.vec3(cx, cy, cz));
        const g = tex.sample(T.vec3(corner.x.add(0.5).div(uAlloc.x), corner.y.add(0.5).div(uAlloc.y), corner.z.add(geomZ).div(depth))).level(0);
        const a = T.floor(g.x.add(0.5));
        const b = T.floor(g.y.add(0.5));
        const a8 = T.floor(a.div(8));
        const b8 = T.floor(b.div(8));
        const xm = free(a.sub(a8.mul(8)));
        const xp = free(a8.sub(T.floor(a8.div(8)).mul(8)));
        const ym = free(T.floor(a.div(64)));
        const yp = free(b.sub(b8.mul(8)));
        const zm = free(b8.sub(T.floor(b8.div(8)).mul(8)));
        const zp = free(T.floor(b.div(64)));
        const pick = (tc: Nd, c: Nd): Nd => T.mix(tc.oneMinus(), tc, c);
        const tri = pick(t.x, cx).mul(pick(t.y, cy)).mul(pick(t.z, cz));
        // Slack for the quantisation (see FREE_SLACK) except for a probe buried in a wall (all distances zero).
        const open = T.step(1e-4, xm.add(xp).add(ym).add(yp).add(zm).add(zp));
        const slack = open.mul(FREE_SLACK);
        const v = sees(t.x.sub(cx), xm.add(slack), xp.add(slack)).mul(sees(t.y.sub(cy), ym.add(slack), yp.add(slack))).mul(sees(t.z.sub(cz), zm.add(slack), zp.add(slack)));
        // A trace of the plain weight keeps the read defined where no probe sees the point; buried probes (their light is
        // filled from both sides of the wall) get almost none of it.
        const w = tri.mul(v.add(open.mul(1e-3)).add(1e-6));
        wsum.addAssign(w);
        wx.addAssign(w.mul(cx));
        wy.addAssign(w.mul(cy));
        wz.addAssign(w.mul(cz));
      });
      const fa = base.add(T.vec3(wx, wy, wz).div(T.max(wsum, 1e-6)));
      const u = fa.x.add(0.5).div(uAlloc.x);
      const v = fa.y.add(0.5).div(uAlloc.y);
      const zb = fa.z.add(1.5);
      const read = (k: number): Nd => tex.sample(T.vec3(u, v, zb.add(slab.mul(k)).div(depth))).level(0);
      const evalAt = (s: Nd): Nd => s.x.add(T.dot(T.vec3(s.y, s.z, s.w), n));
      const s0 = read(0);
      const s1 = read(1);
      const s2 = read(2);
      const s3 = read(3);
      const w = T.smoothstep(0, uParams.y, outside).oneMinus().mul(uParams.w);
      const vis = T.mix(T.float(1), T.clamp(evalAt(s0), 0, 1), w);
      const visC = T.max(vis, uParams.z);
      const bounce = T.max(T.vec3(evalAt(s1), evalAt(s2), evalAt(s3)), 0).mul(w);
      occlusion.assign(visC);
      ambient.assign(bounce.div(visC));
    });
    ctx.ambientOcclusion.mulAssign(occlusion);
    ctx.irradiance.addAssign(ambient);
    // Glossy and metal surfaces reflect the lit room, not only the sky the visibility shuts out: the bounce's mean
    // radiance stands in for it (a fridge door indoors was black).
    ctx.radiance.addAssign(ambient.mul(1 / Math.PI));
    return undefined;
  }
}
