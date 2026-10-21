/**
 * Light nodes of {@link RoomLamp} and {@link RoomSpot}: an ordinary point light, or an (IES-aware) spot light, whose
 * direct light fades out over a short band at the walls of its clip box, so a lamp lights its own room and not the
 * rooms behind the walls (or, for a downlight, the room below). A lamp without a clip gets a box larger than any
 * world (the mask is 1). Six smoothsteps per lit fragment and lamp. A lamp's room apertures (archways, open doors) let
 * the light through: a fragment the lamp sees through an opening is lit as if the wall were not there (see
 * {@link portalMask}).
 */
import { Vector3, Vector4, type Box3 } from 'three';
import { IESSpotLightNode, PointLightNode, type NodeBuilder } from 'three/webgpu';
import { T, type Nd } from '../materials/tsl-lite';
import { MAX_LAMP_PORTALS, type LampPortal, type RoomLamp, type RoomSpot } from '../sync/room-lamp';

/**
 * Width (metres) of the fade at the clip box's faces (half inside, half outside): narrower than any wall, so a box on
 * the wall centrelines lights the near wall face fully and the far one (the next room's) not at all.
 */
export const ROOM_LAMP_FADE = 0.08;
const FAR = 1e7;

interface DirectData {
  lightColor: Nd;
  lightDirection: Nd;
}

/** Copy a light's clip box into the node's uniforms (an empty clip: no limit). */
function syncClip(clip: Box3 | undefined, lo: Vector3, hi: Vector3): void {
  if (clip && !clip.isEmpty()) {
    lo.copy(clip.min);
    hi.copy(clip.max);
  } else {
    lo.set(-FAR, -FAR, -FAR);
    hi.set(FAR, FAR, FAR);
  }
}

/** Distance (metres) past an aperture over which the light that came through fades out (the lamp's own falloff acts too). */
export const PORTAL_REACH: readonly [number, number] = Object.freeze([3.5, 7] as const);
/** Penumbra of an aperture's edge: a floor width plus a share of the distance past it (an area lamp's soft shadow). */
export const PORTAL_SOFT = Object.freeze({ base: 0.05, perMetre: 0.12 });

/** Uniform storage of a lamp's apertures: (centre, half width) and (tangent x, tangent z, half height, 0) per portal. */
interface PortalUniforms {
  lamp: Vector3;
  a: Vector4[];
  b: Vector4[];
}

function makePortalUniforms(): PortalUniforms {
  return { lamp: new Vector3(), a: Array.from({ length: MAX_LAMP_PORTALS }, () => new Vector4()), b: Array.from({ length: MAX_LAMP_PORTALS }, () => new Vector4()) };
}

/** Copy a lamp's world position and apertures into the node's uniforms (unused slots get zero width: no light). */
function syncPortals(light: (RoomLamp | RoomSpot) | null, u: PortalUniforms): void {
  if (!light) return;
  light.getWorldPosition(u.lamp);
  for (let i = 0; i < MAX_LAMP_PORTALS; i++) {
    const p: LampPortal | undefined = light.portals[i];
    u.a[i]!.set(p?.cx ?? 0, p?.cy ?? 0, p?.cz ?? 0, p?.halfWidth ?? 0);
    u.b[i]!.set(p?.tx ?? 1, p?.tz ?? 0, p?.halfHeight ?? 0, 0);
  }
}

/**
 * Light that reaches a fragment through the lamp's apertures, in [0, 1]: the segment from the lamp to the fragment
 * must cross an opening's rectangle (soft at its edges, softer the farther the fragment is past it, like the shadow of
 * an area light), and the light fades out between {@link PORTAL_REACH} metres beyond it.
 */
function portalMask(u: PortalUniforms): Nd {
  const L = T.uniform(u.lamp);
  const d = T.positionWorld.sub(L);
  let best: Nd = T.float(0);
  for (let i = 0; i < MAX_LAMP_PORTALS; i++) {
    const A = T.uniform(u.a[i]!);
    const B = T.uniform(u.b[i]!);
    const C = A.xyz;
    const n = T.vec3(B.y, 0, B.x.negate());
    const den = T.dot(d, n);
    const sign = T.step(0, den).mul(2).sub(1);
    const t = T.dot(C.sub(L), n).div(sign.mul(T.max(T.abs(den), 1e-4)));
    const between = T.step(0.001, t).mul(T.step(t, 0.999));
    const hit = L.add(d.mul(t));
    const beyond = T.max(T.float(1).sub(t), 0).mul(d.length());
    const soft = beyond.mul(PORTAL_SOFT.perMetre).add(PORTAL_SOFT.base);
    const u1 = T.dot(hit.sub(C), T.vec3(B.x, 0, B.y));
    const across = T.smoothstep(0, 1, T.clamp(A.w.add(soft).sub(T.abs(u1)).div(soft.mul(2)), 0, 1));
    const along = T.smoothstep(0, 1, T.clamp(B.z.add(soft).sub(T.abs(hit.y.sub(C.y))).div(soft.mul(2)), 0, 1));
    const reach = T.smoothstep(PORTAL_REACH[0], PORTAL_REACH[1], beyond).oneMinus();
    const exists = T.step(0.01, A.w);
    best = T.max(best, between.mul(across).mul(along).mul(reach).mul(exists));
  }
  return best;
}

/** 1 inside the box (or in sight of the lamp through one of its apertures), 0 outside, smooth over {@link ROOM_LAMP_FADE} at the box's faces. */
function clipMask(lo: Vector3, hi: Vector3, portals: PortalUniforms): Nd {
  const p = T.positionWorld;
  const h = ROOM_LAMP_FADE / 2;
  const uLo = T.uniform(lo);
  const uHi = T.uniform(hi);
  const inLo = T.smoothstep(uLo.sub(h), uLo.add(h), p);
  const inHi = T.smoothstep(uHi.sub(h), uHi.add(h), p).oneMinus();
  const m = inLo.mul(inHi);
  return T.max(m.x.mul(m.y).mul(m.z), portalMask(portals));
}

/** The node the renderer creates for each {@link RoomLamp} (register with `renderer.library.addLight`). */
export class RoomLampNode extends PointLightNode {
  static get type(): string {
    return 'RoomLampNode';
  }

  private readonly vMin = new Vector3(-FAR, -FAR, -FAR);
  private readonly vMax = new Vector3(FAR, FAR, FAR);
  private readonly portals = makePortalUniforms();

  override update(frame: Parameters<PointLightNode['update']>[0]): undefined {
    super.update(frame);
    syncClip((this.light as RoomLamp | null)?.clip, this.vMin, this.vMax);
    syncPortals(this.light as RoomLamp | null, this.portals);
    return undefined;
  }

  override setupDirect(builder: NodeBuilder): ReturnType<PointLightNode['setupDirect']> {
    const d = super.setupDirect(builder) as unknown as DirectData;
    d.lightColor = d.lightColor.mul(clipMask(this.vMin, this.vMax, this.portals));
    return d as unknown as ReturnType<PointLightNode['setupDirect']>;
  }
}

/**
 * The node the renderer creates for each {@link RoomSpot}: three's IES spot node (a plain cone when the light has no
 * profile) with the room clip on top.
 */
export class RoomSpotNode extends IESSpotLightNode {
  static get type(): string {
    return 'RoomSpotNode';
  }

  private readonly vMin = new Vector3(-FAR, -FAR, -FAR);
  private readonly vMax = new Vector3(FAR, FAR, FAR);
  private readonly portals = makePortalUniforms();

  override update(frame: Parameters<IESSpotLightNode['update']>[0]): undefined {
    super.update(frame);
    syncClip((this.light as RoomSpot | null)?.clip, this.vMin, this.vMax);
    syncPortals(this.light as RoomSpot | null, this.portals);
    return undefined;
  }

  override setupDirect(builder: NodeBuilder): ReturnType<IESSpotLightNode['setupDirect']> {
    const d = super.setupDirect(builder) as unknown as DirectData;
    d.lightColor = d.lightColor.mul(clipMask(this.vMin, this.vMax, this.portals));
    return d as unknown as ReturnType<IESSpotLightNode['setupDirect']>;
  }
}
