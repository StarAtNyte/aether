/**
 * An architectural wall casts its sun shadow from its front faces. Three draws the faces behind a single-sided material
 * into the shadow map by default; for a wall of 12 to 28 cm that puts the occluder's surface on the far side of the wall,
 * where it meets the face of the wall next to it at an inside corner: a receiver there is within the depth bias of the
 * occluder (about 2 cm along the ray), the sun leaks through, and a lit hairline of 1.5 cm runs down the corner in the
 * shadow of the next wall (found on the integrated GPU: it stayed with the light volume, every screen effect, the
 * walls' own shadow side and every lamp off, and went with the sun's shadow and with this).
 */
import { describe, expect, it } from 'vitest';
import { BackSide, DoubleSide, FrontSide, Mesh, MeshStandardMaterial } from 'three';
import { createMaterial } from '../src/materials/material-cache';
import { materialKey, resolveMaterial } from '../src/materials/presets';
import { box, makeSync, world } from './helpers';

describe('wall shadow side', () => {
  it('a solid material is its own cache key and draws its shadow from the front faces', () => {
    const plain = resolveMaterial({ finish: 'paint', color: '#f3f1ec' });
    const solid = resolveMaterial({ finish: 'paint', color: '#f3f1ec' }, { solid: true });
    expect(solid.solid).toBe(true);
    expect(plain.solid).toBeUndefined();
    expect(materialKey(solid)).not.toBe(materialKey(plain));
    // Three's own choice for a single-sided material is the back faces (BackSide for the shadow pass).
    expect(createMaterial(plain, 'standard').shadowSide).toBeNull();
    expect(createMaterial(solid, 'standard').shadowSide).toBe(FrontSide);
  });

  it('glass, foliage cards and the ghost keep what they had', () => {
    expect(resolveMaterial({ color: '#88aacc', opacity: 0.3 }, { solid: true }).solid).toBeUndefined();
    expect(resolveMaterial({ foliage: 'leaf' as never, opacity: 1 }, { solid: true }).solid).toBeUndefined();
    const ghost = createMaterial(resolveMaterial({ color: '#ffffff' }, { solid: true }), 'ghost');
    expect(ghost.shadowSide).not.toBe(FrontSide);
    expect([null, BackSide, DoubleSide]).toContain(ghost.shadowSide);
  });

  it('wall entities get the solid material, other things the plain one', async () => {
    const { sync } = makeSync();
    const w = world([
      { ...box('wall', [0, 1, 0]), arch: { role: 'wall' } },
      box('crate', [3, 0.5, 0]),
    ]);
    await sync.setWorld(w);
    const side = (id: string): unknown => {
      let m: unknown = null;
      sync.node(id)?.content.traverse((o) => {
        if (o instanceof Mesh) m = (o.material as MeshStandardMaterial).shadowSide;
      });
      return m;
    };
    expect(side('wall')).toBe(FrontSide);
    expect(side('crate')).toBeNull();
  });
});
