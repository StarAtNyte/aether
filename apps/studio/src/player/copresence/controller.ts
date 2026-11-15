/**
 * Runs a shared visit inside the player: the session (`session.ts`) over the chosen transport, this visitor's pose
 * read from the running world ten times a second, and the other visitors drawn every frame (`avatars.ts`).
 *
 * This visitor's pose: playing (P), the player's feet and the way they walk; otherwise where the camera is: at street
 * level the ground under it, higher up the ground under the point it orbits, facing the way the camera looks.
 */
import { COPRESENCE_STATE_HZ, type PresenceBody, type PresenceMotion, type PresencePose } from '@aether/core/copresence';
import { Vector3 } from 'three';
import type { Simulation } from '../../engine/Simulation';
import { RemoteAvatars } from './avatars';
import { CopresenceSession, type SessionSnapshot } from './session';
import type { CopresenceTransport } from './transport';

const _dir = new Vector3();

/** Camera height under which the visitor stands under the camera (else under the orbit point). */
const STREET_M = 6;

const motionOf = (speed: number): PresenceMotion => (speed < 0.35 ? 'idle' : speed < 3.6 ? 'walk' : 'run');

/** Debug / probe handle (`window.__aetherCopresence`). */
export interface CopresenceHandle {
  readonly status: SessionSnapshot['status'];
  readonly id: string | null;
  readonly count: number;
  /** The other visitors as drawn now: id, name, body, feet position. */
  remotes(): Array<{ id: string; name: string; body: string; position: [number, number, number] | null; visible: boolean }>;
  /** This visitor's last pose sent. */
  readonly local: PresencePose | null;
}

declare global {
  interface Window {
    __aetherCopresence?: CopresenceHandle;
  }
}

export class CopresenceController {
  readonly session: CopresenceSession;
  private readonly avatars: RemoteAvatars;
  private raf = 0;
  private lastPoseAt = Number.NEGATIVE_INFINITY;
  private last: { pos: [number, number, number]; at: number; yaw: number } | null = null;
  private local: PresencePose | null = null;
  private seenChat = 0;

  constructor(
    private readonly sim: Simulation,
    transport: CopresenceTransport,
    layer: HTMLElement,
    identity: { name: string; body: PresenceBody },
    onChange: (s: SessionSnapshot) => void,
  ) {
    this.avatars = new RemoteAvatars(sim.renderer, layer);
    this.session = new CopresenceSession({
      transport,
      name: identity.name,
      body: identity.body,
      onChange: (s) => {
        // New chat lines from others also show over their heads.
        for (const line of s.chat) {
          if (line.id <= this.seenChat) continue;
          this.seenChat = line.id;
          if (!line.self) this.avatars.bubble(line.from, line.text, performance.now());
        }
        onChange(s);
      },
    });
    const self = this;
    window.__aetherCopresence = {
      get status() {
        return self.session.snapshot().status;
      },
      get id() {
        return self.session.id;
      },
      get count() {
        return self.session.snapshot().count;
      },
      get local() {
        return self.local;
      },
      remotes: () =>
        this.session.remotes().map(({ peer, pose }) => ({
          id: peer.id,
          name: peer.name,
          body: peer.body,
          position: pose ? [pose.position[0], pose.position[1], pose.position[2]] : null,
          visible: pose !== null,
        })),
    };
  }

  async join(room: string): Promise<boolean> {
    const ok = await this.session.join(room);
    if (ok && this.raf === 0) this.raf = requestAnimationFrame(this.frame);
    return ok;
  }

  leave(): void {
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.session.close();
    this.avatars.dispose();
  }

  dispose(): void {
    this.leave();
    if (window.__aetherCopresence) delete window.__aetherCopresence;
  }

  private readonly frame = (t: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    try {
      if (t - this.lastPoseAt >= 1000 / COPRESENCE_STATE_HZ) {
        this.lastPoseAt = t;
        const pose = this.readPose(t);
        if (pose) {
          this.local = pose;
          this.session.setPose(pose);
        }
      }
      const peers = this.session.remotes(t).map(({ peer, pose }) => ({ id: peer.id, name: peer.name, body: peer.body, pose }));
      this.avatars.update(peers, t);
      if (peers.length > 0) this.sim.renderer.requestRender();
    } catch (err) {
      console.warn('[copresence] frame failed', err);
    }
  };

  /** This visitor's pose now (null when it cannot be told, e.g. nothing under the camera). */
  private readPose(t: number): PresencePose | null {
    const sim = this.sim;
    const r = sim.renderer;
    let pos: [number, number, number] | null = null;
    let yaw: number | null = null;
    const feet = sim.mode === 'play' ? sim.playerPosition : null;
    if (feet) {
      pos = [feet[0], feet[1], feet[2]];
    } else {
      const cam = r.cameraPose();
      const dir = r.camera.getWorldDirection(_dir);
      if (Math.hypot(dir.x, dir.z) > 1e-4) yaw = (Math.atan2(-dir.x, -dir.z) * 180) / Math.PI;
      const skip = this.avatars.ids;
      const street = r.cameraHeightAboveGround() < STREET_M;
      const from: [number, number, number] = street ? [cam.pos[0], cam.pos[1] + 0.5, cam.pos[2]] : [cam.target[0], cam.target[1] + 60, cam.target[2]];
      const hit = r.raycastWorld(from, [0, -1, 0], street ? 40 : 300, skip);
      if (hit) pos = [hit.point[0], hit.point[1], hit.point[2]];
    }
    if (!pos) return null;
    const prev = this.last;
    const dt = prev ? (t - prev.at) / 1000 : 0;
    const vx = prev && dt > 0 ? (pos[0] - prev.pos[0]) / dt : 0;
    const vz = prev && dt > 0 ? (pos[2] - prev.pos[2]) / dt : 0;
    const speed = Math.hypot(vx, vz);
    if (yaw === null) {
      // Playing: face the way the body walks; standing, keep the last heading (else the camera's yaw).
      yaw = speed > 0.35 ? (Math.atan2(-vx, -vz) * 180) / Math.PI : (prev?.yaw ?? sim.playerYawDeg ?? 0);
    }
    this.last = { pos, at: t, yaw };
    // A jump (a viewpoint change) is not a run.
    return { position: pos, yawDeg: yaw, motion: speed > 30 ? 'idle' : motionOf(speed) };
  }
}
