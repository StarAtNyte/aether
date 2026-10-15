/**
 * The camera of the photo: a field of view the model reports as horizontal becomes the vertical angle of the
 * compare render at the photo's own aspect ratio.
 */
import type { CustomPoseSpec } from '../scene/views';
import type { RoomDescription } from './description';
import { PHOTO_ROOM_ID } from './derive';

/** Vertical field of view (degrees) of a camera with the given horizontal one and image aspect (width / height). */
export function verticalFov(horizontalDeg: number, aspect: number): number {
  const a = Math.max(0.4, Math.min(3, Number.isFinite(aspect) ? aspect : 1.5));
  const h = (Math.max(20, Math.min(130, horizontalDeg)) * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(h / 2) / a) * 180) / Math.PI;
}

/** The pose spec of the photo's camera for a render at `aspect`. The position is kept inside the room. */
export function photoCameraSpec(d: RoomDescription, aspect: number): CustomPoseSpec {
  const cam = d.camera;
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  return {
    name: 'photo-camera',
    label: "the room from the photo's own camera position and direction (compare with the photo)",
    room: PHOTO_ROOM_ID,
    at: [clamp(cam.x, 0.15, d.footprint.width - 0.15), clamp(cam.z, 0.15, d.footprint.depth - 0.15)],
    height: clamp(cam.height, 0.3, d.footprint.ceiling - 0.1),
    heading: cam.heading,
    pitch: cam.pitch,
    fov: verticalFov(cam.fov, aspect),
  };
}
