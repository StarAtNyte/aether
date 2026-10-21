/**
 * Light node of a {@link RoomLamp}: an ordinary point light whose direct light fades out over a short band at the
 * walls of its clip box, so a lamp lights its own room and not the rooms behind the walls. A lamp without a clip gets
 * a box larger than any world (the mask is 1). Six smoothsteps per lit fragment and lamp.
 */
import { Vector3 } from 'three';
import { PointLightNode, type NodeBuilder } from 'three/webgpu';
import { T, type Nd } from '../materials/tsl-lite';
import type { RoomLamp } from '../sync/room-lamp';

/** Width (metres) of the fade at the clip box's faces (half inside, half outside). */
export const ROOM_LAMP_FADE = 0.25;
const FAR = 1e7;

interface DirectData {
  lightColor: Nd;
  lightDirection: Nd;
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
    const l = this.light as RoomLamp | null;
    if (l && l.clip && !l.clip.isEmpty()) {
      this.vMin.copy(l.clip.min);
      this.vMax.copy(l.clip.max);
    } else {
      this.vMin.set(-FAR, -FAR, -FAR);
      this.vMax.set(FAR, FAR, FAR);
    }
    return undefined;
  }

  override setupDirect(builder: NodeBuilder): ReturnType<PointLightNode['setupDirect']> {
    const d = super.setupDirect(builder) as unknown as DirectData;
    const p = T.positionWorld;
    const lo = T.uniform(this.vMin);
    const hi = T.uniform(this.vMax);
    const h = ROOM_LAMP_FADE / 2;
    const inLo = T.smoothstep(lo.sub(h), lo.add(h), p);
    const inHi = T.smoothstep(hi.sub(h), hi.add(h), p).oneMinus();
    const m = inLo.mul(inHi);
    d.lightColor = d.lightColor.mul(m.x.mul(m.y).mul(m.z));
    return d as unknown as ReturnType<PointLightNode['setupDirect']>;
  }
}
