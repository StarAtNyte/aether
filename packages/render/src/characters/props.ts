/**
 * Hand-held props for characters. Each prop is built in a "grip frame":
 * the point the fingers close on is the origin and the long axis runs along +Y,
 * so the rig only has to map that frame onto the hand bone once. Props are
 * small procedural meshes (no files, no licences); two-handed carries
 * (`crate`) use the chest anchor instead of a hand.
 */
import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, LatheGeometry, Mesh, MeshStandardMaterial, Object3D, Shape, SphereGeometry, TorusGeometry, Vector2, type BufferAttribute, type BufferGeometry, type Material } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CharacterHold } from '@aether/core';

/** A built prop with the resources it owns. */
export interface Prop {
  group: Group;
  /** True for props carried in both hands in front of the chest. */
  twoHanded: boolean;
  /** True for a pack worn on the back (mounted on the spine, both hands stay free). */
  onBack?: boolean;
  /**
   * A long gun held at the ready in both hands: the prop is built along −Z (forward) with its origin at the pistol
   * grip, mounted in front of the right shoulder; `grip` and `fore` are where the right and left hands close, in the
   * prop's frame.
   */
  shouldered?: { grip: readonly [number, number, number]; fore: readonly [number, number, number] };
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
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  let twoHanded = false;
  let onBack = false;
  let flameAnchor: Object3D | undefined;
  let shouldered: Prop['shouldered'];
  switch (kind) {
    case 'rifle': {
      shouldered = buildCarbine(g, geos, mats);
      break;
    }
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
      buildSword(g, geos, mats);
      break;
    }
    case 'spear': {
      buildSpear(g, geos, mats);
      break;
    }
    case 'axe': {
      buildAxe(g, geos, mats);
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
    ...(shouldered ? { shouldered } : {}),
    dispose() {
      for (const x of geos) x.dispose();
      for (const x of mats) x.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Modelled props: parts built from extruded side profiles, lathes and tubes, merged per material so a carbine or an axe
// is a handful of draws (one per material), with real silhouettes instead of stacked boxes.
// ---------------------------------------------------------------------------

type V2 = readonly [number, number];

/** Parts of one prop, grouped by material and merged into one mesh per material when the prop is finished. */
class Parts {
  private readonly byMat = new Map<Material, BufferGeometry[]>();
  add(mat: Material, geo: BufferGeometry): BufferGeometry {
    const list = this.byMat.get(mat) ?? [];
    list.push(geo);
    this.byMat.set(mat, list);
    return geo;
  }
  /** Merge, add the meshes to `g` and hand their geometry and materials to the prop for disposal. */
  finish(g: Group, geos: BufferGeometry[], mats: Material[]): void {
    for (const [mat, list] of this.byMat) {
      const flat = list.map((x) => {
        const n = x.index ? x.toNonIndexed() : x;
        if (n !== x) x.dispose();
        for (const name of Object.keys(n.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') n.deleteAttribute(name);
        n.clearGroups();
        return n;
      });
      const merged = flat.length === 1 ? (flat[0] as BufferGeometry) : mergeGeometries(flat, false);
      if (flat.length > 1) for (const x of flat) x.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      geos.push(merged);
      mats.push(mat);
      const m = new Mesh(merged, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    this.byMat.clear();
  }
}

/** A side profile (`[forward, up]` points, forward = −Z) extruded `width` wide across X, with softened edges. */
function sideProfile(pts: readonly V2[], width: number, bevel = 0.003): BufferGeometry {
  const shape = new Shape(pts.map(([s, y]) => new Vector2(s, y)));
  const depth = Math.max(0.0005, width - 2 * bevel);
  const geo = new ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.6, bevelSegments: 1, curveSegments: 4 });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(Math.PI / 2);
  return geo;
}

/** A front profile (`[x, y]` points) extruded `depth` along Z and centred on it (blades and heads in the grip frame). */
function frontProfile(pts: readonly V2[], depth: number, bevel = 0.002): BufferGeometry {
  const shape = new Shape(pts.map(([x, y]) => new Vector2(x, y)));
  const d = Math.max(0.0005, depth - 2 * bevel);
  const geo = new ExtrudeGeometry(shape, { depth: d, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.6, bevelSegments: 1, curveSegments: 6 });
  geo.translate(0, 0, -d / 2);
  return geo;
}

/** Thin a front-extruded part toward its edges (an axe bit, a blade): Z shrinks to `edge` of itself where `f(x, y)` is 1. */
function taper(geo: BufferGeometry, f: (x: number, y: number) => number, edge: number): BufferGeometry {
  const pos = geo.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const k = Math.min(1, Math.max(0, f(pos.getX(i), pos.getY(i))));
    pos.setZ(i, pos.getZ(i) * (1 - k * (1 - edge)));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** A tube along the forward axis from `s0` to `s1` (forward = −Z) at height `y`. */
function tube(r0: number, r1: number, s0: number, s1: number, y: number, seg = 10, x = 0): BufferGeometry {
  const geo = new CylinderGeometry(r1, r0, Math.abs(s1 - s0), seg);
  geo.rotateX(-Math.PI / 2);
  geo.translate(x, y, -(s0 + s1) / 2);
  return geo;
}

/** A box `w` wide, `h` tall and `len` long centred at forward `s`, height `y`. */
function block(w: number, h: number, len: number, s: number, y: number, x = 0): BufferGeometry {
  return new BoxGeometry(w, h, len).translate(x, y, -s);
}

/**
 * A compact 5.56 carbine at about 1:1: flat-top upper with a full-length rail, lower with magazine well and trigger
 * guard, raked pistol grip, curved polymer magazine, octagonal free-float handguard, barrel with front sight and flash
 * hider, buffer tube and adjustable stock with a rubber pad, and a red-dot sight. Anodised aluminium, polymer, rubber
 * and glass: four draws, about 2k triangles. Origin at the pistol grip, muzzle along −Z.
 */
function buildCarbine(g: Group, geos: BufferGeometry[], mats: Material[]): NonNullable<Prop['shouldered']> {
  const metal = new MeshStandardMaterial({ name: 'carbine-metal', color: '#24272a', roughness: 0.42, metalness: 0.78 });
  const poly = new MeshStandardMaterial({ name: 'carbine-polymer', color: '#2b2c28', roughness: 0.74, metalness: 0.04 });
  const rubber = new MeshStandardMaterial({ name: 'carbine-rubber', color: '#181818', roughness: 0.92, metalness: 0 });
  const glass = new MeshStandardMaterial({ name: 'carbine-glass', color: '#0d1a22', roughness: 0.08, metalness: 0.5, emissive: '#5a0c06', emissiveIntensity: 0.35 });
  const p = new Parts();
  const bore = 0.062;
  // Upper receiver (sloped rear), lower receiver with the magazine well, trigger guard and trigger.
  p.add(metal, sideProfile([[-0.07, 0.03], [0.2, 0.03], [0.2, 0.088], [-0.052, 0.088], [-0.07, 0.072]], 0.05));
  p.add(metal, sideProfile([[-0.062, 0.031], [0.19, 0.031], [0.19, -0.03], [0.182, -0.036], [0.088, -0.036], [0.082, -0.006], [-0.03, -0.006], [-0.062, 0.012]], 0.046));
  p.add(metal, block(0.012, 0.006, 0.09, 0.04, -0.037));
  p.add(metal, sideProfile([[0.04, -0.006], [0.05, -0.006], [0.046, -0.03], [0.04, -0.028]], 0.006, 0.001));
  // Ejection port cover and forward assist on the right side, charging handle at the back.
  p.add(poly, block(0.003, 0.022, 0.07, 0.07, 0.058, 0.026));
  p.add(metal, tube(0.008, 0.008, -0.04, -0.005, 0.07, 8, 0.03));
  p.add(metal, block(0.044, 0.01, 0.02, -0.058, 0.082));
  // Picatinny rail along the top, its cross slots as raised teeth.
  p.add(metal, block(0.022, 0.008, 0.62, 0.25, 0.093));
  for (let s = -0.045; s < 0.55; s += 0.028) p.add(metal, block(0.024, 0.004, 0.013, s, 0.099));
  // Free-float handguard: an octagon with a flat on top, a thinner nose ring.
  p.add(poly, new CylinderGeometry(0.029, 0.029, 0.325, 8).rotateX(-Math.PI / 2).rotateZ(Math.PI / 8).translate(0, bore, -0.3625));
  p.add(metal, tube(0.027, 0.024, 0.525, 0.535, bore, 8));
  // Barrel, gas block, front sight post and flash hider.
  p.add(metal, tube(0.0088, 0.0082, 0.535, 0.725, bore, 10));
  p.add(metal, block(0.022, 0.022, 0.022, 0.552, bore));
  p.add(metal, sideProfile([[0.538, 0.07], [0.566, 0.07], [0.557, 0.112], [0.547, 0.112]], 0.012, 0.0015));
  p.add(metal, tube(0.0125, 0.0125, 0.722, 0.778, bore, 8));
  p.add(metal, tube(0.011, 0.011, 0.778, 0.786, bore, 8));
  // Pistol grip and the curved magazine (polymer).
  p.add(poly, sideProfile([[0.036, -0.002], [-0.012, -0.002], [-0.056, -0.1], [-0.049, -0.111], [-0.012, -0.109], [0.004, -0.1]], 0.032, 0.005));
  p.add(poly, sideProfile([[0.095, -0.03], [0.099, -0.09], [0.113, -0.15], [0.133, -0.196], [0.224, -0.187], [0.205, -0.142], [0.191, -0.086], [0.178, -0.03]], 0.026, 0.003));
  p.add(rubber, sideProfile([[0.128, -0.192], [0.135, -0.205], [0.232, -0.196], [0.228, -0.184]], 0.03, 0.002));
  // Buffer tube, adjustable stock with a cheek rest, rubber butt pad.
  p.add(metal, tube(0.0155, 0.0155, -0.07, -0.29, bore, 10));
  p.add(poly, sideProfile([[-0.165, 0.09], [-0.165, 0.034], [-0.2, -0.004], [-0.214, -0.046], [-0.326, -0.056], [-0.334, -0.05], [-0.334, 0.088], [-0.3, 0.097], [-0.2, 0.097]], 0.042, 0.005));
  p.add(rubber, block(0.044, 0.152, 0.012, -0.339, 0.02));
  // Red-dot sight on a riser: tube, mount and lenses.
  p.add(metal, block(0.03, 0.022, 0.05, 0.07, 0.108));
  p.add(metal, tube(0.0195, 0.0195, 0.03, 0.108, 0.128, 14));
  p.add(metal, block(0.012, 0.012, 0.02, 0.068, 0.15));
  p.add(glass, tube(0.0165, 0.0165, 0.106, 0.11, 0.128, 14));
  p.add(glass, tube(0.0165, 0.0165, 0.028, 0.032, 0.128, 14));
  p.finish(g, geos, mats);
  return { grip: [0, -0.03, 0.02], fore: [0, 0.01, -0.42] };
}

/** A felling axe: a swelled, oval hickory haft with a leather-wrapped foot, a forged head with a wedge bit and a poll. */
function buildAxe(g: Group, geos: BufferGeometry[], mats: Material[]): void {
  const hickory = new MeshStandardMaterial({ name: 'axe-haft', color: '#7a5a3a', roughness: 0.62 });
  const steel = new MeshStandardMaterial({ name: 'axe-head', color: '#45484c', roughness: 0.46, metalness: 0.85 });
  const leather = new MeshStandardMaterial({ name: 'axe-wrap', color: '#3b2618', roughness: 0.8 });
  const p = new Parts();
  const haft = new LatheGeometry([[0, -0.2], [0.017, -0.2], [0.022, -0.18], [0.018, -0.13], [0.0165, 0.1], [0.0155, 0.45], [0.017, 0.63], [0.0165, 0.7], [0, 0.705]].map(([r, y]) => new Vector2(r, y)), 10);
  haft.scale(1, 1, 0.78);
  p.add(hickory, haft);
  for (let i = 0; i < 4; i++) p.add(leather, new TorusGeometry(0.0185, 0.004, 4, 12).rotateX(Math.PI / 2).scale(1, 1, 0.8).translate(0, -0.165 + i * 0.018, 0));
  const head = frontProfile([[-0.048, 0.59], [-0.048, 0.672], [-0.02, 0.682], [0.035, 0.676], [0.09, 0.7], [0.136, 0.735], [0.152, 0.7], [0.158, 0.625], [0.152, 0.55], [0.134, 0.52], [0.092, 0.562], [0.035, 0.588], [-0.02, 0.582]], 0.038, 0.004);
  p.add(steel, taper(head, (x) => (x - 0.03) / 0.125, 0.12));
  p.add(hickory, block(0.008, 0.004, 0.03, 0, 0.684));
  p.finish(g, geos, mats);
}

/** An arming sword: a tapering blade with a diamond section, a slightly swept crossguard, a wrapped grip and a pommel. */
function buildSword(g: Group, geos: BufferGeometry[], mats: Material[]): void {
  const blade = new MeshStandardMaterial({ name: 'sword-blade', color: '#b9bec4', roughness: 0.28, metalness: 0.92 });
  const brass = new MeshStandardMaterial({ name: 'sword-fittings', color: '#8a6a2a', roughness: 0.45, metalness: 0.75 });
  const grip = new MeshStandardMaterial({ name: 'sword-grip', color: '#3a2618', roughness: 0.78 });
  const p = new Parts();
  const b = frontProfile([[-0.024, 0.1], [0.024, 0.1], [0.021, 0.62], [0.012, 0.8], [0, 0.88], [-0.012, 0.8], [-0.021, 0.62]], 0.009, 0.0015);
  p.add(blade, taper(b, (x) => Math.abs(x) / 0.024, 0.15));
  p.add(brass, frontProfile([[-0.105, 0.096], [-0.1, 0.112], [0, 0.104], [0.1, 0.112], [0.105, 0.096], [0, 0.088]], 0.03, 0.006));
  p.add(grip, new LatheGeometry([[0, -0.06], [0.014, -0.06], [0.017, 0.0], [0.014, 0.088], [0, 0.088]].map(([r, y]) => new Vector2(r, y)), 10));
  for (let i = 0; i < 6; i++) p.add(grip, new TorusGeometry(0.016, 0.0025, 4, 10).rotateX(Math.PI / 2).translate(0, -0.045 + i * 0.024, 0));
  p.add(brass, new SphereGeometry(0.026, 10, 8).scale(1, 0.8, 0.7).translate(0, -0.075, 0));
  p.finish(g, geos, mats);
}

/** A spear: a tapering ash shaft with a steel butt cap and a leaf-shaped head on a socket. */
function buildSpear(g: Group, geos: BufferGeometry[], mats: Material[]): void {
  const ash = new MeshStandardMaterial({ name: 'spear-shaft', color: '#8a6a44', roughness: 0.62 });
  const steel = new MeshStandardMaterial({ name: 'spear-head', color: '#8e9399', roughness: 0.35, metalness: 0.9 });
  const p = new Parts();
  p.add(ash, new CylinderGeometry(0.015, 0.018, 2.0, 10).translate(0, 0.45, 0));
  p.add(steel, new CylinderGeometry(0.019, 0.019, 0.05, 10).translate(0, -0.53, 0));
  p.add(steel, new CylinderGeometry(0.011, 0.019, 0.12, 10).translate(0, 1.5, 0));
  const head = frontProfile([[0, 1.55], [0.028, 1.6], [0.034, 1.66], [0.02, 1.74], [0, 1.8], [-0.02, 1.74], [-0.034, 1.66], [-0.028, 1.6]], 0.012, 0.002);
  p.add(steel, taper(head, (x) => Math.abs(x) / 0.034, 0.18));
  p.finish(g, geos, mats);
}
