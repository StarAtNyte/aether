/**
 * The player's body. In third person this is a person from the cast
 * (animated by the same rig as every NPC: idle, walk, run, sprint, jump, fall,
 * land, crouch, head turning to where the camera looks, footsteps). Its origin
 * is at the FEET (matches `CharacterController.position`) and it faces −Z at
 * yaw 0 (matches `CharacterController.move`).
 *
 * While the person is loading (or if the character files are unavailable) a
 * simple stand-in is drawn so the camera never looks at nothing. In first
 * person, and when the camera is inside the body, the person is drawn
 * shadow-only: the sun still sees you, the camera never clips through you.
 */
import { BoxGeometry, CapsuleGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3, type BufferGeometry, type Material } from 'three';
import type { CharacterSpecInput } from '@aether/core';
import { resolveLook } from '@aether/assets';
import type { CharacterRig } from '../characters/rig';
import type { CharacterSystem } from '../characters/system';

/** Id of the avatar inside the {@link CharacterSystem}. */
export const AVATAR_ID = 'aether:player';

/** What the controller knows that the avatar cannot see from positions alone. */
export interface AvatarState {
  grounded: boolean;
  /** Vertical speed (m/s, positive up). */
  vy: number;
  crouching?: boolean;
  sprinting?: boolean;
}

/** Camera distance (m, to the head) under which the body stops being drawn. */
const CLIP_DISTANCE = 0.85;
const _v = new Vector3();

/** Player avatar object with owned resources. */
export class Avatar {
  readonly group = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly standIn = new Group();
  private placed = false;
  private hidden = false;
  private system: CharacterSystem | null = null;
  private spec: CharacterSpecInput | undefined;
  private rig: CharacterRig | null = null;
  private mounting = false;
  private failed = false;
  private camClose = false;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private bodyYaw = 0;
  private lastTime = 0;
  private readonly look = new Vector3();

  constructor(system?: CharacterSystem) {
    this.system = system ?? null;
    this.group.name = 'aether:avatar';
    const suit = this.material(new MeshStandardMaterial({ color: '#4f7cff', roughness: 0.55, metalness: 0.1 }));
    const skin = this.material(new MeshStandardMaterial({ color: '#ffd2a8', roughness: 0.7 }));
    const body = new Mesh(this.geometry(new CapsuleGeometry(0.3, 0.75, 6, 16)), suit);
    body.position.y = 0.3 + 0.375 + 0.02;
    const head = new Mesh(this.geometry(new SphereGeometry(0.22, 20, 14)), skin);
    head.position.y = 1.5;
    const face = new Mesh(this.geometry(new BoxGeometry(0.3, 0.1, 0.1)), this.material(new MeshStandardMaterial({ color: '#141a28', roughness: 0.2 })));
    face.position.set(0, 1.52, -0.17);
    for (const m of [body, head, face]) {
      m.castShadow = true;
      m.receiveShadow = true;
      this.standIn.add(m);
    }
    this.group.add(this.standIn);
    this.group.visible = false;
  }

  private geometry<G extends BufferGeometry>(g: G): G {
    this.geometries.push(g);
    return g;
  }

  private material<M extends Material>(m: M): M {
    this.materials.push(m);
    return m;
  }

  /** Give the avatar the scene's character system (done once by the renderer). */
  setSystem(system: CharacterSystem): void {
    this.system = system;
  }

  /** Choose who the avatar looks like (`world.player.character`; default: derived from the seed). */
  setLook(spec: CharacterSpecInput | undefined): void {
    const same = JSON.stringify(spec ?? null) === JSON.stringify(this.spec ?? null);
    this.spec = spec;
    if (same) return;
    if (this.rig) {
      this.system?.remove(AVATAR_ID);
      this.rig = null;
      this.standIn.visible = true;
    }
    this.failed = false;
    if (this.placed) void this.mount();
  }

  private async mount(): Promise<void> {
    const system = this.system;
    if (!system || this.mounting || this.rig || this.failed) return;
    this.mounting = true;
    try {
      const look = resolveLook(this.spec ?? { wardrobe: 'traveller' }, 'player');
      const rig = await system.add(AVATAR_ID, look, this.group, { footOffset: 0, track: this.group, castShadow: true, autoMotion: true });
      if (!rig) {
        this.failed = true;
        return;
      }
      this.rig = rig;
      rig.autoMotion = true;
      this.standIn.visible = false;
      this.applyVisibility();
    } finally {
      this.mounting = false;
    }
  }

  /** The person's rig once loaded (tests, HUD). */
  get character(): CharacterRig | null {
    return this.rig;
  }

  /**
   * Place at a feet position with a yaw in degrees (the camera's heading).
   * Non-finite input is ignored. `state` carries what the controller knows
   * (grounded, vertical speed, crouch, sprint).
   */
  set(x: number, y: number, z: number, yawDeg: number, state?: AvatarState): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    this.group.position.set(x, y, z);
    if (Number.isFinite(yawDeg)) this.group.rotation.set(0, (yawDeg * Math.PI) / 180, 0);
    const first = !this.placed;
    this.placed = true;
    if (first && this.system && !this.rig && !this.failed) void this.mount();
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const dt = this.lastTime > 0 ? Math.min(0.2, (now - this.lastTime) / 1000) : 0;
    this.lastTime = now;
    // The body turns toward where it walks; at rest it keeps its heading (first person: the camera's).
    const camYaw = this.group.rotation.y;
    if (Number.isFinite(this.lastX) && dt > 0) {
      const dx = x - this.lastX;
      const dz = z - this.lastZ;
      if (Math.hypot(dx, dz) / dt > 0.4) {
        const target = Math.atan2(-dx, -dz);
        this.bodyYaw = turnToward(this.bodyYaw, target, dt * 9);
      }
    } else if (first) this.bodyYaw = camYaw;
    this.lastX = x;
    this.lastZ = z;
    const rig = this.rig;
    if (rig) {
      rig.root.rotation.y = this.hidden ? 0 : this.bodyYaw - camYaw;
      if (state) {
        rig.input.grounded = state.grounded;
        rig.input.vy = state.vy;
        rig.input.crouching = state.crouching ?? false;
        rig.input.sprinting = state.sprinting ?? false;
      }
      // The head follows the camera's direction.
      this.look.set(x - Math.sin(camYaw) * 6, y + 1.55, z - Math.cos(camYaw) * 6);
      rig.lookTarget = this.look;
    }
    this.applyVisibility();
  }

  /** True once a position has been set. */
  get isPlaced(): boolean {
    return this.placed;
  }

  /** Current yaw in radians. */
  get yaw(): number {
    return this.group.rotation.y;
  }

  /** Hide (first-person view) or show the avatar. Hidden means shadow-only once the person is loaded. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.applyVisibility();
  }

  /** Tell the avatar how far the camera is from its head (m); the body fades out when the camera is inside it. */
  setCameraDistance(d: number): void {
    const close = this.camClose ? d < CLIP_DISTANCE + 0.15 : d < CLIP_DISTANCE;
    if (close === this.camClose) return;
    this.camClose = close;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    const rig = this.rig;
    const hide = this.hidden || this.camClose;
    if (rig) {
      this.group.visible = this.placed;
      rig.setVisibleBody(!hide);
      this.standIn.visible = false;
    } else {
      this.group.visible = this.placed && !this.hidden;
      this.standIn.visible = true;
    }
  }

  /** World position of the head (for cameras and speech), falling back to a standing height. */
  headPosition(out: Vector3): Vector3 {
    if (this.rig) return this.rig.headWorld(out);
    return out.copy(this.group.position).setY(this.group.position.y + 1.65);
  }

  /** Release resources. */
  dispose(): void {
    this.system?.remove(AVATAR_ID);
    this.rig = null;
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.group.removeFromParent();
    void _v;
  }
}

/** Rotate `from` toward `to` (radians) by at most `rate` of the remaining angle (shortest way). */
export function turnToward(from: number, to: number, rate: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + d * Math.min(1, Math.max(0, rate));
}
