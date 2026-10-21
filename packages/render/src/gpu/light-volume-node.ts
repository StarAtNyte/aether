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
import { AnalyticLightNode, type NodeBuilder } from 'three/webgpu';
import { T, type Nd } from '../materials/tsl-lite';
import { LightVolume } from '../environment/light-volume-light';
import { ATLAS_SUBVOLUMES, FREE_SLACK, FREE_STEPS } from '../environment/light-volume';

interface LightingContext {
  irradiance: Nd;
  radiance: Nd;
  ambientOcclusion: Nd;
}

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
    return undefined;
  }

  override setup(builder: NodeBuilder): undefined {
    const light = this.light;
    if (!light) return undefined;
    const ctx = builder.context as unknown as LightingContext;
    const uMin = T.uniform(this.vMin);
    const uExtent = T.uniform(this.vExtent);
    const uRes = T.uniform(this.vRes);
    const uAlloc = T.uniform(this.vAlloc);
    const uParams = T.uniform(this.vParams);
    const n = T.normalWorld;
    const pw = T.positionWorld;
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
    let wsum: Nd = T.float(0);
    let wx: Nd = T.float(0);
    let wy: Nd = T.float(0);
    let wz: Nd = T.float(0);
    for (let c = 0; c < 8; c++) {
      const cx = c & 1;
      const cy = (c >> 1) & 1;
      const cz = (c >> 2) & 1;
      const corner = base.add(T.vec3(cx, cy, cz));
      const g = tex.sample(T.vec3(corner.x.add(0.5).div(uAlloc.x), corner.y.add(0.5).div(uAlloc.y), corner.z.add(geomZ).div(depth)));
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
      const tri = (cx ? t.x : t.x.oneMinus()).mul(cy ? t.y : t.y.oneMinus()).mul(cz ? t.z : t.z.oneMinus());
      // Half a step of slack (the middle of the quantisation step) except for a probe buried in a wall (all distances zero).
      const slack = T.step(1e-4, xm.add(xp).add(ym).add(yp).add(zm).add(zp)).mul(FREE_SLACK);
      const v = sees(t.x.sub(cx), xm.add(slack), xp.add(slack)).mul(sees(t.y.sub(cy), ym.add(slack), yp.add(slack))).mul(sees(t.z.sub(cz), zm.add(slack), zp.add(slack)));
      // A trace of the plain weight keeps the read defined where no probe sees the point.
      const w = tri.mul(v.add(1e-3));
      wsum = wsum.add(w);
      if (cx) wx = wx.add(w);
      if (cy) wy = wy.add(w);
      if (cz) wz = wz.add(w);
    }
    const fa = base.add(T.vec3(wx, wy, wz).div(T.max(wsum, 1e-6)));
    const u = fa.x.add(0.5).div(uAlloc.x);
    const v = fa.y.add(0.5).div(uAlloc.y);
    const zb = fa.z.add(1.5);
    const read = (k: number): Nd => tex.sample(T.vec3(u, v, zb.add(slab.mul(k)).div(depth)));
    const evalAt = (s: Nd): Nd => s.x.add(T.dot(T.vec3(s.y, s.z, s.w), n));
    const s0 = read(0);
    const s1 = read(1);
    const s2 = read(2);
    const s3 = read(3);
    const hi = uMin.add(uExtent);
    const outside = T.max(uMin.sub(pw), 0).add(T.max(pw.sub(hi), 0)).length();
    const w = T.smoothstep(0, uParams.y, outside).oneMinus().mul(uParams.w);
    const vis = T.mix(T.float(1), T.clamp(evalAt(s0), 0, 1), w);
    const visC = T.max(vis, uParams.z);
    const bounce = T.max(T.vec3(evalAt(s1), evalAt(s2), evalAt(s3)), 0).mul(w);
    ctx.ambientOcclusion.mulAssign(visC);
    ctx.irradiance.addAssign(bounce.div(visC));
    // Glossy and metal surfaces reflect the lit room, not only the sky the visibility shuts out: the bounce's mean
    // radiance stands in for it (a fridge door indoors was black).
    ctx.radiance.addAssign(bounce.div(visC).mul(1 / Math.PI));
    return undefined;
  }
}
