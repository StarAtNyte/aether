/**
 * Hand-held props for characters. Each prop is built in a "grip frame":
 * the point the fingers close on is the origin and the long axis runs along +Y,
 * so the rig only has to map that frame onto the hand bone once. Props are
 * small procedural meshes (no files, no licences); two-handed carries
 * (`crate`) use the chest anchor instead of a hand.
 */
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, type BufferGeometry, type Material } from 'three';
import type { CharacterHold } from '@aether/core';

/** A built prop with the resources it owns. */
export interface Prop {
  group: Group;
  /** True for props carried in both hands in front of the chest. */
  twoHanded: boolean;
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
  switch (kind) {
    case 'torch': {
      const w = wood();
      add(new CylinderGeometry(0.022, 0.03, 0.56, 10), w, 0, 0.12, 0);
      add(new CylinderGeometry(0.045, 0.03, 0.08, 10), new MeshStandardMaterial({ color: '#2a2018', roughness: 0.9 }), 0, 0.42, 0);
      const flame = new MeshStandardMaterial({ color: '#ffb347', emissive: '#ff8a1f', emissiveIntensity: 3, roughness: 0.6 });
      add(new SphereGeometry(0.06, 12, 10), flame, 0, 0.5, 0).scale.set(0.9, 1.5, 0.9);
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
      add(new BoxGeometry(0.34, 0.26, 0.1), new MeshStandardMaterial({ color: '#7a5232', roughness: 0.9 }), 0, -0.2, 0);
      add(new BoxGeometry(0.34, 0.09, 0.11), new MeshStandardMaterial({ color: '#5e3d24', roughness: 0.9 }), 0, -0.1, 0);
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
    case 'cup': {
      add(new CylinderGeometry(0.04, 0.032, 0.1, 12), new MeshStandardMaterial({ color: '#c9b78b', roughness: 0.5, metalness: 0.4 }), 0, 0.03, 0);
      break;
    }
  }
  return {
    group: g,
    twoHanded,
    dispose() {
      for (const x of geos) x.dispose();
      for (const x of mats) x.dispose();
    },
  };
}
