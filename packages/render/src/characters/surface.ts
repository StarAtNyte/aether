/**
 * Character surface touches that cost almost nothing on an integrated GPU:
 *
 * - a soft contact shadow under the feet (one shared quad and texture for the whole crowd), which grounds a person where
 *   the sun's shadow map is coarse, far off or absent (inside a shadow, at a distance, on the low tier).
 *
 * (A fresnel rim on the materials was tried and dropped: through the eye adaptation in the shade it read as satin sheen on
 * cloth, not as an edge light.)
 */
import { CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';

let shared: { geometry: PlaneGeometry; material: MeshBasicMaterial } | null = null;

/** A radial falloff: dark in the middle, clear at the edge. */
function blobTexture(): CanvasTexture | null {
  if (typeof OffscreenCanvas === 'undefined' && typeof document === 'undefined') return null;
  const size = 64;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.6)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new CanvasTexture(canvas as never);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A contact shadow for the feet of one person (shared geometry and material; never dispose them per person). */
export function contactShadow(radius = 0.42, opacity = 0.42): Mesh {
  if (!shared) {
    const tex = blobTexture();
    const material = new MeshBasicMaterial({ color: '#000000', transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: DoubleSide });
    if (tex) material.alphaMap = tex;
    material.name = 'character-contact-shadow';
    shared = { geometry: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material };
  }
  const m = new Mesh(shared.geometry, shared.material);
  m.name = 'contact-shadow';
  m.scale.set(radius * 2, 1, radius * 2 * 1.15);
  m.position.y = 0.012;
  m.castShadow = false;
  m.receiveShadow = false;
  m.renderOrder = -1;
  return m;
}
