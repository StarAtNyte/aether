/**
 * The showroom guide's person, drawn the way a shared visit draws the other visitors (`copresence/avatars.ts`): a transient
 * entity with a VRM body (`character: { body }`), so the renderer's character system idles and walks it by its speed, moved
 * every frame, with a name tag and a speech bubble over its head (DOM, in `layer`). It walks a path at
 * {@link GUIDE_WALK_MS} facing the way it goes, and turns to the visitor when they come near or talk to it.
 */
import type { Vec3 } from '@aether/core';
import type { WorldRenderer } from '@aether/render';
import { Vector3 } from 'three';

/** Entity id of the guide's person (raycasts of the guide skip it). */
export const GUIDE_ID = 'aether-guide';
/** Walking speed (m/s). */
export const GUIDE_WALK_MS = 1.3;
/** The guide turns to a visitor nearer than this (m). */
export const ATTEND_M = 4.5;
/** Height of the tag above the feet. */
const TAG_HEIGHT = 1.9;
/** The tag shows up to this distance. */
const TAG_M = 40;
/** Turning speed (rad/s). */
const TURN_RATE = 3.2;

const _v = new Vector3();
const _head: Vec3 = [0, 0, 0];
const _cam: Vec3 = [0, 0, 0];
const _dir: Vec3 = [0, 0, 0];

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** How long a line stays up (ms): long enough to read. */
export const bubbleMs = (text: string): number => Math.min(16_000, 3500 + text.length * 55);

export class GuidePerson {
  pos: Vec3;
  yaw: number;
  private path: Vec3[] = [];
  private onArrive: (() => void) | null = null;
  private readonly tag: HTMLDivElement;
  private readonly bubbleEl: HTMLSpanElement;
  private bubbleUntil = 0;
  private visible = true;
  private readonly packed = new Float32Array(7);
  private readonly order: string[] = [GUIDE_ID];
  private readonly skip: ReadonlySet<string> = new Set([GUIDE_ID]);
  /** Something stands between the camera and the head (checked a few times a second). */
  private occluded = false;
  private occludedAt = 0;
  /** Someone is talking with the guide: it faces the visitor wherever they are. */
  attending = false;

  constructor(
    private readonly renderer: WorldRenderer,
    private readonly layer: HTMLElement,
    name: string,
    body: 'kaho-vrm' | 'mio-vrm',
    at: Vec3,
    yaw: number,
  ) {
    this.pos = [at[0], at[1], at[2]];
    this.yaw = yaw;
    renderer.addTransient({
      id: GUIDE_ID,
      name,
      parent: null,
      tags: ['guide'],
      transform: { position: [...at], rotation: [0, (yaw * 180) / Math.PI, 0], scale: [1, 1, 1] },
      shape: { kind: 'none' },
      behaviors: [],
      // A shop uniform: a dark teal jacket over charcoal.
      character: { body, scale: 1, top: '#1f4f57', bottom: '#2b2d33', mood: 'cheerful' },
    } as unknown as Parameters<WorldRenderer['addTransient']>[0]);
    const tag = document.createElement('div');
    tag.className = 'pl-ctag pl-gtag';
    tag.hidden = true;
    const bubble = document.createElement('span');
    bubble.className = 'pl-ctag__bubble pl-gtag__bubble';
    bubble.hidden = true;
    bubble.setAttribute('data-testid', 'pl-guide-bubble');
    const label = document.createElement('span');
    label.className = 'pl-ctag__name pl-gtag__name';
    label.textContent = name;
    const role = document.createElement('span');
    role.className = 'pl-gtag__role';
    role.textContent = 'Guide';
    label.append(role);
    tag.append(bubble, label);
    layer.append(tag);
    this.tag = tag;
    this.bubbleEl = bubble;
  }

  /** Say a line over the head. */
  say(text: string, nowMs: number, thinking = false): void {
    this.bubbleEl.textContent = text;
    this.bubbleEl.classList.toggle('is-thinking', thinking);
    this.bubbleUntil = nowMs + (thinking ? 30_000 : bubbleMs(text));
  }

  /** Clear the bubble. */
  hush(): void {
    this.bubbleUntil = 0;
  }

  /** Walk `path` (feet points), then call `onArrive`. */
  walk(path: Vec3[], onArrive?: () => void): void {
    this.path = path.map((p) => [p[0], p[1], p[2]]);
    this.onArrive = onArrive ?? null;
  }

  /** Stand at `to` at once (no clear way to walk there). */
  place(to: Vec3, onArrive?: () => void): void {
    this.path = [];
    this.onArrive = null;
    this.pos = [to[0], to[1], to[2]];
    onArrive?.();
  }

  get walking(): boolean {
    return this.path.length > 0;
  }

  /** Metres left of the walk (0 standing). */
  get remaining(): number {
    let s = 0;
    let a = this.pos;
    for (const p of this.path) {
      s += Math.hypot(p[0] - a[0], p[2] - a[2]);
      a = p;
    }
    return s;
  }

  /** Seconds the walk of `path` from here takes. */
  static seconds(from: Vec3, path: readonly Vec3[]): number {
    let s = 0;
    let a = from;
    for (const p of path) {
      s += Math.hypot(p[0] - a[0], p[2] - a[2]);
      a = p;
    }
    return s / GUIDE_WALK_MS;
  }

  /** Move, turn and draw; once a frame. */
  update(dt: number, nowMs: number, eye: Readonly<Vec3>): void {
    const r = this.renderer;
    let want: number | null = null;
    const next = this.path[0];
    if (next) {
      const dx = next[0] - this.pos[0];
      const dz = next[2] - this.pos[2];
      const d = Math.hypot(dx, dz);
      const step = GUIDE_WALK_MS * dt;
      if (d <= step || d < 1e-3) {
        this.pos[0] = next[0];
        this.pos[1] = next[1];
        this.pos[2] = next[2];
        this.path.shift();
        if (this.path.length === 0) {
          const done = this.onArrive;
          this.onArrive = null;
          done?.();
        }
      } else {
        const k = step / d;
        // In place: nothing is allocated per frame.
        this.pos[0] += dx * k;
        this.pos[1] += (next[1] - this.pos[1]) * Math.min(1, k * 2);
        this.pos[2] += dz * k;
        want = Math.atan2(-dx, -dz);
      }
    }
    const ex = eye[0] - this.pos[0];
    const ez = eye[2] - this.pos[2];
    const near = Math.hypot(ex, ez);
    if (want === null && (near < ATTEND_M || this.attending) && near > 0.3) want = Math.atan2(-ex, -ez);
    if (want !== null) {
      const t = wrap(want - this.yaw);
      const s = TURN_RATE * dt * (next ? 2 : 1);
      this.yaw = wrap(this.yaw + Math.max(-s, Math.min(s, t)));
    }
    const p = this.packed;
    p[0] = this.pos[0];
    p[1] = this.pos[1];
    p[2] = this.pos[2];
    p[3] = 0;
    p[4] = Math.sin(this.yaw / 2);
    p[5] = 0;
    p[6] = Math.cos(this.yaw / 2);
    r.applyTransforms(p, this.order);
    // Tag: over the head, hidden behind the camera and far away.
    const cam = r.camera;
    const dist = cam.position.distanceTo(_v.set(this.pos[0], this.pos[1], this.pos[2]));
    _v.set(this.pos[0], this.pos[1] + TAG_HEIGHT, this.pos[2]).project(cam);
    const w = this.layer.clientWidth;
    const h = this.layer.clientHeight;
    const inView = this.visible && dist < TAG_M && _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
    if (inView && nowMs - this.occludedAt > 200) {
      this.occludedAt = nowMs;
      const head = _head;
      head[0] = this.pos[0];
      head[1] = this.pos[1] + 1.5;
      head[2] = this.pos[2];
      const o = _cam;
      o[0] = cam.position.x;
      o[1] = cam.position.y;
      o[2] = cam.position.z;
      const d = Math.hypot(head[0] - o[0], head[1] - o[1], head[2] - o[2]);
      _dir[0] = head[0] - o[0];
      _dir[1] = head[1] - o[1];
      _dir[2] = head[2] - o[2];
      // Stopped short of the person: a ray into it tests every triangle of its skinned mesh. Five times a second.
      this.occluded = d > 1.2 && !!r.raycastWorld(o, _dir, d - 1, this.skip);
    }
    const onScreen = inView && !this.occluded;
    // Idle and walk animate only while drawn: in view, or moving.
    if (onScreen || next) r.requestRender();
    if (onScreen) {
      const sx = (_v.x * 0.5 + 0.5) * w;
      const sy = (-_v.y * 0.5 + 0.5) * h;
      this.tag.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
      this.tag.hidden = false;
    } else this.tag.hidden = true;
    this.bubbleEl.hidden = nowMs > this.bubbleUntil;
  }

  /** Show or hide the person (a story, photo mode). */
  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    this.renderer.setEntityProperty(GUIDE_ID, 'visible', on);
    if (!on) this.tag.hidden = true;
  }

  /** The bubble is up (a line being read). */
  speaking(nowMs: number): boolean {
    return nowMs < this.bubbleUntil;
  }

  dispose(): void {
    this.renderer.removeTransient(GUIDE_ID);
    this.tag.remove();
  }
}
