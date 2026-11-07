/**
 * Kaho's body, built from the proportioned skeleton to match her model sheet
 * (docs/worlds/cloudwatch-concept/, generated concept art used as reference
 * only): head (signed-distance shape with a painted face), hair (cap, a
 * chin-length bob in large clumps curling in at the tips, side-parted bangs
 * laid on the forehead, a thin braid behind her left ear with a seashell
 * charm), summer sailor uniform (blouse with a chest pocket, a sky-blue collar
 * with two white lines, a deep-teal neckerchief, short sleeves, a knee-length
 * skirt in twelve knife pleats), a digital wristwatch, socks, loafers, arms
 * and hands.
 *
 * Everything is in the bind pose, metres, +Y up, facing +Z, her left at +X.
 */
import { Vector3 } from 'three';
import { addSecondary, boneIndex, type KBone } from './skeleton';
import { clamp, envelope, frame, lerp, loft, mixSkin, normaliseSkin, Part, section, smoothstep, spline, type Ring, type Seg, type Skin, type Toon } from './mesh';
import { collarUv, faceUv, hairUv, swatchUv, COLLAR_RANGE, type Swatch } from './paint';

/** A spring chain the runtime swings (bone names root to tip, tip offset of the last bone in its local frame). */
export interface SpringChain {
  name: string;
  bones: string[];
  tip: [number, number, number];
  stiffness: number;
  drag: number;
  gravity: number;
  /** Collision radius of the chain's points (m). */
  radius: number;
  /** Largest swing from the rest direction (radians). */
  limit: number;
}

/** A collision capsule on a Biped bone (head and tail in the bone's local frame). */
export interface Collider {
  bone: string;
  head: [number, number, number];
  tail: [number, number, number];
  radius: number;
}

export interface BuiltBody {
  part: Part;
  springs: SpringChain[];
  colliders: Collider[];
}

const T_SKIN: Toon = [0.8, 0.08, 1, 0];
const T_FACE: Toon = [0.55, 0.62, 0.6, 0];
const T_CLOTH: Toon = [1, 0, 1, 0];
const T_HAIR: Toon = [1, 0.02, 1, 0];
const T_SMALL: Toon = [0.55, 0.05, 0.6, 0];

const V = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
/** Skirt hem half-width and half-depth (m): a moderate flare, so the hanging hands clear it. */
const HEM_X = 0.2;
const HEM_Z = 0.168;
/** Knife pleats round the skirt (the sheet's twelve). */
const PLEATS = 12;

/** Build the whole body; adds secondary bones to `bones`. */
export function buildBody(bones: KBone[]): BuiltBody {
  const J = (n: string): Vector3 => (bones[boneIndex(bones, n)] as KBone).pos.clone();
  const B = (n: string): number => boneIndex(bones, n);
  const part = new Part('kaho');
  const springs: SpringChain[] = [];
  const colliders: Collider[] = [];

  // -------------------------------------------------------------------------
  // Head frame and shapes
  // -------------------------------------------------------------------------
  const HB = J('Bip01_Head');
  const O = HB.clone().add(V(0, -0.042, 0.018));
  const headSdf = (q: Vector3): number => {
    // Cranium (ellipsoid, approximate distance).
    const c = q.clone().sub(V(0, 0.122, -0.006));
    const r = V(0.086, 0.1, 0.094);
    const k0 = c.clone().divide(r).length();
    const k1 = c.clone().divide(r).divide(r).length();
    const cran = (k0 * (k0 - 1)) / k1;
    // Lower face: a round cone from the cheeks to the chin.
    const face = roundCone(q, V(0, 0.086, 0.02), 0.076, V(0, 0.03, 0.057), 0.021);
    let d = smin(cran, face, 0.034);
    // Nose hint.
    d = smin(d, q.distanceTo(V(0, 0.062, 0.083)) - 0.0055, 0.012);
    return d;
  };
  const HAIR_C = O.clone().add(V(0, 0.122, -0.008));
  const HAIR_R = V(0.0985, 0.1115, 0.1035);
  const hairDir = (lon: number, lat: number): Vector3 => V(Math.sin(lat) * Math.sin(lon), Math.cos(lat), Math.sin(lat) * Math.cos(lon));
  const hairPoint = (lon: number, lat: number, lift = 0): Vector3 => HAIR_C.clone().add(hairDir(lon, lat).multiply(HAIR_R).multiplyScalar(1 + lift));
  const crownY = HAIR_C.y + HAIR_R.y;
  const hairV = (y: number): number => clamp((crownY - y) / 0.3, 0, 1);
  const HEAD_CENTRE = V(0, 0.095, 0.004);
  /** The skull surface along the ray from the head's centre through `p`, pushed out by `gap` (m). */
  const onHead = (p: Vector3, gap: number): Vector3 => {
    const d = p.clone().sub(O).sub(HEAD_CENTRE).normalize();
    let lo = 0;
    let hi = 0.3;
    for (let k = 0; k < 32; k++) {
      const m = (lo + hi) / 2;
      if (headSdf(HEAD_CENTRE.clone().addScaledVector(d, m)) < 0) lo = m;
      else hi = m;
    }
    return O.clone().add(HEAD_CENTRE).addScaledVector(d, (lo + hi) / 2 + gap);
  };

  // -------------------------------------------------------------------------
  // Secondary bones (added before skinning so indices are known)
  // -------------------------------------------------------------------------
  // Skirt: eight panels hanging from the waist.
  const SKIRT_TOP = 1.0;
  // Knee-length, as on the sheet: the hem a hand above the knee joint.
  const SKIRT_HEM = J('Bip01_L_Calf').y + 0.075;
  const SKIRT_N = 8;
  const skirtBones: number[] = [];
  const pelvis = J('Bip01_Pelvis');
  for (let k = 0; k < SKIRT_N; k++) {
    const a = (k / SKIRT_N) * Math.PI * 2;
    const at = V(Math.sin(a) * 0.085, 0.965, pelvis.z + Math.cos(a) * 0.065);
    skirtBones.push(addSecondary(bones, `Skirt_${k}`, 'Bip01_Pelvis', at));
  }
  // Hem point of each panel at rest (the tip of the chain).
  const skirtHem = (a: number): Vector3 => V(Math.sin(a) * HEM_X, SKIRT_HEM, pelvis.z - 0.005 + Math.cos(a) * HEM_Z);
  for (let k = 0; k < SKIRT_N; k++) {
    const a = (k / SKIRT_N) * Math.PI * 2;
    const bone = bones[skirtBones[k] as number] as KBone;
    const tip = skirtHem(a).sub(bone.pos);
    springs.push({ name: `skirt${k}`, bones: [bone.name], tip: [tip.x, tip.y, tip.z], stiffness: 0.34, drag: 0.24, gravity: 0.2, radius: 0.022, limit: 0.6 });
  }
  // The braid: a thin three-strand braid behind her left ear (+X), from under the bob to below the jaw, with the
  // seashell charm at its end. Two spring bones.
  const braidPath = [hairPoint(1.86, 1.2, 0.012), hairPoint(1.9, 1.48, 0.03), hairPoint(1.92, 1.72, 0.05), hairPoint(1.93, 1.72, 0.05).add(V(0.004, -0.06, -0.004)), hairPoint(1.93, 1.72, 0.05).add(V(0.006, -0.125, -0.006))];
  const br1 = addSecondary(bones, 'Hair_Braid_1', 'Bip01_Head', spline(braidPath, 0.45));
  const br2 = addSecondary(bones, 'Hair_Braid_2', 'Hair_Braid_1', spline(braidPath, 0.74));
  {
    const tip = spline(braidPath, 1).add(V(0, -0.026, 0)).sub((bones[br2] as KBone).pos);
    springs.push({ name: 'braid', bones: ['Hair_Braid_1', 'Hair_Braid_2'], tip: [tip.x, tip.y, tip.z], stiffness: 0.22, drag: 0.18, gravity: 0.6, radius: 0.012, limit: 0.9 });
  }
  // Side locks, framing the face.
  const sideLock: Record<number, { path: Vector3[]; bones: number[] }> = {};
  for (const side of [1, -1]) {
    const lon = side * 1.32;
    const s0 = hairPoint(lon, 0.75, 0.035);
    const s1 = hairPoint(lon, 1.32, 0.045);
    const hang = s1.clone().add(V(side * 0.002, -0.05, 0.012));
    const tipP = s1.clone().add(V(side * -0.012, -0.112, 0.02));
    const path = [s0, hairPoint(lon, 1.05, 0.04), s1, hang, tipP];
    const name = side > 0 ? 'L' : 'R';
    const b1 = addSecondary(bones, `Hair_Side${name}_1`, 'Bip01_Head', spline(path, 0.5));
    const b2 = addSecondary(bones, `Hair_Side${name}_2`, `Hair_Side${name}_1`, spline(path, 0.76));
    const tip = tipP.clone().sub((bones[b2] as KBone).pos);
    springs.push({ name: `side${name}`, bones: [`Hair_Side${name}_1`, `Hair_Side${name}_2`], tip: [tip.x, tip.y, tip.z], stiffness: 0.3, drag: 0.2, gravity: 0.35, radius: 0.012, limit: 0.7 });
    sideLock[side] = { path, bones: [b1, b2] };
  }

  // Colliders (skirt against the thighs, hair against the head and shoulders).
  for (const s of ['L', 'R']) {
    const thigh = bones[B(`Bip01_${s}_Thigh`)] as KBone;
    const calf = bones[B(`Bip01_${s}_Calf`)] as KBone;
    colliders.push({ bone: thigh.name, head: [0.02, 0, 0], tail: [calf.t.x * 0.75, calf.t.y * 0.75, calf.t.z * 0.75], radius: 0.075 });
  }
  for (const s of ['L', 'R']) {
    const calf = bones[B(`Bip01_${s}_Calf`)] as KBone;
    const foot = bones[B(`Bip01_${s}_Foot`)] as KBone;
    colliders.push({ bone: calf.name, head: [0, 0, 0], tail: [foot.t.x * 0.6, foot.t.y * 0.6, foot.t.z * 0.6], radius: 0.05 });
  }
  for (const s of ['L', 'R']) colliders.push({ bone: `Bip01_${s}_Hand`, head: [0, 0, 0], tail: [0.06, 0, 0], radius: 0.035 });
  for (const s of ['L', 'R']) {
    // Forearms too: a swinging arm pushes the skirt panels out instead of passing through them.
    const fore = bones[B(`Bip01_${s}_Forearm`)] as KBone;
    const hand = bones[B(`Bip01_${s}_Hand`)] as KBone;
    colliders.push({ bone: fore.name, head: [0, 0, 0], tail: [hand.t.x, hand.t.y, hand.t.z], radius: 0.032 });
  }
  // The chest (the neckerchief's tails rest on it).
  colliders.push({ bone: 'Bip01_Spine2', head: localOf(bones, 'Bip01_Spine2', V(0.05, 1.15, 0.035)), tail: localOf(bones, 'Bip01_Spine2', V(-0.05, 1.15, 0.035)), radius: 0.075 });
  colliders.push({ bone: 'Bip01_Head', head: localOf(bones, 'Bip01_Head', O.clone().add(V(0, 0.11, -0.005))), tail: localOf(bones, 'Bip01_Head', O.clone().add(V(0, 0.05, 0.0))), radius: 0.09 });
  colliders.push({ bone: 'Bip01_Spine2', head: localOf(bones, 'Bip01_Spine2', V(0.09, 1.2, -0.04)), tail: localOf(bones, 'Bip01_Spine2', V(-0.09, 1.2, -0.04)), radius: 0.07 });
  colliders.push({ bone: 'Bip01_Pelvis', head: localOf(bones, 'Bip01_Pelvis', V(0, 0.92, -0.01)), tail: localOf(bones, 'Bip01_Pelvis', V(0, 0.84, -0.01)), radius: 0.1 });

  // -------------------------------------------------------------------------
  // Skinning helpers
  // -------------------------------------------------------------------------
  const seg = (bone: string, to: string | Vector3, reach = 1): Seg => ({ bone: B(bone), a: J(bone), b: typeof to === 'string' ? J(to) : to, reach });
  const spineChain: Array<[number, number]> = [
    [B('Bip01_Pelvis'), (J('Bip01_Pelvis').y + J('Bip01_Spine').y) / 2],
    [B('Bip01_Spine'), (J('Bip01_Spine').y + J('Bip01_Spine1').y) / 2],
    [B('Bip01_Spine1'), (J('Bip01_Spine1').y + J('Bip01_Spine2').y) / 2],
    [B('Bip01_Spine2'), (J('Bip01_Spine2').y + J('Bip01_Neck').y) / 2],
    [B('Bip01_Neck'), (J('Bip01_Neck').y + J('Bip01_Head').y) / 2],
    [B('Bip01_Head'), J('Bip01_Head').y + 0.06],
  ];
  const chainSkin = (y: number): Skin => {
    const c = spineChain;
    if (y <= (c[0] as [number, number])[1]) return [[(c[0] as [number, number])[0], 1]];
    for (let i = 0; i + 1 < c.length; i++) {
      const [b0, y0] = c[i] as [number, number];
      const [b1, y1] = c[i + 1] as [number, number];
      if (y <= y1) {
        const t = smoothstep(0, 1, (y - y0) / (y1 - y0));
        return normaliseSkin([[b0, 1 - t], [b1, t]]);
      }
    }
    return [[(c[c.length - 1] as [number, number])[0], 1]];
  };
  const armSegs = (s: 'L' | 'R'): Seg[] => [seg(`Bip01_${s}_Clavicle`, `Bip01_${s}_UpperArm`, 0.55), seg(`Bip01_${s}_UpperArm`, `Bip01_${s}_Forearm`), seg(`Bip01_${s}_Forearm`, `Bip01_${s}_Hand`), seg(`Bip01_${s}_Hand`, `Bip01_${s}_Finger2`, 0.8)];
  const torsoSkin = (p: Vector3): Skin => {
    const base = chainSkin(p.y);
    const side = p.x >= 0 ? 'L' : 'R';
    const a = smoothstep(0.085, 0.15, Math.abs(p.x)) * smoothstep(1.12, 1.2, p.y);
    if (a <= 0) return base;
    return mixSkin(base, envelope(p, [seg(`Bip01_${side}_Clavicle`, `Bip01_${side}_UpperArm`), seg(`Bip01_${side}_UpperArm`, `Bip01_${side}_Forearm`, 0.7)], 4), a * 0.85);
  };
  const legSegs = (s: 'L' | 'R'): Seg[] => [seg('Bip01_Pelvis', 'Bip01_Spine', 0.5), seg(`Bip01_${s}_Thigh`, `Bip01_${s}_Calf`), seg(`Bip01_${s}_Calf`, `Bip01_${s}_Foot`), seg(`Bip01_${s}_Foot`, `Bip01_${s}_Toe0`, 0.8), seg(`Bip01_${s}_Toe0`, J(`Bip01_${s}_Toe0`).add(V(0, 0, 0.05)), 0.8)];

  const sw = (s: Swatch) => (): readonly [number, number] => swatchUv(s);

  // -------------------------------------------------------------------------
  // Head
  // -------------------------------------------------------------------------
  {
    const head = new Part('head');
    const rows = 40;
    const cols = 64;
    const centre = V(0, 0.095, 0.004);
    const grid: number[][] = [];
    for (let i = 0; i <= rows; i++) {
      const lat = (i / rows) * Math.PI;
      const row: number[] = [];
      for (let j = 0; j <= cols; j++) {
        const lon = -Math.PI + (j / cols) * Math.PI * 2;
        const d = V(Math.sin(lat) * Math.sin(lon), Math.cos(lat), Math.sin(lat) * Math.cos(lon));
        // March out to the surface, then bisect.
        let lo = 0;
        let hi = 0.02;
        while (headSdf(centre.clone().addScaledVector(d, hi)) < 0 && hi < 0.3) {
          lo = hi;
          hi += 0.01;
        }
        for (let k = 0; k < 30; k++) {
          const m = (lo + hi) / 2;
          if (headSdf(centre.clone().addScaledVector(d, m)) < 0) lo = m;
          else hi = m;
        }
        const q = centre.clone().addScaledVector(d, (lo + hi) / 2);
        const g = sdfGrad(headSdf, q);
        const p = q.clone().add(O);
        // Back of the head maps outside the face square (clamped to its skin border); the seam column is doubled.
        let ux = q.x;
        if (q.z < 0) ux = (j < cols / 2 ? -1 : 1) * (0.1 + -q.z);
        if (j === 0) ux = -0.2;
        if (j === cols) ux = 0.2;
        const uv = faceUv(ux, q.y);
        const skin: Skin = q.y < 0.03 && q.z < 0.02 ? normaliseSkin([[B('Bip01_Head'), 0.85], [B('Bip01_Neck'), 0.15]]) : [[B('Bip01_Head'), 1]];
        row.push(head.vertex(p, uv, skin, T_FACE, g));
      }
      grid.push(row);
    }
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const a = (grid[i] as number[])[j] as number;
        const b = (grid[i] as number[])[j + 1] as number;
        const c = (grid[i + 1] as number[])[j + 1] as number;
        const d = (grid[i + 1] as number[])[j] as number;
        head.quad(a, d, c, b);
      }
    }
    orientOutward(head, (p) => p.clone().sub(O.clone().add(centre)));
    // Cleaner light on the face: blend toward a sphere centred behind the face.
    head.sphereNormals(O.clone().add(V(0, 0.07, -0.06)), 0.7, undefined, (p) => smoothstep(-0.02, 0.04, p.z - O.z));
    part.merge(head);
  }

  // -------------------------------------------------------------------------
  // Neck
  // -------------------------------------------------------------------------
  {
    const neck = new Part('neck');
    const n0 = J('Bip01_Neck').add(V(0, -0.045, 0.012));
    const n1 = HB.clone().add(V(0, 0.05, 0.004));
    const rings: Ring[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const c = n0.clone().lerp(n1, t);
      rings.push({ c, x: V(1, 0, 0), y: V(0, 0, 1), shape: section(lerp(0.036, 0.0228, smoothstep(0, 0.45, t)), lerp(0.032, 0.0245, smoothstep(0, 0.45, t)), lerp(0.038, 0.027, smoothstep(0, 0.45, t)), 2) });
    }
    loft(neck, rings, { seg: 20, uv: sw('skin'), skin: (p) => chainSkin(p.y), toon: () => T_SKIN });
    part.merge(neck);
  }

  // -------------------------------------------------------------------------
  // Torso (blouse)
  // -------------------------------------------------------------------------
  // [y, half width, front depth, back depth, superellipse exponent]
  const TORSO: Array<[number, number, number, number, number]> = [
    [0.93, 0.118, 0.078, 0.078, 2.3],
    [0.99, 0.104, 0.07, 0.068, 2.3],
    [1.05, 0.108, 0.08, 0.07, 2.2],
    [1.1, 0.12, 0.106, 0.075, 2.0],
    [1.14, 0.126, 0.112, 0.078, 2.0],
    [1.18, 0.133, 0.088, 0.08, 2.2],
    [1.215, 0.142, 0.072, 0.076, 2.4],
    [1.243, 0.128, 0.058, 0.062, 2.3],
    [1.262, 0.09, 0.047, 0.052, 2.1],
    [1.276, 0.046, 0.038, 0.042, 2],
  ];
  const torsoZ = (y: number): number => lerp(-0.004, -0.044, smoothstep(1.0, 1.27, y));
  const torsoAt = (y: number): [number, number, number, number] => {
    const t = TORSO;
    if (y <= (t[0] as number[])[0]!) return (t[0] as number[]).slice(1) as [number, number, number, number];
    for (let i = 0; i + 1 < t.length; i++) {
      const a = t[i] as [number, number, number, number, number];
      const b = t[i + 1] as [number, number, number, number, number];
      if (y <= b[0]) {
        const f = smoothstep(0, 1, (y - a[0]) / (b[0] - a[0])) * 0.5 + ((y - a[0]) / (b[0] - a[0])) * 0.5;
        return [lerp(a[1], b[1], f), lerp(a[2], b[2], f), lerp(a[3], b[3], f), lerp(a[4], b[4], f)];
      }
    }
    return (t[t.length - 1] as number[]).slice(1) as [number, number, number, number];
  };
  /** Torso surface at azimuth `phi` (0 = front, +π/2 = her left) and height y, pushed out by `off`. */
  const torsoPoint = (phi: number, y: number, off = 0): Vector3 => {
    const [hw, fr, bk, ex] = torsoAt(y);
    const s = Math.sin(phi);
    const c = Math.cos(phi);
    const e = 2 / ex;
    const x = Math.sign(s) * Math.pow(Math.abs(s), e) * (hw + off);
    const z = Math.sign(c) * Math.pow(Math.abs(c), e) * ((c >= 0 ? fr : bk) + off);
    return V(x, y, torsoZ(y) + z);
  };
  {
    const torso = new Part('torso');
    const rings: Ring[] = [];
    const n = 26;
    for (let i = 0; i <= n; i++) {
      const y = lerp(0.93, 1.276, i / n);
      const [hw, fr, bk, ex] = torsoAt(y);
      rings.push({ c: V(0, y, torsoZ(y)), x: V(1, 0, 0), y: V(0, 0, 1), shape: section(hw, fr, bk, ex) });
    }
    loft(torso, rings, { seg: 40, capEnd: 0.004, capStart: -0.0, uv: sw('blouse'), skin: (p) => torsoSkin(p), toon: () => T_CLOTH });
    part.merge(torso);
  }

  // -------------------------------------------------------------------------
  // Sailor collar: back flap, shoulders and front lapels down to a V, with a white stripe near its edge.
  // -------------------------------------------------------------------------
  {
    const collar = new Part('collar');
    const NECK_Y = 1.272;
    // Surface curve per azimuth: points down the torso from the neck base, with arc length.
    const curveOf = (phi: number): { pts: Vector3[]; len: number[] } => {
      const pts: Vector3[] = [];
      const len: number[] = [];
      let acc = 0;
      for (let k = 0; k <= 160; k++) {
        const y = NECK_Y - k * 0.0018;
        const p = torsoPoint(phi, y);
        if (k > 0) acc += p.distanceTo(pts[k - 1] as Vector3);
        pts.push(p);
        len.push(acc);
      }
      return { pts, len };
    };
    const at = (cv: { pts: Vector3[]; len: number[] }, d: number): { p: Vector3; i: number } => {
      const { pts, len } = cv;
      for (let k = 1; k < len.length; k++) {
        if ((len[k] as number) >= d) {
          const f = (d - (len[k - 1] as number)) / ((len[k] as number) - (len[k - 1] as number) || 1);
          return { p: (pts[k - 1] as Vector3).clone().lerp(pts[k] as Vector3, f), i: k };
        }
      }
      return { p: (pts[pts.length - 1] as Vector3).clone(), i: pts.length - 1 };
    };
    const PHI_S = 1.12;
    const PHI_B = 1.02;
    const D_V = 0.128;
    const W_S = 0.085;
    const D_B = 0.165;
    const inner = (phi: number): number => {
      const a = Math.abs(phi);
      return a < PHI_S ? D_V * Math.pow(1 - a / PHI_S, 0.95) : 0;
    };
    const outer = (phi: number): number => {
      const a = Math.abs(phi);
      if (a > Math.PI - PHI_B) return D_B;
      if (a >= PHI_S) return W_S;
      return inner(phi) + W_S * Math.pow(a / PHI_S, 0.75) + 0.002;
    };
    // Columns: dense, with the flap's corners on exact pairs.
    const phis: number[] = [];
    const NC = 100;
    for (let k = 0; k <= NC; k++) phis.push(-Math.PI + (k / NC) * Math.PI * 2);
    for (const s of [1, -1]) {
      phis.push(s * (Math.PI - PHI_B - 0.0015), s * (Math.PI - PHI_B + 0.0015));
    }
    phis.sort((a, b) => a - b);
    // Drop near-duplicates and the closing column (the ring wraps).
    const cols: number[] = [];
    for (const p of phis) if (cols.length === 0 || p - (cols[cols.length - 1] as number) > 0.0009) cols.push(p);
    if (Math.abs((cols[cols.length - 1] as number) - Math.PI) < 1e-6) cols.pop();
    const rows = 9;
    // Outer boundary, for the stripe distance.
    const boundary: Vector3[] = [];
    for (let k = 0; k < 720; k++) {
      const phi = -Math.PI + (k / 720) * Math.PI * 2;
      const cv = curveOf(phi);
      boundary.push(at(cv, outer(phi)).p);
    }
    for (const s of [1, -1]) {
      const cv = curveOf(s * (Math.PI - PHI_B));
      for (let k = 0; k <= 40; k++) boundary.push(at(cv, W_S + (D_B - W_S) * (k / 40)).p);
    }
    const edgeDist = (p: Vector3): number => {
      let m = 1e9;
      for (const b of boundary) m = Math.min(m, b.distanceTo(p));
      return m;
    };
    const top: number[][] = [];
    const bottom: number[][] = [];
    for (const phi of cols) {
      const cv = curveOf(phi);
      const d0 = inner(phi);
      const d1 = outer(phi);
      const tc: number[] = [];
      const bc: number[] = [];
      for (let r = 0; r <= rows; r++) {
        const d = lerp(d0, d1, r / rows);
        const { p, i } = at(cv, d);
        // Surface normal from neighbours.
        const pa = torsoPoint(phi + 0.01, p.y);
        const pb = torsoPoint(phi - 0.01, p.y);
        const pc = (cv.pts[Math.max(0, i - 2)] as Vector3).clone();
        const pd = (cv.pts[Math.min(cv.pts.length - 1, i + 2)] as Vector3).clone();
        const nrm = pa.sub(pb).cross(pc.sub(pd)).normalize();
        const out = V(p.x, 0, p.z - torsoZ(p.y));
        if (nrm.dot(out) < 0 && Math.abs(p.y - NECK_Y) > 0.004) nrm.negate();
        if (nrm.y < -0.2) nrm.y = -0.2;
        nrm.normalize();
        const lift = 0.0045 + 0.002 * smoothstep(0, 0.03, d - d0) * (1 - Math.abs(Math.cos(phi))) + 0.003 * smoothstep(0.02, 0.0, d);
        const pt = p.clone().addScaledVector(nrm, lift);
        const pbm = p.clone().addScaledVector(nrm, 0.0015);
        const dist = edgeDist(pt);
        const uv = collarUv(Math.min(dist, COLLAR_RANGE * 0.99));
        const skin = torsoSkin(p);
        tc.push(collar.vertex(pt, uv, skin, T_CLOTH));
        bc.push(collar.vertex(pbm, collarUv(COLLAR_RANGE * 0.99), skin, T_CLOTH));
      }
      top.push(tc);
      bottom.push(bc);
    }
    const nc = cols.length;
    for (let c = 0; c < nc; c++) {
      const c1 = (c + 1) % nc;
      for (let r = 0; r < rows; r++) {
        const a = (top[c] as number[])[r] as number;
        const b = (top[c1] as number[])[r] as number;
        const cc = (top[c1] as number[])[r + 1] as number;
        const d = (top[c] as number[])[r + 1] as number;
        collar.quad(a, b, cc, d);
        const ba = (bottom[c] as number[])[r] as number;
        const bb = (bottom[c1] as number[])[r] as number;
        const bcc = (bottom[c1] as number[])[r + 1] as number;
        const bd = (bottom[c] as number[])[r + 1] as number;
        collar.quad(ba, bd, bcc, bb);
      }
    }
    // Faces: top outward from the body axis.
    orientCollar(collar, top, bottom, torsoZ);
    // Rims at the inner and outer edges, facing away from the middle of the collar's width.
    for (let c = 0; c < nc; c++) {
      const c1 = (c + 1) % nc;
      const mid = collar.p((top[c] as number[])[rows >> 1] as number);
      for (const r of [0, rows]) {
        const from = collar.idx.length;
        const a = (top[c] as number[])[r] as number;
        const b = (top[c1] as number[])[r] as number;
        const ba = (bottom[c] as number[])[r] as number;
        const bb = (bottom[c1] as number[])[r] as number;
        collar.quad(a, ba, bb, b);
        orientOutward(collar, (m) => m.clone().sub(mid), from, collar.idx.length);
      }
    }
    part.merge(collar);

    // The neckerchief's knot at the V, its two tails on spring bones.
    const vCurve = curveOf(0);
    const vp = at(vCurve, D_V - 0.004).p.add(V(0, 0.0, 0.01));
    const tails: number[] = [];
    for (const side of [1, -1]) {
      const name = side > 0 ? 'L' : 'R';
      const b = addSecondary(bones, `Tie_${name}`, 'Bip01_Spine2', vp.clone().add(V(side * 0.004, -0.012, 0.004)));
      tails.push(b);
      springs.push({ name: `tie${name}`, bones: [`Tie_${name}`], tip: [side * 0.02, -0.1, 0.01], stiffness: 0.42, drag: 0.26, gravity: 0.35, radius: 0.012, limit: 0.5 });
    }
    buildNeckerchief(part, vp, B('Bip01_Spine2'), tails as [number, number], (y) => torsoPoint(0, y).z);

    // Chest pocket on her left: a thin patch laid on the blouse, with a hem at its mouth.
    const pocket = new Part('pocket');
    const PH = [1.125, 1.178];
    const PP = [0.34, 0.66];
    const grid: number[][] = [];
    for (let i = 0; i <= 4; i++) {
      const y = lerp(PH[0] as number, PH[1] as number, i / 4);
      const row: number[] = [];
      for (let j = 0; j <= 4; j++) {
        const phi = lerp(PP[0] as number, PP[1] as number, j / 4);
        const p0 = torsoPoint(phi, y, 0.0026);
        row.push(pocket.vertex(p0, swatchUv(i === 4 ? 'blouseInner' : 'pocket'), torsoSkin(p0), T_CLOTH));
      }
      grid.push(row);
    }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) pocket.quad((grid[i] as number[])[j] as number, (grid[i] as number[])[j + 1] as number, (grid[i + 1] as number[])[j + 1] as number, (grid[i + 1] as number[])[j] as number);
    orientOutward(pocket, (q) => V(q.x, 0, q.z - torsoZ(q.y)));
    part.merge(pocket);
  }

  // -------------------------------------------------------------------------
  // Skirt: pleated shell, panels skinned to the skirt bones.
  // -------------------------------------------------------------------------
  {
    const skirt = new Part('skirt');
    const SEG = PLEATS * 12;
    // The hip line stays at its height whatever the skirt's length (a longer skirt must not pull it down over the thighs).
    const T_HIP = clamp((SKIRT_TOP - 0.885) / (SKIRT_TOP - SKIRT_HEM), 0.1, 0.5);
    const ROWS = 16;
    const ringAt = (t: number, off: number): Ring => {
      const y = lerp(SKIRT_TOP, SKIRT_HEM, t);
      const [hw, fr, bk] = torsoAt(Math.max(y, 0.99));
      const waist = V(hw + 0.008, fr + 0.008, bk + 0.008);
      const hem = V(HEM_X, HEM_Z + 0.002, HEM_Z + 0.002);
      const hip = V(0.157, 0.123, 0.123);
      const tt = smoothstep(0, 1, t);
      let w = t < T_HIP ? waist.clone().lerp(hip, smoothstep(0, T_HIP, t)) : hip.clone().lerp(hem, (t - T_HIP) / (1 - T_HIP));
      w = w.addScalar(off);
      // Pleats closed at the waistband, opening toward the hem.
      const amp = 0.0018 + 0.0105 * tt;
      return {
        c: V(0, y, lerp(torsoZ(SKIRT_TOP), pelvis.z - 0.005, smoothstep(0, 0.4, t))),
        x: V(1, 0, 0),
        y: V(0, 0, 1),
        shape: (a) => {
          const pa = (a / (Math.PI * 2)) * PLEATS;
          const f = pa - Math.floor(pa);
          // Knife pleats: a sharp fold then a long face.
          const fold = f < 0.2 ? f / 0.2 : 1 - (f - 0.2) / 0.8;
          const r = 1 + (amp * (fold - 0.5) * 2) / Math.max(0.1, w.x);
          const c = Math.cos(a);
          const s = Math.sin(a);
          return [c * w.x * r, s * (s >= 0 ? w.y : w.z) * r];
        },
      };
    };
    const skirtSkin = (p: Vector3, t: number): Skin => {
      const ang = Math.atan2(p.x, p.z - pelvis.z);
      const f = (((ang / (Math.PI * 2)) * SKIRT_N) % SKIRT_N + SKIRT_N) % SKIRT_N;
      const k0 = Math.floor(f) % SKIRT_N;
      const k1 = (k0 + 1) % SKIRT_N;
      const u = f - Math.floor(f);
      const s = smoothstep(0.0, 0.7, t);
      const pel = B('Bip01_Pelvis');
      return normaliseSkin([[pel, 1 - s], [skirtBones[k0] as number, s * (1 - u)], [skirtBones[k1] as number, s * u]]);
    };
    const outerRings: Ring[] = [];
    const innerRings: Ring[] = [];
    for (let i = 0; i <= ROWS; i++) {
      outerRings.push(ringAt(i / ROWS, 0));
      innerRings.push(ringAt(i / ROWS, -0.006));
    }
    const go = loft(skirt, outerRings, { seg: SEG, uv: sw('skirt'), skin: (p, t) => skirtSkin(p, t), toon: () => T_CLOTH });
    const gi = loft(skirt, innerRings, { seg: SEG, uv: sw('skirtInner'), skin: (p, t) => skirtSkin(p, t), toon: () => [0.4, 0, 0, 0], inside: true });
    // Hem rim.
    const ro = go[ROWS] as number[];
    const ri = gi[ROWS] as number[];
    const rimFrom = skirt.idx.length;
    for (let j = 0; j < SEG; j++) {
      const j1 = (j + 1) % SEG;
      skirt.quad(ro[j] as number, ri[j] as number, ri[j1] as number, ro[j1] as number);
    }
    orientOutward(skirt, () => V(0, -1, 0), rimFrom, skirt.idx.length);
    // Waistband.
    const band: Ring[] = [];
    for (let i = 0; i <= 2; i++) {
      const y = SKIRT_TOP + 0.012 - i * 0.012;
      const [hw, fr, bk, ex] = torsoAt(y);
      band.push({ c: V(0, y, torsoZ(y)), x: V(1, 0, 0), y: V(0, 0, 1), shape: section(hw + 0.009, fr + 0.009, bk + 0.009, ex) });
    }
    loft(skirt, band, { seg: 48, uv: sw('skirt'), skin: (p) => chainSkin(p.y), toon: () => T_CLOTH });
    part.merge(skirt);
  }

  // -------------------------------------------------------------------------
  // Legs, socks and loafers
  // -------------------------------------------------------------------------
  for (const s of ['L', 'R'] as const) {
    const sx = s === 'L' ? 1 : -1;
    const H = J(`Bip01_${s}_Thigh`);
    const K = J(`Bip01_${s}_Calf`);
    const A = J(`Bip01_${s}_Foot`);
    const T = J(`Bip01_${s}_Toe0`);
    const path = [H.clone().add(V(-sx * 0.012, 0.07, 0)), H.clone().add(V(0, 0.0, 0.004)), H.clone().lerp(K, 0.5).add(V(0, 0, 0.004)), K.clone().add(V(0, 0, 0.008)), K.clone().lerp(A, 0.45).add(V(0, 0, -0.004)), A.clone().add(V(0, 0.0, 0.0)), A.clone().add(V(0, -0.045, 0.012))];
    const legLen = H.distanceTo(K) + K.distanceTo(A);
    const kneeT = (0.07 + H.distanceTo(K)) / (0.07 + legLen + 0.045);
    // Radius (x, front, back) along the path parameter.
    const radius = (t: number): [number, number, number] => {
      const k = kneeT;
      if (t < 0.12) return [0.07, 0.074, 0.074];
      if (t < k) {
        const f = (t - 0.12) / (k - 0.12);
        return [lerp(0.07, 0.041, Math.pow(f, 0.9)), lerp(0.072, 0.044, f), lerp(0.074, 0.04, f)];
      }
      const f = (t - k) / (1 - k);
      const calf = Math.exp(-(((f - 0.3) / 0.2) ** 2));
      const thin = lerp(0.041, 0.0235, smoothstep(0.1, 0.82, f));
      return [thin + 0.006 * calf, thin + 0.003 * calf, thin + 0.011 * calf];
    };
    const rings = (off: number, t0: number, t1: number, n: number): Ring[] => {
      const out: Ring[] = [];
      for (let i = 0; i <= n; i++) {
        const t = lerp(t0, t1, i / n);
        const c = spline(path, t);
        const tan = spline(path, Math.min(1, t + 0.01)).sub(spline(path, Math.max(0, t - 0.01)));
        const f = frame(tan, V(1, 0, 0));
        const [rx, rf, rb] = radius(t);
        // y axis of the frame points back (tangent down × x); front depth goes on its negative side.
        out.push({ c, x: f.x, y: f.y, shape: section(rx + off, rb + off, rf + off, 2.05) });
      }
      return out;
    };
    const leg = new Part(`leg${s}`);
    loft(leg, rings(0, 0, 1, 34), { seg: 18, capEnd: 0.012, uv: sw('skin'), skin: (p) => envelope(p, legSegs(s), 5), toon: () => T_SKIN });
    part.merge(leg);
    // Socks: from inside the shoe to below the calf, with a folded top.
    const sock = new Part(`sock${s}`);
    const st0 = kneeT + (1 - kneeT) * 0.58;
    const sr = rings(0.0022, st0, 1, 12);
    const topRing = sr[0] as Ring;
    const fold: Ring = { ...topRing, c: topRing.c.clone().add(V(0, 0.004, 0)), shape: (a) => { const [x, y] = topRing.shape(a); return [x * 1.06, y * 1.06]; } };
    const lip: Ring = { ...topRing, c: topRing.c.clone().add(V(0, 0.008, 0)), shape: (a) => { const [x, y] = topRing.shape(a); return [x * 0.96, y * 0.96]; } };
    loft(sock, [lip, fold, ...sr], { seg: 18, capEnd: 0.013, uv: sw('sock'), skin: (p) => envelope(p, legSegs(s), 5), toon: () => T_CLOTH });
    part.merge(sock);
    // Loafer.
    const shoe = new Part(`shoe${s}`);
    const fwd = V(T.x - A.x, 0, T.z - A.z).normalize();
    const side = V(fwd.z, 0, -fwd.x).multiplyScalar(-1);
    const heel = V(A.x, 0, A.z).addScaledVector(fwd, -0.04);
    const LEN = 0.19;
    const shoeRings: Ring[] = [];
    const NR = 16;
    for (let i = 0; i <= NR; i++) {
      const t = i / NR;
      const topY = t < 0.35 ? lerp(0.074, 0.062, t / 0.35) : lerp(0.062, 0.03, smoothstep(0.35, 1, t));
      const hw = lerp(0.03, 0.04, smoothstep(0, 0.55, t)) * (1 - 0.35 * smoothstep(0.75, 1, t));
      const c = heel.clone().addScaledVector(fwd, LEN * t).addScaledVector(side, sx * 0.004 * smoothstep(0.4, 1, t));
      c.y = topY / 2 + 0.002;
      shoeRings.push({ c, x: side.clone().multiplyScalar(1), y: V(0, 1, 0), shape: section(hw, topY / 2 + 0.002, topY / 2 + 0.002, t > 0.6 ? 2.6 : 3.2) });
    }
    const shoeSkin = (p: Vector3): Skin => envelope(p, [seg(`Bip01_${s}_Foot`, `Bip01_${s}_Toe0`), seg(`Bip01_${s}_Toe0`, J(`Bip01_${s}_Toe0`).addScaledVector(fwd, 0.06), 0.9)], 4);
    loft(shoe, shoeRings, { seg: 22, capStart: 0.014, capEnd: 0.022, uv: (_t, _s, p) => swatchUv(p.y < 0.009 ? 'sole' : 'shoe'), skin: shoeSkin, toon: () => T_CLOTH });
    part.merge(shoe);
  }

  // -------------------------------------------------------------------------
  // Arms, sleeves, hands
  // -------------------------------------------------------------------------
  for (const s of ['L', 'R'] as const) {
    const sx = s === 'L' ? 1 : -1;
    const S = J(`Bip01_${s}_UpperArm`);
    const E = J(`Bip01_${s}_Forearm`);
    const W = J(`Bip01_${s}_Hand`);
    const dirA = E.clone().sub(S).normalize();
    const path = [S.clone().addScaledVector(dirA, -0.035).add(V(-sx * 0.01, 0, 0)), S.clone(), S.clone().lerp(E, 0.5), E.clone(), E.clone().lerp(W, 0.5), W.clone(), W.clone().add(W.clone().sub(E).normalize().multiplyScalar(0.02))];
    const total = 0.035 + S.distanceTo(E) + E.distanceTo(W) + 0.02;
    const elbowT = (0.035 + S.distanceTo(E)) / total;
    const radius = (t: number): [number, number] => {
      if (t < elbowT) {
        const f = t / elbowT;
        return [lerp(0.04, 0.027, smoothstep(0, 1, f)), lerp(0.042, 0.029, smoothstep(0, 1, f))];
      }
      const f = (t - elbowT) / (1 - elbowT);
      const fore = Math.exp(-(((f - 0.25) / 0.25) ** 2));
      return [lerp(0.027, 0.0185, smoothstep(0.1, 0.9, f)) + 0.002 * fore, lerp(0.029, 0.021, smoothstep(0.1, 0.9, f)) + 0.003 * fore];
    };
    const armRings = (t0: number, t1: number, n: number, scale: (t: number) => number = () => 1, add = 0): Ring[] => {
      const out: Ring[] = [];
      for (let i = 0; i <= n; i++) {
        const t = lerp(t0, t1, i / n);
        const c = spline(path, t);
        const tan = spline(path, Math.min(1, t + 0.01)).sub(spline(path, Math.max(0, t - 0.01)));
        const f = frame(tan, V(0, 0, 1));
        const [rx, rz] = radius(t);
        const k = scale(t);
        out.push({ c, x: f.x, y: f.y, shape: section(rz * k + add, rx * k + add, rx * k + add, 2) });
      }
      return out;
    };
    const arm = new Part(`arm${s}`);
    loft(arm, armRings(0, 1, 30), { seg: 16, uv: sw('skin'), skin: (p) => envelope(p, armSegs(s), 5), toon: () => T_SKIN });
    part.merge(arm);
    // Short puffed sleeve: a shell from over the shoulder to a third of the upper arm, with a navy cuff.
    const sleeve = new Part(`sleeve${s}`);
    const sEnd = 0.035 / total + (S.distanceTo(E) / total) * 0.42;
    const puff = (t: number): number => 1.22 + 0.08 * Math.sin(Math.PI * clamp(t / sEnd, 0, 1));
    const so = armRings(0, sEnd, 10, puff, 0.004);
    const si = armRings(0, sEnd, 10, puff, -0.0005);
    const sleeveSkin = (p: Vector3): Skin => mixSkin(envelope(p, armSegs(s), 4), torsoSkin(p), 0.25 * smoothstep(sEnd * 0.6, 0, 0));
    const go = loft(sleeve, so, { seg: 20, capStart: 0.012, uv: sw('blouse'), skin: sleeveSkin, toon: () => T_CLOTH });
    const gi = loft(sleeve, si, { seg: 20, uv: sw('blouseInner'), skin: sleeveSkin, toon: () => [0.3, 0, 0, 0], inside: true });
    const ro = go[go.length - 1] as number[];
    const ri = gi[gi.length - 1] as number[];
    const rimFrom = sleeve.idx.length;
    for (let j = 0; j < 20; j++) {
      const j1 = (j + 1) % 20;
      sleeve.quad(ro[j] as number, ro[j1] as number, ri[j1] as number, ri[j] as number);
    }
    orientOutward(sleeve, () => dirA, rimFrom, sleeve.idx.length);
    part.merge(sleeve);
    const cuff = new Part(`cuff${s}`);
    const cr = armRings(sEnd - 0.022, sEnd + 0.002, 3, () => puff(sEnd) + 0.02, 0.0045);
    loft(cuff, cr, { seg: 20, uv: sw('cuff'), skin: sleeveSkin, toon: () => T_CLOTH });
    part.merge(cuff);
    if (s === 'L') {
      // A cheap digital wristwatch: a strap round the wrist and a squarish case on its back.
      const tw = 1 - 0.045 / total;
      const watch = new Part('watch');
      loft(watch, armRings(tw - 0.011, tw + 0.011, 3, () => 1.08, 0.0024), { seg: 16, uv: sw('watch'), skin: (p) => envelope(p, armSegs(s), 5), toon: () => T_SMALL });
      const c = spline(path, tw);
      const tan = spline(path, Math.min(1, tw + 0.01)).sub(spline(path, tw - 0.01)).normalize();
      // The back of the wrist: world up made square to the forearm (the bind pose has the palms down).
      const back = V(0, 1, 0).addScaledVector(tan, -tan.y).normalize();
      const side = tan.clone().cross(back).normalize();
      const [rx] = radius(tw);
      const caseRings: Ring[] = [];
      for (let i = 0; i <= 2; i++) {
        const cc = c.clone().addScaledVector(back, rx * 1.08 + 0.0012 + i * 0.0026);
        caseRings.push({ c: cc, x: side, y: tan, shape: section(0.0105 - i * 0.0008, 0.0115 - i * 0.0008, 0.0115 - i * 0.0008, 3.2) });
      }
      loft(watch, caseRings, { seg: 16, capEnd: 0.006, uv: (t) => swatchUv(t > 0.9 ? 'watchFace' : 'watch'), skin: (p) => envelope(p, armSegs(s), 5), toon: () => T_SMALL });
      part.merge(watch);
    }
    buildHand(part, bones, s, J, B);
  }

  // -------------------------------------------------------------------------
  // Hair
  // -------------------------------------------------------------------------
  const headBone = B('Bip01_Head');
  const hairSkin: Skin = [[headBone, 1]];
  {
    // Cap over the scalp.
    const cap = new Part('cap');
    const rows = 22;
    const cols = 48;
    const maxLat = (lon: number): number => {
      const f = 0.5 - 0.5 * Math.cos(lon); // 0 front, 1 back
      return lerp(1.12, 2.3, Math.pow(f, 0.7));
    };
    const grid: number[][] = [];
    for (let i = 0; i <= rows; i++) {
      const row: number[] = [];
      for (let j = 0; j < cols; j++) {
        const lon = (j / cols) * Math.PI * 2;
        const lat = (i / rows) * maxLat(lon) + 0.0001;
        const shrink = i === rows ? -0.06 : -0.012;
        const p = hairPoint(lon, lat, shrink);
        row.push(cap.vertex(p, hairUv(0.5, hairV(p.y)), hairSkin, T_HAIR));
      }
      grid.push(row);
    }
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const j1 = (j + 1) % cols;
        cap.quad((grid[i] as number[])[j] as number, (grid[i + 1] as number[])[j] as number, (grid[i + 1] as number[])[j1] as number, (grid[i] as number[])[j1] as number);
      }
    }
    orientOutward(cap, (p) => p.clone().sub(HAIR_C));
    cap.smoothNormals();
    cap.sphereNormals(HAIR_C, 0.6, HAIR_R);
    part.merge(cap);
  }
  const lock = (o: LockSpec): void => {
    const lp = new Part('lock');
    buildLock(lp, o, hairV, (p, t) => o.skin?.(p, t) ?? hairSkin);
    lp.smoothNormals();
    lp.sphereNormals(HAIR_C, o.sphere ?? 0.5, HAIR_R);
    part.merge(lp);
  };
  /** A lock that follows the hair mass from `lat0` to `lat1` at `lon`, then hangs `hang` metres, flaring out. */
  const massLock = (lon: number, lat0: number, lat1: number, hang: number, width: number, opts: { lift?: number; flare?: number; curl?: number; thick?: number; tipY?: number; sphere?: number; uvDark?: boolean; drift?: number; hug?: number } = {}): void => {
    const pts: Vector3[] = [];
    const lift = opts.lift ?? 0.0;
    for (let k = 0; k <= 7; k++) {
      const lat = lerp(lat0, lat1, k / 7);
      let p = hairPoint(lon + (opts.drift ?? 0) * (k / 7), lat, lift + 0.01 * (k / 7));
      // Bangs lie on the forehead: below the hairline the lock is pulled onto the skull plus a small gap, so in profile
      // it follows the brow instead of standing off it on the hair mass's ellipsoid.
      if (opts.hug !== undefined) p = p.lerp(onHead(p, opts.hug + 0.004 * (1 - k / 7)), smoothstep(0.55, 1.15, lat));
      pts.push(p);
    }
    if (hang > 0) {
      const end = pts[pts.length - 1] as Vector3;
      const out = V(Math.sin(lon), 0, Math.cos(lon));
      const flare = opts.flare ?? 0.012;
      for (let k = 1; k <= 4; k++) {
        const f = k / 4;
        pts.push(end.clone().add(V(0, -hang * f, 0)).addScaledVector(out, flare * f * f - (opts.curl ?? 0.006) * Math.pow(f, 6)));
      }
    }
    lock({ path: pts, width, thick: opts.thick ?? 0.0075, out: (p) => p.clone().sub(HAIR_C).multiply(V(1, 0.6, 1)).normalize(), sphere: opts.sphere, dark: opts.uvDark });
  };
  // Under-layer (dark) behind the bob, so gaps show hair, not the neck.
  for (const lon of [1.5, 2.0, 2.5, Math.PI, -2.5, -2.0, -1.5]) massLock(lon, 0.7, 1.5, 0.095, 0.14, { lift: -0.012, flare: 0.006, curl: 0.0, thick: 0.007, sphere: 0.3, uvDark: true });
  // Bob: sides and back, layered tips.
  const bob: Array<[number, number, number]> = [
    // lon, hang, width
    [1.45, 0.085, 0.05], [1.8, 0.1, 0.055], [2.15, 0.11, 0.058], [2.5, 0.115, 0.058], [2.82, 0.12, 0.06], [Math.PI, 0.112, 0.06],
    [-1.45, 0.085, 0.05], [-1.8, 0.1, 0.055], [-2.15, 0.11, 0.058], [-2.5, 0.115, 0.058], [-2.82, 0.12, 0.06],
  ];
  // The tips turn in under the jaw (the sheet's soft inward curl).
  for (const [lon, hang, w] of bob) massLock(lon, 0.22, 1.42, hang, w * 1.25, { lift: 0.0, flare: 0.012, curl: 0.022 });
  // Second, shorter layer over the bob for depth.
  for (const lon of [1.7, 2.2, 2.75, -1.7, -2.2, -2.75]) massLock(lon, 0.3, 1.36, 0.06, 0.05, { lift: 0.022, flare: 0.012, curl: 0.004 });
  // Crown locks running back from the parting.
  for (const lon of [0.55, 0.95, 1.25, -0.55, -0.95, -1.25]) massLock(lon, 0.12, 1.25, 0.0, 0.055, { lift: 0.006, drift: Math.sign(lon) * 0.25 });
  // Bangs: from the top of the head over the forehead, tips at the brows; one longer strand between the eyes.
  // Parted a little to her left (+lon): the clumps sweep away from the parting toward her right, the longest one between
  // the eyes; few and large, with pointed tips at the brows.
  const PART = 0.22;
  const bangs: Array<[number, number, number, number]> = [
    // lon, end lat, width, sweep
    [PART - 0.12, 1.6, 0.042, -0.2], [PART - 0.36, 1.55, 0.046, -0.24], [PART - 0.6, 1.5, 0.044, -0.22], [PART - 0.84, 1.47, 0.04, -0.14],
    [PART + 0.14, 1.54, 0.04, 0.12], [PART + 0.38, 1.47, 0.04, 0.14], [PART + 0.62, 1.44, 0.036, 0.1], [PART - 0.22, 1.66, 0.024, -0.16],
  ];
  for (const [lon, lat1, w, sweep] of bangs) massLock(lon, 0.18, lat1, 0.0, w * 1.35, { lift: -0.004, thick: 0.0088, sphere: 0.55, drift: sweep, hug: 0.0046 });
  // Side locks (spring).
  for (const side of [1, -1]) {
    const sl = sideLock[side] as { path: Vector3[]; bones: number[] };
    const chainB = sl.bones;
    lock({
      path: sl.path,
      width: 0.03,
      thick: 0.0075,
      out: () => V(side, 0, 0.25).normalize(),
      sphere: 0.2,
      skin: (_p, t) => (t < 0.45 ? hairSkin : t < 0.7 ? normaliseSkin([[headBone, 1 - (t - 0.45) / 0.25], [chainB[0] as number, (t - 0.45) / 0.25]]) : normaliseSkin([[chainB[0] as number, 1 - smoothstep(0.7, 0.9, t)], [chainB[1] as number, smoothstep(0.7, 0.9, t)]])),
    });
  }
  // The braid: lumps alternating side to side along the path (three strands read as a zig-zag), tied off above the
  // seashell charm.
  {
    const chain = [headBone, br1, br2];
    const braidSkin = (t: number): Skin => {
      if (t < 0.35) return hairSkin;
      if (t < 0.62) return normaliseSkin([[headBone, 1 - smoothstep(0.35, 0.62, t)], [br1, smoothstep(0.35, 0.62, t)]]);
      return normaliseSkin([[br1, 1 - smoothstep(0.62, 0.85, t)], [br2, smoothstep(0.62, 0.85, t)]]);
    };
    void chain;
    const bp = new Part('braid');
    const N = 9;
    for (let k = 0; k < N; k++) {
      const t0 = k / N;
      const t1 = (k + 1.25) / N;
      const lump: Ring[] = [];
      const side = k % 2 === 0 ? 1 : -1;
      for (let i = 0; i <= 6; i++) {
        const u = i / 6;
        const t = Math.min(1, lerp(t0, t1, u));
        const c = spline(braidPath, t);
        const tan = spline(braidPath, Math.min(1, t + 0.02)).sub(spline(braidPath, Math.max(0, t - 0.02))).normalize();
        const out = c.clone().sub(HAIR_C).setY(0).normalize();
        const across = tan.clone().cross(out).normalize();
        const tilt = across.clone().multiplyScalar(Math.cos(0.5 * side)).addScaledVector(tan, Math.sin(0.5 * side) * 0.5).normalize();
        const r = 0.0062 * (1 - 0.25 * (k / N)) * Math.sin(Math.PI * clamp(u, 0.04, 0.96));
        lump.push({ c: c.clone().addScaledVector(across, side * 0.0018), x: tilt, y: out, shape: (a2) => [Math.cos(a2) * r, Math.sin(a2) * r * 0.8] });
      }
      const tk = (t0 + t1) / 2;
      loft(bp, lump, { seg: 8, uv: () => hairUv(0.5, 0.3 + 0.4 * tk), skin: () => braidSkin(tk), toon: () => T_HAIR });
    }
    bp.smoothNormals();
    part.merge(bp);
    // The tie: a small dark band.
    const end = spline(braidPath, 1);
    const tie = new Part('braidTie');
    const tieRings: Ring[] = [];
    for (let i = 0; i <= 2; i++) tieRings.push({ c: end.clone().add(V(0, -0.003 * i, 0)), x: V(1, 0, 0), y: V(0, 0, 1), shape: section(0.0046, 0.0046, 0.0046, 2) });
    loft(tie, tieRings, { seg: 10, capStart: 0.002, capEnd: 0.002, uv: sw('scrunchie'), skin: () => braidSkin(1), toon: () => T_SMALL });
    part.merge(tie);
    // The seashell charm: a scallop (a fan, ribbed, with two small ears at its hinge) hanging below the tie.
    const shell = new Part('shell');
    const top = end.clone().add(V(0, -0.008, 0));
    const face = V(1, 0, 0.35).normalize();
    const flat = V(0, 1, 0).cross(face).normalize();
    const rings: Ring[] = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      const w = 0.004 + 0.0105 * Math.sin(Math.PI * 0.5 * Math.min(1, u * 1.25)) * (u > 0.85 ? Math.sqrt(Math.max(0, 1 - ((u - 0.85) / 0.15) * 0.6)) : 1);
      rings.push({ c: top.clone().add(V(0, -0.022 * u, 0)), x: flat, y: face, shape: (a2) => {
        const rib = 1 + 0.06 * Math.cos(a2 * 9) * u;
        return [Math.cos(a2) * w * rib, Math.sin(a2) * (Math.sin(a2) > 0 ? 0.0028 : 0.0016) * (0.6 + 0.4 * u)];
      } });
    }
    loft(shell, rings, { seg: 18, capStart: 0.001, capEnd: 0.002, uv: sw('shell'), skin: () => braidSkin(1), toon: () => T_SMALL });
    shell.smoothNormals();
    part.merge(shell);
  }

  return { part, springs, colliders };
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

interface LockSpec {
  path: Vector3[];
  width: number;
  thick: number;
  /** Outward direction at a point (the lock's thickness axis). */
  out: (p: Vector3) => Vector3;
  sphere?: number;
  dark?: boolean;
  skin?: (p: Vector3, t: number) => Skin;
  /** Width at the root as a share of `width` (bundled locks start narrow). */
  rootWidth?: number;
}

/** A hair lock: a lens-section ribbon along a path, pointed at the tip. */
function buildLock(part: Part, o: LockSpec, hairV: (y: number) => number, skin: (p: Vector3, t: number) => Skin): void {
  const n = 12;
  const rings: Ring[] = [];
  const ts: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    ts.push(t);
    const c = spline(o.path, t);
    const tan = spline(o.path, Math.min(1, t + 0.01)).sub(spline(o.path, Math.max(0, t - 0.01))).normalize();
    const out = o.out(c);
    const across = tan.clone().cross(out).normalize();
    const nrm = across.clone().cross(tan).normalize();
    const rw = o.rootWidth ?? 0.65;
    const w = o.width * 0.5 * lerp(rw, 1, smoothstep(0, 0.3, t)) * Math.pow(Math.max(0, 1 - t), 0.7) + 0.0006;
    const th = o.thick * 0.5 * (0.55 + 0.45 * (1 - t)) * (t > 0.96 ? 0.5 : 1);
    rings.push({ c, x: across, y: nrm, shape: (a) => [Math.cos(a) * w, Math.sin(a) * th * (0.7 + 0.3 * Math.abs(Math.cos(a)))] });
  }
  loft(part, rings, {
    seg: 8,
    capStart: 0.0,
    capEnd: 0.004,
    uv: (t, s, p) => (o.dark ? swatchUv('hairInner') : hairUv(0.5 + 0.5 * Math.cos(s * Math.PI * 2), hairV(p.y))),
    skin: (p, t) => skin(p, t),
    toon: () => (o.dark ? [0.5, 0, 0.3, 0] : T_HAIR),
  });
}

/**
 * The neckerchief: a soft square knot at the collar's V and two tails hanging from it, widening and then cut to a point,
 * splayed a little; each tail skinned to its spring bone.
 */
function buildNeckerchief(part: Part, at: Vector3, chest: number, tails: [number, number], front: (y: number) => number): void {
  const nk = new Part('neckerchief');
  const T: Toon = [0.7, 0.04, 0.8, 0];
  const uv = (): readonly [number, number] => swatchUv('ribbon');
  for (const [k, side] of [[0, 1], [1, -1]] as const) {
    const bone = tails[k];
    const rings: Ring[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const c = at.clone().add(V(side * (0.005 + 0.02 * t), -0.008 - 0.1 * t, 0));
      // Lying on the blouse: never behind the chest's front.
      c.z = Math.max(at.z + 0.004 - 0.01 * t, front(c.y) + 0.007);
      // Wider toward the end, then a pointed cut.
      const w = (0.009 + 0.016 * Math.sin(Math.PI * 0.5 * Math.min(1, t / 0.72))) * (t > 0.72 ? 1 - ((t - 0.72) / 0.28) * 0.94 : 1);
      rings.push({ c, x: V(1, -0.22 * side, 0).normalize(), y: V(0, 0, 1), shape: (a) => [Math.cos(a) * w, Math.sin(a) * 0.0019] });
    }
    loft(nk, rings, { seg: 10, capStart: 0.0, capEnd: 0.001, uv, skin: (_p, t) => normaliseSkin([[chest, 1 - smoothstep(0.05, 0.4, t)], [bone, smoothstep(0.05, 0.4, t)]]), toon: () => T });
  }
  // The knot: a squat rounded block, its fold lines given by the outline.
  const knot: Ring[] = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    knot.push({ c: at.clone().add(V(0, 0.011 - 0.024 * t, 0.003 + 0.002 * Math.sin(Math.PI * t))), x: V(1, 0, 0), y: V(0, 0, 1), shape: section(0.0105 * (0.75 + 0.25 * Math.sin(Math.PI * t)), 0.0062, 0.005, 2.3) });
  }
  loft(nk, knot, { seg: 14, capStart: 0.003, capEnd: 0.003, uv, skin: () => [[chest, 1]], toon: () => T });
  nk.smoothNormals();
  part.merge(nk);
}

/** A hand: palm and five fingers along the finger bones. */
function buildHand(part: Part, bones: KBone[], s: 'L' | 'R', J: (n: string) => Vector3, B: (n: string) => number): void {
  const hand = new Part(`hand${s}`);
  const W = J(`Bip01_${s}_Hand`);
  const base = (i: number): Vector3 => J(`Bip01_${s}_Finger${i}`);
  const k1 = base(1);
  const k4 = base(4);
  const kMid = base(2).lerp(base(3), 0.5);
  const across = k1.clone().sub(k4).normalize();
  const fwd = kMid.clone().sub(W).normalize();
  const segsOf = (i: number): Seg[] => {
    const a = J(`Bip01_${s}_Finger${i}`);
    const b = J(`Bip01_${s}_Finger${i}1`);
    const c = J(`Bip01_${s}_Finger${i}2`);
    const tip = c.clone().add(c.clone().sub(b).multiplyScalar(0.85));
    return [
      { bone: B(`Bip01_${s}_Hand`), a: W, b: a, reach: 0.8 },
      { bone: B(`Bip01_${s}_Finger${i}`), a, b },
      { bone: B(`Bip01_${s}_Finger${i}1`), a: b, b: c },
      { bone: B(`Bip01_${s}_Finger${i}2`), a: c, b: tip },
    ];
  };
  // Palm.
  const palm: Ring[] = [];
  const palmN = across.clone().cross(fwd).normalize();
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const c = W.clone().lerp(kMid, t * 0.98).addScaledVector(fwd, -0.006 * (1 - t));
    const hw = lerp(0.018, 0.026, smoothstep(0, 0.7, t));
    palm.push({ c, x: across, y: palmN, shape: section(hw, 0.0105, 0.0105, 2.6) });
  }
  const palmSkin = (p: Vector3): Skin => envelope(p, [{ bone: B(`Bip01_${s}_Forearm`), a: J(`Bip01_${s}_Forearm`), b: W, reach: 0.5 }, { bone: B(`Bip01_${s}_Hand`), a: W, b: kMid }], 4);
  loft(hand, palm, { seg: 16, capStart: 0.006, capEnd: 0.008, uv: () => swatchUv('skin'), skin: palmSkin, toon: () => T_SMALL });
  void bones;
  for (let i = 0; i <= 4; i++) {
    const a = J(`Bip01_${s}_Finger${i}`);
    const b = J(`Bip01_${s}_Finger${i}1`);
    const c = J(`Bip01_${s}_Finger${i}2`);
    const tip = c.clone().add(c.clone().sub(b).multiplyScalar(0.8));
    const start = i === 0 ? W.clone().lerp(a, 0.45) : a.clone().addScaledVector(fwd, -0.012);
    const pts = [start, a, b, c, tip];
    const r0 = i === 0 ? 0.0092 : i === 4 ? 0.0062 : 0.007;
    const rings: Ring[] = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      const p = spline(pts, t);
      const tan = spline(pts, Math.min(1, t + 0.02)).sub(spline(pts, Math.max(0, t - 0.02)));
      const f = frame(tan, palmN);
      const r = r0 * lerp(1, 0.78, t);
      rings.push({ c: p, x: f.x, y: f.y, shape: section(r, r * 0.92, r * 0.92, 2) });
    }
    const segs = segsOf(i);
    loft(hand, rings, { seg: 8, capEnd: r0 * 0.75, uv: () => swatchUv('skin'), skin: (p) => envelope(p, segs, 6), toon: () => T_SMALL });
  }
  hand.smoothNormals();
  part.merge(hand);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function roundCone(p: Vector3, a: Vector3, r1: number, b: Vector3, r2: number): number {
  // iq's round cone.
  const ba = b.clone().sub(a);
  const l2 = ba.lengthSq();
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pa = p.clone().sub(a);
  const y = pa.dot(ba);
  const z = y - l2;
  const xv = pa.clone().multiplyScalar(l2).sub(ba.clone().multiplyScalar(y));
  const x2 = xv.lengthSq();
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function sdfGrad(f: (q: Vector3) => number, q: Vector3): Vector3 {
  const e = 0.0008;
  return V(f(q.clone().add(V(e, 0, 0))) - f(q.clone().add(V(-e, 0, 0))), f(q.clone().add(V(0, e, 0))) - f(q.clone().add(V(0, -e, 0))), f(q.clone().add(V(0, 0, e))) - f(q.clone().add(V(0, 0, -e)))).normalize();
}

/** Position of world point `p` in a bone's local frame. */
function localOf(bones: KBone[], name: string, p: Vector3): [number, number, number] {
  const b = bones[boneIndex(bones, name)] as KBone;
  const inv = b.world.clone().invert();
  const l = p.clone().applyMatrix4(inv);
  return [l.x, l.y, l.z];
}

/** Flip triangles whose normal points against `out(p)` at their centre. */
function orientOutward(part: Part, out: (p: Vector3) => Vector3, from = 0, to = part.idx.length): void {
  for (let k = from; k < to; k += 3) {
    const a = part.p(part.idx[k] as number);
    const b = part.p(part.idx[k + 1] as number);
    const c = part.p(part.idx[k + 2] as number);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    const m = a.clone().add(b).add(c).divideScalar(3);
    if (n.dot(out(m)) < 0) {
      const t = part.idx[k + 1] as number;
      part.idx[k + 1] = part.idx[k + 2] as number;
      part.idx[k + 2] = t;
    }
  }
}

/** Collar: the top sheet faces away from the body, the bottom toward it; rims follow the top. */
function orientCollar(collar: Part, top: number[][], bottom: number[][], torsoZ: (y: number) => number): void {
  const topSet = new Set(top.flat());
  const botSet = new Set(bottom.flat());
  for (let k = 0; k < collar.idx.length; k += 3) {
    const ids = [collar.idx[k] as number, collar.idx[k + 1] as number, collar.idx[k + 2] as number];
    const a = collar.p(ids[0] as number);
    const b = collar.p(ids[1] as number);
    const c = collar.p(ids[2] as number);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    const m = a.clone().add(b).add(c).divideScalar(3);
    const out = V(m.x, 0.25, m.z - torsoZ(m.y));
    const allBottom = ids.every((i) => botSet.has(i));
    const allTop = ids.every((i) => topSet.has(i));
    const want = allBottom ? -1 : 1;
    if (!allTop && !allBottom) continue;
    if (Math.sign(n.dot(out)) !== want) {
      collar.idx[k + 1] = ids[2] as number;
      collar.idx[k + 2] = ids[1] as number;
    }
  }
}

