/**
 * Hand-held props for characters. Each prop is built in a "grip frame":
 * the point the fingers close on is the origin and the long axis runs along +Y,
 * so the rig only has to map that frame onto the hand bone once. Props are
 * small procedural meshes (no files, no licences); two-handed carries
 * (`crate`) use the chest anchor instead of a hand.
 */
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D, SphereGeometry, TorusGeometry, type BufferGeometry, type Material } from 'three';
import type { CharacterHold } from '@aether/core';

/** A built prop with the resources it owns. */
export interface Prop {
  group: Group;
  /** True for props carried in both hands in front of the chest. */
  twoHanded: boolean;
  /** True for a pack worn on the back (mounted on the spine, both hands stay free). */
  onBack?: boolean;
  /** Where a live flame burns (a torch's head): the renderer attaches a fire emitter to it. */
  flame?: Object3D;
  dispose(): void;
}

const wood = (): MeshStandardMaterial => new MeshStandardMaterial({ color: '#6b4a2e', roughness: 0.85 });
const iron = (): MeshStandardMaterial => new MeshStandardMaterial({ color: '#aeb4bb', roughness: 0.38, metalness: 0.85 });

/** Build the prop for a `hold` value (null for "none"). */
export function buildProp(kind: CharacterHold): Prop | null {
  if (kind === 'none') return null;
  const geos: BufferGeometry[] = [];
  const mats: Material[] = [];
  const g = new Group();
  g.name = `prop-${kind}`;
  const add = (geo: BufferGeometry, mat: Material, x: number, y: number, z: number): Mesh => {
    geos.push(geo);
    if (!mats.includes(mat)) mats.push(mat);
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  let twoHanded = false;
  let onBack = false;
  let flameAnchor: Object3D | undefined;
  switch (kind) {
    case 'torch': {
      const w = wood();
      add(new CylinderGeometry(0.022, 0.03, 0.56, 10), w, 0, 0.12, 0);
      add(new CylinderGeometry(0.045, 0.03, 0.08, 10), new MeshStandardMaterial({ color: '#2a2018', roughness: 0.9 }), 0, 0.42, 0);
      const flame = new MeshStandardMaterial({ color: '#ffb347', emissive: '#ff8a1f', emissiveIntensity: 1.3, roughness: 0.6 });
      add(new SphereGeometry(0.06, 12, 10), flame, 0, 0.5, 0).scale.set(0.9, 1.5, 0.9);
      const head = new Object3D();
      head.name = 'prop-flame';
      head.position.set(0, 0.52, 0);
      g.add(head);
      flameAnchor = head;
      break;
    }
    case 'lantern': {
      add(new CylinderGeometry(0.008, 0.008, 0.16, 6), iron(), 0, 0.08, 0);
      add(new BoxGeometry(0.11, 0.16, 0.11), new MeshStandardMaterial({ color: '#ffd9a0', emissive: '#ffa030', emissiveIntensity: 2.2, roughness: 0.4, transparent: true, opacity: 0.9 }), 0, -0.1, 0);
      add(new BoxGeometry(0.13, 0.03, 0.13), iron(), 0, -0.2, 0);
      break;
    }
    case 'sword': {
      const m = iron();
      add(new BoxGeometry(0.055, 0.78, 0.012), m, 0, 0.5, 0);
      add(new BoxGeometry(0.2, 0.025, 0.04), new MeshStandardMaterial({ color: '#8a6a2a', roughness: 0.5, metalness: 0.6 }), 0, 0.1, 0);
      add(new CylinderGeometry(0.018, 0.018, 0.14, 8), wood(), 0, 0, 0);
      add(new SphereGeometry(0.03, 8, 6), iron(), 0, -0.08, 0);
      break;
    }
    case 'spear': {
      add(new CylinderGeometry(0.017, 0.017, 2.0, 8), wood(), 0, 0.45, 0);
      add(new ConeGeometry(0.04, 0.24, 8), iron(), 0, 1.57, 0);
      break;
    }
    case 'axe': {
      add(new CylinderGeometry(0.02, 0.02, 0.85, 8), wood(), 0, 0.25, 0);
      add(new BoxGeometry(0.2, 0.17, 0.035), iron(), 0.1, 0.62, 0);
      break;
    }
    case 'staff': {
      add(new CylinderGeometry(0.022, 0.026, 1.75, 8), wood(), 0, 0.5, 0);
      add(new SphereGeometry(0.05, 10, 8), new MeshStandardMaterial({ color: '#7a5a35', roughness: 0.7 }), 0, 1.4, 0);
      break;
    }
    case 'bag': {
      // A canvas satchel on a strap: a rounded body, a stitched flap with a buckle, and the strap looping up to the hand.
      const canvas = new MeshStandardMaterial({ color: '#6f5a3c', roughness: 0.95 });
      const leather = new MeshStandardMaterial({ color: '#4a3220', roughness: 0.7 });
      add(new SphereGeometry(0.5, 16, 12), canvas, 0, -0.24, 0).scale.set(0.38, 0.3, 0.15);
      add(new SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), leather, 0, -0.17, 0.004).scale.set(0.4, 0.3, 0.165);
      add(new BoxGeometry(0.035, 0.05, 0.02), iron(), 0, -0.22, 0.082);
      const strap = add(new TorusGeometry(0.14, 0.009, 6, 20), leather, 0, -0.02, 0);
      strap.scale.set(0.55, 1.2, 1);
      break;
    }
    case 'paddle': {
      // A canoe paddle: ash shaft, a crossbar grip and a wide spruce blade at the foot.
      const ash = new MeshStandardMaterial({ color: '#b98d5a', roughness: 0.6 });
      add(new CylinderGeometry(0.014, 0.016, 1.25, 8), ash, 0, 0.1, 0);
      add(new BoxGeometry(0.1, 0.022, 0.022), ash, 0, 0.73, 0);
      const blade = add(new SphereGeometry(0.5, 14, 8), new MeshStandardMaterial({ color: '#8a5a32', roughness: 0.55 }), 0, -0.82, 0);
      blade.scale.set(0.095, 0.3, 0.018);
      break;
    }
    case 'backpack': {
      // A hiker's rucksack: canvas body, a lid with a buckle, two side pockets and a rolled mat on top. Origin: the pack's centre.
      onBack = true;
      const canvas = new MeshStandardMaterial({ color: '#53603b', roughness: 0.95 });
      const darker = new MeshStandardMaterial({ color: '#3d4a2c', roughness: 0.92 });
      const strap = new MeshStandardMaterial({ color: '#2a2a26', roughness: 0.8 });
      add(new SphereGeometry(0.5, 18, 14), canvas, 0, 0, 0).scale.set(0.34, 0.5, 0.2);
      add(new SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), darker, 0, 0.1, 0.004).scale.set(0.355, 0.26, 0.215);
      for (const sx of [-1, 1]) add(new SphereGeometry(0.5, 12, 10), darker, sx * 0.19, -0.1, 0).scale.set(0.1, 0.26, 0.15);
      add(new BoxGeometry(0.05, 0.07, 0.02), iron(), 0, 0.02, 0.108);
      const mat = add(new CylinderGeometry(0.06, 0.06, 0.4, 14), new MeshStandardMaterial({ color: '#b9632f', roughness: 0.9 }), 0, 0.3, 0.02);
      mat.rotation.z = Math.PI / 2;
      for (const sx of [-1, 1]) add(new BoxGeometry(0.045, 0.5, 0.02), strap, sx * 0.1, 0.02, -0.098);
      break;
    }
    case 'crate': {
      twoHanded = true;
      add(new BoxGeometry(0.42, 0.34, 0.34), new MeshStandardMaterial({ color: '#8b6a40', roughness: 0.9 }), 0, 0, 0);
      break;
    }
    case 'book': {
      add(new BoxGeometry(0.2, 0.035, 0.28), new MeshStandardMaterial({ color: '#4a2a2a', roughness: 0.8 }), 0, 0, 0);
      break;
    }
    case 'umbrella': {
      // A pole with a crooked handle and a dome of dark cloth over the person's head (rain worlds).
      add(new CylinderGeometry(0.011, 0.011, 1.05, 8), iron(), 0, 0.3, 0);
      add(new SphereGeometry(0.024, 8, 6), wood(), 0, -0.24, 0);
      const cloth = new MeshStandardMaterial({ color: '#23262e', roughness: 0.75, side: 2 });
      const dome = add(new SphereGeometry(0.55, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), cloth, 0, 0.8, 0);
      dome.scale.set(1, 0.42, 1);
      add(new SphereGeometry(0.018, 6, 6), iron(), 0, 0.99, 0);
      break;
    }
    case 'cup': {
      add(new CylinderGeometry(0.04, 0.032, 0.1, 12), new MeshStandardMaterial({ color: '#c9b78b', roughness: 0.5, metalness: 0.4 }), 0, 0.03, 0);
      break;
    }
  }
  return {
    group: g,
    twoHanded,
    ...(onBack ? { onBack } : {}),
    ...(flameAnchor ? { flame: flameAnchor } : {}),
    dispose() {
      for (const x of geos) x.dispose();
      for (const x of mats) x.dispose();
    },
  };
}
