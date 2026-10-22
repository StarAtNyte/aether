/**
 * Continued conversations: the planner conversation of a project's last run,
 * kept so the next run (a chat edit, a playtest repair, a quality round)
 * appends to it instead of starting over with a full world summary. A
 * backend that keeps threads (Codex, Claude Code) then resumes the same
 * thread and is sent only the new turn: what changed in the scene since the
 * model's last turn and the request.
 *
 * Bounded (LRU + time to live, a size budget per conversation), in memory
 * only. A conversation is dropped when its run fails, and replaced by a fresh
 * one when the system prompt changes or it grows past the budget.
 */
import { hashString, type WorldDoc } from '@aether/core';
import type { ChatMessage, ContentBlock } from './types';

/** One remembered conversation. */
export interface ConversationState {
  /** Hash of the planner system prompt it was held with. */
  systemHash: string;
  /** The whole conversation (append-only). */
  messages: ChatMessage[];
  /** The world as the model last saw it (the end of its last run). */
  world: WorldDoc;
  /** Last use (ms). */
  used: number;
}

/** Most conversations kept. */
export const MAX_CONVERSATIONS = 16;
/** A conversation unused for this long is forgotten (ms): 6 hours, like the bridge's threads. */
export const CONVERSATION_TTL_MS = 6 * 60 * 60 * 1000;
/**
 * Rendered size budget of a conversation (characters, images not counted). Beyond it the next run starts a new
 * conversation: a resumable body must stay under the bridge's 512 KiB, and every resumed turn re-reads it.
 */
export const CONVERSATION_BUDGET_CHARS = 300_000;

/** Characters a conversation takes when rendered for a text-only backend (approximate, images excluded). */
export function conversationChars(messages: readonly ChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      n += m.content.length + 20;
      continue;
    }
    for (const b of m.content) {
      if (b.type === 'text') n += b.text.length;
      else if (b.type === 'tool_result') n += Math.min(b.content.length, 12_000) + 40;
      else if (b.type === 'tool_use') n += 420;
      else n += 24;
    }
  }
  return n;
}

/** Largest conversation (characters) kept whole before old tool results are shrunk. */
export const COMPACT_AT_CHARS = 240_000;
/** Messages at the end that are never shrunk. */
export const COMPACT_KEEP_MESSAGES = 12;
const STUB_KEEP_CHARS = 280;

/**
 * Shrink the bulk of old tool results in `messages`, in place, once the conversation passes `maxChars`. The newest
 * `keep` messages stay whole; older results over 600 characters keep their first lines and say how much was dropped.
 * Done in one sweep (not one message per turn), so what is sent changes once and then stays stable for the cache.
 * Returns how many results were shrunk.
 */
export function compactConversation(messages: ChatMessage[], maxChars = COMPACT_AT_CHARS, keep = COMPACT_KEEP_MESSAGES): number {
  if (conversationChars(messages) <= maxChars) return 0;
  let shrunk = 0;
  for (let i = 0; i < messages.length - keep; i++) {
    const m = messages[i];
    if (!m || typeof m.content === 'string') continue;
    let changed = false;
    const blocks = m.content.map((b): ContentBlock => {
      if (b.type === 'tool_result' && b.content.length > 600 && !b.content.includes('were dropped to save space')) {
        changed = true;
        shrunk++;
        return { ...b, content: `${b.content.slice(0, STUB_KEEP_CHARS)}\n… [${b.content.length - STUB_KEEP_CHARS} characters of this old result were dropped to save space]` };
      }
      return b;
    });
    if (changed) messages[i] = { role: m.role, content: blocks };
  }
  return shrunk;
}

/** Hash of a system prompt (a changed prompt starts a new conversation). */
export function systemHash(system: string): string {
  return `${hashString(system).toString(36)}-${system.length}`;
}

/** In-memory LRU of continued conversations, keyed by the project's session key. */
export class ConversationStore {
  private readonly map = new Map<string, ConversationState>();

  constructor(private readonly now: () => number = Date.now) {}

  private sweep(): void {
    const t = this.now();
    for (const [k, c] of this.map) if (t - c.used > CONVERSATION_TTL_MS) this.map.delete(k);
    while (this.map.size > MAX_CONVERSATIONS) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  /** The conversation to continue for `key` with `system`, or null (none, another system prompt, over budget). */
  continuable(key: string, system: string): ConversationState | null {
    this.sweep();
    const c = this.map.get(key);
    if (!c || c.systemHash !== systemHash(system)) return null;
    // Over the budget: old tool results shrink (a backend that resumes threads then starts a new one, as it would have
    // anyway) instead of the whole conversation being thrown away; only a conversation that stays too big is dropped.
    if (conversationChars(c.messages) > CONVERSATION_BUDGET_CHARS) compactConversation(c.messages, CONVERSATION_BUDGET_CHARS * 0.6);
    return conversationChars(c.messages) > CONVERSATION_BUDGET_CHARS ? null : c;
  }

  /** Remember the conversation of a finished run. */
  save(key: string, system: string, messages: readonly ChatMessage[], world: WorldDoc): void {
    this.map.delete(key);
    this.map.set(key, { systemHash: systemHash(system), messages: messages.slice(), world, used: this.now() });
    this.sweep();
  }

  /** Forget one conversation (a failed run, a deleted project). */
  forget(key: string): void {
    this.map.delete(key);
  }

  /** Forget every conversation. */
  clear(): void {
    this.map.clear();
  }

  /** Number of conversations kept. */
  get size(): number {
    return this.map.size;
  }
}

/** The conversations of this page / process (hosts may pass their own through `AgentOptions.conversations`). */
export const sharedConversations = new ConversationStore();
