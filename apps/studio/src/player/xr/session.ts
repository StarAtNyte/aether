/**
 * Immersive VR in the standalone player (a lazy chunk: loaded once `support.ts` finds an `immersive-vr` device).
 *
 * - Rendering: three's XR manager on the renderer's WebGL2 backend (`WorldRenderer.xrHost`). The session's animation
 *   frames drive the whole player loop (`Simulation.setExternalFrames` / `runFrame`): the window's frames stop while a
 *   headset presents. The scene draws straight into the eye buffers, without the post chain (`setXRPresenting`), with the
 *   baked light kept; adaptive resolution and the quality ladder stand still, the eye buffer's scale comes from the tier.
 * - Where the visitor stands: a `local-floor` space (their real height, 1:1) offset into the world by the rig of
 *   `locomotion.ts`, starting at the walk view's spot and facing (the head recentred onto it at the first tracked frame).
 * - Moving: snap turn (30°) on the right stick; teleport by pushing the left stick forward (or holding either trigger),
 *   aiming an arc onto the walk view's floor (its probes, `walk.ts`), releasing to go, with a short fade to black.
 *   Smooth turning is off. Each controller shows a ray.
 * - Leaving (the headset's own exit, or {@link VRSession.exit}): the walk view stands where the visitor stood, facing
 *   where they looked.
 *
 * Nothing in the frame loop allocates on this side (the browser's XR poses and the scene's ray casts do).
 */
import type { Vec3 } from '@aether/core';
import { BackSide, BufferAttribute, BufferGeometry, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, RingGeometry, SphereGeometry, type Object3D } from 'three';
import type { Simulation } from '../../engine/Simulation';
import { rendererWalkProbe, type ExploreController } from '../explore';
import { WALK_EYE, type WalkProbe } from '../walk';
import {
  ARC_MAX_POINTS,
  directionToWorld,
  localToWorld,
  rigAtWalk,
  rigOffset,
  SnapTurn,
  stickAiming,
  TeleportFade,
  teleportRig,
  teleportTarget,
  traceArc,
  turnRig,
  walkPoseOnExit,
  xrFramebufferScale,
  type ArcHit,
  type RigidTransform,
  type XRRig,
} from './locomotion';

/** What the session reports (tests, diagnostics). */
export interface VRStats {
  active: boolean;
  /** XR frames seen, and those with a tracked head. */
  frames: number;
  posed: number;
  teleports: number;
  turns: number;
  rig: XRRig;
  /** The head in the world. */
  head: Vec3;
  /** Aiming a teleport, and where it would land (null: nowhere to stand). */
  aiming: boolean;
  target: Vec3 | null;
  framebufferScale: number;
  /** Why the session ended itself, if it did. */
  failure: string | null;
}

export interface VROptions {
  /** The session ended (the walk view stands at `spot`); `failure`: it was ended because frames kept failing. */
  onEnd?: (spot: { feet: Vec3; yaw: number }, failure: string | null) => void;
}

/** Frames failing in a row (rendering, or this side's input step) after which the session ends itself. */
export const VR_FAILURES_TO_EXIT = 5;

const ARC_OK = 0x5fe3c0;
const ARC_BAD = 0x8a8f98;

/** Start immersive VR on an already requested `session` (requested in the click, which carries the user activation). */
export async function enterVR(sim: Simulation, explore: ExploreController | null, session: XRSession, opts: VROptions = {}): Promise<VRSession> {
  const vr = new VRSession(sim, explore, session, opts);
  await vr.begin();
  return vr;
}

export class VRSession {
  private readonly probe: WalkProbe;
  private rig: XRRig = { x: 0, y: 0, z: 0, yaw: 0 };
  private startFeet: Vec3 = [0, 0, 0];
  private base: XRReferenceSpace | null = null;
  private active = false;
  private ended = false;
  private recentred = false;
  /** The head in the play space (position, and its horizontal forward). */
  private readonly head = { x: 0, y: 0, z: 0, fx: 0, fz: -1 };
  private readonly headWorld: Vec3 = [0, 0, 0];
  private readonly turner = new SnapTurn();
  private stickAim = false;
  private triggerAim: XRInputSource | null = null;
  private aimSource: XRInputSource | null = null;
  private readonly arcPoints = new Float32Array(ARC_MAX_POINTS * 3);
  private readonly arcHit: ArcHit = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 };
  private readonly arcFlag = { hit: false };
  private readonly checkedAt: Vec3 = [Number.NaN, 0, 0];
  private target: Vec3 | null = null;
  private pending: Vec3 = [0, 0, 0];
  private readonly fade = new TeleportFade();
  private readonly fadeOut = { alpha: 0, move: false };
  private readonly offset: RigidTransform = { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
  private readonly origin: Vec3 = [0, 0, 0];
  private readonly dir: Vec3 = [0, 0, 0];
  private lastTime = -1;
  private framebufferScale = 1;
  private frames = 0;
  private posed = 0;
  private teleports = 0;
  private turns = 0;
  private endPromise: Promise<void>;
  /** Why the session ended itself (null: the visitor left). */
  private failure: string | null = null;
  private updateFailures = 0;
  private resolveEnd: () => void = () => undefined;

  // The scene's VR furniture: controller rays, the arc, the landing ring, the fade.
  private readonly group = new Group();
  private readonly arcGeometry = new BufferGeometry();
  private readonly arcMaterial = new LineBasicMaterial({ color: ARC_OK, transparent: true, opacity: 0.9, depthTest: false });
  private readonly arc: Line;
  private readonly reticle: Mesh;
  private readonly fadeMaterial = new MeshBasicMaterial({ color: 0x000000, side: BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  private readonly fadeSphere: Mesh;
  private readonly controllers: Object3D[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(
    private readonly sim: Simulation,
    private readonly explore: ExploreController | null,
    private readonly session: XRSession,
    private readonly opts: VROptions,
  ) {
    this.probe = rendererWalkProbe(sim.renderer);
    this.endPromise = new Promise<void>((resolve) => (this.resolveEnd = resolve));
    this.arcGeometry.setAttribute('position', new BufferAttribute(this.arcPoints, 3));
    this.arcGeometry.setDrawRange(0, 0);
    this.arc = new Line(this.arcGeometry, this.arcMaterial);
    this.arc.frustumCulled = false;
    this.arc.renderOrder = 9998;
    this.arc.visible = false;
    const ringGeometry = new RingGeometry(0.22, 0.3, 40).rotateX(-Math.PI / 2);
    const ringMaterial = new MeshBasicMaterial({ color: ARC_OK, transparent: true, opacity: 0.85, depthWrite: false });
    this.reticle = new Mesh(ringGeometry, ringMaterial);
    this.reticle.renderOrder = 9998;
    this.reticle.visible = false;
    const fadeGeometry = new SphereGeometry(0.35, 16, 12);
    this.fadeSphere = new Mesh(fadeGeometry, this.fadeMaterial);
    this.fadeSphere.renderOrder = 9999;
    this.fadeSphere.frustumCulled = false;
    this.fadeSphere.visible = false;
    this.group.name = 'xr:furniture';
    this.group.add(this.arc, this.reticle, this.fadeSphere);
    this.disposables.push(this.arcGeometry, this.arcMaterial, ringGeometry, ringMaterial, fadeGeometry, this.fadeMaterial);
  }

  /** Resolves once the session has ended and the walk view is back. */
  get done(): Promise<void> {
    return this.endPromise;
  }

  get stats(): VRStats {
    return {
      active: this.active,
      frames: this.frames,
      posed: this.posed,
      teleports: this.teleports,
      turns: this.turns,
      rig: { ...this.rig },
      head: [...this.headWorld] as Vec3,
      aiming: this.stickAim || this.triggerAim !== null,
      target: this.target ? ([...this.target] as Vec3) : null,
      framebufferScale: this.framebufferScale,
      failure: this.failure,
    };
  }

  async begin(): Promise<void> {
    const sim = this.sim;
    const r = sim.renderer;
    const host = r.xrHost();
    if (!host) {
      await this.session.end().catch(() => undefined);
      throw new Error('VR needs the WebGL2 backend');
    }
    const spot = this.explore?.viewSpot ?? { eye: [r.camera.position.x, r.camera.position.y, r.camera.position.z] as Vec3, yaw: 0 };
    this.rig = rigAtWalk(spot.eye, spot.yaw);
    this.startFeet = [spot.eye[0], spot.eye[1] - WALK_EYE, spot.eye[2]];
    const xr = host.xr;
    this.framebufferScale = xrFramebufferScale(r.renderTier, r.gpu.tier);
    xr.enabled = true;
    // Projection layers need the session's 'layers' feature (optional in the request): without it, three's own check (the
    // browser has XRWebGLBinding.createProjectionLayer) would still take that path and fail; the plain XRWebGLLayer then.
    const features = (this.session as { enabledFeatures?: readonly string[] }).enabledFeatures;
    if (Array.isArray(features) && !features.includes('layers')) (xr as unknown as { _supportsLayers: boolean })._supportsLayers = false;
    xr.setReferenceSpaceType('local-floor');
    xr.setFramebufferScaleFactor(this.framebufferScale);
    xr.setFoveation(1);
    this.explore?.suspend(true);
    sim.setQualityHold('xr', true);
    r.setXRPresenting(true);
    this.active = true;
    try {
      // The loop first: the XR manager keeps the loop set when the session starts and runs it on the session's frames.
      await host.setAnimationLoop(this.onFrame);
      sim.setExternalFrames(true);
      this.session.addEventListener('end', this.onSessionEnd);
      await xr.setSession(this.session);
      this.base = xr.getReferenceSpace();
      this.applyRig();
      xr.setFoveation(1);
      for (let i = 0; i < 2; i++) {
        const c = xr.getController(i);
        c.add(controllerRay());
        this.controllers.push(c);
        this.group.add(c);
      }
      host.scene.add(this.group);
      this.session.addEventListener('selectstart', this.onSelectStart);
      this.session.addEventListener('selectend', this.onSelectEnd);
    } catch (e) {
      this.finish();
      await this.session.end().catch(() => undefined);
      throw e;
    }
  }

  /** Leave VR (the session's end brings the walk view back). */
  async exit(): Promise<void> {
    if (this.ended) return;
    await this.session.end().catch(() => this.finish());
    await this.endPromise;
  }

  private applyRig(): void {
    const host = this.sim.renderer.xrHost();
    if (!host || !this.base) return;
    rigOffset(this.rig, this.offset);
    host.xr.setReferenceSpace(this.base.getOffsetReferenceSpace(new XRRigidTransform(this.offset.position, this.offset.orientation)));
  }

  private readonly onFrame = (time: number, frame?: XRFrame): void => {
    if (!this.active) return;
    if (frame && this.base) {
      try {
        this.update(time, frame);
        this.updateFailures = 0;
      } catch (e) {
        this.updateFailures++;
        console.warn('[vr] frame update failed', e);
      }
    }
    this.sim.runFrame(time);
    // A headset showing one frozen frame is worse than leaving VR: frames failing in a row end the session, and the
    // walk view comes back with a message (the window's loop keeps rendering, or reports the failure, as without VR).
    if (this.failure === null && (this.sim.consecutiveFrameFailures >= VR_FAILURES_TO_EXIT || this.updateFailures >= VR_FAILURES_TO_EXIT)) {
      this.failure = 'VR stopped after repeated rendering errors; back to the normal view.';
      console.warn(`[vr] ${this.failure}`);
      void this.session.end().catch(() => this.finish());
    }
  };

  private update(time: number, frame: XRFrame): void {
    this.frames++;
    const dtMs = this.lastTime < 0 ? 0 : Math.min(100, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const pose = frame.getViewerPose(this.base as XRReferenceSpace);
    if (pose) {
      this.posed++;
      const p = pose.transform.position;
      const q = pose.transform.orientation;
      this.head.x = p.x;
      this.head.y = p.y;
      this.head.z = p.z;
      // Forward (-Z) turned by the head's orientation: minus the rotation matrix's third column.
      this.head.fx = -2 * (q.x * q.z + q.w * q.y);
      this.head.fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
      if (!this.recentred) {
        // The head stands where the walk's eye stood (the session's origin is wherever the visitor happened to be).
        this.recentred = true;
        teleportRig(this.rig, p.x, p.z, this.startFeet);
        this.applyRig();
      }
    }
    // The head in the world as this frame's cameras see it (the rig changes below show from the next frame).
    localToWorld(this.rig, this.head.x, this.head.y, this.head.z, this.headWorld);
    this.input(frame);
    const f = this.fade.step(dtMs, this.fadeOut);
    this.fadeSphere.visible = f.alpha > 0.001;
    this.fadeMaterial.opacity = f.alpha;
    this.fadeSphere.position.set(this.headWorld[0], this.headWorld[1], this.headWorld[2]);
    if (f.move) {
      teleportRig(this.rig, this.head.x, this.head.z, this.pending);
      this.applyRig();
      this.teleports++;
    }
  }

  private input(frame: XRFrame): void {
    const sources = this.session.inputSources;
    let rightX = 0;
    let leftY = 0;
    let left: XRInputSource | null = null;
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i] as XRInputSource;
      const gp = s.gamepad;
      if (!gp) continue;
      const ax = gp.axes;
      const x = (ax.length >= 4 ? ax[2] : ax[0]) ?? 0;
      const y = (ax.length >= 4 ? ax[3] : ax[1]) ?? 0;
      if (s.handedness === 'right') rightX = x;
      else if (s.handedness === 'left') {
        leftY = y;
        left = s;
      }
    }
    if (!this.fade.active) {
      const d = this.turner.update(rightX);
      if (d !== 0) {
        turnRig(this.rig, this.head.x, this.head.z, d);
        this.applyRig();
        this.turns++;
      }
    }
    const was = this.stickAim;
    this.stickAim = left !== null && stickAiming(was, leftY);
    if (this.stickAim && !was && this.triggerAim === null) this.aimSource = left;
    if (was && !this.stickAim && this.triggerAim === null) this.commit();
    const src = this.triggerAim ?? (this.stickAim ? this.aimSource : null);
    if (src) this.aim(frame, src);
    else this.hideAim();
  }

  private aim(frame: XRFrame, src: XRInputSource): void {
    const rp = frame.getPose(src.targetRaySpace, this.base as XRReferenceSpace);
    if (!rp) {
      this.hideAim();
      return;
    }
    const p = rp.transform.position;
    const q = rp.transform.orientation;
    localToWorld(this.rig, p.x, p.y, p.z, this.origin);
    directionToWorld(this.rig, -2 * (q.x * q.z + q.w * q.y), -2 * (q.y * q.z - q.w * q.x), -(1 - 2 * (q.x * q.x + q.y * q.y)), this.dir);
    const n = traceArc(this.origin, this.dir, this.cast, this.arcPoints, this.arcHit, this.arcFlag);
    const h = this.arcHit;
    if (!this.arcFlag.hit) this.target = null;
    else if (!(Math.abs(h.x - this.checkedAt[0]) < 0.03 && Math.abs(h.y - this.checkedAt[1]) < 0.03 && Math.abs(h.z - this.checkedAt[2]) < 0.03)) {
      // The landing spot is checked again only once it moved (its probes are a handful of scene rays).
      this.checkedAt[0] = h.x;
      this.checkedAt[1] = h.y;
      this.checkedAt[2] = h.z;
      this.target = teleportTarget(h, this.probe, this.rig.y);
    }
    const ok = this.target !== null;
    this.arcMaterial.color.setHex(ok ? ARC_OK : ARC_BAD);
    this.arcGeometry.setDrawRange(0, n);
    (this.arcGeometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    this.arc.visible = n >= 2;
    this.reticle.visible = ok;
    if (this.target) this.reticle.position.set(this.target[0], this.target[1] + 0.02, this.target[2]);
  }

  private hideAim(): void {
    this.arc.visible = false;
    this.reticle.visible = false;
  }

  /** Teleport to the aimed spot (if any), behind the fade. */
  private commit(): void {
    const t = this.target;
    this.target = null;
    this.checkedAt[0] = Number.NaN;
    this.hideAim();
    if (!t || this.fade.active) return;
    this.pending[0] = t[0];
    this.pending[1] = t[1];
    this.pending[2] = t[2];
    this.fade.start();
  }

  private readonly cast = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number, out: ArcHit): boolean => {
    this.castFrom[0] = ox;
    this.castFrom[1] = oy;
    this.castFrom[2] = oz;
    this.castDir[0] = dx;
    this.castDir[1] = dy;
    this.castDir[2] = dz;
    const hit = this.sim.renderer.raycastWorld(this.castFrom, this.castDir, len);
    if (hit) {
      out.x = hit.point[0];
      out.y = hit.point[1];
      out.z = hit.point[2];
      out.nx = hit.normal[0];
      out.ny = hit.normal[1];
      out.nz = hit.normal[2];
      return true;
    }
    // The environment's ground plane (y = 0) lies outside the scene's entities (as for the walk's floor probe).
    const floor = this.sim.renderer.cameraFloorY;
    if (Number.isFinite(floor) && dy < 0 && oy >= 0 && oy + dy * len <= 0) {
      const t = -oy / dy;
      out.x = ox + dx * t;
      out.y = 0;
      out.z = oz + dz * t;
      out.nx = 0;
      out.ny = 1;
      out.nz = 0;
      return true;
    }
    return false;
  };
  private readonly castFrom: Vec3 = [0, 0, 0];
  private readonly castDir: Vec3 = [0, 0, 0];

  private readonly onSelectStart = (e: XRInputSourceEvent): void => {
    if (this.fade.active) return;
    this.triggerAim = e.inputSource;
    this.aimSource = e.inputSource;
  };

  private readonly onSelectEnd = (e: XRInputSourceEvent): void => {
    if (this.triggerAim !== e.inputSource) return;
    this.triggerAim = null;
    this.commit();
  };

  private readonly onSessionEnd = (): void => {
    this.finish();
  };

  /** Back to the walk view (the session ended, or never started). */
  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.active = false;
    const sim = this.sim;
    const r = sim.renderer;
    const host = r.xrHost();
    this.session.removeEventListener('end', this.onSessionEnd);
    this.session.removeEventListener('selectstart', this.onSelectStart);
    this.session.removeEventListener('selectend', this.onSelectEnd);
    if (host) {
      void host.setAnimationLoop(null);
      host.xr.enabled = false;
    }
    for (const c of this.controllers) for (const child of [...c.children]) {
      c.remove(child);
      disposeRay(child);
    }
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
    r.setXRPresenting(false);
    sim.setQualityHold('xr', false);
    sim.setExternalFrames(false);
    const spot = walkPoseOnExit(this.rig, this.head.x, this.head.z, this.head.fx, this.head.fz);
    this.explore?.suspend(false);
    if (this.posed > 0) this.explore?.standAt(spot.feet, spot.yaw);
    try {
      this.opts.onEnd?.(spot, this.failure);
    } finally {
      this.resolveEnd();
    }
  }
}

/** A controller's pointing ray (2 m, faint). */
function controllerRay(): Line {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 0, 0, -2]), 3));
  const line = new Line(g, new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
  line.name = 'xr:ray';
  line.frustumCulled = false;
  return line;
}

function disposeRay(o: Object3D): void {
  if (o instanceof Line) {
    o.geometry.dispose();
    (o.material as LineBasicMaterial).dispose();
  }
}
