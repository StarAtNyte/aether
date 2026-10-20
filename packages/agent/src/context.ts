/**
 * The user-turn envelope sent to the planner and history sanitization.
 *
 * The world summary and the request are wrapped in explicit tags so the model
 * (and the offline mock planner) can tell data from instructions.
 */
import { hashString } from '@aether/core';
import type { ChatMessage, ContentBlock } from './types';

/** Input limits of {@link import('./agent').WorldAgent.run}. */
export const CONTEXT_LIMITS = Object.freeze({
  MAX_PROMPT_CHARS: 8_000,
  MAX_IMAGES: 4,
  MAX_HISTORY_MESSAGES: 16,
  MAX_HISTORY_CHARS_PER_MESSAGE: 4_000,
  /** Entity lines in the summary sent with each request. */
  SUMMARY_ENTITIES: 200,
});

const SUMMARY_OPEN = '<world_summary>';
const SUMMARY_CLOSE = '</world_summary>';
const MODE_OPEN = '<edit_mode>';
const MODE_CLOSE = '</edit_mode>';
const REQUEST_OPEN = '<request>';
const REQUEST_CLOSE = '</request>';

/** Neutralize our envelope tags inside untrusted text so it cannot close or forge a section. */
function escapeTags(text: string): string {
  return text.replace(/<\/?(world_summary|scene_changes|request|edit_mode)>/gi,(m) => m.replace('<', '‹').replace('>', '›'));
}

/** Build the text of the planner's user turn. */
export function formatUserTurn(summary: string, prompt: string, mode?: string): string {
  const hint = mode ? `${MODE_OPEN}\n${escapeTags(mode)}\n${MODE_CLOSE}\n` : '';
  return `${SUMMARY_OPEN}\n${escapeTags(summary)}\n${SUMMARY_CLOSE}\n${hint}${REQUEST_OPEN}\n${escapeTags(prompt)}\n${REQUEST_CLOSE}`;
}

/** Inverse of {@link formatUserTurn}; `null` when the text is not an envelope. */
export function parseUserTurn(text: string): { summary: string; request: string; mode?: string } | null {
  const s0 = text.indexOf(SUMMARY_OPEN);
  const s1 = text.indexOf(SUMMARY_CLOSE);
  const r0 = text.indexOf(REQUEST_OPEN);
  const r1 = text.lastIndexOf(REQUEST_CLOSE);
  if (r0 < 0 || r1 < r0) return null;
  const summary = s0 >= 0 && s1 > s0 ? text.slice(s0 + SUMMARY_OPEN.length, s1).trim() : '';
  const m0 = text.indexOf(MODE_OPEN);
  const m1 = text.indexOf(MODE_CLOSE);
  const mode = m0 >= 0 && m1 > m0 ? text.slice(m0 + MODE_OPEN.length, m1).trim() : '';
  return { summary, request: text.slice(r0 + REQUEST_OPEN.length, r1).trim(), ...(mode ? { mode } : {}) };
}

/** Plain text of a message (text blocks only). */
export function messageText(m: ChatMessage): string {
  if (typeof m.content === 'string') return m.content;
  return m.content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n');
}

/**
 * Reduce prior chat history to bounded text-only turns that start with a
 * user message. Tool calls/results and images are dropped: they belong to
 * finished runs and would otherwise create unpaired tool blocks.
 */
export function sanitizeHistory(history: readonly ChatMessage[] | undefined): ChatMessage[] {
  if (!history || history.length === 0) return [];
  const out: ChatMessage[] = [];
  for (const m of history.slice(-CONTEXT_LIMITS.MAX_HISTORY_MESSAGES)) {
    if (m === null || typeof m !== 'object' || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const text = messageText(m).trim().slice(0, CONTEXT_LIMITS.MAX_HISTORY_CHARS_PER_MESSAGE);
    if (text.length === 0) continue;
    if (out.length === 0 && m.role !== 'user') continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content = `${prev.content as string}\n\n${text}`;
    else out.push({ role: m.role, content: text });
  }
  return out;
}

const DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

/** True for an acceptable base64 image data URL (≤ ~5 MiB). */
export function isImageDataUrl(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 7_100_000 && DATA_URL.test(v);
}

/** Text that opens a look-and-fix round with renders (building review, level review, photo comparison). */
const ROUND_MARK = /^(?:(?:LEVEL )?REVIEW round \d+|Image \d+: (?:the PHOTO|RENDER))/;
/** Labels of the images of a round ("Image 2: front, from the street"). */
const IMAGE_LABEL = /^Image \d+:/;

/**
 * The conversation as one request should carry it, without changing
 * `messages` (the conversation stays append-only, so resumed threads and
 * prompt caches keep matching it): the images of earlier look-and-fix rounds
 * give way to a note, then at most `max` images are kept, the newest first.
 */
export function limitImages(messages: readonly ChatMessage[], max: number = CONTEXT_LIMITS.MAX_IMAGES): ChatMessage[] {
  let latest = -1;
  messages.forEach((m, i) => {
    if (m.role === 'user' && typeof m.content !== 'string' && m.content.some((b) => b.type === 'image')) latest = i;
  });
  let kept = 0;
  const out = messages.slice();
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || typeof m.content === 'string' || !m.content.some((b) => b.type === 'image')) continue;
    if (i !== latest && m.content.some((b) => b.type === 'text' && ROUND_MARK.test(b.text))) {
      const text = m.content.filter((b) => b.type !== 'image' && !(b.type === 'text' && IMAGE_LABEL.test(b.text)));
      out[i] = { role: m.role, content: [...text, { type: 'text', text: '(The images of this round were removed to save space.)' }] };
      continue;
    }
    const blocks: ContentBlock[] = [];
    let dropped = 0;
    for (let j = m.content.length - 1; j >= 0; j--) {
      const b = m.content[j];
      if (!b) continue;
      if (b.type === 'image') {
        if (kept >= max) {
          dropped++;
          continue;
        }
        kept++;
      }
      blocks.unshift(b);
    }
    if (dropped > 0) out[i] = { role: m.role, content: [...blocks, { type: 'text', text: `(${dropped} earlier image${dropped === 1 ? ' was' : 's were'} removed to stay within the image limit.)` }] };
  }
  return out;
}

/** The stable key of an image: a short hash of its data URL. */
export function imageKey(dataUrl: string): string {
  return `i${hashString(dataUrl).toString(36)}`;
}

const GHOST_RE = /^\[image (i[a-z0-9]{1,14}) removed\]$/;

/** The key of an image that was taken out of a request ({@link requestView}), or null for any other text. */
export function ghostImageKey(text: string): string | null {
  return GHOST_RE.exec(text)?.[1] ?? null;
}

/**
 * What one request carries of an append-only conversation: the images
 * {@link limitImages} would drop are replaced, in place, by a short
 * `[image <key> removed]` text. Nothing else changes, so a text-only backend
 * renders the conversation exactly as before (its prefix stays stable) and a
 * request never carries more than `max` images.
 */
export function requestView(messages: readonly ChatMessage[], max: number = CONTEXT_LIMITS.MAX_IMAGES): ChatMessage[] {
  const kept = new Set<ContentBlock>();
  for (const m of limitImages(messages, max)) if (typeof m.content !== 'string') for (const b of m.content) if (b.type === 'image') kept.add(b);
  return messages.map((m) => {
    if (typeof m.content === 'string' || !m.content.some((b) => b.type === 'image' && !kept.has(b))) return m;
    return { role: m.role, content: m.content.map((b): ContentBlock => (b.type === 'image' && !kept.has(b) ? { type: 'text', text: `[image ${imageKey(b.dataUrl)} removed]` } : b)) };
  });
}

const CHANGES_OPEN = '<scene_changes>';
const CHANGES_CLOSE = '</scene_changes>';

/**
 * The user turn of a continued conversation: what changed in the scene since
 * the model's last turn (instead of a full summary: the conversation already
 * holds the scene it built), the edit mode and the request.
 */
export function formatFollowUpTurn(changes: string, prompt: string, mode?: string): string {
  const hint = mode ? `${MODE_OPEN}\n${escapeTags(mode)}\n${MODE_CLOSE}\n` : '';
  return `${CHANGES_OPEN}\n${escapeTags(changes)}\n${CHANGES_CLOSE}\n${hint}${REQUEST_OPEN}\n${escapeTags(prompt)}\n${REQUEST_CLOSE}`;
}
