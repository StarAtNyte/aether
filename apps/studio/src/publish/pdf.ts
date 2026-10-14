/**
 * A minimal vector PDF writer for floor plans: one page sized to the
 * drawing at a print scale (capped to A0, scaled down to fit), filled and
 * stroked polygons, dashed lines, arcs (as Bézier segments) and text in the
 * standard Helvetica fonts (WinAnsi encoding; characters outside it become
 * "?"). Uncompressed content stream, exact cross-reference table.
 */
import type { PlanDrawing } from './floorplan';

const PT_PER_MM = 72 / 25.4;
/** Largest page side (A0 long side, mm). */
const MAX_PAGE_MM = 1189;

function hexRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1] as string, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function f(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Number.isFinite(r) ? String(r) : '0';
}

/** Encode text for a PDF literal string in WinAnsi (Latin-1 range kept, others → '?'). */
export function pdfString(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 63;
    let b: number;
    if (c === 0x2022) b = 0x95;
    else if (c === 0x2013) b = 0x96;
    else if (c === 0x2014) b = 0x97;
    else if (c === 0xb7) b = 0xb7;
    else if (c >= 0x20 && c <= 0x7e) b = c;
    else if (c >= 0xa0 && c <= 0xff) b = c;
    else b = 63;
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += `\\${String.fromCharCode(b)}`;
    else if (b < 0x20 || b > 0x7e) out += `\\${b.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(b);
  }
  return `(${out})`;
}

/** Approximate Helvetica text width (em fraction per character class). */
function textWidth(text: string, size: number, bold: boolean): number {
  let w = 0;
  for (const ch of text) {
    if (/[il.,:;'|!]/.test(ch)) w += 0.26;
    else if (/[mwMW@]/.test(ch)) w += 0.86;
    else if (/[A-Z0-9]/.test(ch)) w += 0.66;
    else if (ch === ' ') w += 0.28;
    else w += 0.54;
  }
  return w * size * (bold ? 1.05 : 1);
}

/** Write a drawing as a one-page PDF (1:`scale`, scaled down to fit A0 when needed). */
export function planPdf(d: PlanDrawing, scale = 50): Uint8Array {
  const [x0, z0, x1, z1] = d.sheet;
  const wm = Math.max(0.1, x1 - x0);
  const hm = Math.max(0.1, z1 - z0);
  let mmPerM = 1000 / Math.max(1, scale);
  const fit = Math.min(1, MAX_PAGE_MM / Math.max(wm * mmPerM, hm * mmPerM));
  mmPerM *= fit;
  const k = mmPerM * PT_PER_MM; // points per metre
  const pw = wm * k;
  const ph = hm * k;
  const X = (x: number): number => (x - x0) * k;
  const Y = (z: number): number => ph - (z - z0) * k;
  const ops: string[] = [];
  ops.push('1 1 1 rg', `0 0 ${f(pw)} ${f(ph)} re f`);
  for (const p of d.items) {
    if (p.k === 'poly') {
      if (p.pts.length < 2) continue;
      ops.push('q');
      if (p.fill) ops.push(`${hexRgb(p.fill).map(f).join(' ')} rg`);
      if (p.stroke) ops.push(`${hexRgb(p.stroke).map(f).join(' ')} RG`, `${f((p.width ?? 0.02) * k)} w`, '1 j 1 J');
      if (p.dash) ops.push(`[${p.dash.map((v) => f(v * k)).join(' ')}] 0 d`);
      const first = p.pts[0] as [number, number];
      ops.push(`${f(X(first[0]))} ${f(Y(first[1]))} m`);
      for (let i = 1; i < p.pts.length; i++) {
        const q = p.pts[i] as [number, number];
        ops.push(`${f(X(q[0]))} ${f(Y(q[1]))} l`);
      }
      if (p.closed) ops.push('h');
      ops.push(p.fill && p.stroke ? 'B' : p.fill ? 'f' : 'S', 'Q');
    } else if (p.k === 'arc') {
      let delta = p.a1 - p.a0;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      const segs = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
      const step = delta / segs;
      const kappa = (4 / 3) * Math.tan(step / 4);
      ops.push('q', `${hexRgb(p.stroke).map(f).join(' ')} RG`, `${f(p.width * k)} w`, `[${f(p.width * 4 * k)} ${f(p.width * 3 * k)}] 0 d`);
      const pt = (a: number): [number, number] => [p.c[0] + Math.cos(a) * p.r, p.c[1] + Math.sin(a) * p.r];
      const s = pt(p.a0);
      ops.push(`${f(X(s[0]))} ${f(Y(s[1]))} m`);
      for (let i = 0; i < segs; i++) {
        const a = p.a0 + i * step;
        const b = a + step;
        const pa = pt(a);
        const pb = pt(b);
        const c1: [number, number] = [pa[0] - Math.sin(a) * p.r * kappa, pa[1] + Math.cos(a) * p.r * kappa];
        const c2: [number, number] = [pb[0] + Math.sin(b) * p.r * kappa, pb[1] - Math.cos(b) * p.r * kappa];
        ops.push(`${f(X(c1[0]))} ${f(Y(c1[1]))} ${f(X(c2[0]))} ${f(Y(c2[1]))} ${f(X(pb[0]))} ${f(Y(pb[1]))} c`);
      }
      ops.push('S', 'Q');
    } else {
      const size = p.size * k;
      const width = textWidth(p.text, size, p.bold === true);
      const tx = X(p.at[0]) - (p.anchor === 'middle' ? width / 2 : p.anchor === 'end' ? width : 0);
      // SVG uses a middle baseline: shift down by ~0.35 em.
      const ty = Y(p.at[1]) - size * 0.35;
      ops.push(`${hexRgb(p.color).map(f).join(' ')} rg`, 'BT', `/${p.bold ? 'F2' : 'F1'} ${f(size)} Tf`, `${f(tx)} ${f(ty)} Td`, `${pdfString(p.text)} Tj`, 'ET');
    }
  }
  const content = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pw)} ${f(ph)}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${new TextEncoder().encode(content).byteLength} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title ${pdfString(d.title)} /Producer (Aether) >>`,
  ];
  // Content is ASCII only (non-ASCII text is octal-escaped), so string length = byte length.
  let body = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(latin1Length(body));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = latin1Length(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const out = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) out[i] = body.charCodeAt(i) & 0xff;
  return out;
}

function latin1Length(s: string): number {
  return s.length;
}
