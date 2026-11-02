/**
 * The material expression language: a tiny, safe, GLSL-like language for `material.shader` channels.
 *
 * A model writes `mix(base, #ff5a10, smoothstep(0.4, 0.6, fbm(p * 2, 4)))`; this module tokenizes it, parses it with a
 * Pratt parser and type-checks it (float, vec2, vec3) into a small AST the renderer turns into shader nodes. Nothing
 * here runs the expression: the AST is data, every name is on a whitelist, and the size limits bound the shader the
 * renderer builds. Errors name the offending token and list the valid names, so the model can fix its own expression.
 */

/** Size of a value: 1 float, 2 vec2, 3 vec3. */
export type ShaderType = 1 | 2 | 3;

export type ShaderExpr =
  | { k: 'num'; v: number; t: 1 }
  | { k: 'col'; rgb: [number, number, number]; t: 3 }
  | { k: 'var'; name: ShaderVar; t: ShaderType }
  | { k: 'neg'; a: ShaderExpr; t: ShaderType }
  | { k: 'bin'; op: '+' | '-' | '*' | '/'; a: ShaderExpr; b: ShaderExpr; t: ShaderType }
  | { k: 'call'; fn: string; args: ShaderExpr[]; t: ShaderType }
  | { k: 'swz'; a: ShaderExpr; comps: string; t: ShaderType };

/** The channels of `material.shader` and the type each one returns (a float is widened to vec3 for colours). */
export const SHADER_CHANNELS = { color: 3, emissive: 3, roughness: 1, metalness: 1, opacity: 1, bump: 1, displace: 1 } as const;
export type ShaderChannel = keyof typeof SHADER_CHANNELS;

export const SHADER_LIMITS = Object.freeze({ chars: 600, nodes: 250, noiseCalls: 16, octaves: 6, depth: 32 });

/** Input variables and their types. */
export const SHADER_VARS = Object.freeze({ p: 3, o: 3, n: 3, uv: 2, t: 1, v: 3, seed: 1, base: 3, vcol: 3, pi: 1 } as const);
export type ShaderVar = keyof typeof SHADER_VARS;

/** Functions whose cost is a noise evaluation (counted against {@link SHADER_LIMITS.noiseCalls}). */
export const NOISE_FUNCTIONS: ReadonlySet<string> = new Set(['noise', 'fbm', 'ridged', 'cells', 'cellId']);
/** Functions whose second argument is an integer octave count literal. */
export const OCTAVE_FUNCTIONS: ReadonlySet<string> = new Set(['fbm', 'ridged']);

export class ShaderExprError extends Error {}

type Sig = (ts: ShaderType[]) => ShaderType | string;

const same = (ts: ShaderType[]): ShaderType | null => {
  // Component-wise arguments: one vector size, floats broadcast.
  let size: ShaderType = 1;
  for (const t of ts) {
    if (t === 1) continue;
    if (size !== 1 && size !== t) return null;
    size = t;
  }
  return size;
};
const unary: Sig = (ts) => ts[0] as ShaderType;
const wise: Sig = (ts) => same(ts) ?? 'arguments must be the same size (or floats)';
const point: Sig = (ts) => (ts[0] === 1 ? 'takes a vec2 or vec3 position' : 1);
const anyHash: Sig = () => 1;

/** Whitelisted functions: arity and the result type. */
const FUNCS: Readonly<Record<string, { n: [number, number]; sig: Sig }>> = {
  sin: { n: [1, 1], sig: unary }, cos: { n: [1, 1], sig: unary }, abs: { n: [1, 1], sig: unary }, floor: { n: [1, 1], sig: unary },
  fract: { n: [1, 1], sig: unary }, sqrt: { n: [1, 1], sig: unary }, exp: { n: [1, 1], sig: unary }, sign: { n: [1, 1], sig: unary },
  saturate: { n: [1, 1], sig: unary },
  min: { n: [2, 2], sig: wise }, max: { n: [2, 2], sig: wise }, pow: { n: [2, 2], sig: wise },
  clamp: { n: [3, 3], sig: wise }, mix: { n: [3, 3], sig: wise }, step: { n: [2, 2], sig: wise }, smoothstep: { n: [3, 3], sig: wise },
  length: { n: [1, 1], sig: () => 1 },
  dot: { n: [2, 2], sig: (ts) => (ts[0] === ts[1] ? 1 : 'arguments must be the same size') },
  cross: { n: [2, 2], sig: (ts) => (ts[0] === 3 && ts[1] === 3 ? 3 : 'takes two vec3') },
  normalize: { n: [1, 1], sig: (ts) => (ts[0] === 1 ? 'takes a vector' : (ts[0] as ShaderType)) },
  vec2: { n: [1, 2], sig: (ts) => (ts.length === 1 ? (ts[0] === 1 ? 2 : 'vec2(x) takes a float') : ts.reduce((s, t) => s + t, 0) === 2 ? 2 : 'components must add up to 2') },
  vec3: { n: [1, 3], sig: (ts) => (ts.length === 1 ? (ts[0] === 1 ? 3 : 'vec3(x) takes a float') : ts.reduce((s, t) => s + t, 0) === 3 ? 3 : 'components must add up to 3') },
  noise: { n: [1, 1], sig: point }, fbm: { n: [2, 2], sig: point }, ridged: { n: [2, 2], sig: point },
  cells: { n: [1, 1], sig: point }, cellId: { n: [1, 1], sig: point }, hash: { n: [1, 1], sig: anyHash },
};
export const SHADER_FUNCTIONS: readonly string[] = Object.freeze(Object.keys(FUNCS));

const NAMES_HELP = `variables: ${Object.keys(SHADER_VARS).join(' ')}; functions: ${SHADER_FUNCTIONS.join(' ')}`;
const TYPE_NAME = ['', 'float', 'vec2', 'vec3'] as const;

type Tok = { k: 'num'; v: number; at: number } | { k: 'col'; v: string; at: number } | { k: 'id'; v: string; at: number } | { k: 'op'; v: string; at: number } | { k: 'end'; at: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c === '#') {
      const m = /^#[0-9a-fA-F]{6}(?![0-9a-zA-Z_])/.exec(src.slice(i));
      if (!m) throw new ShaderExprError(`bad colour at ${i}: write colours as #rrggbb`);
      out.push({ k: 'col', v: m[0], at: i });
      i += 7;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ k: 'num', v: Number(num[0]), at: i });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) {
      out.push({ k: 'id', v: id[0], at: i });
      i += id[0].length;
      continue;
    }
    if ('+-*/(),.'.includes(c)) {
      out.push({ k: 'op', v: c, at: i });
      i++;
      continue;
    }
    throw new ShaderExprError(`unexpected "${c}" at ${i}: only numbers, #rrggbb, names, + - * / ( ) , and .swizzles`);
  }
  out.push({ k: 'end', at: src.length });
  return out;
}

const BIN_POWER: Readonly<Record<string, number>> = { '+': 10, '-': 10, '*': 20, '/': 20 };

/** Parse and type-check one expression. Throws {@link ShaderExprError} with a message the model can act on. */
export function parseShaderExpr(src: string): ShaderExpr {
  if (typeof src !== 'string') throw new ShaderExprError('expected an expression string');
  if (src.length > SHADER_LIMITS.chars) throw new ShaderExprError(`expression longer than ${SHADER_LIMITS.chars} characters`);
  const toks = tokenize(src);
  let pos = 0;
  let nodes = 0;
  let noise = 0;
  const peek = (): Tok => toks[pos] as Tok;
  const next = (): Tok => toks[pos++] as Tok;
  const tokText = (t: Tok): string => (t.k === 'end' ? 'end of expression' : `"${t.v}" at ${t.at}`);
  const expectOp = (v: string): void => {
    const t = next();
    if (t.k !== 'op' || t.v !== v) throw new ShaderExprError(`expected "${v}" but found ${tokText(t)}`);
  };
  const node = <E extends ShaderExpr>(e: E): E => {
    if (++nodes > SHADER_LIMITS.nodes) throw new ShaderExprError(`expression too large (more than ${SHADER_LIMITS.nodes} nodes)`);
    return e;
  };

  const prefix = (depth: number): ShaderExpr => {
    if (depth > SHADER_LIMITS.depth) throw new ShaderExprError(`expression nested deeper than ${SHADER_LIMITS.depth}`);
    const t = next();
    if (t.k === 'num') return node({ k: 'num', v: t.v, t: 1 });
    if (t.k === 'col') {
      const h = t.v.slice(1);
      const lin = (s: string): number => {
        const c = parseInt(s, 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return node({ k: 'col', rgb: [lin(h.slice(0, 2)), lin(h.slice(2, 4)), lin(h.slice(4, 6))], t: 3 });
    }
    if (t.k === 'op' && t.v === '-') {
      const a = expr(30, depth + 1);
      return node({ k: 'neg', a, t: a.t });
    }
    if (t.k === 'op' && t.v === '+') return expr(30, depth + 1);
    if (t.k === 'op' && t.v === '(') {
      const e = expr(0, depth + 1);
      expectOp(')');
      return e;
    }
    if (t.k === 'id') {
      const nt = peek();
      if (nt.k === 'op' && nt.v === '(') {
        next();
        const def = Object.hasOwn(FUNCS, t.v) ? FUNCS[t.v] : undefined;
        if (!def) throw new ShaderExprError(`unknown function "${t.v}" at ${t.at}; ${NAMES_HELP}`);
        const args: ShaderExpr[] = [];
        if (!(peek().k === 'op' && (peek() as { v: string }).v === ')')) {
          for (;;) {
            args.push(expr(0, depth + 1));
            const sep = peek();
            if (sep.k === 'op' && sep.v === ',') {
              next();
              continue;
            }
            break;
          }
        }
        expectOp(')');
        const [lo, hi] = def.n;
        if (args.length < lo || args.length > hi) throw new ShaderExprError(`${t.v}() takes ${lo === hi ? lo : `${lo} to ${hi}`} argument${hi === 1 ? '' : 's'}, got ${args.length}`);
        if (NOISE_FUNCTIONS.has(t.v) && ++noise > SHADER_LIMITS.noiseCalls) throw new ShaderExprError(`more than ${SHADER_LIMITS.noiseCalls} noise/fbm/ridged/cells/cellId calls`);
        if (OCTAVE_FUNCTIONS.has(t.v)) {
          const o = args[1] as ShaderExpr;
          if (o.k !== 'num' || !Number.isInteger(o.v) || o.v < 1 || o.v > SHADER_LIMITS.octaves) throw new ShaderExprError(`${t.v}(p, octaves): octaves must be a whole number 1..${SHADER_LIMITS.octaves}`);
          args[1] = o;
        }
        const types = OCTAVE_FUNCTIONS.has(t.v) ? [(args[0] as ShaderExpr).t] : args.map((a) => a.t);
        const r = def.sig(types);
        if (typeof r === 'string') throw new ShaderExprError(`${t.v}(${types.map((x) => TYPE_NAME[x]).join(', ')}): ${r}`);
        return node({ k: 'call', fn: t.v, args, t: r });
      }
      if (!Object.hasOwn(SHADER_VARS, t.v)) throw new ShaderExprError(`unknown name "${t.v}" at ${t.at}; ${NAMES_HELP}`);
      return node({ k: 'var', name: t.v as ShaderVar, t: SHADER_VARS[t.v as ShaderVar] });
    }
    throw new ShaderExprError(`unexpected ${tokText(t)}`);
  };

  const expr = (minPower: number, depth: number): ShaderExpr => {
    let left = prefix(depth);
    for (;;) {
      const t = peek();
      if (t.k === 'op' && t.v === '.') {
        next();
        const s = next();
        if (s.k !== 'id' || !/^[xyzrgb]{1,3}$/.test(s.v)) throw new ShaderExprError(`bad swizzle ${tokText(s)}: use .x .y .z .xy .xz .xyz (or r g b)`);
        const comps = s.v.replace(/r/g, 'x').replace(/g/g, 'y').replace(/b/g, 'z');
        const max = Math.max(...[...comps].map((c) => 'xyz'.indexOf(c) + 1));
        if (left.t === 1 || max > left.t) throw new ShaderExprError(`.${s.v} on a ${TYPE_NAME[left.t]}`);
        left = node({ k: 'swz', a: left, comps, t: comps.length as ShaderType });
        continue;
      }
      if (t.k !== 'op' || !Object.hasOwn(BIN_POWER, t.v)) break;
      const power = BIN_POWER[t.v] as number;
      if (power <= minPower) break;
      next();
      const right = expr(power, depth + 1);
      const r = same([left.t, right.t]);
      if (r === null) throw new ShaderExprError(`"${t.v}" at ${t.at} between ${TYPE_NAME[left.t]} and ${TYPE_NAME[right.t]}: sizes must match (or one side a float)`);
      left = node({ k: 'bin', op: t.v as '+' | '-' | '*' | '/', a: left, b: right, t: r });
    }
    return left;
  };

  const e = expr(0, 0);
  const rest = peek();
  if (rest.k !== 'end') throw new ShaderExprError(`unexpected ${tokText(rest)}`);
  return e;
}

/** Parse a channel expression and check its result type (a float colour is allowed: it is grey). */
export function parseShaderChannel(channel: ShaderChannel, src: string): ShaderExpr {
  const e = parseShaderExpr(src);
  const want = SHADER_CHANNELS[channel];
  if (e.t !== want && !(want === 3 && e.t === 1)) throw new ShaderExprError(`shader.${channel} must be a ${TYPE_NAME[want]}, got a ${TYPE_NAME[e.t]}`);
  return e;
}

/** The message of a failed channel, or null when it parses (schema and sanitizer validation). */
export function shaderChannelError(channel: ShaderChannel, src: unknown): string | null {
  if (typeof src !== 'string') return `shader.${channel}: expected an expression string`;
  try {
    parseShaderChannel(channel, src);
    return null;
  } catch (e) {
    return `shader.${channel}: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Kinds of `material.surface` layers. */
export const SURFACE_LAYER_KINDS = [
  'tone', 'veins', 'strata', 'moss', 'snow', 'grime', 'streaks', 'edgeWear', 'wet', 'lichen', 'rust', 'scratches', 'cracks',
  'glowCracks', 'runes', 'pattern', 'pulse', 'rim', 'sparkle',
] as const;
export type SurfaceLayerKind = (typeof SURFACE_LAYER_KINDS)[number];
export const MAX_SURFACE_LAYERS = 8;
