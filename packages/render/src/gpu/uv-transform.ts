/** Exact zero-rotation specialization of Three r186's UV transform math. All matrix writes still run. */
import { Matrix3, REVISION } from 'three';

type Setter = (this: Matrix3, tx: number, ty: number, sx: number, sy: number, rotation: number, cx: number, cy: number) => Matrix3;
const specialized = new WeakSet<Setter>();

/** Only replace the known pure native body, including its minified spelling; custom setters stay untouched. */
function nativeBody(fn: Setter): boolean {
  const source = Function.prototype.toString.call(fn), start = source.indexOf('('), end = source.indexOf(')', start);
  const args = source.slice(start + 1, end).split(',').map(s => s.trim());
  if (args.length !== 7 || args.some(s => !/^[\w$]+$/.test(s))) return false;
  let body = source.slice(source.indexOf('{', end) + 1, source.lastIndexOf('}'));
  const cos = /\b([\w$]+)\s*=\s*Math\.cos\(/.exec(body)?.[1], sin = /\b([\w$]+)\s*=\s*Math\.sin\(/.exec(body)?.[1];
  if (!cos || !sin || new Set([...args, cos, sin]).size !== 9) return false;
  const names = new Map(args.map((arg, i) => [arg, `p${i}`])); names.set(cos, 'c'); names.set(sin, 's');
  body = body.replace(/\b(?:const|let|var)\s+/g, '').replace(/\b[A-Za-z_$][\w$]*\b/g, name => names.get(name) ?? name).replace(/\s/g, '');
  if (!body.endsWith(';')) body += ';';
  const call = 'this.set(p2*c,p2*s,-p2*(c*p5+s*p6)+p5+p0,-p3*s,p3*c,-p3*(-s*p5+c*p6)+p6+p1,0,0,1)';
  for (const prefix of ['c=Math.cos(p4);s=Math.sin(p4);', 'c=Math.cos(p4),s=Math.sin(p4);']) {
    if (body === `${prefix}${call};returnthis;` || body === `${prefix}return${call},this;`) return true;
  }
  return false;
}

export function specializeUvTransform(original: Setter): Setter {
  if (specialized.has(original)) return original;
  const cos = Math.cos, sin = Math.sin, apply = Reflect.apply;
  const builtin = (fn: Function, name: string): boolean => typeof fn === 'function' && Function.prototype.toString.call(fn).replace(/\s/g, '') === `function${name}(){[nativecode]}`;
  if (REVISION !== '186' || !builtin(cos, 'cos') || !builtin(sin, 'sin') || !builtin(apply, 'apply') || !nativeBody(original)) return original;
  const fast: Setter = {
    setUvTransform(this: Matrix3, tx: number, ty: number, sx: number, sy: number, rotation: number, cx: number, cy: number) {
      let c: number, s: number;
      if (rotation === 0) {
        const cosineReceiver = Math, currentCos = cosineReceiver.cos;
        c = currentCos === cos ? 1 : apply(currentCos, cosineReceiver, [rotation]);
        const sineReceiver = Math, currentSin = sineReceiver.sin;
        s = currentSin === sin ? rotation : apply(currentSin, sineReceiver, [rotation]);
      } else { c = Math.cos(rotation); s = Math.sin(rotation); }
      this.set(
        sx * c, sx * s, -sx * (c * cx + s * cy) + cx + tx,
        -sy * s, sy * c, -sy * (-s * cx + c * cy) + cy + ty,
        0, 0, 1,
      );
      return this;
    },
  }.setUvTransform;
  specialized.add(fast); return fast;
}

export function specializeTextureUvMath(): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(Matrix3.prototype, 'setUvTransform');
  if (!descriptor || descriptor.writable !== true || typeof descriptor.value !== 'function') return false;
  const next = specializeUvTransform(descriptor.value);
  if (next === descriptor.value) return specialized.has(next);
  Matrix3.prototype.setUvTransform = next as typeof Matrix3.prototype.setUvTransform;
  return true;
}
