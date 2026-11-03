/**
 * Worn gear: helmets, caps, beanies, face scarves, chest rigs, plate carriers and heavy armour, modelled and fitted to
 * each body so a shooter's roles read at a glance (a raider in a beanie and chest rig, a heavy in a helmet and plates).
 *
 * The fit is measured once per mount from the posed mesh (skinned vertex positions in the rig's root frame: the upper
 * cranium for head pieces, a band around the chest for the torso), so a piece hugs a narrow woman's head as well as a
 * broad man's. Pieces are built in the root frame (metres, forward −Z, feet at 0), merged per material and handed to the
 * rig with the bone that carries them. Materials are shared by every character (a few shaders for the whole crowd);
 * geometry is per body (a few hundred triangles a piece).
 */
import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, Shape, SphereGeometry, Vector3, type BufferGeometry, type Material, type Object3D, type SkinnedMesh } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CharacterGear } from '@aether/core';

/** Body measurements in the rig's root frame (metres, forward −Z, feet at y = 0). */
export interface GearFit {
  /** Top of the head (scalp). */
  headTop: number;
  /** Centre and half extents of the upper cranium. */
  cx: number;
  cz: number;
  rx: number;
  rz: number;
  /** Chin height and the front of the face at mouth level. */
  chinY: number;
  faceZ: number;
  /** Half extents of the lower face (mouth to chin) around the cranium centre. */
  jawRx: number;
  jawRz: number;
  /** Chest band: height, front (most negative z), back and half width. */
  chestY: number;
  chestFront: number;
  chestBack: number;
  chestHalf: number;
  /** Top of the shoulders (base of the neck) and the waist. */
  shoulderY: number;
  waistY: number;
}

/** Bones a piece can ride on. */
export type GearBone = 'head' | 'spine' | 'pelvis' | 'lUpper' | 'rUpper';

/** One built piece: a group in the root frame and the bone that carries it. */
export interface GearPiece {
  bone: GearBone;
  group: Group;
}

const _v = new Vector3();
const _w = new Vector3();

/** Posed vertex positions of `mesh` in `root`'s frame, every `stride`-th vertex. */
function posed(mesh: SkinnedMesh, root: Object3D, stride: number, visit: (p: Vector3) => void): void {
  const pos = mesh.geometry.getAttribute('position');
  if (!pos) return;
  _w.copy(root.position);
  for (let i = 0; i < pos.count; i += stride) {
    mesh.getVertexPosition(i, _v);
    mesh.localToWorld(_v);
    root.worldToLocal(_v);
    visit(_v);
  }
}

/**
 * Measure the body (posed as the rig left it; call after `root.updateMatrixWorld(true)`). Head pieces fit the mesh whose
 * material is the head; torso pieces the body mesh. Null when the model has no recognisable head or body mesh.
 */
export function fitBody(scene: Object3D, root: Object3D, spineY: number): GearFit | null {
  let head: SkinnedMesh | null = null;
  let body: SkinnedMesh | null = null;
  scene.traverse((o) => {
    const m = o as SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const name = (Array.isArray(m.material) ? m.material[0]?.name : m.material?.name) ?? '';
    if (/head/i.test(name)) head = m;
    else if (/body/i.test(name)) body = m;
  });
  if (!head || !body) return null;
  const h: SkinnedMesh = head;
  const b: SkinnedMesh = body;
  // Head: the top, then the cranium (the 11 cm under the top) and the lower face.
  let top = -Infinity;
  const hp: number[] = [];
  posed(h, root, 1, (p) => {
    hp.push(p.x, p.y, p.z);
    if (p.y > top) top = p.y;
  });
  if (!Number.isFinite(top)) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < hp.length; i += 3) {
    if ((hp[i + 1] as number) < top - 0.11) continue;
    x0 = Math.min(x0, hp[i] as number); x1 = Math.max(x1, hp[i] as number);
    z0 = Math.min(z0, hp[i + 2] as number); z1 = Math.max(z1, hp[i + 2] as number);
  }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const chinY = top - 0.235;
  let faceZ = cz, jawRx = 0.06, jawRz = 0.06;
  for (let i = 0; i < hp.length; i += 3) {
    const y = hp[i + 1] as number;
    if (y < chinY || y > top - 0.12) continue;
    const x = hp[i] as number, z = hp[i + 2] as number;
    faceZ = Math.min(faceZ, z);
    jawRx = Math.max(jawRx, Math.abs(x - cx));
    jawRz = Math.max(jawRz, Math.abs(z - cz));
  }
  // Chest: a band at the breastbone; the arms hang outside |x| > 0.2 of the centre line.
  const chestY = spineY + 0.04;
  let front = Infinity, back = -Infinity, half = 0.12, shoulder = -Infinity;
  posed(b, root, 2, (p) => {
    if (Math.abs(p.y - chestY) < 0.035 && Math.abs(p.x - cx) < 0.07) {
      front = Math.min(front, p.z);
      back = Math.max(back, p.z);
    }
    if (Math.abs(p.y - chestY) < 0.05 && Math.abs(p.x - cx) < 0.2 && Math.abs(p.z - (front + back) / 2) < 0.2) half = Math.max(half, Math.abs(p.x - cx));
    if (Math.abs(p.x - cx) < 0.12 && Math.abs(p.x - cx) > 0.06 && p.y < chinY && p.y > shoulder) shoulder = p.y;
  });
  if (!Number.isFinite(front) || !Number.isFinite(back)) return null;
  return {
    headTop: top, cx, cz, rx: (x1 - x0) / 2, rz: (z1 - z0) / 2, chinY, faceZ, jawRx, jawRz,
    chestY, chestFront: front, chestBack: back, chestHalf: Math.min(0.2, half), shoulderY: Number.isFinite(shoulder) ? Math.min(shoulder, chestY + 0.16) : chestY + 0.14, waistY: chestY - 0.3,
  };
}

// ---------------------------------------------------------------------------
// Shared materials
// ---------------------------------------------------------------------------

const materials = new Map<string, MeshStandardMaterial>();

/** A shared gear material (never disposed: a handful for the whole session). */
function mat(key: string, color: string, roughness: number, metalness = 0): MeshStandardMaterial {
  let m = materials.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ name: `gear-${key}`, color, roughness, metalness });
    materials.set(key, m);
  }
  return m;
}

/** Colours of the pieces by who wears them (`role` = wardrobe kind, e.g. guard, bandit). */
function palette(role: string, heavy: boolean): { shell: MeshStandardMaterial; webbing: MeshStandardMaterial; pouch: MeshStandardMaterial; knit: MeshStandardMaterial; cloth: MeshStandardMaterial; cap: MeshStandardMaterial } {
  if (heavy) return { shell: mat('shell-heavy', '#2b2d2c', 0.62, 0.15), webbing: mat('web-heavy', '#262823', 0.9), pouch: mat('pouch-heavy', '#33352e', 0.88), knit: mat('knit', '#262628', 0.97), cloth: mat('scarf', '#6d5e48', 0.95), cap: mat('cap', '#3d4636', 0.9) };
  if (role === 'guard') return { shell: mat('shell-guard', '#4a4d3f', 0.66, 0.05), webbing: mat('web-guard', '#4a5140', 0.9), pouch: mat('pouch-guard', '#545b48', 0.88), knit: mat('knit', '#262628', 0.97), cloth: mat('scarf', '#6d5e48', 0.95), cap: mat('cap', '#3d4636', 0.9) };
  if (role === 'bandit') return { shell: mat('shell-raider', '#4f4a3e', 0.7), webbing: mat('web-raider', '#3f3a2f', 0.92), pouch: mat('pouch-raider', '#544a39', 0.9), knit: mat('knit-raider', '#2d2a27', 0.97), cloth: mat('scarf-raider', '#4f4637', 0.96), cap: mat('cap-raider', '#4a4234', 0.9) };
  return { shell: mat('shell', '#5a5644', 0.66), webbing: mat('web', '#3d3d33', 0.9), pouch: mat('pouch', '#5a5443', 0.88), knit: mat('knit', '#262628', 0.97), cloth: mat('scarf', '#6d5e48', 0.95), cap: mat('cap', '#3d4636', 0.9) };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Parts by material, merged into one mesh each. */
class Bag {
  readonly parts = new Map<Material, BufferGeometry[]>();
  add(m: Material, g: BufferGeometry): void {
    const list = this.parts.get(m) ?? [];
    list.push(g);
    this.parts.set(m, list);
  }
  build(name: string): Group {
    const group = new Group();
    group.name = name;
    for (const [m, list] of this.parts) {
      const flat = list.map((g) => {
        const n = g.index ? g.toNonIndexed() : g;
        if (n !== g) g.dispose();
        for (const a of Object.keys(n.attributes)) if (a !== 'position' && a !== 'normal' && a !== 'uv') n.deleteAttribute(a);
        n.clearGroups();
        return n;
      });
      const merged = flat.length === 1 ? (flat[0] as BufferGeometry) : mergeGeometries(flat, false);
      if (flat.length > 1) for (const g of flat) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new Mesh(merged, m);
      mesh.name = `${name}-${m.name}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

/** An ellipsoid shell cut at `theta` from the top (radians), centred at `c`. */
function dome(c: Vector3, rx: number, ry: number, rz: number, theta: number, seg = 16): BufferGeometry {
  return new SphereGeometry(1, seg, Math.max(5, Math.round(seg * 0.45)), 0, Math.PI * 2, 0, theta).scale(rx, ry, rz).translate(c.x, c.y, c.z);
}

/** A rounded rectangle `w` × `h` (centred), `t` thick along Z, with corner radius `r`. */
function slab(w: number, h: number, t: number, r: number): BufferGeometry {
  const s = new Shape();
  const x = w / 2, y = h / 2;
  s.moveTo(-x + r, -y);
  s.lineTo(x - r, -y);
  s.quadraticCurveTo(x, -y, x, -y + r);
  s.lineTo(x, y - r);
  s.quadraticCurveTo(x, y, x - r, y);
  s.lineTo(-x + r, y);
  s.quadraticCurveTo(-x, y, -x, y - r);
  s.lineTo(-x, -y + r);
  s.quadraticCurveTo(-x, -y, -x + r, -y);
  const bevel = Math.min(0.006, t * 0.3);
  const g = new ExtrudeGeometry(s, { depth: Math.max(0.001, t - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 3 });
  g.translate(0, 0, -(t - 2 * bevel) / 2);
  return g;
}

/** A flat strap `w` wide and `t` thick from `a` to `b`. */
function beam(a: Vector3, b: Vector3, w: number, t: number): BufferGeometry {
  const len = a.distanceTo(b);
  const g = new BoxGeometry(w, len, t);
  const dir = b.clone().sub(a).normalize();
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** A pouch (a soft box with a flap), its back against a plane facing `dir` (−1 front, +1 back). */
function pouch(b: Bag, body: Material, flap: Material, x: number, y: number, z: number, w: number, h: number, d: number, dir: -1 | 1): void {
  b.add(body, slab(w, h, d, Math.min(w, h) * 0.18).translate(x, y, z + (dir * d) / 2));
  b.add(flap, new BoxGeometry(w * 1.04, h * 0.3, d * 0.25).translate(x, y + h * 0.36, z + dir * (d + d * 0.08)));
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/**
 * Build the pieces for `gear` on a body measured by `fit`. `role` picks the colours (wardrobe kind); `heavy` the dark
 * heavy-armour palette. Pieces share the bone they ride on: one group per bone.
 */
export function buildGear(gear: readonly CharacterGear[], fit: GearFit, role: string): GearPiece[] {
  if (gear.length === 0) return [];
  const heavy = gear.includes('heavy-armor');
  const pal = palette(role, heavy);
  const head = new Bag();
  const torso = new Bag();
  const pelvis = new Bag();
  const arms: Record<'lUpper' | 'rUpper', Bag> = { lUpper: new Bag(), rUpper: new Bag() };
  const cranium = new Vector3(fit.cx, fit.headTop - 0.105, fit.cz + 0.005);
  const rx = fit.rx, rz = fit.rz;

  if (gear.includes('helmet')) {
    // A ballistic helmet: a shell standing 2 cm off the scalp, cut high over the ears, a rim, side rails and a front mount.
    const c = cranium.clone().setY(cranium.y + 0.008);
    head.add(pal.shell, dome(c, rx + 0.026, 0.128, rz + 0.026, Math.PI * 0.56, 18));
    head.add(pal.shell, new CylinderGeometry(1, 1, 0.012, 18, 1, true).scale(rx + 0.03, 1, rz + 0.03).translate(c.x, c.y + 0.128 * Math.cos(Math.PI * 0.56) + 0.005, c.z));
    for (const sx of [-1, 1]) head.add(pal.webbing, new BoxGeometry(0.008, 0.022, 0.1).translate(c.x + sx * (rx + 0.03), c.y + 0.0, c.z));
    head.add(pal.webbing, new BoxGeometry(0.04, 0.026, 0.014).translate(c.x, c.y + 0.07, c.z - rz - 0.03));
    head.add(pal.webbing, new BoxGeometry(0.008, 0.08, 0.008).translate(c.x - rx * 0.6, c.y - 0.075, c.z - 0.01).rotateZ(0));
  } else if (gear.includes('beanie')) {
    // A knit watch cap pulled down to the eyebrows, its brim folded up.
    const c = cranium.clone().setY(cranium.y + 0.004);
    head.add(pal.knit, dome(c.setY(c.y + 0.004), rx + 0.014, 0.12, rz + 0.016, Math.PI * 0.6, 16));
    head.add(pal.knit, new CylinderGeometry(1, 1, 0.03, 16, 1, true).scale(rx + 0.02, 1, rz + 0.022).translate(c.x, c.y + 0.12 * Math.cos(Math.PI * 0.6) + 0.014, c.z));
  } else if (gear.includes('cap')) {
    // A baseball cap: a six-panel crown and a curved bill over the brow.
    const c = cranium.clone().setY(cranium.y + 0.006);
    head.add(pal.cap, dome(c, rx + 0.012, 0.112, rz + 0.012, Math.PI * 0.5, 16));
    const bill = new SphereGeometry(1, 12, 3, Math.PI * 1.25, Math.PI * 0.5, Math.PI * 0.47, Math.PI * 0.06).scale(rx + 0.06, 0.12, rz + 0.075).translate(c.x, c.y, c.z);
    head.add(pal.cap, bill);
  }
  if (gear.includes('scarf')) {
    // A neck gaiter: a loose tube of cloth from the collar up over the chin, ready to pull up over the face.
    const y0 = fit.chinY - 0.085, y1 = fit.chinY + 0.005;
    const bx = rx * 0.72, bz = rz * 0.74;
    head.add(pal.cloth, new CylinderGeometry(1.08, 0.98, y1 - y0, 16, 2, true).scale(bx, 1, bz).translate(fit.cx, (y0 + y1) / 2, fit.cz + 0.012));
    head.add(pal.cloth, new CylinderGeometry(1.0, 1.08, 0.02, 16, 1, true).scale(bx, 1, bz).translate(fit.cx, y0 + 0.004, fit.cz + 0.012));
  }

  const front = fit.chestFront, back = fit.chestBack, half = fit.chestHalf;
  const midZ = (front + back) / 2;
  if (gear.includes('plate-carrier') || heavy) {
    // Front and back plates in a carrier, a cummerbund round the sides, shoulder straps, magazine pouches across the front.
    const t = heavy ? 0.065 : 0.045;
    const w = Math.min(0.34, half * 2 * (heavy ? 0.95 : 0.84));
    const ph = heavy ? 0.36 : 0.31;
    const py = fit.chestY - 0.07;
    torso.add(pal.webbing, slab(w, ph, t, 0.05).translate(fit.cx, py, front - t / 2 + 0.02));
    torso.add(pal.webbing, slab(w, ph, t, 0.05).translate(fit.cx, py, back + t / 2 - 0.02));
    const cumY = py - ph * 0.22;
    for (const sx of [-1, 1]) {
      torso.add(pal.webbing, new BoxGeometry(0.03, 0.15, back - front + 0.01).translate(fit.cx + sx * (half + 0.004), cumY, midZ));
      // Shoulder straps arching from the front plate to the back plate.
      torso.add(pal.webbing, new BoxGeometry(0.055, 0.02, back - front + 0.03).translate(fit.cx + sx * w * 0.3, fit.shoulderY + 0.01, midZ));
    }
    const pz = front - t + 0.02;
    const n = heavy ? 3 : 3;
    for (let i = 0; i < n; i++) pouch(torso, pal.pouch, pal.webbing, fit.cx + (i - (n - 1) / 2) * (w / n), py - ph * 0.22, pz, w / n - 0.012, 0.12, 0.045, -1);
    pouch(torso, pal.pouch, pal.webbing, fit.cx, py + ph * 0.2, pz, w * 0.4, 0.07, 0.03, -1);
    if (heavy) {
      // Heavy armour: a high collar, shoulder plates on the upper arms and a groin plate.
      torso.add(pal.shell, new CylinderGeometry(1, 1.1, 0.06, 16, 1, true).scale(half * 0.62, 1, (back - front) * 0.62).translate(fit.cx, fit.shoulderY + 0.035, midZ));
      for (const [bone, sx] of [['lUpper', 1], ['rUpper', -1]] as const) {
        const ax = fit.cx + sx * (half + 0.03);
        arms[bone].add(pal.shell, dome(new Vector3(ax, fit.shoulderY - 0.035, midZ), 0.062, 0.05, 0.072, Math.PI * 0.45, 12));
      }
      pelvis.add(pal.webbing, slab(w * 0.5, 0.16, 0.03, 0.04).translate(fit.cx, fit.waistY - 0.08, front - 0.005));
    }
  } else if (gear.includes('chest-rig')) {
    // A chest rig: a row of magazine pouches on a panel at the bottom of the ribs, an H-harness over the shoulders.
    const w = Math.min(0.3, half * 2 * 0.86);
    const py = fit.chestY - 0.15;
    torso.add(pal.webbing, slab(w, 0.13, 0.02, 0.025).translate(fit.cx, py, front + 0.03));
    for (let i = 0; i < 4; i++) pouch(torso, pal.pouch, pal.webbing, fit.cx + (i - 1.5) * (w / 4), py + 0.005, front + 0.02, w / 4 - 0.01, 0.12, 0.04, -1);
    for (const sx of [-1, 1]) {
      // Straps from the top of the panel up over the chest and the shoulder, then straight down the back.
      const x = fit.cx + sx * w * 0.3;
      const sy = Math.min(fit.shoulderY - 0.01, fit.chestY + 0.12);
      const top = new Vector3(x, sy, midZ - (back - front) * 0.15);
      torso.add(pal.webbing, beam(new Vector3(x, py + 0.06, front + 0.028), top, 0.03, 0.008));
      torso.add(pal.webbing, beam(top, new Vector3(x, sy - 0.01, back - 0.004), 0.03, 0.008));
      torso.add(pal.webbing, beam(new Vector3(x, sy - 0.01, back + 0.002), new Vector3(x, py, back + 0.004), 0.03, 0.008));
    }
  }
  const out: GearPiece[] = [];
  if (head.parts.size) out.push({ bone: 'head', group: head.build('gear-head') });
  if (torso.parts.size) out.push({ bone: 'spine', group: torso.build('gear-torso') });
  if (pelvis.parts.size) out.push({ bone: 'pelvis', group: pelvis.build('gear-pelvis') });
  for (const k of ['lUpper', 'rUpper'] as const) if (arms[k].parts.size) out.push({ bone: k, group: arms[k].build(`gear-${k}`) });
  return out;
}

/** Free the geometry of built pieces (materials are shared). */
export function disposeGear(pieces: readonly GearPiece[]): void {
  for (const p of pieces) p.group.traverse((o) => (o as Mesh).isMesh && (o as Mesh).geometry.dispose());
}
