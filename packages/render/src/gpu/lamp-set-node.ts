/**
 * The light node of a {@link LampSet}: every shadowless point lamp of the scene shaded in one loop over uniform arrays,
 * as many passes as lamps are lit this frame.
 *
 * A light of its own per lamp gave every lit program one unrolled block per lamp (point light, room clip, three
 * apertures): a lamp switched off had to leave the light set (and every lit material linked a new program at dusk and
 * dawn), or stay in it at zero and cost its block anyway. Behind a uniform branch the block was skipped, but its code
 * still weighed on the whole program: four lamps at zero cost 6-9 % of a daylight frame at the low tier and about 30 % at
 * medium on an Intel UHD 770. Here the program holds the code of one lamp whatever their number, the light set never
 * changes with the hour, and in daylight the loop runs no pass at all.
 *
 * Each pass is the same light as `RoomLampNode` draws: a point light with three's distance falloff, faded at its room's
 * clip box (`ROOM_LAMP_FADE`) unless the fragment sees the lamp through one of the room's apertures.
 */
import { Color, Vector4 } from 'three';
import * as TSL from 'three/tsl';
import { AnalyticLightNode, type NodeBuilder } from 'three/webgpu';
import { T, type Nd } from '../materials/tsl-lite';
import { MAX_LAMP_PORTALS } from '../sync/room-lamp';
import type { LampSet } from '../sync/lamp-slots';
import { PORTAL_REACH, PORTAL_SOFT, ROOM_LAMP_FADE } from './room-lamp-node';

const FAR = 1e7;

/** The few TSL pieces this node needs beyond the typed façade (loop, dynamic array index, int uniform, falloff). */
interface LoopTsl {
  Loop(count: Nd, body: (o: { i: Nd }) => void): void;
  int(v: number | Nd): Nd;
  getDistanceAttenuation(o: { lightDistance: Nd; cutoffDistance: Nd; decayExponent: Nd }): Nd;
  renderGroup: unknown;
}
const L = TSL as unknown as LoopTsl;

/** An array element at a node index (the façade's `element` takes a number). */
const at = (arr: Nd, i: Nd): Nd => (arr as unknown as { element(i: Nd): Nd }).element(i);
/** Uniforms shared by every draw of a frame (render group, like three's own light uniforms). */
const shared = (n: Nd): Nd => (n as Nd & { setGroup(g: unknown): Nd }).setGroup(L.renderGroup);

interface LightingContext {
  lightingModel: { direct(o: Record<string, unknown>, builder: NodeBuilder): void };
  reflectedLight: { directDiffuse: Nd; directSpecular: Nd };
  positionView?: Nd;
}

/** The node the renderer creates for a {@link LampSet} (register with `renderer.library.addLight`). */
export class LampSetNode extends AnalyticLightNode<LampSet> {
  static get type(): string {
    return 'LampSetNode';
  }

  private readonly cap: number;
  /** Colour times intensity. */
  private readonly colors: Color[];
  /** World position, cutoff distance. */
  private readonly positions: Vector4[];
  /** Decay exponent. */
  private readonly decays: Vector4[];
  /** Clip box corners (an empty clip: a box larger than any world). */
  private readonly los: Vector4[];
  private readonly his: Vector4[];
  /** Apertures, {@link MAX_LAMP_PORTALS} per lamp: (centre, half width), (tangent x, tangent z, half height, 0). */
  private readonly portalsA: Vector4[];
  private readonly portalsB: Vector4[];
  private readonly count: Nd & { value: number };
  /**
   * The uniform array nodes, made once: three names a uniform array's buffer after its node, so arrays made per build
   * gave every material's program a source of its own (42 more links in a load of Casa del Patio).
   */
  private readonly u: { colors: Nd; positions: Nd; decays: Nd; los: Nd; his: Nd; pa: Nd; pb: Nd };

  constructor(light: LampSet | null = null) {
    super(light);
    const n = Math.max(1, light?.capacity ?? 1);
    this.cap = n;
    const v4 = (k: number): Vector4[] => Array.from({ length: k }, () => new Vector4());
    this.colors = Array.from({ length: n }, () => new Color(0, 0, 0));
    this.positions = v4(n);
    this.decays = v4(n);
    this.los = v4(n);
    this.his = v4(n);
    this.portalsA = v4(n * MAX_LAMP_PORTALS);
    this.portalsB = v4(n * MAX_LAMP_PORTALS);
    this.count = shared((T.uniform as (v: number, type: string) => Nd)(0, 'int')) as Nd & { value: number };
    this.u = {
      colors: shared(T.uniformArray(this.colors, 'color')),
      positions: shared(T.uniformArray(this.positions, 'vec4')),
      decays: shared(T.uniformArray(this.decays, 'vec4')),
      los: shared(T.uniformArray(this.los, 'vec4')),
      his: shared(T.uniformArray(this.his, 'vec4')),
      pa: shared(T.uniformArray(this.portalsA, 'vec4')),
      pb: shared(T.uniformArray(this.portalsB, 'vec4')),
    };
  }

  override update(): undefined {
    const set = this.light;
    const lamps = set?.lit ?? [];
    const k = Math.min(lamps.length, this.cap);
    let n = 0;
    for (let i = 0; i < k; i++) {
      const l = lamps[i]!;
      if (!(l.intensity > 0)) continue;
      this.colors[n]!.copy(l.color).multiplyScalar(l.intensity);
      const e = l.matrixWorld.elements;
      this.positions[n]!.set(e[12]!, e[13]!, e[14]!, l.distance);
      this.decays[n]!.set(l.decay, 0, 0, 0);
      if (l.clip.isEmpty()) {
        this.los[n]!.set(-FAR, -FAR, -FAR, 0);
        this.his[n]!.set(FAR, FAR, FAR, 0);
      } else {
        this.los[n]!.set(l.clip.min.x, l.clip.min.y, l.clip.min.z, 0);
        this.his[n]!.set(l.clip.max.x, l.clip.max.y, l.clip.max.z, 0);
      }
      for (let j = 0; j < MAX_LAMP_PORTALS; j++) {
        const p = l.portals[j];
        this.portalsA[n * MAX_LAMP_PORTALS + j]!.set(p?.cx ?? 0, p?.cy ?? 0, p?.cz ?? 0, p?.halfWidth ?? 0);
        this.portalsB[n * MAX_LAMP_PORTALS + j]!.set(p?.tx ?? 1, p?.tz ?? 0, p?.halfHeight ?? 0, 0);
      }
      n++;
    }
    this.count.value = n;
    return undefined;
  }

  override setup(builder: NodeBuilder): undefined {
    if (!this.light) return undefined;
    const ctx = builder.context as unknown as LightingContext;
    const { colors, positions, decays, los, his, pa, pb } = this.u;
    // Copies made before the loop: a shared node first built inside it would be declared in the loop's scope only.
    const surface = (ctx.positionView ?? T.positionView).toVar();
    const pw = T.positionWorld.toVar();
    const diffuse = T.vec3(0).toVar();
    const specular = T.vec3(0).toVar();
    L.Loop(this.count, ({ i }) => {
      const P = at(positions, i);
      const lamp = P.xyz;
      const lightView = T.cameraViewMatrix.mul(T.vec4(lamp.x, lamp.y, lamp.z, 1)).xyz;
      const lightVector = lightView.sub(surface).toVar();
      const lightDirection = T.normalize(lightVector).toVar();
      const attenuation = L.getDistanceAttenuation({ lightDistance: lightVector.length(), cutoffDistance: P.w, decayExponent: at(decays, i).x });
      // The room clip: 1 inside the box, fading over ROOM_LAMP_FADE at its faces.
      const h = ROOM_LAMP_FADE / 2;
      const lo = at(los, i).xyz;
      const hi = at(his, i).xyz;
      const inLo = T.smoothstep(lo.sub(h), lo.add(h), pw);
      const inHi = T.smoothstep(hi.sub(h), hi.add(h), pw).oneMinus();
      const m = inLo.mul(inHi);
      const box = m.x.mul(m.y).mul(m.z);
      // The apertures: light that reaches the fragment through an opening of the room (see `portalMask` in
      // room-lamp-node.ts, the same shape).
      const through = T.float(0).toVar();
      const d = pw.sub(lamp).toVar();
      const dist = d.length();
      L.Loop(L.int(MAX_LAMP_PORTALS), ({ i: j }) => {
        const k = i.mul(MAX_LAMP_PORTALS).add(j);
        const A = at(pa, k);
        const B = at(pb, k);
        const C = A.xyz;
        const n = T.vec3(B.y, 0, B.x.negate());
        const den = T.dot(d, n);
        const sign = T.step(0, den).mul(2).sub(1);
        const t = T.dot(C.sub(lamp), n).div(sign.mul(T.max(T.abs(den), 1e-4)));
        const between = T.step(0.001, t).mul(T.step(t, 0.999));
        const hit = lamp.add(d.mul(t));
        const beyond = T.max(T.float(1).sub(t), 0).mul(dist);
        const soft = beyond.mul(PORTAL_SOFT.perMetre).add(PORTAL_SOFT.base);
        const u1 = T.dot(hit.sub(C), T.vec3(B.x, 0, B.y));
        const across = T.smoothstep(0, 1, T.clamp(A.w.add(soft).sub(T.abs(u1)).div(soft.mul(2)), 0, 1));
        const along = T.smoothstep(0, 1, T.clamp(B.z.add(soft).sub(T.abs(hit.y.sub(C.y))).div(soft.mul(2)), 0, 1));
        const reach = T.smoothstep(PORTAL_REACH[0], PORTAL_REACH[1], beyond).oneMinus();
        const exists = T.step(0.01, A.w);
        through.assign(T.max(through, between.mul(across).mul(along).mul(reach).mul(exists)));
      });
      const lightColor = at(colors, i).mul(attenuation).mul(T.max(box, through));
      ctx.lightingModel.direct({ lightDirection, lightColor, lightNode: { light: {}, shadowNode: null }, reflectedLight: { directDiffuse: diffuse, directSpecular: specular } }, builder);
    });
    ctx.reflectedLight.directDiffuse.addAssign(diffuse);
    ctx.reflectedLight.directSpecular.addAssign(specular);
    return undefined;
  }
}
