/**
 * The particle shader (TSL, so one source runs on the WebGPU and WebGL2
 * backends, Firefox included).
 *
 * Particles are camera-facing quads of an instanced geometry. Each instance
 * carries its birth record (see `pool.ts`); the vertex stage evaluates the
 * motion analytically from the age (origin + velocity with exponential drag,
 * gravity, a seeded wander), grows or shrinks the quad, spins billboards or
 * stretches sparks and droplets along their current velocity, and rests
 * particles on their floor. Nothing is simulated per frame on the CPU, and
 * dead particles collapse to a point.
 *
 * Soft particles: the fragment fades with its height above the emitter's
 * floor (a dust puff or smoke ball meets the ground in a soft edge instead of
 * a hard line) and near the camera (no opaque card across the lens). Depth
 * buffer softness is not used: on WebGPU the multisampled depth cannot be
 * copied for sampling (see `materials/scene-backdrop.ts`), and the floor fade
 * covers the case that shows (sprites crossing the ground they rise from).
 */
import { AdditiveBlending, NormalBlending, Vector2, type DataTexture, type Vector3 } from 'three';
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import {
  attribute, cameraPosition, clamp, cos, cross, exp, float, length, max, min, mix, normalize, positionGeometry, sin, smoothstep, step, texture, uniform, uv, varying, vec2, vec3,
} from 'three/tsl';
import { ATLAS_CELLS } from './atlas';
import { SPIN_BIAS } from './pool';

/** Uniforms shared by the particle materials of one renderer. */
export interface VfxUniforms {
  /**
   * Clock of the effects (s) in `value.x`. A vector, not a number: uniform nodes holding vectors and numbers share
   * one object shape, and a number written to it every frame would be boxed.
   */
  time: { value: Vector2 };
  /** Camera right and up axes (world). */
  right: { value: Vector3 };
  up: { value: Vector3 };
  /** Light the alpha-blended matter (smoke, dust) receives: the scene's ambient + sun, linear. */
  light: { value: Vector3 };
}

/** Make the shared uniforms. */
export function vfxUniforms(right: Vector3, up: Vector3, light: Vector3): VfxUniforms {
  return {
    time: uniform(new Vector2()) as unknown as { value: Vector2 },
    right: uniform(right) as unknown as { value: Vector3 },
    up: uniform(up) as unknown as { value: Vector3 },
    light: uniform(light) as unknown as { value: Vector3 },
  };
}

/** The node material of one blend layer. */
export function createVfxMaterial(blend: 'add' | 'alpha', atlas: DataTexture, u: VfxUniforms): MeshBasicNodeMaterial {
  const aO = attribute('aOrigin', 'vec4') as unknown as Node<'vec4'>;
  const aV = attribute('aVel', 'vec4') as unknown as Node<'vec4'>;
  const aS = attribute('aShape', 'vec4') as unknown as Node<'vec4'>;
  const aC0 = attribute('aColor0', 'vec4') as unknown as Node<'vec4'>;
  const aC1 = attribute('aColor1', 'vec4') as unknown as Node<'vec4'>;
  const aM = attribute('aMotion', 'vec4') as unknown as Node<'vec4'>;
  const uTime = (u.time as unknown as Node<'vec2'>).x;
  const uRight = u.right as unknown as Node<'vec3'>;
  const uUp = u.up as unknown as Node<'vec3'>;
  const uLight = u.light as unknown as Node<'vec3'>;

  const age = uTime.sub(aO.w);
  const life = max(aV.w, float(1e-3));
  const t = clamp(age.div(life), 0, 1);
  const alive = step(float(0), age).mul(step(age, life));
  const gravity = aM.x;
  const drag = max(aM.y, float(1e-3));
  const turb = aM.z;
  const w = aM.w;
  const seed = aS.z;
  const decay = float(1).sub(exp(drag.negate().mul(age))).div(drag);
  const fall = gravity.mul(age).mul(age).mul(0.5);
  const wanderAge = min(age, float(4));
  const wander = vec3(sin(seed.mul(91.7).add(age.mul(2.3))), sin(seed.mul(47.3).add(age.mul(1.7))).mul(0.6), cos(seed.mul(13.1).add(age.mul(2.9)))).mul(turb.mul(wanderAge));
  const free = aO.xyz.add(aV.xyz.mul(decay)).add(vec3(0, fall.negate(), 0)).add(wander);
  const size = mix(aS.x, aS.y, t).mul(alive);
  const floorY = aC1.w;
  // Particles with a floor rest on it (their lower edge touching it) instead of falling through.
  const p = vec3(free.x, max(free.y, floorY.add(size.mul(0.5))), free.z);
  const vNow = aV.xyz.mul(exp(drag.negate().mul(age))).add(vec3(0, gravity.mul(age).negate(), 0));
  const corner = positionGeometry.xy;
  // Billboard, spinning.
  const spin = w.negate().sub(SPIN_BIAS);
  const ang = spin.mul(age).add(seed.mul(6.2832));
  const ca = cos(ang);
  const sa = sin(ang);
  const rx = corner.x.mul(ca).sub(corner.y.mul(sa));
  const ry = corner.x.mul(sa).add(corner.y.mul(ca));
  const billboard = uRight.mul(rx.mul(size)).add(uUp.mul(ry.mul(size)));
  // Streak along the current velocity (sparks, droplets).
  const speedNow = length(vNow);
  const axis = vNow.div(max(speedNow, float(1e-3)));
  const toCam = normalize(cameraPosition.sub(p));
  const side = normalize(cross(axis, toCam).add(vec3(1e-5, 0, 0)));
  const len = size.add(speedNow.mul(max(w, float(0))).mul(alive));
  const streak = side.mul(corner.x.mul(size)).add(axis.mul(corner.y.mul(len)));
  const isStreak = step(float(1e-4), w);
  const world = p.add(mix(billboard, streak, isStreak));

  const vT = varying(t);
  const vCell = varying(aS.w);
  const vC0 = varying(aC0);
  const vC1 = varying(aC1.xyz);
  // Height of this corner above the floor, and the softness range (a fraction of the particle's size).
  const vAbove = varying(world.y.sub(floorY));
  const vSoft = varying(size.mul(0.6).add(0.02));
  const vCam = varying(length(cameraPosition.sub(p)));

  const cuv = uv();
  const atlasUv = vec2(vCell.add(clamp(cuv.x, 0.01, 0.99)).div(ATLAS_CELLS), cuv.y);
  const shapeAlpha = texture(atlas, atlasUv).a;
  const fadeIn = smoothstep(float(0), float(0.08), vT);
  const fadeOut = float(1).sub(smoothstep(float(0.55), float(1), vT));
  const ground = smoothstep(float(0), vSoft, vAbove);
  const lens = smoothstep(float(0.18), float(0.95), vCam);
  const alpha = shapeAlpha.mul(vC0.w).mul(fadeIn).mul(fadeOut).mul(ground).mul(lens);
  const rgb = mix(vC0.xyz, vC1, vT);

  const m = new MeshBasicNodeMaterial();
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.blending = blend === 'add' ? AdditiveBlending : NormalBlending;
  m.fog = blend === 'alpha';
  m.toneMapped = true;
  m.positionNode = world as unknown as Node<'vec3'>;
  m.colorNode = (blend === 'alpha' ? rgb.mul(uLight) : rgb) as unknown as Node<'vec3'>;
  m.opacityNode = alpha as unknown as Node<'float'>;
  m.name = `aether:vfx:${blend}`;
  return m;
}
