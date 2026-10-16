/**
 * Recording and replay of model transcripts. A recording keeps what the
 * model answered, in order; replaying it drives the agent loop with the same
 * answers, so everything that follows (tool execution, patches, review,
 * checker numbers) is reproduced exactly, with no model call. That is what
 * makes live evaluations repeatable in CI.
 */
import { z } from 'zod';
import { CompletionResponseSchema } from '../wire';
/** Bounds on a stored transcript. */
export const TRANSCRIPT_LIMITS = Object.freeze({ MAX_RESPONSES: 400 });
/** A recorded run: the model's answers in order. */
export const TranscriptSchema = z.object({
    version: z.literal(1),
    /** The prompt the run answered (documentation; replay does not read it). */
    prompt: z.string().max(8_000),
    /** Provider and model that produced it. */
    source: z.string().max(200).default(''),
    responses: z.array(CompletionResponseSchema).max(TRANSCRIPT_LIMITS.MAX_RESPONSES),
});
/** Wrap `inner` so its answers are kept. */
export function createRecordingProvider(inner) {
    const responses = [];
    return {
        name: inner.name,
        async complete(req, signal) {
            const res = await inner.complete(req, signal);
            if (responses.length < TRANSCRIPT_LIMITS.MAX_RESPONSES)
                responses.push({ content: res.content, stopReason: res.stopReason, ...(res.model ? { model: res.model } : {}) });
            return res;
        },
        transcript(prompt, source = inner.name) {
            return { version: 1, prompt: prompt.slice(0, 8_000), source: source.slice(0, 200), responses: structuredClone(responses) };
        },
    };
}
/**
 * Replays a transcript. When the agent asks for more answers than were recorded it throws (strict, the
 * default) or, with `onExhausted: 'finish'`, answers "nothing more to change" (tolerant, for fixtures whose
 * tool results drifted after the model's code changed).
 */
export function createReplayProvider(transcript, opts = {}) {
    const name = opts.name ?? 'replay';
    const parsed = TranscriptSchema.parse(transcript);
    let i = 0;
    return {
        name,
        used: () => i,
        async complete() {
            const r = parsed.responses[i];
            if (!r && opts.onExhausted === 'finish')
                return { content: [{ type: 'text', text: 'Nothing more to change.' }], stopReason: 'end' };
            if (!r)
                throw new Error(`the recorded transcript has only ${parsed.responses.length} answers; the agent asked for more (re-record the fixture)`);
            i++;
            return structuredClone(r);
        },
    };
}
