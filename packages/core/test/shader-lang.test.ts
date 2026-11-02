/** The material expression language (parser, type checker, limits) and the `surface` / `shader` material fields. */
import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, MaterialSpec, parseShaderChannel, parseShaderExpr, SHADER_LIMITS, ShaderExprError, type ShaderExpr } from '../src';

const show = (e: ShaderExpr): string => {
  switch (e.k) {
    case 'num':
      return String(e.v);
    case 'col':
      return 'col';
    case 'var':
      return e.name;
    case 'neg':
      return `(-${show(e.a)})`;
    case 'bin':
      return `(${show(e.a)}${e.op}${show(e.b)})`;
    case 'call':
      return `${e.fn}(${e.args.map(show).join(',')})`;
    case 'swz':
      return `${show(e.a)}.${e.comps}`;
  }
};
const err = (src: string): string => {
  try {
    parseShaderExpr(src);
  } catch (e) {
    expect(e).toBeInstanceOf(ShaderExprError);
    return (e as Error).message;
  }
  throw new Error(`parsed: ${src}`);
};

describe('shader expressions', () => {
  it('parse with precedence, unary minus, parentheses and left associativity', () => {
    expect(show(parseShaderExpr('1 + 2 * 3'))).toBe('(1+(2*3))');
    expect(show(parseShaderExpr('(1 + 2) * 3'))).toBe('((1+2)*3)');
    expect(show(parseShaderExpr('1 - 2 - 3'))).toBe('((1-2)-3)');
    expect(show(parseShaderExpr('8 / 4 / 2'))).toBe('((8/4)/2)');
    expect(show(parseShaderExpr('-p.x * 2'))).toBe('((-p.x)*2)');
    expect(show(parseShaderExpr('2 * -t'))).toBe('(2*(-t))');
    expect(show(parseShaderExpr('.5 + 1e-2'))).toBe('(0.5+0.01)');
  });

  it('type-check vectors, swizzles, colours and broadcasting', () => {
    expect(parseShaderExpr('p').t).toBe(3);
    expect(parseShaderExpr('p.xz').t).toBe(2);
    expect(parseShaderExpr('n.y').t).toBe(1);
    expect(parseShaderExpr('base.rgb').t).toBe(3);
    expect(parseShaderExpr('uv * 2 + 1').t).toBe(2);
    expect(parseShaderExpr('p * 0.5 + n').t).toBe(3);
    expect(parseShaderExpr('mix(base, #ff5a10, 0.5)').t).toBe(3);
    expect(parseShaderExpr('vec3(uv, t)').t).toBe(3);
    expect(parseShaderExpr('vec2(1)').t).toBe(2);
    expect(parseShaderExpr('length(p.xz)').t).toBe(1);
    expect(parseShaderExpr('cross(n, v)').t).toBe(3);
    expect(parseShaderExpr('fbm(p * 2, 4) + ridged(p.xz, 3) + cells(p) + cellId(p) + hash(seed) + noise(p)').t).toBe(1);
    const c = parseShaderExpr('#ffffff');
    expect(c.k === 'col' && c.rgb).toEqual([1, 1, 1]);
    const mid = parseShaderExpr('#808080');
    expect(mid.k === 'col' && mid.rgb[0]).toBeCloseTo(0.2158, 3); // sRGB to linear
  });

  it('accept a set of real material expressions', () => {
    const ok = [
      'mix(base, #ff5a10, smoothstep(0.4, 0.6, fbm(p * 2, 4)))',
      '#ff4000 * pow(1 - cells(p * 3), 4) * (0.8 + 0.2 * sin(t * 2))',
      '#40c0ff * pow(1 - abs(dot(n, v)), 3) * (0.6 + 0.4 * sin(t * 3 + p.y * 8))',
      'clamp(0.3 + 0.5 * pow(1 - abs(dot(n, v)), 2), 0, 1)',
      '0.1 * sin(o.x * 4 - t * 3) * o.x',
      'mix(base * 0.6, base, step(0.5, fract(uv.x * 8)))',
      'vcol * (0.9 + 0.2 * hash(cellId(p * 2)))',
      'saturate(normalize(p).y) * max(min(p.y, 1), 0) + sqrt(exp(sign(t)))',
    ];
    for (const src of ok) expect(() => parseShaderExpr(src), src).not.toThrow();
  });

  it('reject unknown names and list the valid ones', () => {
    const m = err('foo * 2');
    expect(m).toContain('unknown name "foo"');
    expect(m).toContain('variables: p o n uv t v seed base vcol pi');
    expect(m).toContain('fbm');
    expect(err('texture(p)')).toContain('unknown function "texture"');
    expect(err('p.w')).toContain('bad swizzle');
    expect(err('t.x')).toContain('.x on a float');
    expect(err('uv.z')).toContain('.z on a vec2');
  });

  it('reject wrong arity, types and syntax', () => {
    expect(err('sin(1, 2)')).toContain('sin() takes 1 argument');
    expect(err('mix(p, uv, 0.5)')).toContain('same size');
    expect(err('p + uv')).toContain('sizes must match');
    expect(err('cross(p, uv)')).toContain('two vec3');
    expect(err('noise(t)')).toContain('vec2 or vec3');
    expect(err('vec3(uv, uv)')).toContain('add up to 3');
    expect(err('fbm(p, 9)')).toContain('octaves must be a whole number 1..6');
    expect(err('fbm(p, t)')).toContain('octaves');
    expect(err('1 +')).toContain('end of expression');
    expect(err('(1 + 2')).toContain('expected ")"');
    expect(err('1 2')).toContain('unexpected "2"');
    expect(err('p ; 1')).toContain('unexpected ";"');
    expect(err('#ff00')).toContain('#rrggbb');
  });

  it('enforce the size limits', () => {
    expect(err('1+'.repeat(300) + '1')).toMatch(/longer than 600|more than 250 nodes/);
    expect(err(Array.from({ length: 130 }, () => 't').join('+'))).toContain(`more than ${SHADER_LIMITS.nodes} nodes`);
    expect(err(Array.from({ length: 17 }, () => 'noise(p)').join('+'))).toContain('more than 16 noise');
    expect(() => parseShaderExpr(Array.from({ length: 16 }, () => 'noise(p)').join('+'))).not.toThrow();
    expect(err('('.repeat(40) + '1' + ')'.repeat(40))).toContain('nested deeper');
  });

  it('check the channel type', () => {
    expect(parseShaderChannel('color', 't').t).toBe(1); // a float colour is grey
    expect(() => parseShaderChannel('roughness', 'p')).toThrow('shader.roughness must be a float, got a vec3');
    expect(() => parseShaderChannel('color', 'uv')).toThrow('must be a vec3');
  });
});

describe('material surface and shader fields', () => {
  it('accept layers and expressions', () => {
    const spec = {
      preset: 'stone',
      surface: { layers: [{ kind: 'moss', amount: 0.6, mask: { up: 0.5, noise: 0.4 } }, { kind: 'edgeWear' }, { kind: 'snow', mask: { height: [20, 100] } }], scale: 2 },
      shader: { emissive: '#ff4000 * pow(1 - cells(p * 3), 4)', displace: '0.02 * sin(t + p.x)' },
    };
    expect(MaterialSpec.safeParse(spec).success).toBe(true);
  });

  it('reject bad layers, too many layers and bad expressions with the parser message', () => {
    expect(MaterialSpec.safeParse({ surface: { layers: [{ kind: 'glitter' }] } }).success).toBe(false);
    expect(MaterialSpec.safeParse({ surface: { layers: [] } }).success).toBe(false);
    expect(MaterialSpec.safeParse({ surface: { layers: Array.from({ length: 9 }, () => ({ kind: 'tone' })) } }).success).toBe(false);
    expect(MaterialSpec.safeParse({ surface: { layers: [{ kind: 'moss', amount: 2 }] } }).success).toBe(false);
    const bad = MaterialSpec.safeParse({ shader: { color: 'lava(p)' } });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toContain('unknown function \\"lava\\"');
    expect(MaterialSpec.safeParse({ shader: { roughness: 'p' } }).success).toBe(false);
    expect(MaterialSpec.safeParse({ shader: { color: 'x'.repeat(601) } }).success).toBe(false);
  });

  it('reach the model as patch errors', () => {
    const w = createWorld({});
    const r = applyPatches(w, [{ op: 'add', entity: { id: 'wall', material: { preset: 'stone', shader: { color: 'base * glow' } } } }]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.message).toContain('unknown name "glow"');
    const ok = applyPatches(w, [{ op: 'add', entity: { id: 'wall', material: { preset: 'stone', surface: { layers: [{ kind: 'grime' }] } } } }]);
    expect(ok.errors).toEqual([]);
  });

  it('take a shader budget on the world look', () => {
    const w = createWorld({});
    const r = applyPatches(w, [{ op: 'setEnvironment', set: { look: { shaderBudget: 'hero' } } }]);
    expect(r.errors).toEqual([]);
    expect(r.world.environment.look?.shaderBudget).toBe('hero');
    expect(applyPatches(w, [{ op: 'setEnvironment', set: { look: { shaderBudget: 'max' } } }]).errors).toHaveLength(1);
  });
});
