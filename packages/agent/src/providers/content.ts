/**
 * Helpers shared by providers: content normalization, image data-URL parsing
 * and a small LRU used to replay provider-private blocks (reasoning/thinking)
 * verbatim on later turns of the same conversation.
 */
import { stableStringify } from '@aether/core';
import type { ChatMessage, ContentBlock } from '../types';
import { ProviderError } from './errors';

/** Image types every supported provider accepts. */
export const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** Maximum decoded image size accepted (5 MiB, the strictest provider limit). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

/** Parse and validate a base64 image data URL. Throws a `bad_request` ProviderError. */
export function parseImageDataUrl(dataUrl: string): { mediaType: string; data: string } {
  const m = DATA_URL.exec(dataUrl);
  if (!m) throw new ProviderError('bad_request', 'images must be base64 data URLs (data:image/png;base64,...)');
  const mediaType = m[1] as string;
  const data = m[2] as string;
  if (!IMAGE_MEDIA_TYPES.has(mediaType)) throw new ProviderError('bad_request', `unsupported image type ${mediaType}`);
  if (Math.floor((data.length * 3) / 4) > MAX_IMAGE_BYTES) throw new ProviderError('bad_request', 'image exceeds 5 MiB');
  return { mediaType, data };
}

/** Content as a block array (strings become one text block). */
export function blocksOf(msg: ChatMessage): ContentBlock[] {
  return typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content;
}

/** Stable key identifying an assistant turn by its normalized content. */
export function contentKey(blocks: readonly ContentBlock[]): string {
  return stableStringify(blocks);
}

/** Minimal LRU map (insertion-ordered Map). */
export class LruMap<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly capacity: number) {}

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

/**
 * Parse tool-call arguments produced by a model. Malformed JSON is returned as
 * the raw string so the agent's schema validation reports it back to the model.
 */
export function parseToolArguments(raw: string): unknown {
  if (raw.trim().length === 0) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}
