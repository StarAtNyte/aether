/**
 * Draws the other visitors of a shared visit: one runtime-only person per visitor (a transient entity with the chosen
 * VRM body, `character: { body }`, so the renderer's character system walks, runs and idles it by its speed, with its
 * own levels of detail) in the visitor's colours (`top` / `bottom` / `hair` from its hue, {@link presenceColours}: the
 * renderer draws a VRM body's clothes and hair with a tinted copy of its shared toon materials, skin, face and eyes
 * untouched), moved every frame from the interpolated pose, and a name tag over its head (a DOM label in
 * `layer`; it lights up while the visitor speaks in voice, {@link RemoteAvatars.setSpeaking}). Visitors beyond {@link FAR_M} are hidden (body and tag): sixteen people cost little more than the few in
 * view. Nothing here touches the world document.
 */
import type { WorldRenderer } from '@aether/render';
import { presenceColours, type PresenceBody, type PresencePose } from '@aether/core/copresence';
import { Vector3 } from 'three';

/** Visitors farther than this from the camera are not drawn. */
export const FAR_M = 160;
/** Name tags show up to this distance. */
const TAG_M = 70;
/** Height of a name tag above the feet. */
const TAG_HEIGHT = 1.85;
/** A chat line shows over its speaker this long. */
const BUBBLE_MS = 6000;

/** Entity id of a visitor's person. */
export const avatarId = (peer: string): string => `copresence-${peer}`;

interface Drawn {
  body: PresenceBody;
  hue: number;
  visible: boolean;
  tag: HTMLDivElement;
  label: HTMLSpanElement;
  bubble: HTMLSpanElement;
  bubbleUntil: number;
  name: string;
  speaking: boolean;
}

const _v = new Vector3();

export class RemoteAvatars {
  private readonly drawn = new Map<string, Drawn>();
  private packed = new Float32Array(0);

  constructor(
    private readonly renderer: WorldRenderer,
    private readonly layer: HTMLElement,
  ) {}

  /** Ids of the people drawn (raycasts for the local pose skip them). */
  get ids(): ReadonlySet<string> {
    return new Set([...this.drawn.keys()].map(avatarId));
  }

  /** Show a chat line over a visitor. */
  bubble(peer: string, text: string, nowMs: number): void {
    const d = this.drawn.get(peer);
    if (!d) return;
    d.bubble.textContent = text.length > 80 ? `${text.slice(0, 79)}…` : text;
    d.bubbleUntil = nowMs + BUBBLE_MS;
  }

  /** Light the name tags of the visitors speaking now (null or empty: none). Cheap to call every frame. */
  setSpeaking(ids: ReadonlySet<string> | null): void {
    for (const [id, d] of this.drawn) {
      const on = !!ids?.has(id);
      if (on === d.speaking) continue;
      d.speaking = on;
      d.tag.classList.toggle('is-speaking', on);
    }
  }

  /** Draw `peers` (others leave). Call once per frame. */
  update(peers: ReadonlyArray<{ id: string; name: string; body: PresenceBody; hue: number; pose: PresencePose | null }>, nowMs: number): void {
    const r = this.renderer;
    const cam = r.camera;
    const live = new Set<string>();
    const order: string[] = [];
    if (this.packed.length < peers.length * 7) this.packed = new Float32Array(peers.length * 7);
    const w = this.layer.clientWidth;
    const h = this.layer.clientHeight;
    for (const p of peers) {
      if (!p.pose) continue;
      live.add(p.id);
      let d = this.drawn.get(p.id);
      if (d && (d.body !== p.body || d.hue !== p.hue)) {
        this.remove(p.id);
        d = undefined;
      }
      const [x, y, z] = p.pose.position;
      const yaw = (p.pose.yawDeg * Math.PI) / 180;
      if (!d) d = this.add(p.id, p.name, p.body, p.hue, p.pose);
      if (d.name !== p.name) {
        d.name = p.name;
        d.label.textContent = p.name || 'Visitor';
      }
      const dist = cam.position.distanceTo(_v.set(x, y, z));
      const visible = dist < FAR_M;
      if (visible !== d.visible) {
        d.visible = visible;
        r.setEntityProperty(avatarId(p.id), 'visible', visible);
      }
      if (visible) {
        const o = order.length * 7;
        this.packed[o] = x;
        this.packed[o + 1] = y;
        this.packed[o + 2] = z;
        this.packed[o + 3] = 0;
        this.packed[o + 4] = Math.sin(yaw / 2);
        this.packed[o + 5] = 0;
        this.packed[o + 6] = Math.cos(yaw / 2);
        order.push(avatarId(p.id));
      }
      // Name tag: projected over the head, faded with distance, hidden behind the camera.
      _v.set(x, y + TAG_HEIGHT, z).project(cam);
      const onScreen = visible && dist < TAG_M && _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      if (onScreen) {
        const sx = (_v.x * 0.5 + 0.5) * w;
        const sy = (-_v.y * 0.5 + 0.5) * h;
        d.tag.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
        d.tag.style.opacity = String(Math.max(0.35, Math.min(1, 1.3 - dist / TAG_M)));
        d.tag.hidden = false;
      } else d.tag.hidden = true;
      d.bubble.hidden = nowMs > d.bubbleUntil;
    }
    for (const id of [...this.drawn.keys()]) if (!live.has(id)) this.remove(id);
    if (order.length > 0) r.applyTransforms(this.packed.subarray(0, order.length * 7), order);
  }

  /** Remove every visitor (leaving the visit). */
  dispose(): void {
    for (const id of [...this.drawn.keys()]) this.remove(id);
  }

  private add(peer: string, name: string, body: PresenceBody, hue: number, pose: PresencePose): Drawn {
    this.renderer.addTransient({
      id: avatarId(peer),
      name: name || 'Visitor',
      parent: null,
      tags: ['copresence'],
      transform: { position: [...pose.position], rotation: [0, pose.yawDeg, 0], scale: [1, 1, 1] },
      shape: { kind: 'none' },
      behaviors: [],
      character: { body, scale: 1, ...presenceColours(hue) },
    } as unknown as Parameters<WorldRenderer['addTransient']>[0]);
    const tag = document.createElement('div');
    tag.className = 'pl-ctag';
    tag.hidden = true;
    const bubble = document.createElement('span');
    bubble.className = 'pl-ctag__bubble';
    bubble.hidden = true;
    const label = document.createElement('span');
    label.className = 'pl-ctag__name';
    label.textContent = name || 'Visitor';
    // Speaking light: three bars before the name, shown while the visitor speaks (CSS `.is-speaking`).
    const wave = document.createElement('span');
    wave.className = 'pl-ctag__wave';
    wave.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
    const row = document.createElement('span');
    row.className = 'pl-ctag__row';
    row.append(wave, label);
    tag.append(bubble, row);
    this.layer.append(tag);
    const d: Drawn = { body, hue, visible: true, tag, label, bubble, bubbleUntil: 0, name, speaking: false };
    this.drawn.set(peer, d);
    return d;
  }

  private remove(peer: string): void {
    const d = this.drawn.get(peer);
    if (!d) return;
    this.renderer.removeTransient(avatarId(peer));
    d.tag.remove();
    this.drawn.delete(peer);
  }
}
