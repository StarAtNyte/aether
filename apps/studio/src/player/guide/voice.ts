/**
 * The guide's recorded voice: prepared lines (greeting, tour stops, product lines) recorded ahead of time
 * (`scripts/voices/`, Chatterbox on Modal) and shipped beside the world as MP3s. `guide.voice` names their folder on this
 * site; its `index.json` maps each line's {@link voiceKey} to a file. A line without a recording is silent (only the
 * bubble): nothing is synthesised while visitors use the site. Only `index.json` downloads up front; a clip loads when it
 * is played, or just before (`preload`, the tour's next line), and at most two Audio elements live at once (the line
 * playing and the next).
 */

/** Key of a line: FNV-1a 32 of its text, trimmed, as 8 hex digits (the generator names the files by it). */
export function voiceKey(text: string): string {
  let h = 0x811c9dc5;
  const t = text.trim();
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** A same-origin folder path only (`/templates/voices/<slug>/`): never another site. */
export const VOICE_PATH_RE = /^\/(?:[A-Za-z0-9_-]+\/)+$/;

export class GuideVoice {
  private files: Record<string, string> | null = null;
  private audio: HTMLAudioElement | null = null;
  /** The next line, loading ahead (its key and element). */
  private next: { key: string; audio: HTMLAudioElement } | null = null;
  private on = true;

  constructor(private readonly base: string) {
    if (!VOICE_PATH_RE.test(base)) return;
    void fetch(`${base}index.json`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        const lines = (j as { lines?: unknown } | null)?.lines;
        if (lines && typeof lines === 'object') this.files = lines as Record<string, string>;
      })
      .catch(() => undefined);
  }

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(on: boolean): void {
    this.on = on;
    if (!on) this.stop();
  }

  private url(key: string): string {
    return `${this.base}${this.files?.[key] ?? ''}`;
  }

  /** Load the recording of `text` ahead of its turn (replacing the one loading before). */
  preload(text: string): void {
    if (!this.on || !this.has(text)) return;
    const key = voiceKey(text);
    if (this.next?.key === key) return;
    if (this.next) release(this.next.audio);
    const a = new Audio();
    a.preload = 'auto';
    a.src = this.url(key);
    this.next = { key, audio: a };
  }

  /** A recording of `text` exists (the index is loaded and names one). */
  has(text: string): boolean {
    const file = this.files?.[voiceKey(text)];
    return !!file && /^[0-9a-f]{8}\.mp3$/.test(file);
  }

  /**
   * Play the recording of `text`, if there is one (stops the line before). `onLength`: its length in seconds once known;
   * `onEnd`: it finished (not called when stopped or refused). Returns whether a recording plays.
   */
  play(text: string, onLength?: (seconds: number) => void, onEnd?: () => void): boolean {
    this.stop();
    if (!this.on || !this.files || !this.has(text)) return false;
    const key = voiceKey(text);
    // The line loaded ahead, else a new element.
    const ready = this.next?.key === key ? this.next.audio : null;
    if (ready) this.next = null;
    const a = ready ?? new Audio(this.url(key));
    a.volume = 0.9;
    this.audio = a;
    if (onLength) {
      if (a.readyState >= 1 && Number.isFinite(a.duration)) onLength(a.duration);
      else a.addEventListener('loadedmetadata', () => this.audio === a && Number.isFinite(a.duration) && onLength(a.duration), { once: true });
    }
    if (onEnd) a.addEventListener('ended', () => this.audio === a && onEnd(), { once: true });
    // Before the visitor's first click or key the browser may refuse to play: the caption still shows.
    void a.play().catch(() => undefined);
    return true;
  }

  stop(): void {
    if (this.audio) {
      release(this.audio);
      this.audio = null;
    }
  }

  dispose(): void {
    this.stop();
    if (this.next) release(this.next.audio);
    this.next = null;
    this.files = null;
  }
}

/** Stop an element and let go of its download. */
function release(a: HTMLAudioElement): void {
  a.pause();
  a.removeAttribute('src');
  a.load();
}
