/**
 * Runs a shared visit inside the player: the session (`session.ts`) over the chosen transport, this visitor's pose
 * read from the running world ten times a second, and the other visitors drawn every frame (`avatars.ts`).
 *
 * This visitor's pose: playing (P), the player's feet and the way they walk; otherwise where the camera is: at street
 * level the ground under it, higher up the ground under the point it orbits, facing the way the camera looks.
 *
 * Voice (`voice.ts`) is loaded by {@link CopresenceController.startVoice}, on the first click of the mic button; each
 * frame then places every voice at its avatar's head and the listener at the camera (the player's head while playing).
 */
import { COPRESENCE_STATE_HZ, type PresenceBody, type PresenceMotion, type PresencePose } from '@aether/core/copresence';
import { Vector3 } from 'three';
import type { Simulation } from '../../engine/Simulation';
import { RemoteAvatars } from './avatars';
import { CopresenceSession, type SessionSnapshot } from './session';
import type { CopresenceTransport } from './transport';
import type { VoiceMesh, VoiceSnapshot, VoiceStatus } from './voice';

const _dir = new Vector3();
const _up = new Vector3();
/** Height of a voice above an avatar's feet, and of the listener above this visitor's feet while playing. */
const HEAD_M = 1.6;

/** Camera height under which the visitor stands under the camera (else under the orbit point). */
const STREET_M = 6;

const motionOf = (speed: number): PresenceMotion => (speed < 0.35 ? 'idle' : speed < 3.6 ? 'walk' : 'run');

/** Debug / probe handle (`window.__aetherCopresence`). */
export interface CopresenceHandle {
  readonly status: SessionSnapshot['status'];
  readonly id: string | null;
  readonly count: number;
  /** The other visitors as drawn now: id, name, body, outfit hue, feet position. */
  remotes(): Array<{ id: string; name: string; body: string; hue: number; position: [number, number, number] | null; visible: boolean }>;
  /** This visitor's last pose sent. */
  readonly local: PresencePose | null;
  /** Voice: status, the listener and, per peer, its connection, level and panner position (null before voice loads). */
  voice(): ReturnType<VoiceMesh['debug']> | null;
  /** Voice: what WebRTC reports per peer (inbound audio level and bytes, the candidate pair in use). */
  voiceStats(): Promise<Awaited<ReturnType<VoiceMesh['stats']>> | null>;
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
  private voiceMesh: VoiceMesh | null = null;
  private voiceLoading: Promise<VoiceMesh | null> | null = null;
  private readonly heads = new Map<string, [number, number, number]>();
  /** Voice changed (status, links, speaking); a connection to a peer failed. */
  onVoice: (v: VoiceSnapshot) => void = () => undefined;
  onVoiceFailed: (peer: string, name: string) => void = () => undefined;

  constructor(
    private readonly sim: Simulation,
    private readonly transport: CopresenceTransport,
    layer: HTMLElement,
    identity: { name: string; body: PresenceBody; tint: number | null },
    onChange: (s: SessionSnapshot) => void,
  ) {
    this.avatars = new RemoteAvatars(sim.renderer, layer);
    this.session = new CopresenceSession({
      transport,
      name: identity.name,
      body: identity.body,
      tint: identity.tint,
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
      voice: () => self.voiceMesh?.debug() ?? null,
      voiceStats: async () => (self.voiceMesh ? self.voiceMesh.stats() : null),
      remotes: () =>
        this.session.remotes().map(({ peer, pose }) => ({
          id: peer.id,
          name: peer.name,
          body: peer.body,
          hue: peer.hue,
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

  /** The voice mesh, loaded on first use (null where WebRTC is missing). */
  get voice(): VoiceMesh | null {
    return this.voiceMesh;
  }

  /** Join voice (loads `voice.ts` the first time; the microphone is asked for now). */
  async startVoice(): Promise<VoiceStatus> {
    if (!this.transport.voice) return 'unsupported';
    this.voiceLoading ??= import('./voice').then(({ VoiceMesh }) => {
      const session = this.session;
      const mesh = new VoiceMesh(
        {
          get selfId() {
            return session.id;
          },
          sendRtc: (to, body) => session.sendRtc(to, body),
          setVoice: (on) => session.setVoice(on),
          voicePeers: () => session.snapshot().peers.filter((p) => p.voice).map((p) => p.id),
        },
        undefined,
        (v) => this.onVoice(v),
        (peer) => this.onVoiceFailed(peer, session.peerById(peer)?.name || 'Visitor'),
      );
      this.voiceMesh = mesh;
      session.setVoiceSink(mesh);
      return mesh;
    });
    const mesh = await this.voiceLoading;
    if (!mesh) return 'unsupported';
    if (this.session.snapshot().status !== 'live') return 'off';
    return mesh.start();
  }

  stopVoice(): void {
    this.voiceMesh?.stop();
  }

  leave(): void {
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.voiceMesh?.stop();
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
      const peers = this.session.remotes(t).map(({ peer, pose }) => ({ id: peer.id, name: peer.name, body: peer.body, hue: peer.hue, pose }));
      this.avatars.update(peers, t);
      if (peers.length > 0) this.sim.renderer.requestRender();
      const voice = this.voiceMesh;
      if (voice?.active) {
        this.heads.clear();
        for (const p of peers) if (p.pose) this.heads.set(p.id, [p.pose.position[0], p.pose.position[1] + HEAD_M, p.pose.position[2]]);
        this.avatars.setSpeaking(voice.update(this.listener(), this.heads, t));
      } else this.avatars.setSpeaking(null);
    } catch (err) {
      console.warn('[copresence] frame failed', err);
    }
  };

  /** Where this visitor hears from: the camera, or the player's head while playing; facing the camera's way. */
  private listener(): { position: [number, number, number]; forward: [number, number, number]; up: [number, number, number] } {
    const cam = this.sim.renderer.camera;
    const f = cam.getWorldDirection(_dir);
    const u = _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const feet = this.sim.mode === 'play' ? this.sim.playerPosition : null;
    const position: [number, number, number] = feet ? [feet[0], feet[1] + HEAD_M, feet[2]] : [cam.position.x, cam.position.y, cam.position.z];
    return { position, forward: [f.x, f.y, f.z], up: [u.x, u.y, u.z] };
  }

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
