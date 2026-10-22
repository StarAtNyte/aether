import { describe, expect, it } from 'vitest';
import { BoxGeometry, DoubleSide, Mesh, MeshStandardMaterial } from 'three';
import { lightmapEligible } from '../src/view/lightmap-geometry';

describe('lightmap eligibility', () => {
  const geometry = (): BoxGeometry => new BoxGeometry(1, 1, 1);
  it('takes plain opaque lit geometry', () => {
    expect(lightmapEligible(new Mesh(geometry(), new MeshStandardMaterial()))).toBe(true);
  });
  it('leaves a two-sided surface to the volume (both faces would share one texel)', () => {
    expect(lightmapEligible(new Mesh(geometry(), new MeshStandardMaterial({ side: DoubleSide })))).toBe(false);
  });
  it('leaves glass and flagged meshes alone', () => {
    expect(lightmapEligible(new Mesh(geometry(), new MeshStandardMaterial({ transparent: true, opacity: 0.4 })))).toBe(false);
    const m = new Mesh(geometry(), new MeshStandardMaterial());
    m.userData['aetherNoLightmap'] = true;
    expect(lightmapEligible(m)).toBe(false);
  });
});
