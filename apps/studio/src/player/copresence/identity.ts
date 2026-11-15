/**
 * This viewer's identity in shared visits: a display name (a random two-word default) and a body, remembered in this
 * browser. Storage may be missing (private windows): everything still works, only nothing is remembered.
 */
import { COPRESENCE_NAME_MAX, PRESENCE_BODIES, ROOM_ID_RE, cleanPresenceText, type PresenceBody } from '@aether/core/copresence';

const KEY = 'aether.player.copresence.v1';

const FIRST = ['Amber', 'Blue', 'Brisk', 'Calm', 'Cloud', 'Copper', 'Dawn', 'Ember', 'Fern', 'Frost', 'Golden', 'Jade', 'Lucky', 'Maple', 'Misty', 'Quiet', 'River', 'Saffron', 'Snowy', 'Swift'];
const SECOND = ['Yak', 'Crane', 'Fox', 'Heron', 'Ibex', 'Lynx', 'Marmot', 'Otter', 'Panda', 'Pika', 'Robin', 'Sparrow', 'Wren', 'Badger', 'Finch', 'Hare', 'Kite', 'Owl', 'Swan', 'Tahr'];

export interface Identity {
  name: string;
  body: PresenceBody;
}

/** A random default name ("Misty Ibex"). */
export function randomName(random: () => number = Math.random): string {
  const pick = (a: readonly string[]): string => a[Math.floor(random() * a.length) % a.length] as string;
  return `${pick(FIRST)} ${pick(SECOND)}`;
}

/** The remembered identity, or a fresh random one (saved, so it stays the same next time). */
export function loadIdentity(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): Identity {
  try {
    const raw = storage?.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as { name?: unknown; body?: unknown };
      const name = typeof v.name === 'string' ? cleanPresenceText(v.name, COPRESENCE_NAME_MAX) : '';
      const body = (PRESENCE_BODIES as readonly unknown[]).includes(v.body) ? (v.body as PresenceBody) : 'kaho-vrm';
      if (name) return { name, body };
    }
  } catch {
    // unreadable: start fresh
  }
  const id: Identity = { name: randomName(), body: Math.random() < 0.5 ? 'kaho-vrm' : 'mio-vrm' };
  saveIdentity(id, storage);
  return id;
}

export function saveIdentity(id: Identity, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(id));
  } catch {
    // storage full or blocked
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The shared visit a link names: `room=<id>` in its fragment, and `relay=tabs` for the same-browser transport. */
export function roomFromHash(hash: string): { room: string | null; relay: 'server' | 'tabs' } {
  const q = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const room = q.get('room');
  return { room: room && ROOM_ID_RE.test(room) ? room : null, relay: q.get('relay') === 'tabs' ? 'tabs' : 'server' };
}

/** `href` with `room=<id>` set in its fragment (other fragment keys kept). */
export function withRoom(href: string, room: string): string {
  const u = new URL(href);
  const q = new URLSearchParams(u.hash.startsWith('#') ? u.hash.slice(1) : u.hash);
  q.set('room', room);
  u.hash = q.toString();
  return u.href;
}
