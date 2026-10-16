/**
 * The JSON reply protocol used to emulate native tool calling on backends that
 * can only return text (Codex and Claude Code in headless mode, small
 * on-device models):
 *
 *   { "thoughts": "…", "tool_calls": [{ "name": "apply_patches", "input": {…} }], "final_message": "…" }
 *
 * Strict structured-output engines (Codex `outputSchema`) cannot describe a
 * free-form object, so they receive a variant whose tool arguments travel as a
 * JSON-encoded string (`input_json`). The parser accepts either form, validates
 * everything with zod and maps the reply to normalized {@link ContentBlock}s, so
 * the agent loop, verification and repair run unchanged.
 */
import { hashString } from '@aether/core';
import { z } from 'zod';
/** Bounds on an emulated reply. */
export const EMULATION_LIMITS = Object.freeze({
    MAX_TOOL_CALLS: 16,
    MAX_THOUGHTS: 4_000,
    MAX_FINAL_MESSAGE: 4_000,
    /** Serialized size of one tool input. */
    MAX_INPUT_CHARS: 600_000,
});
const ToolCallSchema = z
    .object({
    name: z.string().min(1).max(64),
    input: z.unknown().optional(),
    input_json: z.string().max(EMULATION_LIMITS.MAX_INPUT_CHARS).optional(),
})
    .strip();
/** zod schema of an emulated reply (both `input` and `input_json` forms). */
export const EmulatedReplySchema = z
    .object({
    thoughts: z.string().max(EMULATION_LIMITS.MAX_THOUGHTS * 4).optional(),
    tool_calls: z.array(ToolCallSchema).max(EMULATION_LIMITS.MAX_TOOL_CALLS).default([]),
    final_message: z.string().max(EMULATION_LIMITS.MAX_FINAL_MESSAGE * 4).optional(),
})
    .strip();
/**
 * JSON Schema for the reply. `strict` produces the variant accepted by strict
 * structured-output engines: every property required, no free-form objects,
 * tool arguments as a JSON string. Tool names are an enum of `tools`.
 */
export function replyJsonSchema(tools, strict) {
    if (tools.length === 0) {
        return { type: 'object', properties: { final_message: { type: 'string' } }, required: ['final_message'], additionalProperties: false };
    }
    const names = tools.map((t) => t.name);
    const call = strict
        ? {
            type: 'object',
            properties: { name: { type: 'string', enum: names }, input_json: { type: 'string', description: 'The tool input as a JSON object, encoded as a string.' } },
            required: ['name', 'input_json'],
            additionalProperties: false,
        }
        : {
            type: 'object',
            properties: { name: { type: 'string', enum: names }, input: { type: 'object', description: 'The tool input object.' } },
            required: ['name', 'input'],
        };
    return {
        type: 'object',
        properties: {
            thoughts: { type: 'string', description: 'One or two sentences of plan, shown to the user.' },
            tool_calls: { type: 'array', items: call, maxItems: EMULATION_LIMITS.MAX_TOOL_CALLS },
            final_message: { type: 'string', description: 'Message to the user when no tool call is needed; otherwise empty.' },
        },
        required: strict ? ['thoughts', 'tool_calls', 'final_message'] : ['tool_calls'],
        additionalProperties: false,
    };
}
/**
 * Validate an untrusted reply object against the protocol and the request's
 * tools and convert it to a normalized response. Tool-use ids are derived
 * from a content hash, so identical replies map to identical ids.
 */
export function parseEmulatedReply(value, tools, salt) {
    const parsed = EmulatedReplySchema.safeParse(value);
    if (!parsed.success)
        return { ok: false, error: `the reply does not match the JSON protocol (${parsed.error.issues[0]?.message ?? 'invalid'})` };
    const reply = parsed.data;
    const allowed = new Set(tools.map((t) => t.name));
    const content = [];
    const thoughts = (reply.thoughts ?? '').trim().slice(0, EMULATION_LIMITS.MAX_THOUGHTS);
    const final = (reply.final_message ?? '').trim().slice(0, EMULATION_LIMITS.MAX_FINAL_MESSAGE);
    const calls = [];
    for (let i = 0; i < reply.tool_calls.length; i++) {
        const call = reply.tool_calls[i];
        if (!allowed.has(call.name))
            return { ok: false, error: `unknown tool "${call.name.slice(0, 64)}" (available: ${[...allowed].join(', ') || 'none'})` };
        const input = callInput(call);
        if (!input.ok)
            return { ok: false, error: `tool_calls[${i}] (${call.name}): ${input.error}` };
        calls.push({ type: 'tool_use', id: `emu-${hashString(`${salt}|${i}|${call.name}`).toString(36)}-${i}`, name: call.name, input: input.value });
    }
    if (calls.length > 0) {
        const text = thoughts || final;
        if (text)
            content.push({ type: 'text', text });
        content.push(...calls);
        return { ok: true, response: { content, stopReason: 'tool_use' } };
    }
    const text = final || thoughts;
    if (!text)
        return { ok: false, error: 'the reply has neither tool_calls nor a final_message' };
    content.push({ type: 'text', text });
    return { ok: true, response: { content, stopReason: 'end' } };
}
function callInput(call) {
    if (call.input_json !== undefined && call.input_json.trim().length > 0) {
        let value;
        try {
            value = JSON.parse(call.input_json);
        }
        catch {
            return { ok: false, error: 'input_json is not valid JSON' };
        }
        if (typeof value !== 'object' || value === null || Array.isArray(value))
            return { ok: false, error: 'input_json must encode a JSON object' };
        return { ok: true, value };
    }
    const value = call.input ?? {};
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return { ok: false, error: 'input must be a JSON object' };
    let size;
    try {
        size = JSON.stringify(value).length;
    }
    catch {
        return { ok: false, error: 'input is not serializable' };
    }
    if (size > EMULATION_LIMITS.MAX_INPUT_CHARS)
        return { ok: false, error: 'input is too large' };
    return { ok: true, value };
}
