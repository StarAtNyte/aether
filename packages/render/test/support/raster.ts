/**
 * A tiny software rasteriser for debugging poses headlessly: the skinned body (the toon vertex stage's cloth push
 * replayed) drawn flat-shaded from the front, side or back with a z-buffer, skirt cloth blue, everything else by its
 * bone group (legs skin, the rest grey), the flagged vertices red. Writes PNGs. Also contact sheets (strips of poses).
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { Matrix4, Vector3, type SkinnedMesh } from 'three';
import type { CharacterRig } from '../../src/characters/rig';
import { CLOTH_MARGIN, clothClearCpu } from '../../src/characters/cloth-clear';

export interface Image {
  w: number;
  h: number;
  data: Uint8Array;
}

export function newImage(w: number, h: number, bg = [236, 238, 242]): Image {
  const data = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) data.set(bg, i * 3);
  return { w, h, data };
}

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

export function writePng(file: string, im: Image): void {
  const raw = Buffer.alloc((im.w * 3 + 1) * im.h);
  for (let y = 0; y < im.h; y++) {
    raw[y * (im.w * 3 + 1)] = 0;
    Buffer.from(im.data.buffer, im.data.byteOffset + y * im.w * 3, im.w * 3).copy(raw, y * (im.w * 3 + 1) + 1);
  }
  const chunk = (type: string, body: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(tb));
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(im.w, 0);
  ihdr.writeUInt32BE(im.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

export type View = 'front' | 'side' | 'back' | 'three-quarter';

const VIEWS: Record<View, number> = { front: 0, side: Math.PI / 2, back: Math.PI, 'three-quarter': Math.PI / 4 };

export interface BodyPoints {
  mesh: SkinnedMesh;
  /** 0 other, 1 skirt, 2 leg. */
  kind: Uint8Array;
}

export function classify(rig: CharacterRig): BodyPoints | null {
  let mesh: SkinnedMesh | null = null;
  rig.root.traverse((o) => {
    const m = o as SkinnedMesh;
    if (!mesh && m.isSkinnedMesh && !/outline/i.test(o.name)) mesh = m;
  });
  const sm = mesh as SkinnedMesh | null;
  if (!sm) return null;
  const g = sm.geometry;
  const si = g.attributes['skinIndex']!;
  const sw = g.attributes['skinWeight']!;
  const tw = g.attributes['_toon'];
  const bones = sm.skeleton.bones;
  const kind = new Uint8Array(g.attributes['position']!.count);
  for (let v = 0; v < kind.length; v++) {
    if (tw && tw.getW(v) > 0.5) {
      kind[v] = 1;
      continue;
    }
    let leg = 0;
    for (let k = 0; k < 4; k++) if (/(Thigh|Calf|Foot|Toe)/.test(bones[si.getComponent(v, k)]!.name)) leg += sw.getComponent(v, k);
    if (leg > 0.5) kind[v] = 2;
  }
  return { mesh: sm, kind };
}

/** Posed vertices in world space (cloth pushed out of the leg capsules as the vertex stage does). */
export function posedWorld(rig: CharacterRig, bp: BodyPoints, push = true): Float32Array {
  const { mesh } = bp;
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  const inv = new Matrix4().copy(mesh.matrixWorld).invert();
  const sc = Math.hypot(inv.elements[0]!, inv.elements[1]!, inv.elements[2]!);
  const caps =
    push && rig.springs
      ? rig.springs.posedCapsules(['Thigh', 'Calf'], CLOTH_MARGIN).map((c) => ({ a: c.a.clone().applyMatrix4(inv), b: c.b.clone().applyMatrix4(inv), radius: c.radius * sc }))
      : [];
  const n = bp.kind.length;
  const out = new Float32Array(n * 3);
  const q = new Vector3();
  const th = ['L_Thigh', 'R_Thigh'].map((nm) => new Vector3().setFromMatrixPosition(bp.mesh.skeleton.bones.find((b) => b.name.endsWith(nm))!.matrixWorld).applyMatrix4(inv));
  const axis = { x: (th[0]!.x + th[1]!.x) / 2, z: (th[0]!.z + th[1]!.z) / 2 };
  for (let i = 0; i < n; i++) {
    mesh.getVertexPosition(i, q);
    if (bp.kind[i] === 1 && push) clothClearCpu(q, caps, 1, axis);
    q.applyMatrix4(mesh.matrixWorld);
    out.set([q.x, q.y, q.z], i * 3);
  }
  return out;
}

export interface Frame {
  /** World-space centre (x, y, z) and half height of the window (m). */
  cx: number;
  cy: number;
  cz: number;
  half: number;
}

/** Draw into `im` at (ox, oy) size (w, h). The camera looks along the view direction at the body from `view`. */
export function drawBody(im: Image, ox: number, oy: number, w: number, h: number, bp: BodyPoints, P: Float32Array, view: View, fr: Frame, flagged: ArrayLike<number> = []): void {
  const ang = VIEWS[view];
  // the body faces +z; a camera in front looks toward -z. Screen x to the viewer's right.
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const scale = h / (2 * fr.half);
  const n = bp.kind.length;
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const sz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3]! - fr.cx;
    const z = P[i * 3 + 2]! - fr.cz;
    // rotate about y by ang: viewer-right axis (ca, -sa) in (x,z) ... front view: right = -x (viewer faces the body)
    const rx = -(x * ca - z * sa);
    const dz = x * sa + z * ca;
    sx[i] = ox + w / 2 + rx * scale;
    sy[i] = oy + h / 2 - (P[i * 3 + 1]! - fr.cy) * scale;
    sz[i] = dz;
  }
  const zb = new Float32Array(w * h).fill(1e9);
  const idx = bp.mesh.geometry.index!;
  const cols: Record<number, number[]> = { 0: [150, 150, 160], 1: [38, 62, 120], 2: [236, 178, 150] };
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t);
    const b = idx.getX(t + 1);
    const c = idx.getX(t + 2);
    const ux = P[b * 3]! - P[a * 3]!;
    const uy = P[b * 3 + 1]! - P[a * 3 + 1]!;
    const uz = P[b * 3 + 2]! - P[a * 3 + 2]!;
    const vx = P[c * 3]! - P[a * 3]!;
    const vy = P[c * 3 + 1]! - P[a * 3 + 1]!;
    const vz = P[c * 3 + 2]! - P[a * 3 + 2]!;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    // view-space z of the normal: toward the viewer positive
    const vzn = nx * sa + nz * ca;
    const lit = 0.45 + 0.55 * Math.abs(vzn);
    const kk = Math.max(bp.kind[a]!, bp.kind[b]!, bp.kind[c]!) === 1 ? 1 : bp.kind[a]!;
    const col = cols[kk]!.map((x) => Math.min(255, x * lit * (vzn < 0 && kk === 1 ? 0.8 : 1)));
    const x0 = sx[a]!;
    const y0 = sy[a]!;
    const x1 = sx[b]!;
    const y1 = sy[b]!;
    const x2 = sx[c]!;
    const y2 = sy[c]!;
    const minX = Math.max(ox, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(ox + w - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(oy, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(oy + h - 1, Math.ceil(Math.max(y0, y1, y2)));
    const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const l0 = ((y1 - y2) * (x + 0.5 - x2) + (x2 - x1) * (y + 0.5 - y2)) / den;
        const l1 = ((y2 - y0) * (x + 0.5 - x2) + (x0 - x2) * (y + 0.5 - y2)) / den;
        const l2 = 1 - l0 - l1;
        if (l0 < 0 || l1 < 0 || l2 < 0) continue;
        const z = l0 * sz[a]! + l1 * sz[b]! + l2 * sz[c]!;
        const zi = (y - oy) * w + (x - ox);
        // skirt wins ties with the leg it covers within 1 mm
        const bias = kk === 1 ? -0.0015 : 0;
        if (z + bias >= zb[zi]!) continue;
        zb[zi] = z + bias;
        im.data[(y * im.w + x) * 3] = col[0]!;
        im.data[(y * im.w + x) * 3 + 1] = col[1]!;
        im.data[(y * im.w + x) * 3 + 2] = col[2]!;
      }
  }
  for (let k = 0; k < flagged.length; k++) {
    const i = flagged[k]!;
    const x = Math.round(sx[i]!);
    const y = Math.round(sy[i]!);
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < ox || yy < oy || xx >= ox + w || yy >= oy + h) continue;
        im.data.set([230, 20, 20], (yy * im.w + xx) * 3);
      }
  }
}

/** The hip's world position (frame centre) of the rig. */
export function pelvisOf(rig: CharacterRig): Vector3 {
  const b = rig.root.getObjectByName('Bip01_Pelvis')!;
  return new Vector3().setFromMatrixPosition(b.matrixWorld);
}
