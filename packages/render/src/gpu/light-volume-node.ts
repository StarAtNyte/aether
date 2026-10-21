/**
 * Light node of a {@link LightVolume}: for every lit node material, read the baked volume at the surface
 * (half a probe spacing out along the normal, so a wall reads the room it faces, not the probes behind it),
 * evaluate sky visibility and bounce for the surface normal and
 *
 * - multiply the lighting context's ambient occlusion by the visibility (the sky hemisphere, the image light
 *   and its reflections reach a room only through its windows),
 * - add the bounce irradiance, divided by that same visibility so the occlusion does not darken it twice
 *   (screen-space AO still applies to it, as it should).
 *
 * Outside the volume's box the effect fades out over {@link LightVolume.fade}. Four filtered reads of one 3D
 * texture and a handful of ALU per fragment; the same code runs on WebGPU and WebGL2.
 */
import { Vector3, Vector4 } from 'three';
import { AnalyticLightNode, type NodeBuilder } from 'three/webgpu';
import { T, type Nd } from '../materials/tsl-lite';
import { LightVolume } from '../environment/light-volume-light';

interface LightingContext {
  irradiance: Nd;
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
    const depth = slab.mul(4);
    const u = f.x.add(0.5).div(uAlloc.x);
    const v = f.y.add(0.5).div(uAlloc.y);
    const zb = f.z.add(1.5);
    const tex = T.texture3D(light.texture);
    const read = (t: number): Nd => tex.sample(T.vec3(u, v, zb.add(slab.mul(t)).div(depth)));
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
    return undefined;
  }
}
