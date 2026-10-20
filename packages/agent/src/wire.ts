/**
 * zod schemas for the provider-agnostic wire types. The server validates
 * incoming `CompletionRequest`s with them and the HTTP provider validates the
 * server's `CompletionResponse`s, so both ends of the proxy treat the other as
 * untrusted. Limits are deliberately generous for real use but bounded.
 */
import { z } from 'zod';

/** Hard bounds on proxied requests. */
export const WIRE_LIMITS = Object.freeze({
  MAX_MESSAGES: 200,
  MAX_BLOCKS_PER_MESSAGE: 200,
  MAX_TEXT: 400_000,
  MAX_SYSTEM: 200_000,
  MAX_TOOLS: 32,
  MAX_IMAGES: 4,
  /** Base64 data URL length cap (~5 MiB decoded). */
  MAX_DATA_URL: 7_100_000,
  MAX_OUTPUT_TOKENS: 64_000,
});

const ToolId = z.string().min(1).max(256);

/** Schema of a {@link import('./types').ContentBlock}. */
export const ContentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(WIRE_LIMITS.MAX_TEXT) }),
  z.object({ type: z.literal('image'), dataUrl: z.string().max(WIRE_LIMITS.MAX_DATA_URL).regex(/^data:image\/(png|jpeg|webp|gif);base64,/) }),
  z.object({ type: z.literal('tool_use'), id: ToolId, name: z.string().min(1).max(128), input: z.unknown() }),
  z.object({ type: z.literal('tool_result'), toolUseId: ToolId, content: z.string().max(WIRE_LIMITS.MAX_TEXT), isError: z.boolean().optional() }),
]);

/** Schema of a {@link import('./types').ChatMessage}. */
export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string().max(WIRE_LIMITS.MAX_TEXT), z.array(ContentBlockSchema).max(WIRE_LIMITS.MAX_BLOCKS_PER_MESSAGE)]),
});

/** Schema of a {@link import('./types').ToolDef}. */
export const ToolDefSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  description: z.string().max(10_000),
  inputSchema: z.record(z.string(), z.unknown()),
});

/** Schema of a {@link import('./types').CompletionRequest}; also caps the image count. */
export const CompletionRequestSchema = z
  .object({
    role: z.enum(['planner', 'coder', 'critic']),
    model: z.string().max(128).optional(),
    system: z.string().max(WIRE_LIMITS.MAX_SYSTEM),
    messages: z.array(ChatMessageSchema).min(1).max(WIRE_LIMITS.MAX_MESSAGES),
    tools: z.array(ToolDefSchema).max(WIRE_LIMITS.MAX_TOOLS).optional(),
    maxTokens: z.number().int().positive().max(WIRE_LIMITS.MAX_OUTPUT_TOKENS).optional(),
    temperature: z.number().min(0).max(2).optional(),
    seed: z.number().int().min(0).max(2_147_483_647).optional(),
    session: z.string().regex(/^[a-z0-9][a-z0-9-]{7,79}$/).optional(),
  })
  .refine((r) => countImages(r.messages) <= WIRE_LIMITS.MAX_IMAGES, { message: `at most ${WIRE_LIMITS.MAX_IMAGES} images per request` });

/** Schema of a {@link import('./types').CompletionResponse}. */
export const CompletionResponseSchema = z.object({
  content: z.array(ContentBlockSchema).max(WIRE_LIMITS.MAX_BLOCKS_PER_MESSAGE),
  stopReason: z.enum(['end', 'tool_use', 'max_tokens', 'error']),
  usage: z.object({ inputTokens: z.number().min(0), outputTokens: z.number().min(0) }).optional(),
  model: z.string().max(128).optional(),
});

function countImages(messages: ReadonlyArray<z.infer<typeof ChatMessageSchema>>): number {
  let n = 0;
  for (const m of messages) if (typeof m.content !== 'string') for (const b of m.content) if (b.type === 'image') n++;
  return n;
}
