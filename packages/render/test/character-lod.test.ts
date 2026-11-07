/**
 * A body's far level of detail: attached to the body's own skeleton and materials, switched by height on screen with
 * hysteresis, cross-faded through complementary dither, and cast into the sun's map in place of the near level.
 */
import { farLevelOf, castById } from '@aether/assets';
import { Bone, BufferGeometry, Float32BufferAttribute, Group, MeshBasicMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute, type Mesh } from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { describe, expect, it } from 'vitest';
import { attachFarLevel, BodyLevels, ditherKeeps, isFarLevel, LOD_DITHER_KEY, LOD_FADE_S, LOD_FAR_PX, LOD_NEAR_PX } from '../src/characters/lod';
import { FIELD_SHADOW_LAYER, fieldShadowSkipped } from '../src/virtual/scatter-field';

function skinned(name: string, material: MeshBasicMaterial, bones: Bone[]): SkinnedMesh {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  g.setAttribute('skinIndex', new Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], 4));
  g.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const m = new SkinnedMesh(g, material);
  m.name = name;
  m.bind(new Skeleton(bones));
  return m;
}

/** A body file: an armature with two bones, a body mesh and its outline hull. */
function bodyFile(): Group {
  const scene = new Group();
  const arm = new Group();
  arm.name = 'Armature';
  const hips = new Bone();
  hips.name = 'Bip01';
  const head = new Bone();
  head.name = 'Bip01_Head';
  head.position.y = 1;
  hips.add(head);
  arm.add(hips);
  scene.add(arm);
  scene.updateMatrixWorld(true);
  const body = new MeshBasicMaterial();
  body.name = 'x-toon';
  body.userData['toon'] = 'body';
  const line = new MeshBasicMaterial();
  line.name = 'x-toon-outline';
  line.userData['toon'] = 'outline';
  arm.add(skinned('x-body', body, [hips, head]));
  const hull = skinned('x-outline', line, [hips, head]);
  hull.userData['toonOutline'] = true;
  arm.add(hull);
  return scene;
}

const meshes = (root: Group): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
};

describe('far level of detail', () => {
  it('is known for the built anime bodies', () => {
    for (const id of ['kaho', 'mio']) {
      const body = castById(id);
      expect(body).toBeTruthy();
      const far = farLevelOf(body!);
      expect(far?.file).toMatch(new RegExp(`^c/${id}\\.lod1\\.[0-9a-f]{8}\\.glb$`));
      expect(far!.triangles).toBeLessThan(body!.triangles * 0.5);
    }
    // Bodies with no far level keep one.
    expect(farLevelOf({ id: 'nobody' })).toBeNull();
  });

  it('joins the body on its skeleton with its materials', () => {
    const body = cloneSkinned(bodyFile()) as Group;
    const lod = cloneSkinned(bodyFile()) as Group;
    const nearBody = body.getObjectByName('x-body') as SkinnedMesh;
    const far = attachFarLevel(body, lod);
    expect(far).toHaveLength(2);
    const farBody = body.getObjectByName('x-body:lod1') as SkinnedMesh;
    expect(farBody.parent?.name).toBe('Armature');
    expect(farBody.parent).toBe(nearBody.parent);
    // The bind matches: the body's own skeleton (one bone palette), and its very materials (no new program).
    expect(farBody.skeleton).toBe(nearBody.skeleton);
    expect(farBody.material).toBe(nearBody.material);
    expect((body.getObjectByName('x-outline:lod1') as Mesh).material).toBe((body.getObjectByName('x-outline') as Mesh).material);
    expect(isFarLevel(farBody)).toBe(true);
    expect(isFarLevel(nearBody)).toBe(false);
  });

  it('refuses a far level whose bones are missing', () => {
    const body = cloneSkinned(bodyFile()) as Group;
    const lod = cloneSkinned(bodyFile()) as Group;
    lod.getObjectByName('Bip01_Head')!.name = 'Other';
    // Different bind (moved bone) so the skeleton is not shared, then the bone lookup fails.
    const sk = (lod.getObjectByName('x-body') as SkinnedMesh).skeleton;
    sk.boneInverses[1]!.elements[13] = 5;
    expect(attachFarLevel(body, lod)).toBeNull();
    expect(meshes(body)).toHaveLength(2);
  });

  it('switches by height on screen with hysteresis, and casts the far level into the sun map', () => {
    const body = cloneSkinned(bodyFile()) as Group;
    attachFarLevel(body, cloneSkinned(bodyFile()) as Group);
    const all = meshes(body);
    const near = all.filter((m) => !isFarLevel(m));
    const far = all.filter(isFarLevel);
    const levels = new BodyLevels(near, far, (m) => m.userData['toonOutline'] === true, true);
    const nearBody = near.find((m) => m.name === 'x-body')!;
    const farBody = far.find((m) => m.name === 'x-body:lod1')!;
    const farHull = far.find((m) => m.name === 'x-outline:lod1')!;
    // Near: the full body is drawn and casts; the far one is not drawn anywhere.
    expect(fieldShadowSkipped(nearBody)).toBe(false);
    expect(farBody.visible).toBe(false);
    expect(nearBody.visible).toBe(true);
    expect(farHull.visible).toBe(false);
    // Between the thresholds nothing changes.
    expect(levels.update((LOD_FAR_PX + LOD_NEAR_PX) / 2, 1 / 30)).toBe(false);
    levels.update(LOD_FAR_PX - 1, 1 / 30);
    expect(levels.level).toBe(1);
    expect(levels.fading).toBe(true);
    // From the start of the fade the far body casts in place of the near one.
    expect(fieldShadowSkipped(nearBody)).toBe(true);
    expect(farBody.layers.isEnabled(FIELD_SHADOW_LAYER)).toBe(true);
    // Mid fade both are drawn, each keeping the pixels the other drops.
    expect(nearBody.visible && farBody.layers.isEnabled(0)).toBe(true);
    const dn = nearBody.userData[LOD_DITHER_KEY] as number;
    const df = farBody.userData[LOD_DITHER_KEY] as number;
    for (let p = 0; p < 1; p += 0.01) expect(ditherKeeps(dn, p) !== ditherKeeps(df, p)).toBe(true);
    // Back over the far threshold but under the near one: stays far.
    levels.update((LOD_FAR_PX + LOD_NEAR_PX) / 2, 1 / 30);
    expect(levels.level).toBe(1);
    for (let t = 0; t < LOD_FADE_S + 0.1; t += 1 / 30) levels.update(LOD_FAR_PX - 1, 1 / 30);
    expect(levels.fading).toBe(false);
    expect(nearBody.visible).toBe(false);
    expect(farBody.layers.isEnabled(0)).toBe(true);
    expect(farHull.visible).toBe(true);
    expect(farBody.userData[LOD_DITHER_KEY]).toBe(0);
    // Far away the rig hides outlines.
    levels.setOutlines(false);
    expect(farHull.visible).toBe(false);
    levels.update(LOD_NEAR_PX + 1, 1 / 30);
    expect(levels.level).toBe(0);
    levels.snap(0);
    expect(levels.fading).toBe(false);
    expect(nearBody.visible).toBe(true);
    expect(farBody.visible).toBe(false);
    expect(fieldShadowSkipped(nearBody)).toBe(false);
  });

  it('switches at once when the materials cannot dither', () => {
    const body = cloneSkinned(bodyFile()) as Group;
    attachFarLevel(body, cloneSkinned(bodyFile()) as Group);
    const all = meshes(body);
    const levels = new BodyLevels(all.filter((m) => !isFarLevel(m)), all.filter(isFarLevel), (m) => m.userData['toonOutline'] === true, false);
    levels.update(LOD_FAR_PX - 1, 1 / 30);
    expect(levels.level).toBe(1);
    expect(levels.fading).toBe(false);
  });

  it('dithers complementary pixels and none at rest', () => {
    expect(ditherKeeps(0, 0)).toBe(true);
    expect(ditherKeeps(0, 0.999)).toBe(true);
    expect(ditherKeeps(-1e-4, 0.5)).toBe(false);
    expect(ditherKeeps(0.3, 0.2)).toBe(false);
    expect(ditherKeeps(-0.3, 0.2)).toBe(true);
  });
});
