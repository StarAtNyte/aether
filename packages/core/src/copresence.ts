/**
 * Shared visits (co-presence): the wire format visitors of one published world exchange through a relay.
 *
 * Only presence is shared: where each visitor stands, which way they face, whether they stand, walk or run, the body
 * they chose and its colour, their display name and short chat lines. The world itself is never synced.
 *
 * Two layers:
 * - {@link PresenceMessage}: what a visitor sends (`hello`, `state`, `chat`, `bye`), versioned by `v`. Every receiver
 *   validates it ({@link parsePresence}): a peer is untrusted.
 * - {@link RelayFrame}: what a relay (apps/server `copresence/`) sends back: `welcome` (your id and who is here), `join`,
 *   `leave`, `msg` (a peer's message stamped with its id, so no one can speak for another) and `error`.
 *
 * `state` is quantised: position in whole centimetres, heading in 1/1024 of a turn, motion as 0 / 1 / 2, plus the
 * sender's clock in ms so receivers can space the samples ({@link quantiseState}, {@link dequantiseState}).
 * See docs/CONTRACTS.md, "Shared visits".
 */
import './zod-config';
import { z } from 'zod';

/** Protocol version carried by every message as `v`. */
export const COPRESENCE_VERSION = 1;
/** Most visitors in one room (the relay refuses the next one with `error` `full`). */
export const COPRESENCE_MAX_PEERS = 16;
/** Largest frame a relay accepts (bytes of UTF-8 JSON). */
export const COPRESENCE_MAX_FRAME_BYTES = 1024;
/** Most `state` messages per second a visitor sends (only while it changes). */
export const COPRESENCE_STATE_HZ = 10;
/** An unchanged visitor still sends its state this often, so the relay and peers know it is there. */
export const COPRESENCE_KEEPALIVE_MS = 5000;
/** A peer silent for this long is dropped (relay and peers). */
export const COPRESENCE_IDLE_MS = 20_000;
/** Remote avatars are drawn this far behind the newest sample (interpolation buffer). */
export const COPRESENCE_DELAY_MS = 100;
/** Longest display name and chat line (characters). */
export const COPRESENCE_NAME_MAX = 24;
export const COPRESENCE_CHAT_MAX = 200;

/** A room id: 6 to 24 lowercase letters and digits (the `room=` of a shared link). */
export const ROOM_ID_RE = /^[a-z0-9]{6,24}$/;
/** A world key (a template slug or a published world id). */
export const WORLD_KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** A peer id the relay assigns. */
export const PEER_ID_RE = /^[a-z0-9]{6,16}$/;

/** Bodies a visitor can choose: the VRM conversions of Kaho and Mio (docs/CHARACTERS.md, "Kaho, Mio and the character pipeline"). */
export const PRESENCE_BODIES = ['kaho-vrm', 'mio-vrm'] as const;
export type PresenceBody = (typeof PRESENCE_BODIES)[number];

/** Motion state: standing, walking, running. */
export const PRESENCE_MOTIONS = ['idle', 'walk', 'run'] as const;
export type PresenceMotion = (typeof PRESENCE_MOTIONS)[number];

/** Largest coordinate (cm): 100 km from the origin either way. */
const MAX_CM = 10_000_000;
/** Heading steps per turn. */
export const HEADING_STEPS = 1024;

// Control characters, bidirectional overrides and zero-width marks never reach a name tag or the chat.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

/** Clean a line of text: no control or direction characters, single spaces, trimmed, at most `max` characters. */
export function cleanPresenceText(s: string, max: number): string {
  return Array.from(s.replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim()).slice(0, max).join('').trim();
}

const CleanText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max * 2)
    .refine((s) => s === cleanPresenceText(s, max) && s.length > 0, 'not a clean line of text');

const Int = (min: number, max: number) => z.number().int().min(min).max(max);

export const PresenceHello = z.strictObject({
  v: z.literal(COPRESENCE_VERSION),
  t: z.literal('hello'),
  name: CleanText(COPRESENCE_NAME_MAX),
  body: z.enum(PRESENCE_BODIES),
  /** Optional: the hue (degrees) the visitor picked for their outfit and hair; absent, receivers derive one from the peer id ({@link peerHue}). */
  tint: Int(0, 359).optional(),
});
export const PresenceState = z.strictObject({
  v: z.literal(COPRESENCE_VERSION),
  t: z.literal('state'),
  /** Sender clock (ms, wraps at 2^31). */
  ts: Int(0, 2 ** 31 - 1),
  /** Feet position in whole centimetres. */
  p: z.tuple([Int(-MAX_CM, MAX_CM), Int(-MAX_CM, MAX_CM), Int(-MAX_CM, MAX_CM)]),
  /** Heading in 1/1024 turns; 0 faces -Z, increasing turns toward -X (three.js yaw). */
  h: Int(0, HEADING_STEPS - 1),
  /** 0 idle, 1 walk, 2 run. */
  m: Int(0, 2),
});
export const PresenceChat = z.strictObject({
  v: z.literal(COPRESENCE_VERSION),
  t: z.literal('chat'),
  text: CleanText(COPRESENCE_CHAT_MAX),
});
export const PresenceBye = z.strictObject({ v: z.literal(COPRESENCE_VERSION), t: z.literal('bye') });

/** A message one visitor sends to the others. */
export const PresenceMessage = z.discriminatedUnion('t', [PresenceHello, PresenceState, PresenceChat, PresenceBye]);
export type PresenceMessage = z.infer<typeof PresenceMessage>;
export type PresenceHello = z.infer<typeof PresenceHello>;
export type PresenceState = z.infer<typeof PresenceState>;
export type PresenceChat = z.infer<typeof PresenceChat>;

const PeerId = z.string().regex(PEER_ID_RE);

/** What a relay sends to a visitor. */
export const RelayFrame = z.discriminatedUnion('k', [
  z.strictObject({ k: z.literal('welcome'), v: z.literal(COPRESENCE_VERSION), id: PeerId, peers: z.array(PeerId).max(COPRESENCE_MAX_PEERS) }),
  z.strictObject({ k: z.literal('join'), id: PeerId }),
  z.strictObject({ k: z.literal('leave'), id: PeerId }),
  z.strictObject({ k: z.literal('msg'), from: PeerId, m: PresenceMessage }),
  z.strictObject({ k: z.literal('error'), code: z.enum(['full', 'bad-room', 'bad-message', 'rate', 'version', 'idle', 'closing']) }),
]);
export type RelayFrame = z.infer<typeof RelayFrame>;

/** Parse an untrusted message (a JSON string or a value); null when it is not one. Never throws. */
export function parsePresence(raw: unknown): PresenceMessage | null {
  let value = raw;
  if (typeof raw === 'string') {
    if (raw.length > COPRESENCE_MAX_FRAME_BYTES) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const r = PresenceMessage.safeParse(value);
  return r.success ? r.data : null;
}

/** Parse an untrusted relay frame; null when it is not one. Never throws. */
export function parseRelayFrame(raw: string): RelayFrame | null {
  if (raw.length > COPRESENCE_MAX_FRAME_BYTES + 64) return null;
  try {
    const r = RelayFrame.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** A visitor's presence in world units (feet position in metres, yaw in degrees). */
export interface PresencePose {
  position: readonly [number, number, number];
  /** Degrees; 0 faces -Z (three.js yaw about +Y). */
  yawDeg: number;
  motion: PresenceMotion;
}

const cm = (m: number): number => Math.max(-MAX_CM, Math.min(MAX_CM, Math.round((Number.isFinite(m) ? m : 0) * 100))) || 0;

/** Heading steps of a yaw in degrees (any range). */
export function headingSteps(yawDeg: number): number {
  const turns = (Number.isFinite(yawDeg) ? yawDeg : 0) / 360;
  return (((Math.round(turns * HEADING_STEPS) % HEADING_STEPS) + HEADING_STEPS) % HEADING_STEPS) | 0;
}

/** Quantise a pose into a `state` message stamped with the sender's clock `nowMs`. */
export function quantiseState(pose: PresencePose, nowMs: number): PresenceState {
  return {
    v: COPRESENCE_VERSION,
    t: 'state',
    ts: Math.max(0, Math.floor(nowMs)) % 2 ** 31,
    p: [cm(pose.position[0]), cm(pose.position[1]), cm(pose.position[2])],
    h: headingSteps(pose.yawDeg),
    m: PRESENCE_MOTIONS.indexOf(pose.motion) as 0 | 1 | 2,
  };
}

/** The pose a `state` message describes (yaw in 0..360). */
export function dequantiseState(s: PresenceState): PresencePose {
  return { position: [s.p[0] / 100, s.p[1] / 100, s.p[2] / 100], yawDeg: (s.h * 360) / HEADING_STEPS, motion: PRESENCE_MOTIONS[s.m] ?? 'idle' };
}

/** Two states show the same pose (position, heading and motion; the clock is ignored). */
export function sameState(a: PresenceState | null, b: PresenceState): boolean {
  return !!a && a.h === b.h && a.m === b.m && a.p[0] === b.p[0] && a.p[1] === b.p[1] && a.p[2] === b.p[2];
}

/** A fresh random room id (10 characters). */
export function newRoomId(random: () => number = Math.random): string {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += abc[Math.floor(random() * abc.length) % abc.length];
  return s;
}

/** The outfit hues a visitor can pick (degrees): eight well-spaced swatches. */
export const PRESENCE_HUES = [0, 30, 55, 140, 180, 210, 260, 310] as const;

/**
 * The hue (0..359) a visitor without a picked one is drawn in: stable for a peer id (every visitor sees the same), and
 * spread by the golden angle so a handful of ids rarely look alike. Pure.
 */
export function peerHue(peerId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < peerId.length; i++) {
    h ^= peerId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.round(((h >>> 0) % 1024) * 137.508) % 360;
}

/** sRGB `#rrggbb` of an HSL colour (h degrees, s and l 0..1). */
function hslHex(h: number, s: number, l: number): string {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const c = (n: number): string =>
    Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))))
      .toString(16)
      .padStart(2, '0');
  return `#${c(0)}${c(8)}${c(4)}`;
}

/**
 * The colours a hue gives a visitor's body (`character` `top` / `bottom` / `hair`): a light top, a deeper bottom in the
 * same hue and hair a little round the wheel, less saturated (dyed, not neon). Skin, face, eyes and shoes keep theirs.
 */
export function presenceColours(hue: number): { top: string; bottom: string; hair: string } {
  const h = ((Math.round(Number.isFinite(hue) ? hue : 0) % 360) + 360) % 360;
  return { top: hslHex(h, 0.62, 0.62), bottom: hslHex(h, 0.45, 0.46), hair: hslHex((h + 25) % 360, 0.5, 0.5) };
}
