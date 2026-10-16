/**
 * Strict zod schemas for the `/api/llm` proxy boundary.
 *
 * Request shapes mirror `CompletionRequest` from @aether/agent (see
 * docs/CONTRACTS.md) but are deliberately stricter: unknown keys are rejected,
 * every string/array is bounded, and images must be small base64 data URLs of
 * an allowlisted MIME type. Responses from upstream providers are untrusted
 * too and are re-validated before being returned to the browser.
 */
import { z } from 'zod';
/** Hard limits for a single completion request. */
export const LLM_LIMITS = Object.freeze({
    MAX_SYSTEM_CHARS: 60_000,
    MAX_MESSAGES: 60,
    MAX_BLOCKS_PER_MESSAGE: 64,
    MAX_TEXT_CHARS: 200_000,
    MAX_IMAGES: 4,
    /** Maximum length of one image data URL (characters ≈ bytes). */
    MAX_IMAGE_DATA_URL: 1_500_000,
    MAX_TOOLS: 16,
    MAX_TOOL_DESCRIPTION: 4_000,
    MAX_TOOL_SCHEMA_CHARS: 32_000,
});
/** Allowed image MIME types inside data URLs. */
export const IMAGE_DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const ToolName = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'invalid tool name');
const TextBlock = z.object({ type: z.literal('text'), text: z.string().max(LLM_LIMITS.MAX_TEXT_CHARS) }).strict();
const ImageBlock = z
    .object({
    type: z.literal('image'),
    dataUrl: z
        .string()
        .max(LLM_LIMITS.MAX_IMAGE_DATA_URL, 'image is too large')
        .regex(IMAGE_DATA_URL_RE, 'image must be a base64 data URL of type image/png, image/jpeg or image/webp'),
})
    .strict();
const ToolUseBlock = z
    .object({
    type: z.literal('tool_use'),
    id: z.string().min(1).max(128),
    name: ToolName,
    input: z.unknown(),
})
    .strict();
const ToolResultBlock = z
    .object({
    type: z.literal('tool_result'),
    toolUseId: z.string().min(1).max(128),
    content: z.string().max(LLM_LIMITS.MAX_TEXT_CHARS),
    isError: z.boolean().optional(),
})
    .strict();
/** One content block of a chat message. */
export const ContentBlockSchema = z.discriminatedUnion('type', [TextBlock, ImageBlock, ToolUseBlock, ToolResultBlock]);
const ChatMessageSchema = z
    .object({
    role: z.enum(['user', 'assistant']),
    content: z.union([z.string().max(LLM_LIMITS.MAX_TEXT_CHARS), z.array(ContentBlockSchema).min(1).max(LLM_LIMITS.MAX_BLOCKS_PER_MESSAGE)]),
})
    .strict();
const ToolDefSchema = z
    .object({
    name: ToolName,
    description: z.string().max(LLM_LIMITS.MAX_TOOL_DESCRIPTION),
    inputSchema: z.record(z.string(), z.unknown()),
})
    .strict()
    .refine((t) => JSON.stringify(t.inputSchema).length <= LLM_LIMITS.MAX_TOOL_SCHEMA_CHARS, {
    message: 'tool inputSchema is too large',
    path: ['inputSchema'],
});
/** Role of the agent sub-model making the call. */
export const RoleSchema = z.enum(['planner', 'coder', 'critic']);
/**
 * Validated `CompletionRequest`. `model` is accepted for wire compatibility
 * but always ignored: the server chooses the model from `role`.
 */
export const CompletionRequestSchema = z
    .object({
    role: RoleSchema,
    model: z.string().max(200).optional(),
    system: z.string().max(LLM_LIMITS.MAX_SYSTEM_CHARS),
    messages: z.array(ChatMessageSchema).min(1).max(LLM_LIMITS.MAX_MESSAGES),
    tools: z.array(ToolDefSchema).max(LLM_LIMITS.MAX_TOOLS).optional(),
    maxTokens: z.number().int().min(1).max(1_000_000).optional(),
    temperature: z.number().min(0).max(2).optional(),
})
    .strict()
    .superRefine((req, ctx) => {
    let images = 0;
    for (const m of req.messages) {
        if (typeof m.content === 'string')
            continue;
        for (const b of m.content)
            if (b.type === 'image')
                images++;
    }
    if (images > LLM_LIMITS.MAX_IMAGES) {
        ctx.addIssue({ code: 'custom', path: ['messages'], message: `too many images (${images} > ${LLM_LIMITS.MAX_IMAGES})` });
    }
    if (req.tools) {
        const seen = new Set();
        for (const t of req.tools) {
            if (seen.has(t.name))
                ctx.addIssue({ code: 'custom', path: ['tools'], message: `duplicate tool '${t.name}'` });
            seen.add(t.name);
        }
    }
});
/** Response from a provider, re-validated before being sent to the client. */
export const CompletionResponseSchema = z.object({
    content: z.array(ContentBlockSchema).max(256),
    stopReason: z.enum(['end', 'tool_use', 'max_tokens', 'error']),
    usage: z
        .object({
        inputTokens: z.number().int().min(0),
        outputTokens: z.number().int().min(0),
    })
        .optional(),
    model: z.string().max(200).optional(),
});
