/**
 * Light nodes of {@link RoomLamp} and {@link RoomSpot}: an ordinary point light, or an (IES-aware) spot light, whose
 * direct light fades out over a short band at the walls of its clip box, so a lamp lights its own room and not the
 * rooms behind the walls (or, for a downlight, the room below). A lamp without a clip gets a box larger than any
 * world (the mask is 1). Six smoothsteps per lit fragment and lamp.
 */
import { Vector3, type Box3 } from 'three';
import { IESSpotLightNode, PointLightNode, type NodeBuilder } from 'three/webgpu';
import { T, type Nd } from '../materials/tsl-lite';
import type { RoomLamp, RoomSpot } from '../sync/room-lamp';

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

/** 1 inside the box, 0 outside, smooth over {@link ROOM_LAMP_FADE} at its faces. */
function clipMask(lo: Vector3, hi: Vector3): Nd {
  const p = T.positionWorld;
  const h = ROOM_LAMP_FADE / 2;
  const uLo = T.uniform(lo);
  const uHi = T.uniform(hi);
  const inLo = T.smoothstep(uLo.sub(h), uLo.add(h), p);
  const inHi = T.smoothstep(uHi.sub(h), uHi.add(h), p).oneMinus();
  const m = inLo.mul(inHi);
  return m.x.mul(m.y).mul(m.z);
}

/** The node the renderer creates for each {@link RoomLamp} (register with `renderer.library.addLight`). */
export class RoomLampNode extends PointLightNode {
  static get type(): string {
    return 'RoomLampNode';
  }

  private readonly vMin = new Vector3(-FAR, -FAR, -FAR);
  private readonly vMax = new Vector3(FAR, FAR, FAR);

  override update(frame: Parameters<PointLightNode['update']>[0]): undefined {
    super.update(frame);
    syncClip((this.light as RoomLamp | null)?.clip, this.vMin, this.vMax);
    return undefined;
  }

  override setupDirect(builder: NodeBuilder): ReturnType<PointLightNode['setupDirect']> {
    const d = super.setupDirect(builder) as unknown as DirectData;
    d.lightColor = d.lightColor.mul(clipMask(this.vMin, this.vMax));
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

  override update(frame: Parameters<IESSpotLightNode['update']>[0]): undefined {
    super.update(frame);
    syncClip((this.light as RoomSpot | null)?.clip, this.vMin, this.vMax);
    return undefined;
  }

  override setupDirect(builder: NodeBuilder): ReturnType<IESSpotLightNode['setupDirect']> {
    const d = super.setupDirect(builder) as unknown as DirectData;
    d.lightColor = d.lightColor.mul(clipMask(this.vMin, this.vMax));
    return d as unknown as ReturnType<IESSpotLightNode['setupDirect']>;
  }
}
