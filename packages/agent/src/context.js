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
function escapeTags(text) {
    return text.replace(/<\/?(world_summary|request|edit_mode)>/gi, (m) => m.replace('<', '‹').replace('>', '›'));
}
/** Build the text of the planner's user turn. */
export function formatUserTurn(summary, prompt, mode) {
    const hint = mode ? `${MODE_OPEN}\n${escapeTags(mode)}\n${MODE_CLOSE}\n` : '';
    return `${SUMMARY_OPEN}\n${escapeTags(summary)}\n${SUMMARY_CLOSE}\n${hint}${REQUEST_OPEN}\n${escapeTags(prompt)}\n${REQUEST_CLOSE}`;
}
/** Inverse of {@link formatUserTurn}; `null` when the text is not an envelope. */
export function parseUserTurn(text) {
    const s0 = text.indexOf(SUMMARY_OPEN);
    const s1 = text.indexOf(SUMMARY_CLOSE);
    const r0 = text.indexOf(REQUEST_OPEN);
    const r1 = text.lastIndexOf(REQUEST_CLOSE);
    if (r0 < 0 || r1 < r0)
        return null;
    const summary = s0 >= 0 && s1 > s0 ? text.slice(s0 + SUMMARY_OPEN.length, s1).trim() : '';
    const m0 = text.indexOf(MODE_OPEN);
    const m1 = text.indexOf(MODE_CLOSE);
    const mode = m0 >= 0 && m1 > m0 ? text.slice(m0 + MODE_OPEN.length, m1).trim() : '';
    return { summary, request: text.slice(r0 + REQUEST_OPEN.length, r1).trim(), ...(mode ? { mode } : {}) };
}
/** Plain text of a message (text blocks only). */
export function messageText(m) {
    if (typeof m.content === 'string')
        return m.content;
    return m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}
/**
 * Reduce prior chat history to bounded text-only turns that start with a
 * user message. Tool calls/results and images are dropped: they belong to
 * finished runs and would otherwise create unpaired tool blocks.
 */
export function sanitizeHistory(history) {
    if (!history || history.length === 0)
        return [];
    const out = [];
    for (const m of history.slice(-CONTEXT_LIMITS.MAX_HISTORY_MESSAGES)) {
        if (m === null || typeof m !== 'object' || (m.role !== 'user' && m.role !== 'assistant'))
            continue;
        const text = messageText(m).trim().slice(0, CONTEXT_LIMITS.MAX_HISTORY_CHARS_PER_MESSAGE);
        if (text.length === 0)
            continue;
        if (out.length === 0 && m.role !== 'user')
            continue;
        const prev = out[out.length - 1];
        if (prev && prev.role === m.role)
            prev.content = `${prev.content}\n\n${text}`;
        else
            out.push({ role: m.role, content: text });
    }
    return out;
}
const DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
/** True for an acceptable base64 image data URL (≤ ~5 MiB). */
export function isImageDataUrl(v) {
    return typeof v === 'string' && v.length <= 7_100_000 && DATA_URL.test(v);
}
